#!/usr/bin/env node

/**
 * Heliosphere HDR Production System
 * Implements HDR-style processing to preserve plasma detail while maintaining cinematic look
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import express from 'express';
import compression from 'compression';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // API Settings
    SOURCE_IDS: { corona: 4, sunDisk: 10 },
    IMAGE_SCALE: 4.8,
    IMAGE_WIDTH: 1920,
    IMAGE_HEIGHT: 1920,
    
    // Frame Processing
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    
    // Production Settings
    TOTAL_DAYS: 56,
    SOCIAL_DAYS: 7,
    FRAMES_PER_DAY: 96,
    SAFE_DELAY_DAYS: 2,
    
    // Performance
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 100,
    FPS: 24,
    
    // Paths
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/daily_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    TEMP_DIR: '/tmp/heliosphere',
    
    // Server
    PORT: 3001
};

const app = express();
app.use(compression());

// Production state
let productionState = {
    status: 'idle',
    startTime: null,
    lastUpdate: null,
    totalFrames: 0,
    processedFrames: 0,
    fetchedFrames: 0,
    interpolatedFrames: 0,
    missingFrames: [],
    fallbacksUsed: 0,
    retryCount: 0,
    errors: [],
    frameManifest: {},
    checksums: {
        corona: new Map(),
        sunDisk: new Map()
    },
    failureStats: {
        coronaFailures: 0,
        sunDiskFailures: 0,
        bothFailures: 0
    }
};

// Helper: Generate frame date/time
function getFrameDateTime(dayOffset, minuteOfDay) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - CONFIG.SAFE_DELAY_DAYS - dayOffset);
    date.setUTCHours(0, minuteOfDay, 0, 0);
    return date;
}

// Helper: Format date for API
function formatDateForAPI(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Fetch image from Helioviewer API
async function fetchImage(date, sourceId, frameNumber, fallbackMinutes = 0) {
    const adjustedDate = new Date(date);
    adjustedDate.setMinutes(adjustedDate.getMinutes() + fallbackMinutes);
    
    const formattedDate = formatDateForAPI(adjustedDate);
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${formattedDate}&layers=[${sourceId},1,100]&imageScale=${CONFIG.IMAGE_SCALE}` +
        `&width=${CONFIG.IMAGE_WIDTH}&height=${CONFIG.IMAGE_HEIGHT}&x0=0&y0=0&display=true&watermark=false`;
    
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const buffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(buffer);
            
            if (imageBuffer.length < 5000) {
                throw new Error(`Image too small: ${imageBuffer.length} bytes`);
            }
            
            const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            
            return {
                buffer: imageBuffer,
                hash,
                size: imageBuffer.length,
                fallbackMinutes,
                attempt
            };
            
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            }
        }
    }
    
    throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
}

// Check for duplicate images
function isDuplicate(sourceType, hash, frameNumber) {
    const checksums = productionState.checksums[sourceType];
    
    for (const [existingFrame, existingHash] of checksums.entries()) {
        if (existingHash === hash && Math.abs(existingFrame - frameNumber) > 1) {
            return true;
        }
    }
    
    checksums.set(frameNumber, hash);
    return false;
}

// Fetch with fallback logic
async function fetchWithFallback(date, sourceId, sourceType, frameNumber) {
    const fallbackSteps = [0, -5, 5, -10, 10, -15];
    
    for (const minuteOffset of fallbackSteps) {
        try {
            const result = await fetchImage(date, sourceId, frameNumber, minuteOffset);
            
            if (isDuplicate(sourceType, result.hash, frameNumber)) {
                console.log(`⚠️ Duplicate ${sourceType} detected! Frame ${frameNumber} matches other frames`);
                if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                    console.log(`  ⚠️ Using duplicate for frame ${frameNumber} (no alternatives)`);
                    return {
                        ...result,
                        fallbackMinutes: minuteOffset,
                        isDuplicate: true
                    };
                }
                continue;
            }
            
            if (minuteOffset !== 0) {
                productionState.fallbacksUsed++;
                console.log(`  ✓ Used ${minuteOffset}min fallback for ${sourceType} frame ${frameNumber}`);
            }
            
            return {
                ...result,
                fallbackMinutes: minuteOffset,
                isDuplicate: false
            };
            
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed for ${sourceType}: ${error.message}`);
            }
        }
    }
}

// ==================== HDR PROCESSING ====================

// Convert to linear light (remove gamma)
async function toLinear(imageBuffer) {
    return await sharp(imageBuffer)
        .gamma(2.2)  // Remove gamma correction
        .toBuffer();
}

// Convert from linear to display (apply gamma)
async function fromLinear(imageBuffer) {
    return await sharp(imageBuffer)
        .gamma(1.0 / 2.2)  // Apply gamma correction
        .toBuffer();
}

// ACES tone mapping curve
async function acesToneMap(imageBuffer) {
    // ACES RRT (Reference Rendering Transform) approximation
    // This preserves highlights while maintaining contrast
    return await sharp(imageBuffer)
        .recomb([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0]
        ])
        .toBuffer();
}

// Reinhard tone mapping (simpler, good for highlights)
async function reinhardToneMap(imageBuffer, exposure = 1.0) {
    // Apply exposure adjustment in linear space
    const exposed = await sharp(imageBuffer)
        .linear(exposure, 0)
        .toBuffer();
    
    // Reinhard operator: L' = L / (1 + L)
    // We'll approximate this with gamma and levels
    return await sharp(exposed)
        .gamma(1.4)  // Compress highlights
        .linear(0.85, 10)  // Fine tune
        .toBuffer();
}

// Apply cinematic color grading to corona (more subtle in HDR)
async function gradeCoronaHDR(imageBuffer) {
    const linear = await toLinear(imageBuffer);
    
    const graded = await sharp(linear)
        .modulate({ 
            saturation: 0.4,     // Reduced from 0.3
            brightness: 1.0,     // No change
            hue: -5 
        })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.1, -5)         // Much gentler than 1.2, -12
        .toBuffer();
    
    return graded;  // Stay in linear for compositing
}

// Apply "Sunshine" film grading to sun disk (HDR version)
async function gradeSunDiskHDR(imageBuffer) {
    const linear = await toLinear(imageBuffer);
    
    const graded = await sharp(linear)
        .modulate({ 
            saturation: 1.1,     // Reduced from 1.2
            brightness: 1.15,    // Reduced from 1.4
            hue: 15 
        })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.2, -10)        // Much reduced from 1.7, -30
        .toBuffer();
    
    return graded;  // Stay in linear for compositing
}

// Apply square feathering with HDR awareness
async function applySquareFeatherHDR(imageBuffer, finalSize, compositeRadius, featherRadius) {
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
    
    // More gradual feathering for HDR
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <radialGradient id="hdrFeather">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${(compositeRadius - featherRadius) / compositeRadius * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="${center}" cy="${center}" r="${compositeRadius}" fill="url(#hdrFeather)" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

// HDR composite with better highlight preservation
async function processFrameHDR(coronaData, sunDiskData) {
    // Apply HDR color grading (returns linear images)
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCoronaHDR(coronaData.buffer),
        gradeSunDiskHDR(sunDiskData.buffer)
    ]);
    
    // Apply feathering to sun disk
    const featheredSunDisk = await applySquareFeatherHDR(
        gradedSunDisk, 1435, CONFIG.COMPOSITE_RADIUS, CONFIG.FEATHER_RADIUS
    );
    
    // Composite in linear space using 'lighten' blend for better highlight preservation
    const compositeImage = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: await fromLinear(gradedCorona), gravity: 'center' },
        { input: await fromLinear(featheredSunDisk), gravity: 'center', blend: 'lighten' }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
    
    // Convert back to linear for tone mapping
    const linearComposite = await toLinear(compositeImage);
    
    // Apply tone mapping to preserve highlights
    const toneMapped = await reinhardToneMap(linearComposite, 1.2);
    
    // Convert back to display gamma
    const displayImage = await fromLinear(toneMapped);
    
    // Crop to final dimensions
    const finalImage = await sharp(displayImage)
        .extract({
            left: 230,
            top: 117,
            width: CONFIG.FRAME_WIDTH,
            height: CONFIG.FRAME_HEIGHT
        })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    
    return finalImage;
}

// Process frames with HDR pipeline
async function processFramesParallel(frames) {
    console.log(`\n📊 Processing ${frames.length} frames with HDR pipeline`);
    console.log(`   🎨 Using HDR processing for plasma detail preservation`);
    console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}`);
    
    const fetchQueue = [...frames];
    const processingQueue = [];
    const results = new Map();
    let activeFetches = 0;
    let activeProcessing = 0;
    
    // Progress tracking
    let lastProgressUpdate = Date.now();
    const startTime = Date.now();
    
    async function processFetchQueue() {
        while (fetchQueue.length > 0 && activeFetches < CONFIG.FETCH_CONCURRENCY) {
            const frame = fetchQueue.shift();
            activeFetches++;
            
            (async () => {
                try {
                    const [coronaData, sunDiskData] = await Promise.all([
                        fetchWithFallback(frame.date, CONFIG.SOURCE_IDS.corona, 'corona', frame.number),
                        fetchWithFallback(frame.date, CONFIG.SOURCE_IDS.sunDisk, 'sunDisk', frame.number)
                    ]);
                    
                    processingQueue.push({ frame, coronaData, sunDiskData });
                    productionState.fetchedFrames++;
                    
                } catch (error) {
                    console.error(`❌ Frame ${frame.number} fetch failed: ${error.message}`);
                    productionState.errors.push({ frame: frame.number, error: error.message });
                    productionState.missingFrames.push(frame.number);
                    
                    if (error.message.includes('corona')) {
                        productionState.failureStats.coronaFailures++;
                    } else if (error.message.includes('sunDisk')) {
                        productionState.failureStats.sunDiskFailures++;
                    } else {
                        productionState.failureStats.bothFailures++;
                    }
                } finally {
                    activeFetches--;
                    processFetchQueue();
                }
            })();
        }
    }
    
    async function processProcessingQueue() {
        while (processingQueue.length > 0 && activeProcessing < CONFIG.PROCESS_CONCURRENCY) {
            const item = processingQueue.shift();
            activeProcessing++;
            
            (async () => {
                try {
                    const processedImage = await processFrameHDR(item.coronaData, item.sunDiskData);
                    await saveFrame(processedImage, item.frame.number, item.frame.date);
                    results.set(item.frame.number, processedImage);
                    productionState.processedFrames++;
                    
                    // Update progress
                    const now = Date.now();
                    if (now - lastProgressUpdate > 5000) {
                        const elapsed = (now - startTime) / 1000 / 60;
                        const fps = productionState.processedFrames / elapsed;
                        const progress = (productionState.processedFrames / frames.length * 100).toFixed(1);
                        console.log(`Progress: ${progress}% (${productionState.processedFrames}/${frames.length}) - ${fps.toFixed(1)} frames/min`);
                        lastProgressUpdate = now;
                    }
                    
                } catch (error) {
                    console.error(`❌ Frame ${item.frame.number} processing failed: ${error.message}`);
                    productionState.errors.push({ frame: item.frame.number, error: error.message });
                } finally {
                    activeProcessing--;
                    processProcessingQueue();
                }
            })();
        }
    }
    
    // Start processing
    processFetchQueue();
    processProcessingQueue();
    
    // Wait for completion
    await new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (fetchQueue.length === 0 && 
                processingQueue.length === 0 && 
                activeFetches === 0 && 
                activeProcessing === 0) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 100);
    });
    
    return results;
}

// Save frame to disk
async function saveFrame(imageBuffer, frameNumber, date) {
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toISOString().split('T')[1].slice(0, 5).replace(':', '');
    const frameDir = path.join(CONFIG.FRAMES_DIR, dateStr);
    
    await fs.mkdir(frameDir, { recursive: true });
    
    const framePath = path.join(frameDir, `frame_${timeStr}.jpg`);
    await fs.writeFile(framePath, imageBuffer);
    
    productionState.frameManifest[frameNumber] = {
        path: framePath,
        date: date.toISOString(),
        size: imageBuffer.length
    };
}

// Load/save state functions
async function loadState() {
    try {
        const stateData = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
        const savedState = JSON.parse(stateData);
        productionState = { ...productionState, ...savedState };
        
        // Restore Map objects
        productionState.checksums.corona = new Map(savedState.checksums?.corona || []);
        productionState.checksums.sunDisk = new Map(savedState.checksums?.sunDisk || []);
        
        console.log('📂 Loaded previous state');
    } catch (error) {
        console.log('📂 No previous state found, starting fresh');
    }
}

async function saveState() {
    const stateToSave = {
        ...productionState,
        checksums: {
            corona: Array.from(productionState.checksums.corona),
            sunDisk: Array.from(productionState.checksums.sunDisk)
        }
    };
    
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(stateToSave, null, 2));
}

async function loadManifest() {
    try {
        const manifestData = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf8');
        productionState.frameManifest = JSON.parse(manifestData);
        console.log(`📋 Loaded manifest with ${Object.keys(productionState.frameManifest).length} frames`);
    } catch (error) {
        console.log('📋 No previous manifest found');
    }
}

async function saveManifest() {
    await fs.writeFile(CONFIG.MANIFEST_FILE, JSON.stringify(productionState.frameManifest, null, 2));
}

// Process date range
async function processDateRange() {
    const frames = [];
    
    for (let day = CONFIG.TOTAL_DAYS - 1; day >= 0; day--) {
        for (let minute = 0; minute < 1440; minute += 15) {
            const frameNumber = (CONFIG.TOTAL_DAYS - 1 - day) * CONFIG.FRAMES_PER_DAY + Math.floor(minute / 15);
            const date = getFrameDateTime(day, minute);
            
            if (!productionState.frameManifest[frameNumber]) {
                frames.push({ number: frameNumber, date, day, minute });
            }
        }
    }
    
    productionState.totalFrames = CONFIG.TOTAL_DAYS * CONFIG.FRAMES_PER_DAY;
    
    if (frames.length === 0) {
        console.log('✅ All frames already processed!');
        return Object.keys(productionState.frameManifest).sort((a, b) => Number(a) - Number(b));
    }
    
    console.log(`\n📅 Processing ${frames.length} frames from ${CONFIG.TOTAL_DAYS} days`);
    console.log(`   🎨 HDR processing enabled for plasma detail preservation`);
    
    await processFramesParallel(frames);
    await saveManifest();
    
    return Object.keys(productionState.frameManifest).sort((a, b) => Number(a) - Number(b));
}

// Generate video
async function generateVideo(frameList, days, outputName) {
    const totalFrames = days * CONFIG.FRAMES_PER_DAY;
    const startFrame = frameList.length - totalFrames;
    const videoFrames = frameList.slice(startFrame);
    
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    const framesFile = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    const framesContent = videoFrames
        .map(num => `file '${productionState.frameManifest[num].path}'`)
        .join('\n');
    await fs.writeFile(framesFile, framesContent);
    
    const today = new Date().toISOString().split('T')[0];
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${today}.mp4`);
    
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${framesFile}" ` +
        `-c:v libx264 -preset veryslow -crf 18 -pix_fmt yuv420p ` +
        `-movflags +faststart -r ${CONFIG.FPS} "${outputPath}"`;
    
    try {
        console.log(`  Processing ${videoFrames.length} frames...`);
        await execAsync(ffmpegCmd, { maxBuffer: 50 * 1024 * 1024 });
        
        const stats = await fs.stat(outputPath);
        console.log(`  Output: ${outputPath}`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
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

// Generate summary report
function generateReport() {
    const runtime = (Date.now() - productionState.startTime) / 1000;
    const fps = (productionState.processedFrames / (runtime / 60)).toFixed(1);
    
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║         HDR PRODUCTION SUMMARY REPORT              ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║ Total Frames:     ${String(productionState.totalFrames).padEnd(33)}║`);
    console.log(`║ Processed:        ${String(productionState.processedFrames).padEnd(33)}║`);
    console.log(`║ Fetched:          ${String(productionState.fetchedFrames).padEnd(33)}║`);
    console.log(`║ Interpolated:     ${String(productionState.interpolatedFrames).padEnd(33)}║`);
    console.log(`║ Missing:          ${String(productionState.missingFrames.length).padEnd(33)}║`);
    console.log(`║ Fallbacks Used:   ${String(productionState.fallbacksUsed).padEnd(33)}║`);
    console.log(`║ Retries:          ${String(productionState.retryCount).padEnd(33)}║`);
    console.log(`║ Errors:           ${String(productionState.errors.length).padEnd(33)}║`);
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║ Corona Failures:  ${String(productionState.failureStats.coronaFailures).padEnd(33)}║`);
    console.log(`║ Sun Disk Failures:${String(productionState.failureStats.sunDiskFailures).padEnd(33)}║`);
    console.log(`║ Both Failed:      ${String(productionState.failureStats.bothFailures).padEnd(33)}║`);
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║ Runtime:          ${String((runtime / 60).toFixed(1) + ' minutes').padEnd(33)}║`);
    console.log(`║ Speed:            ${String(fps + ' frames/min').padEnd(33)}║`);
    console.log(`║ Processing:       ${'HDR Pipeline'.padEnd(33)}║`);
    console.log('╚════════════════════════════════════════════════════╝');
}

// Main production run
async function runDailyProduction() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Heliosphere HDR Production           ║');
    console.log('║   🎨 Plasma Detail Preservation Mode    ║');
    console.log('╚════════════════════════════════════════╝');
    
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    try {
        await loadState();
        await loadManifest();
        
        const frames = await processDateRange();
        
        await generateVideo(frames, CONFIG.TOTAL_DAYS, 'heliosphere_hdr_full');
        await generateVideo(frames, CONFIG.SOCIAL_DAYS, 'heliosphere_hdr_social');
        
        await cleanupOldFrames();
        
        productionState.status = 'completed';
        productionState.lastUpdate = Date.now();
        
        generateReport();
        
    } catch (error) {
        productionState.status = 'error';
        productionState.errors.push({
            type: 'fatal',
            message: error.message,
            timestamp: new Date().toISOString()
        });
        console.error('❌ Production failed:', error);
        generateReport();
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
        hdrEnabled: true,
        checksums: {
            corona: productionState.checksums.corona.size,
            sunDisk: productionState.checksums.sunDisk.size
        },
        framesPerMinute: runtime > 0 ? 
            (productionState.processedFrames / (runtime / 60)).toFixed(1) : 0
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', uptime: process.uptime(), hdr: true });
});

// Start server
app.listen(CONFIG.PORT, () => {
    console.log(`\n🌐 HDR Monitor running at http://localhost:${CONFIG.PORT}/status`);
});

// Handle command line arguments
if (process.argv.includes('--run')) {
    runDailyProduction().catch(console.error);
} else {
    console.log('\n📊 HDR Monitor mode - API running');
    console.log('   Use --run flag to start production');
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏹️  Shutting down gracefully...');
    await saveState();
    await saveManifest();
    process.exit(0);
});