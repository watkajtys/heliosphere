#!/usr/bin/env node

/**
 * Heliosphere Daily Cron Job
 * Runs once daily to generate solar timelapse videos
 * Exits cleanly after completion for cron compatibility
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
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 100,         // Save state every N frames
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14, // Stay within frame boundary
    FALLBACK_STEPS_SOHO: [0, -1, -3, -5, -7, 1, 3, 5, 7],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7],
    
    // Cloudflare proxy
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Storage paths
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/daily_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    TEMP_DIR: '/tmp/heliosphere',
    LOG_DIR: '/opt/heliosphere/logs'
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

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(CONFIG.LOG_DIR, { recursive: true });
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

// Fetch image from API
async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 10 ? 1.87 : 2.5;
    const apiParams = new URLSearchParams({
        date: date,
        imageScale: imageScale,
        layers: `[${sourceId},1,100]`,
        width: CONFIG.FRAME_WIDTH,
        height: CONFIG.FRAME_HEIGHT,
        x0: 0,
        y0: 0,
        display: 'true',
        watermark: 'false'
    });
    
    const url = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/takeScreenshot?${apiParams}`
        : `https://api.helioviewer.org/v2/takeScreenshot/?${apiParams}`;
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
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
            
            return { buffer: imageBuffer, offset: minuteOffset };
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw error;
            }
        }
    }
    
    throw new Error(`All fallback attempts failed for ${sourceType}`);
}

// Apply circular feather to sun disk
async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize)
        .toBuffer();

    if (featherRadius <= 0) {
        return resizedImage;
    }

    const imageRadius = finalSize / 2;
    const compositeRatio = compositeRadius / imageRadius;
    const featherStart = Math.max(0, compositeRadius - featherRadius);
    const featherStartRatio = featherStart / imageRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${featherStartRatio * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${compositeRatio * 100}%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="50%" cy="50%" r="50%" fill="url(#feather)" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();

    const maskedImage = await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();

    return maskedImage;
}

// Process single frame
async function processFrame(frameDate) {
    const frameKey = getFrameKey(frameDate);
    const framePath = getFramePath(frameDate);
    
    // Check if frame already exists
    if (productionState.frameManifest[frameKey]) {
        const exists = await fs.access(framePath).then(() => true).catch(() => false);
        if (exists) {
            console.log(`✓ Frame exists: ${frameKey}`);
            return;
        }
    }
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(framePath), { recursive: true });
    
    try {
        // Fetch both images
        const [coronaResult, sunDiskResult] = await Promise.all([
            fetchImageWithFallback(frameDate, 4, 'SOHO'),
            fetchImageWithFallback(frameDate, 10, 'SDO')
        ]);
        
        // Apply circular feather to sun disk
        const featheredSunDisk = await applyCircularFeather(
            sunDiskResult.buffer,
            1435,
            CONFIG.COMPOSITE_RADIUS,
            CONFIG.FEATHER_RADIUS
        );
        
        // Create composite with optimized grading
        const composite = await sharp(coronaResult.buffer)
            .modulate({
                brightness: 1.2,
                saturation: 0.9
            })
            .gamma(1.1)
            .linear(1.25, -5)
            .composite([{
                input: featheredSunDisk,
                top: Math.floor((CONFIG.FRAME_HEIGHT - 1435) / 2),
                left: Math.floor((CONFIG.FRAME_WIDTH - 1435) / 2),
                blend: 'screen'
            }])
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        // Save frame
        await fs.writeFile(framePath, composite);
        
        // Update manifest
        productionState.frameManifest[frameKey] = {
            path: framePath,
            date: frameDate.toISOString(),
            coronaOffset: coronaResult.offset,
            sunDiskOffset: sunDiskResult.offset
        };
        
        productionState.processedFrames++;
        console.log(`✅ Processed frame ${productionState.processedFrames}/${productionState.totalFrames}`);
        
    } catch (error) {
        console.error(`❌ Failed to process ${frameKey}:`, error.message);
        productionState.errors.push({
            frame: frameKey,
            error: error.message
        });
    }
}

// Process date range in parallel batches
async function processDateRange() {
    const { startDate, endDate } = calculateDateRange();
    
    productionState.dateRange = {
        start: startDate.toISOString(),
        end: endDate.toISOString()
    };
    
    console.log(`📅 Processing ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Generate all frame dates
    const frameDates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
        frameDates.push(new Date(current));
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    productionState.totalFrames = frameDates.length;
    console.log(`📊 Total frames to process: ${productionState.totalFrames}`);
    
    // Process in parallel batches
    for (let i = 0; i < frameDates.length; i += CONFIG.FETCH_CONCURRENCY) {
        const batch = frameDates.slice(i, i + CONFIG.FETCH_CONCURRENCY);
        await Promise.all(batch.map(date => processFrame(date)));
        
        // Save state periodically
        if ((i + CONFIG.FETCH_CONCURRENCY) % CONFIG.BATCH_SIZE === 0) {
            await saveState();
            await saveManifest();
        }
    }
    
    // Final save
    await saveState();
    await saveManifest();
}

// Generate video from frames
async function generateVideo(days, outputName) {
    console.log(`\n🎬 Generating ${days}-day video: ${outputName}`);
    
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${new Date().toISOString().split('T')[0]}.mp4`);
    
    // Calculate frame range for video
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days + 1);
    
    // Create file list for FFmpeg
    const frameList = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);
    
    while (current <= endDate) {
        const framePath = getFramePath(current);
        const exists = await fs.access(framePath).then(() => true).catch(() => false);
        if (exists) {
            frameList.push(`file '${framePath}'`);
        }
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    if (frameList.length === 0) {
        console.error('❌ No frames found for video generation');
        return;
    }
    
    // Write frame list
    const listPath = path.join(CONFIG.TEMP_DIR, `${outputName}_list.txt`);
    await fs.writeFile(listPath, frameList.join('\n'));
    
    // Generate video with FFmpeg
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
        `-c:v libx264 -preset veryslow -crf 15 -pix_fmt yuv420p ` +
        `-vf "fps=${CONFIG.FPS}" "${outputPath}"`;
    
    try {
        await execAsync(ffmpegCmd);
        const stats = await fs.stat(outputPath);
        console.log(`✅ Video generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Upload to Cloudflare if configured
        await uploadToCloudflare(outputPath, outputName);
        
    } catch (error) {
        console.error(`❌ Video generation failed:`, error);
    }
}

// Upload video to Cloudflare Stream
async function uploadToCloudflare(videoPath, videoName) {
    try {
        console.log(`☁️ Uploading to Cloudflare Stream...`);
        
        const uploadScript = path.join(CONFIG.BASE_DIR, 'cloudflare_tus_upload.js');
        const exists = await fs.access(uploadScript).then(() => true).catch(() => false);
        
        if (!exists) {
            console.log('⚠️ Cloudflare upload script not found');
            return;
        }
        
        const { stdout } = await execAsync(`node "${uploadScript}" "${videoPath}" "${videoName}"`);
        console.log(stdout);
        
    } catch (error) {
        console.error('❌ Cloudflare upload failed:', error.message);
    }
}

// Clean up old frames outside the window
async function cleanupOldFrames() {
    console.log('\n🧹 Cleaning up old frames...');
    
    const { startDate } = calculateDateRange();
    const cutoffDate = new Date(startDate);
    cutoffDate.setDate(cutoffDate.getDate() - 1);
    
    try {
        const dirs = await fs.readdir(CONFIG.FRAMES_DIR);
        let deletedCount = 0;
        
        for (const dir of dirs) {
            const dirDate = new Date(dir);
            if (dirDate < cutoffDate) {
                const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
                await fs.rm(dirPath, { recursive: true });
                deletedCount++;
                console.log(`  Deleted: ${dir}`);
            }
        }
        
        if (deletedCount > 0) {
            console.log(`✅ Cleaned up ${deletedCount} old directories`);
        } else {
            console.log('✅ No old frames to clean');
        }
        
    } catch (error) {
        console.error('❌ Cleanup failed:', error);
    }
}

// Main production run
async function runDailyProduction() {
    const startTime = Date.now();
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Heliosphere Daily Production         ║');
    console.log('║   Cron Job Execution                   ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`📅 Run time: ${new Date().toISOString()}`);
    console.log(`📊 Configuration:`);
    console.log(`   Data delay: ${CONFIG.SAFE_DELAY_DAYS} days`);
    console.log(`   Full video: ${CONFIG.TOTAL_DAYS} days`);
    console.log(`   Social video: ${CONFIG.SOCIAL_DAYS} days`);
    console.log('');
    
    productionState.status = 'running';
    productionState.startTime = startTime;
    
    try {
        // Ensure directories exist
        await ensureDirectories();
        
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
        
        const duration = (Date.now() - startTime) / 1000;
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Production Completed Successfully     ║');
        console.log('╚════════════════════════════════════════╝');
        console.log(`⏱️ Duration: ${Math.floor(duration / 60)} min ${Math.floor(duration % 60)} sec`);
        console.log(`📊 Frames processed: ${productionState.processedFrames}`);
        console.log(`⚠️ Fallbacks used: ${productionState.fallbacksUsed}`);
        console.log(`❌ Errors: ${productionState.errors.length}`);
        
        // Save final state
        await saveState();
        await saveManifest();
        
        // Exit with success code
        process.exit(0);
        
    } catch (error) {
        productionState.status = 'error';
        productionState.errors.push({
            type: 'fatal',
            message: error.message,
            stack: error.stack
        });
        
        console.error('');
        console.error('╔════════════════════════════════════════╗');
        console.error('║   Production Failed                     ║');
        console.error('╚════════════════════════════════════════╝');
        console.error('❌ Fatal error:', error.message);
        console.error(error.stack);
        
        // Save error state
        await saveState();
        
        // Exit with error code
        process.exit(1);
    }
}

// Run immediately
runDailyProduction().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});