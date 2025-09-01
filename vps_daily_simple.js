#!/usr/bin/env node

/**
 * Simplified Heliosphere Daily Production Script
 * No web server, just runs the production and exits
 */

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
    FETCH_CONCURRENCY: 4,    // Parallel image fetches (reduced for stability)
    PROCESS_CONCURRENCY: 2,  // Parallel frame processing (reduced for stability)
    BATCH_SIZE: 100,         // Save state every N frames
    MAX_RETRIES: 3,          // Max retry attempts for failed fetches
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 7,
    FALLBACK_STEPS_SOHO: [0, -1, -3, -5, -7, 1, 3, 5, 7],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7],
    
    // Cloudflare proxy
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Storage paths
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/production_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    TEMP_DIR: '/tmp/heliosphere',
    
    // Quality thresholds
    MAX_MISSING_FRAMES_PERCENT: 5,
    MIN_FRAME_SIZE_KB: 50,
    
    // Cloudflare API (loaded from environment)
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN
};

// Global state
let productionState = {
    status: 'idle',
    startTime: null,
    currentDate: null,
    dateRange: { start: null, end: null },
    totalFrames: 0,
    processedFrames: 0,
    skippedFrames: 0,
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

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Load previous state
async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
        const saved = JSON.parse(data);
        
        // Restore simple properties
        Object.assign(productionState, {
            ...saved,
            checksums: {
                corona: new Map(saved.checksums?.corona || []),
                sunDisk: new Map(saved.checksums?.sunDisk || [])
            }
        });
        
        console.log('📂 Loaded previous state');
        console.log(`   Existing frames: ${Object.keys(productionState.frameManifest).length}`);
    } catch (error) {
        console.log('📂 No previous state found, starting fresh');
    }
}

// Save state
async function saveState() {
    const toSave = {
        ...productionState,
        checksums: {
            corona: Array.from(productionState.checksums.corona.entries()),
            sunDisk: Array.from(productionState.checksums.sunDisk.entries())
        }
    };
    
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
}

// Load manifest
async function loadManifest() {
    try {
        const data = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf-8');
        productionState.frameManifest = JSON.parse(data);
        console.log(`📋 Loaded manifest with ${Object.keys(productionState.frameManifest).length} frames`);
    } catch (error) {
        console.log('📋 No manifest found, starting fresh');
    }
}

// Save manifest
async function saveManifest() {
    // Keep a backup
    try {
        await fs.copyFile(CONFIG.MANIFEST_FILE, CONFIG.MANIFEST_FILE + '.backup');
    } catch {}
    
    await fs.writeFile(CONFIG.MANIFEST_FILE, JSON.stringify(productionState.frameManifest, null, 2));
}

// Calculate date range
function calculateDateRange() {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    endDate.setHours(23, 45, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.TOTAL_DAYS + 1);
    startDate.setHours(0, 0, 0, 0);
    
    return { startDate, endDate };
}

// Generate frame key
function getFrameKey(date) {
    return date.toISOString();
}

// Get frame path
function getFramePath(date) {
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toISOString().split('T')[1].substring(0, 5).replace(':', '');
    return path.join(CONFIG.FRAMES_DIR, dateStr, `frame_${timeStr}.jpg`);
}

// Fetch image with retry
async function fetchImageWithRetry(sourceId, date, retries = CONFIG.MAX_RETRIES) {
    const dateStr = date.toISOString().split('.')[0];
    const imageScale = sourceId === 4 ? 2.3 : 4.5;
    const width = 1460;
    const height = sourceId === 4 ? 1200 : 1435;
    
    let apiUrl;
    if (CONFIG.USE_CLOUDFLARE) {
        apiUrl = `${CONFIG.CLOUDFLARE_URL}?date=${dateStr}&sourceId=${sourceId}&imageScale=${imageScale}&width=${width}&height=${height}`;
    } else {
        apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
            `date=${dateStr}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
            `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;
    }
    
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const { stdout } = await execAsync(
                `curl -s -L --max-time 30 "${apiUrl}"`,
                { maxBuffer: 50 * 1024 * 1024 }
            );
            
            const buffer = Buffer.from(stdout, 'binary');
            if (buffer.length < CONFIG.MIN_FRAME_SIZE_KB * 1024) {
                throw new Error('Image too small');
            }
            
            const checksum = crypto.createHash('md5').update(buffer).digest('hex');
            return { buffer, checksum };
        } catch (error) {
            if (attempt === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

// Fetch with fallback
async function fetchImageWithFallback(targetDate, sourceId, sourceType, frameNumber) {
    const fallbackSteps = sourceType === 'SOHO' ? CONFIG.FALLBACK_STEPS_SOHO : CONFIG.FALLBACK_STEPS_SDO;
    const checksumMap = sourceType === 'SOHO' ? productionState.checksums.corona : productionState.checksums.sunDisk;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate);
        tryDate.setMinutes(tryDate.getMinutes() + minuteOffset);
        
        try {
            const result = await fetchImageWithRetry(sourceId, tryDate);
            
            // Check for duplicate
            const existingFrames = checksumMap.get(result.checksum);
            if (existingFrames && existingFrames.length > 0) {
                if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                    throw new Error(`All attempts resulted in duplicates`);
                }
                continue;
            }
            
            // Track checksum
            if (!checksumMap.has(result.checksum)) {
                checksumMap.set(result.checksum, []);
            }
            checksumMap.get(result.checksum).push(frameNumber);
            
            if (minuteOffset !== 0) {
                productionState.fallbacksUsed++;
            }
            
            return {
                ...result,
                fallbackMinutes: minuteOffset,
                isDuplicate: false
            };
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed: ${error.message}`);
            }
        }
    }
}

// Apply color grading
async function gradeCorona(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

async function gradeSunDisk(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.25, brightness: 1.2, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.4, -20)
        .gamma(1.05)
        .toBuffer();
}

// Apply radial feathering
async function applyRadialFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    const center = finalSize / 2;
    const innerRadius = compositeRadius - featherRadius;
    const outerRadius = compositeRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <radialGradient id="feather">
                    <stop offset="${(innerRadius / outerRadius) * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="${center}" cy="${center}" r="${outerRadius}" fill="url(#feather)" />
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
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCorona(coronaData.buffer),
        gradeSunDisk(sunDiskData.buffer)
    ]);
    
    const featheredSunDisk = await applyRadialFeather(
        gradedSunDisk, 1435, CONFIG.COMPOSITE_RADIUS, CONFIG.FEATHER_RADIUS
    );
    
    const compositeImage = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: gradedCorona, left: 230, top: 117, blend: 'over' },
        { input: featheredSunDisk, left: 242, top: 0, blend: 'screen' }
    ])
    .extract({ left: 230, top: 117, width: CONFIG.FRAME_WIDTH, height: CONFIG.FRAME_HEIGHT })
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
    
    return compositeImage;
}

// Process frames with proper promise handling
async function processFramesParallel(frames) {
    console.log(`\n📊 Processing ${frames.length} frames`);
    
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    let completed = 0;
    
    async function fetchNextFrame() {
        if (fetchQueue.length === 0) return null;
        
        const frame = fetchQueue.shift();
        const { number, date } = frame;
        
        try {
            const [coronaResult, sunDiskResult] = await Promise.all([
                fetchImageWithFallback(date, 4, 'SOHO', number),
                fetchImageWithFallback(date, 10, 'SDO', number)
            ]);
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: coronaResult,
                sunDisk: sunDiskResult
            };
        } catch (error) {
            console.error(`❌ Frame ${number}: ${error.message}`);
            productionState.missingFrames.push(number);
            productionState.errors.push({
                frame: number,
                date: date.toISOString(),
                error: error.message
            });
            return null;
        }
    }
    
    async function processNextFrame() {
        if (processingQueue.length === 0) return null;
        
        const frameData = processingQueue.shift();
        const framePath = getFramePath(frameData.frameDate);
        
        try {
            const processedFrame = await processFrame(frameData.corona, frameData.sunDisk);
            
            const dir = path.dirname(framePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(framePath, processedFrame);
            
            const frameKey = getFrameKey(frameData.frameDate);
            productionState.frameManifest[frameKey] = {
                path: framePath,
                date: frameData.frameDate.toISOString(),
                frameNumber: frameData.frameNumber
            };
            
            productionState.processedFrames++;
            productionState.fetchedFrames++;
            completed++;
            
            // Progress update
            if (completed % 10 === 0) {
                const progress = (completed / frames.length * 100).toFixed(1);
                const runtime = (Date.now() - productionState.startTime) / 1000;
                const fps = (completed / (runtime / 60)).toFixed(1);
                console.log(`Progress: ${progress}% (${completed}/${frames.length}) - ${fps} frames/min`);
            }
            
            // Save state periodically
            if (completed % CONFIG.BATCH_SIZE === 0) {
                await saveState();
                await saveManifest();
            }
            
            return true;
        } catch (error) {
            console.error(`❌ Processing failed: ${error.message}`);
            return false;
        }
    }
    
    // Fixed promise handling to prevent infinite loop
    while (fetchQueue.length > 0 || activeFetches.size > 0 || processingQueue.length > 0 || activeProcesses.size > 0) {
        // Start new fetches
        while (activeFetches.size < CONFIG.FETCH_CONCURRENCY && fetchQueue.length > 0) {
            const fetchPromise = fetchNextFrame().then(result => {
                activeFetches.delete(fetchPromise);
                if (result) processingQueue.push(result);
            });
            activeFetches.add(fetchPromise);
        }
        
        // Start new processing
        while (activeProcesses.size < CONFIG.PROCESS_CONCURRENCY && processingQueue.length > 0) {
            const processPromise = processNextFrame().then(() => {
                activeProcesses.delete(processPromise);
            });
            activeProcesses.add(processPromise);
        }
        
        // Wait for at least one promise to complete
        if (activeFetches.size > 0 || activeProcesses.size > 0) {
            await Promise.race([
                ...Array.from(activeFetches),
                ...Array.from(activeProcesses)
            ]);
        }
    }
    
    await saveState();
    await saveManifest();
}

// Process date range
async function processDateRange() {
    const { startDate, endDate } = calculateDateRange();
    productionState.dateRange = { 
        start: startDate.toISOString(), 
        end: endDate.toISOString() 
    };
    
    console.log(`\n📅 Processing ${CONFIG.TOTAL_DAYS} days`);
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To:   ${endDate.toISOString().split('T')[0]}`);
    
    const frames = [];
    const currentDate = new Date(endDate);
    
    while (currentDate >= startDate) {
        frames.push(new Date(currentDate));
        currentDate.setMinutes(currentDate.getMinutes() - CONFIG.INTERVAL_MINUTES);
    }
    
    productionState.totalFrames = frames.length;
    console.log(`\n📊 Total frames: ${frames.length}`);
    
    const framesToProcess = [];
    for (let i = 0; i < frames.length; i++) {
        const frameKey = getFrameKey(frames[i]);
        const framePath = getFramePath(frames[i]);
        
        try {
            await fs.access(framePath);
            productionState.skippedFrames++;
        } catch {
            framesToProcess.push({ number: i, date: frames[i] });
        }
    }
    
    console.log(`📊 Frames to fetch: ${framesToProcess.length}`);
    console.log(`📊 Already exist: ${productionState.skippedFrames}`);
    
    if (framesToProcess.length > 0) {
        await processFramesParallel(framesToProcess);
    }
    
    return frames;
}

// Generate video
async function generateVideo(frames, days, outputName) {
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    
    const frameList = [];
    const daysToInclude = Math.min(days, CONFIG.TOTAL_DAYS);
    const framesToInclude = frames.slice(0, daysToInclude * CONFIG.FRAMES_PER_DAY);
    
    for (const frame of framesToInclude) {
        const framePath = getFramePath(frame);
        try {
            await fs.access(framePath);
            frameList.push(`file '${framePath}'`);
        } catch {}
    }
    
    if (frameList.length === 0) {
        console.error(`❌ No frames for ${outputName}`);
        return null;
    }
    
    const frameListPath = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    await fs.writeFile(frameListPath, frameList.join('\n'));
    
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${new Date().toISOString().split('T')[0]}.mp4`);
    
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 "${outputPath}"`;
    
    try {
        await execAsync(ffmpegCommand, { timeout: 300000 });
        const stats = await fs.stat(outputPath);
        console.log(`✓ Video generated: ${outputPath}`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Frames: ${frameList.length}`);
        return outputPath;
    } catch (error) {
        console.error(`Failed to generate video: ${error.message}`);
        return null;
    }
}

// Main function
async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Heliosphere Daily Production         ║');
    console.log('╚════════════════════════════════════════╝');
    
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    try {
        await ensureDirectories();
        await loadState();
        await loadManifest();
        
        const frames = await processDateRange();
        
        await generateVideo(frames, CONFIG.TOTAL_DAYS, 'heliosphere_full');
        await generateVideo(frames, CONFIG.SOCIAL_DAYS, 'heliosphere_social');
        
        // Generate and upload videos
        console.log('\n🎬 Generating production videos...');
        try {
            const { stdout } = await execAsync(
                `cd /opt/heliosphere && export CLOUDFLARE_API_TOKEN="${CONFIG.CLOUDFLARE_API_TOKEN}" && node generate_videos_only.js`,
                { timeout: 1200000 }
            );
            console.log(stdout);
        } catch (error) {
            console.error('Video generation warning:', error.message);
        }
        
        productionState.status = 'completed';
        
        // Report
        const runtime = (Date.now() - productionState.startTime) / 1000;
        console.log('\n✅ Production complete!');
        console.log(`   Runtime: ${(runtime / 60).toFixed(1)} minutes`);
        console.log(`   Processed: ${productionState.processedFrames}`);
        console.log(`   Skipped: ${productionState.skippedFrames}`);
        console.log(`   Errors: ${productionState.errors.length}`);
        
    } catch (error) {
        productionState.status = 'error';
        console.error('❌ Production failed:', error);
        process.exit(1);
    }
    
    await saveState();
    process.exit(0);
}

// Run
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});