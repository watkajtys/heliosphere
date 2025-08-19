#!/usr/bin/env node

/**
 * Heliosphere Daily Production System
 * Generates daily videos with 48-hour data delay for complete satellite coverage
 * Maintains rolling 56-day window with dual video output
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // Server
    PORT: process.env.PORT || 3001,
    
    // Time windows
    SAFE_DELAY_DAYS: 2,      // 48-hour delay for data availability
    TOTAL_DAYS: 56,          // Full video window
    SOCIAL_DAYS: 30,         // Social media video window
    
    // Frame settings
    FRAMES_PER_DAY: 96,      // One frame every 15 minutes
    INTERVAL_MINUTES: 15,
    FPS: 24,                 // Universal frame rate
    
    // Frame dimensions
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    
    // Processing
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 100,         // Save state every N frames
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14, // Stay within frame boundary
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    // Cloudflare proxy
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Storage paths
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/daily_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    TEMP_DIR: '/tmp/heliosphere'
};

// Global state
let productionState = {
    status: 'idle',
    startTime: null,
    lastUpdate: null,
    currentDate: null,
    dateRange: { start: null, end: null },
    totalFrames: 0,
    processedFrames: 0,
    fetchedFrames: 0,
    interpolatedFrames: 0,
    fallbacksUsed: 0,
    errors: [],
    frameManifest: {},
    checksums: {
        corona: new Set(),
        sunDisk: new Set()
    }
};

// Initialize Express
const app = express();
app.use(express.json());

// Serve static files for monitor (must be before routes)
app.use(express.static('/opt/heliosphere'));

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Load state from disk
async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
        const saved = JSON.parse(data);
        // Restore Sets from arrays
        if (saved.checksums) {
            saved.checksums.corona = new Set(saved.checksums.corona || []);
            saved.checksums.sunDisk = new Set(saved.checksums.sunDisk || []);
        }
        productionState = { ...productionState, ...saved };
        console.log('📋 Loaded previous state');
    } catch {
        console.log('📋 Starting fresh state');
    }
}

// Save state to disk
async function saveState() {
    try {
        const toSave = {
            ...productionState,
            checksums: {
                corona: Array.from(productionState.checksums.corona),
                sunDisk: Array.from(productionState.checksums.sunDisk)
            }
        };
        await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
    } catch (error) {
        console.error('Failed to save state:', error);
    }
}

// Load frame manifest
async function loadManifest() {
    try {
        const data = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf-8');
        productionState.frameManifest = JSON.parse(data);
        console.log(`📊 Loaded manifest with ${Object.keys(productionState.frameManifest).length} frames`);
    } catch {
        productionState.frameManifest = {};
        console.log('📊 Starting new manifest');
    }
}

// Save frame manifest
async function saveManifest() {
    await fs.writeFile(CONFIG.MANIFEST_FILE, JSON.stringify(productionState.frameManifest, null, 2));
}

// Calculate date range with 48-hour delay
function calculateDateRange() {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    endDate.setHours(23, 45, 0, 0); // Last frame of the day
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.TOTAL_DAYS + 1);
    startDate.setHours(0, 0, 0, 0); // First frame of the day
    
    return { startDate, endDate };
}

// Generate frame key for manifest
function getFrameKey(date) {
    return date.toISOString();
}

// Get frame file path
function getFramePath(date) {
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toISOString().split('T')[1].substring(0, 5).replace(':', '');
    return path.join(CONFIG.FRAMES_DIR, dateStr, `frame_${timeStr}.jpg`);
}

// Fetch image with fallback logic
async function fetchImageWithFallback(targetDate, sourceId, sourceType) {
    const fallbackSteps = sourceType === 'SOHO' 
        ? CONFIG.FALLBACK_STEPS_SOHO 
        : CONFIG.FALLBACK_STEPS_SDO;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate.getTime() + minuteOffset * 60 * 1000);
        
        try {
            const imageBuffer = await fetchImage(sourceId, tryDate.toISOString());
            const checksum = crypto.createHash('md5').update(imageBuffer).digest('hex');
            
            // Check for duplicate
            const checksumSet = sourceId === 4 ? 
                productionState.checksums.corona : 
                productionState.checksums.sunDisk;
            
            if (checksumSet.has(checksum) && minuteOffset !== 0) {
                console.log(`⚠️ Duplicate detected at ${minuteOffset} min offset, trying next...`);
                continue;
            }
            
            checksumSet.add(checksum);
            
            if (minuteOffset !== 0) {
                productionState.fallbacksUsed++;
                console.log(`✓ Used ${minuteOffset} min fallback for ${sourceType}`);
            }
            
            return {
                buffer: imageBuffer,
                checksum,
                fallbackMinutes: minuteOffset,
                fallbackUsed: minuteOffset !== 0
            };
            
        } catch (error) {
            // Try next fallback
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed for ${sourceType}: ${error.message}`);
            }
        }
    }
}

// Fetch single image
async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}` +
        `&layers=[${sourceId},1,100]` +
        `&imageScale=${imageScale}` +
        `&width=${width}` +
        `&height=${height}` +
        `&x0=0&y0=0` +
        `&display=true` +
        `&watermark=false`;
    
    const fetchUrl = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/?url=${encodeURIComponent(apiUrl)}`
        : apiUrl;
    
    const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}.png`);
    
    try {
        await execAsync(`curl -s -o "${tempFile}" "${fetchUrl}"`, { timeout: 30000 });
        const buffer = await fs.readFile(tempFile);
        await fs.unlink(tempFile).catch(() => {});
        return buffer;
    } catch (error) {
        await fs.unlink(tempFile).catch(() => {});
        throw error;
    }
}

// Apply color grading to corona
async function gradeCorona(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

// Apply Ad Astra color grading to sun disk
async function gradeSunDisk(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

// Apply square feathering
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    const squareTop = center - compositeRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <linearGradient id="featherHorizontal" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius / squareSize) * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${100 - (featherRadius / squareSize) * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
                <linearGradient id="featherVertical" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius / squareSize) * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${100 - (featherRadius / squareSize) * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
            </defs>
            <rect x="${squareLeft}" y="0" width="${squareSize}" height="${finalSize}" fill="url(#featherHorizontal)" />
            <rect x="0" y="${squareTop}" width="${finalSize}" height="${squareSize}" fill="url(#featherVertical)" style="mix-blend-mode: multiply" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

// Process single frame
async function processFrame(coronaData, sunDiskData) {
    // Apply color grading
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCorona(coronaData.buffer),
        gradeSunDisk(sunDiskData.buffer)
    ]);
    
    // Apply square feathering to sun disk
    const featheredSunDisk = await applySquareFeather(
        gradedSunDisk, 1435, CONFIG.COMPOSITE_RADIUS, CONFIG.FEATHER_RADIUS
    );
    
    // Create composite
    const compositeImage = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: gradedCorona, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
    
    // Crop to final dimensions
    const finalImage = await sharp(compositeImage)
        .extract({
            left: 230,
            top: 117,
            width: CONFIG.FRAME_WIDTH,
            height: CONFIG.FRAME_HEIGHT
        })
        .jpeg({ quality: 90 })
        .toBuffer();
    
    return finalImage;
}

// Interpolate missing frame from neighbors
async function interpolateFrame(prevFrame, nextFrame) {
    // Simple 50/50 blend
    const interpolated = await sharp(prevFrame)
        .composite([{
            input: nextFrame,
            blend: 'over',
            opacity: 0.5
        }])
        .jpeg({ quality: 90 })
        .toBuffer();
    
    productionState.interpolatedFrames++;
    return interpolated;
}

// Process all frames for date range
async function processDateRange() {
    const { startDate, endDate } = calculateDateRange();
    productionState.dateRange = { 
        start: startDate.toISOString(), 
        end: endDate.toISOString() 
    };
    
    console.log(`\n📅 Processing ${CONFIG.TOTAL_DAYS} days`);
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To:   ${endDate.toISOString().split('T')[0]}`);
    
    // Generate all frame timestamps
    const frames = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        frames.push(new Date(currentDate));
        currentDate.setMinutes(currentDate.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    productionState.totalFrames = frames.length;
    console.log(`\n📊 Total frames to process: ${frames.length}`);
    
    // Process frames with concurrency control
    const missingFrames = [];
    
    for (let i = 0; i < frames.length; i++) {
        const frameDate = frames[i];
        const frameKey = getFrameKey(frameDate);
        const framePath = getFramePath(frameDate);
        
        // Check if frame already exists
        if (productionState.frameManifest[frameKey] && await fileExists(framePath)) {
            productionState.processedFrames++;
            continue;
        }
        
        try {
            // Fetch with fallback
            const [coronaData, sunDiskData] = await Promise.all([
                fetchImageWithFallback(frameDate, 4, 'SOHO'),
                fetchImageWithFallback(frameDate, 10, 'SDO')
            ]);
            
            // Process frame
            const processedFrame = await processFrame(coronaData, sunDiskData);
            
            // Save frame
            const dir = path.dirname(framePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(framePath, processedFrame);
            
            // Update manifest
            productionState.frameManifest[frameKey] = {
                path: framePath,
                date: frameDate.toISOString(),
                coronaChecksum: coronaData.checksum,
                sunDiskChecksum: sunDiskData.checksum,
                coronaFallback: coronaData.fallbackMinutes,
                sunDiskFallback: sunDiskData.fallbackMinutes
            };
            
            productionState.processedFrames++;
            productionState.fetchedFrames++;
            
            // Save state periodically
            if (productionState.processedFrames % CONFIG.BATCH_SIZE === 0) {
                await saveState();
                await saveManifest();
                console.log(`✓ Processed ${productionState.processedFrames}/${productionState.totalFrames} frames`);
            }
            
        } catch (error) {
            console.error(`❌ Failed frame ${i}: ${error.message}`);
            missingFrames.push(i);
            productionState.errors.push({
                frame: i,
                date: frameDate.toISOString(),
                error: error.message
            });
        }
        
        // Update progress
        if (i % 10 === 0) {
            const progress = ((i / frames.length) * 100).toFixed(1);
            console.log(`Progress: ${progress}% (${i}/${frames.length})`);
        }
    }
    
    // Interpolate missing frames
    if (missingFrames.length > 0) {
        console.log(`\n🔧 Interpolating ${missingFrames.length} missing frames...`);
        
        for (const frameIndex of missingFrames) {
            if (frameIndex > 0 && frameIndex < frames.length - 1) {
                const prevPath = getFramePath(frames[frameIndex - 1]);
                const nextPath = getFramePath(frames[frameIndex + 1]);
                const targetPath = getFramePath(frames[frameIndex]);
                
                if (await fileExists(prevPath) && await fileExists(nextPath)) {
                    try {
                        const prevFrame = await fs.readFile(prevPath);
                        const nextFrame = await fs.readFile(nextPath);
                        const interpolated = await interpolateFrame(prevFrame, nextFrame);
                        
                        const dir = path.dirname(targetPath);
                        await fs.mkdir(dir, { recursive: true });
                        await fs.writeFile(targetPath, interpolated);
                        
                        productionState.frameManifest[getFrameKey(frames[frameIndex])] = {
                            path: targetPath,
                            date: frames[frameIndex].toISOString(),
                            interpolated: true
                        };
                        
                        productionState.processedFrames++;
                        console.log(`✓ Interpolated frame ${frameIndex}`);
                    } catch (error) {
                        console.error(`Failed to interpolate frame ${frameIndex}: ${error.message}`);
                    }
                }
            }
        }
    }
    
    // Final save
    await saveState();
    await saveManifest();
    
    console.log(`\n✅ Processing complete!`);
    console.log(`   Processed: ${productionState.processedFrames}/${productionState.totalFrames}`);
    console.log(`   Fetched: ${productionState.fetchedFrames}`);
    console.log(`   Interpolated: ${productionState.interpolatedFrames}`);
    console.log(`   Fallbacks used: ${productionState.fallbacksUsed}`);
}

// Generate video from frames
async function generateVideo(days, outputName) {
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    
    const { endDate } = calculateDateRange();
    const videoStartDate = new Date(endDate);
    videoStartDate.setDate(videoStartDate.getDate() - days + 1);
    
    // Create frame list file
    const frameListPath = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    const frameList = [];
    
    const currentDate = new Date(videoStartDate);
    while (currentDate <= endDate) {
        const framePath = getFramePath(currentDate);
        if (await fileExists(framePath)) {
            frameList.push(`file '${framePath}'`);
        }
        currentDate.setMinutes(currentDate.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    await fs.writeFile(frameListPath, frameList.join('\n'));
    
    // Generate video with FFmpeg
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${new Date().toISOString().split('T')[0]}.mp4`);
    
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 "${outputPath}"`;
    
    try {
        await execAsync(ffmpegCommand, { timeout: 300000 });
        const stats = await fs.stat(outputPath);
        
        console.log(`✓ Video generated: ${outputPath}`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Frames: ${frameList.length}`);
        console.log(`  Duration: ${(frameList.length / CONFIG.FPS).toFixed(1)} seconds`);
        
        return outputPath;
    } catch (error) {
        console.error(`Failed to generate video: ${error.message}`);
        throw error;
    }
}

// Clean up old frames
async function cleanupOldFrames() {
    console.log('\n🧹 Cleaning up old frames...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 60);
    
    const dirs = await fs.readdir(CONFIG.FRAMES_DIR);
    let cleaned = 0;
    
    for (const dir of dirs) {
        const dirDate = new Date(dir);
        if (dirDate < cutoffDate) {
            const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
            await fs.rm(dirPath, { recursive: true, force: true });
            cleaned++;
            console.log(`  Removed: ${dir}`);
        }
    }
    
    console.log(`✓ Cleaned ${cleaned} old directories`);
}

// Helper: Check if file exists
async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

// Main daily production run
async function runDailyProduction() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Heliosphere Daily Production         ║');
    console.log('╚════════════════════════════════════════╝');
    
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    try {
        // Load previous state
        await loadState();
        await loadManifest();
        
        // Process all frames
        await processDateRange();
        
        // Generate videos
        await generateVideo(CONFIG.TOTAL_DAYS, 'heliosphere_full');
        await generateVideo(CONFIG.SOCIAL_DAYS, 'heliosphere_social');
        
        // Clean up old frames
        await cleanupOldFrames();
        
        productionState.status = 'completed';
        productionState.lastUpdate = Date.now();
        
        const duration = (Date.now() - productionState.startTime) / 1000;
        console.log(`\n✅ Daily production completed in ${duration.toFixed(1)} seconds`);
        
    } catch (error) {
        productionState.status = 'error';
        productionState.errors.push({
            type: 'fatal',
            message: error.message,
            timestamp: new Date().toISOString()
        });
        console.error('❌ Production failed:', error);
    }
    
    await saveState();
}

// API endpoints
app.get('/status', (req, res) => {
    const runtime = productionState.startTime 
        ? (Date.now() - productionState.startTime) / 1000
        : 0;
    
    res.json({
        ...productionState,
        runtime,
        checksums: {
            corona: productionState.checksums.corona.size,
            sunDisk: productionState.checksums.sunDisk.size
        }
    });
});

app.post('/run', async (req, res) => {
    if (productionState.status === 'running') {
        return res.status(400).json({ error: 'Production already running' });
    }
    
    res.json({ message: 'Production started' });
    runDailyProduction().catch(console.error);
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime() });
});

// Serve monitor page with fallback
app.get('/monitor', (req, res) => {
    res.sendFile(path.join('/opt/heliosphere', 'monitor_optimized.html'), (err) => {
        if (err) {
            // Try alternative monitor files
            res.sendFile(path.join('/opt/heliosphere', 'monitor_production.html'), (err2) => {
                if (err2) {
                    res.sendFile(path.join('/opt/heliosphere', 'monitor.html'), (err3) => {
                        if (err3) {
                            console.error('No monitor file found:', err);
                            res.status(500).send('Monitor temporarily unavailable');
                        }
                    });
                }
            });
        }
    });
});

// Serve latest generated frame for spot checking
app.get('/latest-frame', async (req, res) => {
    try {
        const manifestKeys = Object.keys(productionState.frameManifest);
        if (manifestKeys.length === 0) {
            return res.status(404).json({ error: 'No frames generated yet' });
        }
        
        const latestKey = manifestKeys[manifestKeys.length - 1];
        const latestFrame = productionState.frameManifest[latestKey];
        
        if (await fileExists(latestFrame.path)) {
            res.sendFile(latestFrame.path);
        } else {
            res.status(404).json({ error: 'Latest frame file not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve specific frame by frame number for spot checking
app.get('/frame/:frameNumber', async (req, res) => {
    try {
        const frameNumber = parseInt(req.params.frameNumber);
        const manifestKeys = Object.keys(productionState.frameManifest);
        
        if (frameNumber < 1 || frameNumber > manifestKeys.length) {
            return res.status(404).json({ error: `Frame ${frameNumber} not found. Available: 1-${manifestKeys.length}` });
        }
        
        const frameKey = manifestKeys[frameNumber - 1];
        const frame = productionState.frameManifest[frameKey];
        
        if (await fileExists(frame.path)) {
            res.sendFile(frame.path);
        } else {
            res.status(404).json({ error: `Frame ${frameNumber} file not found` });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get frame info and manifest summary
app.get('/frames/info', (req, res) => {
    const manifestKeys = Object.keys(productionState.frameManifest);
    res.json({
        totalFrames: manifestKeys.length,
        latestFrame: manifestKeys.length > 0 ? manifestKeys[manifestKeys.length - 1] : null,
        frameList: manifestKeys.slice(-10) // Last 10 frames
    });
});

// Start server
async function start() {
    await ensureDirectories();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Daily Production Server Ready        ║');
        console.log(`║   Port: ${CONFIG.PORT}                           ║`);
        console.log('╚════════════════════════════════════════╝');
        console.log('');
        console.log('📅 Configuration:');
        console.log(`   Data delay: ${CONFIG.SAFE_DELAY_DAYS} days`);
        console.log(`   Full video: ${CONFIG.TOTAL_DAYS} days`);
        console.log(`   Social video: ${CONFIG.SOCIAL_DAYS} days`);
        console.log(`   Frame rate: ${CONFIG.FPS} fps`);
        console.log('');
        console.log('🔧 Endpoints:');
        console.log(`   POST /run - Start production`);
        console.log(`   GET /status - Check status`);
        console.log(`   GET /health - Health check`);
        
        // Run immediately if --run flag
        if (process.argv.includes('--run')) {
            console.log('\n🚀 Starting production run...\n');
            runDailyProduction().catch(console.error);
        }
    });
}

start().catch(console.error);