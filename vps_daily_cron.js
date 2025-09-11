#!/usr/bin/env node

/**
 * Heliosphere Daily Cron Job - Production Ready
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
    RETRY_ATTEMPTS: 3,       // API retry attempts
    RETRY_DELAY: 2000,       // Delay between retries (ms)
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14, // Stay within frame boundary
    FALLBACK_STEPS_SOHO: [0, -1, -3, -5, -7, -10, -12, -14, 1, 3, 5, 7, 10, 12, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 12, -12, 14, -14],
    
    // Cloudflare proxy
    USE_CLOUDFLARE: false,  // Disabled - proxy not handling params correctly
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Storage paths
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/daily_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    TEMP_DIR: '/tmp/heliosphere',
    LOG_DIR: '/opt/heliosphere/logs',
    LOCK_FILE: '/opt/heliosphere/production.lock',
    HEALTH_FILE: '/opt/heliosphere/health.json',
    
    // Safety limits
    MIN_DISK_SPACE_GB: 10,  // Minimum free disk space to start
    
    // Timeouts
    FETCH_TIMEOUT: 300000,    // 5 minutes for API calls (API can be slow)
    PROCESS_TIMEOUT: 60000,   // 60 seconds for processing
    VIDEO_TIMEOUT: 28800000,  // 8 hours for video generation (full production takes ~4hrs fetch + video)
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
    skippedFrames: 0,
    fetchedFrames: 0,
    retriedFrames: 0,      // Successfully retried failed frames
    abandonedFrames: 0,     // Frames abandoned after 7 days
    failedFrames: 0,        // Currently failed frames
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
    const dirs = [
        CONFIG.FRAMES_DIR,
        CONFIG.VIDEOS_DIR,
        CONFIG.TEMP_DIR,
        CONFIG.LOG_DIR
    ];
    
    for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
    }
}

// Load state from disk with validation
async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
        const saved = JSON.parse(data);
        
        // Validate and restore Sets from arrays
        if (saved.checksums) {
            saved.checksums.corona = new Set(saved.checksums.corona || []);
            saved.checksums.sunDisk = new Set(saved.checksums.sunDisk || []);
        }
        
        // Merge with defaults to ensure all fields exist
        productionState = { ...productionState, ...saved };
        console.log(`📋 Loaded previous state (${Object.keys(productionState.frameManifest).length} frames in manifest)`);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('⚠️ Error loading state:', error.message);
        }
        console.log('📋 Starting fresh state');
    }
}

// Save state to disk with error handling
async function saveState() {
    try {
        const toSave = {
            ...productionState,
            checksums: {
                corona: Array.from(productionState.checksums.corona),
                sunDisk: Array.from(productionState.checksums.sunDisk)
            }
        };
        
        // Write to temp file first then rename (atomic operation)
        const tempFile = `${CONFIG.STATE_FILE}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(toSave, null, 2));
        await fs.rename(tempFile, CONFIG.STATE_FILE);
    } catch (error) {
        console.error('❌ Failed to save state:', error.message);
        // Don't throw - continue processing even if state save fails
    }
}

// Load frame manifest with validation
async function loadManifest() {
    try {
        const data = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf-8');
        const manifest = JSON.parse(data);
        
        // Validate manifest structure
        if (typeof manifest === 'object' && manifest !== null) {
            productionState.frameManifest = manifest;
            console.log(`📊 Loaded manifest with ${Object.keys(manifest).length} frames`);
        } else {
            throw new Error('Invalid manifest format');
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('⚠️ Error loading manifest:', error.message);
        }
        productionState.frameManifest = {};
        console.log('📊 Starting new manifest');
    }
}

// Save frame manifest with atomic write
async function saveManifest() {
    try {
        const tempFile = `${CONFIG.MANIFEST_FILE}.tmp`;
        await fs.writeFile(tempFile, JSON.stringify(productionState.frameManifest, null, 2));
        await fs.rename(tempFile, CONFIG.MANIFEST_FILE);
    } catch (error) {
        console.error('❌ Failed to save manifest:', error.message);
    }
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

// Sleep utility for delays
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with timeout and retry
async function fetchWithTimeout(url, timeout = CONFIG.FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timeout');
        }
        throw error;
    }
}

// Fetch image from API with retry logic
async function fetchImage(sourceId, date, attempt = 1) {
    // Corona needs higher scale and resolution to be visible
    const imageScale = sourceId === 4 ? 8 : 2.5;  // Corona: 8, Sun: 2.5
    const width = sourceId === 4 ? 1920 : 1920;   // Both use 1920 width
    const height = sourceId === 4 ? 1200 : 1920;  // Corona: 1200, Sun: 1920
    
    // Build URL with string concatenation to avoid encoding brackets
    const apiParams = 
        `date=${date}` +
        `&imageScale=${imageScale}` +
        `&layers=[${sourceId},1,100]` +
        `&width=${width}` +
        `&height=${height}` +
        `&x0=0&y0=0` +
        `&display=true&watermark=false`;
    
    const url = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/takeScreenshot?${apiParams}`
        : `https://api.helioviewer.org/v2/takeScreenshot/?${apiParams}`;
    
    // Debug logging for first few attempts
    if (attempt === 1 && Math.random() < 0.01) {
        console.log(`  Debug URL for ${sourceId === 4 ? 'corona' : 'sun'}:`, url);
    }
    
    try {
        const response = await fetchWithTimeout(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer);
        
    } catch (error) {
        if (attempt < CONFIG.RETRY_ATTEMPTS) {
            console.log(`  Retry ${attempt}/${CONFIG.RETRY_ATTEMPTS} for ${sourceId === 4 ? 'corona' : 'sun'}`);
            await sleep(CONFIG.RETRY_DELAY * attempt);
            return fetchImage(sourceId, date, attempt + 1);
        }
        throw error;
    }
}

// Fetch image with fallback logic
async function fetchImageWithFallback(targetDate, sourceId, sourceType) {
    const fallbackSteps = sourceType === 'SOHO' 
        ? CONFIG.FALLBACK_STEPS_SOHO 
        : CONFIG.FALLBACK_STEPS_SDO;
    
    let lastError = null;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate.getTime() + minuteOffset * 60 * 1000);
        
        try {
            // Remove milliseconds from ISO string as API doesn't accept them
            const dateStr = tryDate.toISOString().replace(/\.\d{3}/, '');
            const imageBuffer = await fetchImage(sourceId, dateStr);
            
            // Validate image buffer
            if (!imageBuffer || imageBuffer.length < 1000) {
                throw new Error('Invalid image data received');
            }
            
            const checksum = crypto.createHash('md5').update(imageBuffer).digest('hex');
            
            // Check for duplicate
            const checksumSet = sourceId === 4 ? 
                productionState.checksums.corona : 
                productionState.checksums.sunDisk;
            
            if (checksumSet.has(checksum) && minuteOffset !== 0) {
                console.log(`  ⚠️ Duplicate detected at ${minuteOffset} min offset, trying next...`);
                continue;
            }
            
            checksumSet.add(checksum);
            
            if (minuteOffset !== 0) {
                productionState.fallbacksUsed++;
                console.log(`  ✓ Used ${minuteOffset} min fallback for ${sourceType}`);
            }
            
            return { buffer: imageBuffer, offset: minuteOffset };
            
        } catch (error) {
            lastError = error;
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallback attempts failed for ${sourceType}: ${lastError.message}`);
            }
        }
    }
    
    throw new Error(`All fallback attempts failed for ${sourceType}: ${lastError?.message}`);
}

// Apply circular feather to sun disk with error handling
async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    try {
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
        
    } catch (error) {
        console.error('❌ Feathering failed:', error.message);
        throw error;
    }
}

// Process single frame with comprehensive error handling
async function processFrame(frameDate, isRetry = false) {
    const frameKey = getFrameKey(frameDate);
    const framePath = getFramePath(frameDate);
    const existingEntry = productionState.frameManifest[frameKey];
    
    try {
        // Check if frame should be processed
        if (existingEntry) {
            const exists = await fs.access(framePath).then(() => true).catch(() => false);
            
            // Skip if successful and file exists
            if (existingEntry.status === 'success' && exists) {
                productionState.skippedFrames++;
                return;
            }
            
            // Check if failed frame should be abandoned (older than 7 days)
            if (existingEntry.status === 'failed') {
                const daysSinceFirst = (Date.now() - existingEntry.firstAttempt) / (1000 * 60 * 60 * 24);
                if (daysSinceFirst > 7) {
                    if (existingEntry.status !== 'abandoned') {
                        existingEntry.status = 'abandoned';
                        productionState.abandonedFrames++;
                        console.log(`  ⏭️ Abandoning frame after 7 days: ${frameKey}`);
                    }
                    return;
                }
                // This is a retry
                isRetry = true;
            }
        }
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(framePath), { recursive: true });
        
        // Fetch both images
        const [coronaResult, sunDiskResult] = await Promise.all([
            fetchImageWithFallback(frameDate, 4, 'SOHO'),
            fetchImageWithFallback(frameDate, 10, 'SDO')
        ]);
        
        // Apply warm grading to sun disk BEFORE feathering
        const gradedSunDisk = await sharp(sunDiskResult.buffer)
            .modulate({
                brightness: 1.3,    // Brighter sun
                saturation: 0.95    // Warmer tones
            })
            .gamma(1.05)           // Gentler midtone boost
            .linear(1.3, -8)       // More punch and contrast
            .toBuffer();
        
        // Apply circular feather to graded sun disk
        // Keep original size of 1435 which extends beyond frame for dramatic effect
        const featheredSunDisk = await applyCircularFeather(
            gradedSunDisk,
            1435,  // Original size - larger than frame height
            CONFIG.COMPOSITE_RADIUS,
            CONFIG.FEATHER_RADIUS
        );
        
        // Apply cool/blue grading to corona for white appearance
        const gradedCorona = await sharp(coronaResult.buffer)
            .modulate({ 
                saturation: 0.3,    // Desaturate for white appearance
                brightness: 1.0, 
                hue: -5             // Slight blue shift
            })
            .tint({ r: 220, g: 230, b: 240 })  // Blue-white tint
            .linear(1.2, -12)
            .gamma(1.2)
            .toBuffer();
        
        // Create large canvas to accommodate both images
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
        .png()
        .toBuffer();
        
        // Crop to final frame dimensions
        const composite = await sharp(compositeImage)
            .extract({
                left: 230,
                top: 117,
                width: CONFIG.FRAME_WIDTH,
                height: CONFIG.FRAME_HEIGHT
            })
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        // Save frame
        await fs.writeFile(framePath, composite);
        
        // Update manifest with success
        productionState.frameManifest[frameKey] = {
            path: framePath,
            date: frameDate.toISOString(),
            status: 'success',
            firstAttempt: existingEntry?.firstAttempt || Date.now(),
            lastAttempt: Date.now(),
            attempts: (existingEntry?.attempts || 0) + 1,
            lastError: null,
            coronaOffset: coronaResult.offset,
            sunDiskOffset: sunDiskResult.offset,
            size: composite.length,
            timestamp: Date.now()
        };
        
        productionState.processedFrames++;
        productionState.fetchedFrames++;
        
        if (isRetry) {
            productionState.retriedFrames++;
            console.log(`  ✅ Successfully retried frame: ${frameKey}`);
        }
        
        // Log progress every 10 frames
        if (productionState.processedFrames % 10 === 0) {
            const progress = ((productionState.processedFrames + productionState.skippedFrames) / productionState.totalFrames * 100).toFixed(1);
            console.log(`📊 Progress: ${progress}% (${productionState.processedFrames} processed, ${productionState.skippedFrames} skipped)`);
        }
        
    } catch (error) {
        console.error(`❌ Failed frame ${frameKey}: ${error.message}`);
        
        // Update manifest with failure
        productionState.frameManifest[frameKey] = {
            path: framePath,
            date: frameDate.toISOString(),
            status: 'failed',
            firstAttempt: existingEntry?.firstAttempt || Date.now(),
            lastAttempt: Date.now(),
            attempts: (existingEntry?.attempts || 0) + 1,
            lastError: error.message,
            coronaOffset: null,
            sunDiskOffset: null,
            size: 0,
            timestamp: Date.now()
        };
        
        productionState.failedFrames++;
        productionState.errors.push({
            frame: frameKey,
            error: error.message,
            timestamp: Date.now()
        });
        
        // Don't throw - continue processing other frames
    }
}

// Get failed frames that should be retried
function getFailedFramesToRetry() {
    const failedFrames = [];
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    for (const [frameKey, entry] of Object.entries(productionState.frameManifest)) {
        if (entry.status === 'failed' && entry.firstAttempt > sevenDaysAgo) {
            failedFrames.push(new Date(entry.date));
        }
    }
    
    return failedFrames;
}

// Process date range with improved batching
async function processDateRange() {
    const { startDate, endDate } = calculateDateRange();
    
    productionState.dateRange = {
        start: startDate.toISOString(),
        end: endDate.toISOString()
    };
    
    console.log(`\n📅 Processing ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // First, get any failed frames that need retrying
    const failedFramesToRetry = getFailedFramesToRetry();
    if (failedFramesToRetry.length > 0) {
        console.log(`🔄 Found ${failedFramesToRetry.length} failed frames to retry (from last 7 days)`);
    }
    
    // Generate all new frame dates
    const newFrameDates = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
        newFrameDates.push(new Date(current));
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    // Combine failed frames (process first) with new frames
    const frameDates = [...failedFramesToRetry, ...newFrameDates];
    
    productionState.totalFrames = frameDates.length;
    console.log(`📊 Total frames to process: ${productionState.totalFrames}`);
    console.log(`  - Failed frames to retry: ${failedFramesToRetry.length}`);
    console.log(`  - New frames: ${newFrameDates.length}`);
    console.log(`⚡ Batch size: ${CONFIG.FETCH_CONCURRENCY} parallel`);
    
    // Process in parallel batches
    for (let i = 0; i < frameDates.length; i += CONFIG.FETCH_CONCURRENCY) {
        const batch = frameDates.slice(i, i + CONFIG.FETCH_CONCURRENCY);
        
        try {
            await Promise.all(batch.map(date => processFrame(date)));
        } catch (error) {
            console.error(`❌ Batch error: ${error.message}`);
            // Continue with next batch even if this one fails
        }
        
        // Save state periodically
        if ((i + CONFIG.FETCH_CONCURRENCY) % CONFIG.BATCH_SIZE === 0) {
            await saveState();
            await saveManifest();
            
            // Log memory usage
            const memUsage = process.memoryUsage();
            console.log(`💾 Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        }
    }
    
    // Final save
    await saveState();
    await saveManifest();
}

// Generate video from frames with timeout
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
            // Use duration to control frame display time
            frameList.push(`file '${framePath}'`);
            frameList.push(`duration ${1.0/CONFIG.FPS}`);
        }
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    if (frameList.length === 0) {
        console.error('❌ No frames found for video generation');
        return;
    }
    
    // Add last frame without duration
    frameList.push(`file '${getFramePath(endDate)}'`);
    
    console.log(`  📊 Using ${frameList.length / 2} frames`);
    
    // Write frame list
    const listPath = path.join(CONFIG.TEMP_DIR, `${outputName}_list.txt`);
    await fs.writeFile(listPath, frameList.join('\n'));
    
    // Generate video with FFmpeg
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
        `-c:v libx264 -preset veryslow -crf 15 -pix_fmt yuv420p ` +
        `-vf "fps=${CONFIG.FPS},format=yuv420p" "${outputPath}"`;
    
    try {
        console.log('  ⚙️ Running FFmpeg...');
        const { stdout, stderr } = await execAsync(ffmpegCmd, {
            timeout: CONFIG.VIDEO_TIMEOUT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        const stats = await fs.stat(outputPath);
        console.log(`  ✅ Video generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Upload to Cloudflare if configured
        await uploadToCloudflare(outputPath, outputName);
        
        // Clean up temp file
        await fs.unlink(listPath).catch(() => {});
        
    } catch (error) {
        console.error(`  ❌ Video generation failed: ${error.message}`);
        productionState.errors.push({
            type: 'video_generation',
            video: outputName,
            error: error.message
        });
    }
}

// Generate portrait video (cropped for mobile)
async function generatePortraitVideo(days, outputName) {
    console.log(`\n🎬 Generating ${days}-day portrait video: ${outputName}`);
    
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
            frameList.push(`duration ${1.0/CONFIG.FPS}`);
        }
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    if (frameList.length === 0) {
        console.error('❌ No frames found for portrait video generation');
        return;
    }
    
    // Add last frame without duration
    frameList.push(`file '${getFramePath(endDate)}'`);
    
    console.log(`  📊 Using ${frameList.length / 2} frames`);
    
    // Write frame list
    const listPath = path.join(CONFIG.TEMP_DIR, `${outputName}_list.txt`);
    await fs.writeFile(listPath, frameList.join('\n'));
    
    // Generate portrait video with center crop (900x1200)
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
        `-c:v libx264 -preset veryslow -crf 15 -pix_fmt yuv420p ` +
        `-vf "fps=${CONFIG.FPS},crop=900:1200:280:0,format=yuv420p" "${outputPath}"`;
    
    try {
        console.log('  ⚙️ Running FFmpeg for portrait (900x1200 crop)...');
        const { stdout, stderr } = await execAsync(ffmpegCmd, {
            timeout: CONFIG.VIDEO_TIMEOUT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        const stats = await fs.stat(outputPath);
        console.log(`  ✅ Portrait video generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Upload to Cloudflare if configured
        await uploadToCloudflare(outputPath, outputName);
        
        // Clean up temp file
        await fs.unlink(listPath).catch(() => {});
        
    } catch (error) {
        console.error(`  ❌ Portrait video generation failed: ${error.message}`);
        productionState.errors.push({
            type: 'video_generation',
            video: outputName,
            error: error.message
        });
    }
}

// Generate social media video (square crop, 60 seconds)
async function generateSocialVideo(days, outputName) {
    console.log(`\n🎬 Generating ${days}-day social video: ${outputName}`);
    
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
            frameList.push(`duration ${1.0/CONFIG.FPS}`);
        }
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    if (frameList.length === 0) {
        console.error('❌ No frames found for social video generation');
        return;
    }
    
    // Add last frame without duration
    frameList.push(`file '${getFramePath(endDate)}'`);
    
    console.log(`  📊 Using ${frameList.length / 2} frames`);
    
    // Write frame list
    const listPath = path.join(CONFIG.TEMP_DIR, `${outputName}_list.txt`);
    await fs.writeFile(listPath, frameList.join('\n'));
    
    // Generate social video with square crop (1200x1200) and 60 second limit
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${listPath}" ` +
        `-c:v libx264 -preset veryslow -crf 15 -pix_fmt yuv420p ` +
        `-vf "fps=${CONFIG.FPS},crop=1200:1200:130:0,format=yuv420p" ` +
        `-t 60 "${outputPath}"`;
    
    try {
        console.log('  ⚙️ Running FFmpeg for social (1200x1200 crop, 60s)...');
        const { stdout, stderr } = await execAsync(ffmpegCmd, {
            timeout: CONFIG.VIDEO_TIMEOUT,
            maxBuffer: 10 * 1024 * 1024
        });
        
        const stats = await fs.stat(outputPath);
        console.log(`  ✅ Social video generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Upload to Cloudflare if configured
        await uploadToCloudflare(outputPath, outputName);
        
        // Clean up temp file
        await fs.unlink(listPath).catch(() => {});
        
    } catch (error) {
        console.error(`  ❌ Social video generation failed: ${error.message}`);
        productionState.errors.push({
            type: 'video_generation',
            video: outputName,
            error: error.message
        });
    }
}

// Deploy updated website to Cloudflare Pages
async function deployToCloudflarePages() {
    try {
        console.log('\n📄 Deploying updated website to Cloudflare Pages...');
        
        const deployScript = path.join(CONFIG.BASE_DIR, 'deploy_to_pages.js');
        const exists = await fs.access(deployScript).then(() => true).catch(() => false);
        
        if (!exists) {
            console.log('  ⚠️ Deploy script not found, skipping deployment');
            return;
        }
        
        const { stdout, stderr } = await execAsync(
            `cd "${CONFIG.BASE_DIR}" && node "${deployScript}"`,
            {
                env: process.env,
                timeout: CONFIG.VIDEO_TIMEOUT,
                maxBuffer: 10 * 1024 * 1024
            }
        );
        
        if (stdout.includes('Deployment successful') || stdout.includes('deployed')) {
            console.log('  ✅ Website deployed with updated video IDs');
        } else if (stderr) {
            console.error('  ⚠️ Deploy warning:', stderr);
        }
        
    } catch (error) {
        console.error(`  ❌ Website deployment failed: ${error.message}`);
        // Don't throw - deployment failure shouldn't stop the process
    }
}

// Deploy updated website to Cloudflare Pages
async function deployToCloudflarePages() {
    console.log('\n🌐 Deploying updated website to Cloudflare Pages...');
    
    try {
        // Check if deployment script exists
        const deployScript = path.join(CONFIG.BASE_DIR, 'deploy_to_pages.js');
        const exists = await fs.access(deployScript).then(() => true).catch(() => false);
        
        if (!exists) {
            console.log('  ⚠️ Deployment script not found, skipping website update');
            return;
        }
        
        // Create cloudflare_videos.json with latest video IDs
        const today = new Date().toISOString().split('T')[0];
        const videoIds = {
            full: 'e1c32f106f9472fce3a58ec950c430d8',  // Will be updated by deploy script
            portrait: '18f9447ca843d9142f66587c3c609392',
            social: 'a7f1bb1b4c3a2da2ffa7eecf9a411e0e',
            generatedDate: today,
            lastUpdate: new Date().toISOString()
        };
        
        const videoJsonPath = path.join(CONFIG.BASE_DIR, 'cloudflare_videos.json');
        await fs.writeFile(videoJsonPath, JSON.stringify(videoIds, null, 2));
        console.log(`  📝 Updated video metadata for ${today}`);
        
        // Run deployment script
        const { stdout, stderr } = await execAsync(
            `cd "${CONFIG.BASE_DIR}" && node "${deployScript}"`,
            {
                env: { ...process.env },
                timeout: CONFIG.VIDEO_TIMEOUT,
                maxBuffer: 10 * 1024 * 1024
            }
        );
        
        if (stdout.includes('Deployment successful') || stdout.includes('deployed')) {
            console.log('  ✅ Website deployed with updated video IDs and metadata');
        } else if (stderr) {
            console.error('  ⚠️ Deploy warning:', stderr);
        }
        
    } catch (error) {
        console.error(`  ❌ Website deployment failed: ${error.message}`);
        // Don't throw - deployment failure shouldn't stop the process
    }
}

// Upload video to Cloudflare Stream
async function uploadToCloudflare(videoPath, videoName) {
    try {
        console.log(`  ☁️ Uploading to Cloudflare Stream...`);
        
        const uploadScript = path.join(CONFIG.BASE_DIR, 'cloudflare_tus_upload.js');
        const exists = await fs.access(uploadScript).then(() => true).catch(() => false);
        
        if (!exists) {
            console.log('  ⚠️ Cloudflare upload script not found, skipping upload');
            return;
        }
        
        const { stdout, stderr } = await execAsync(
            `node "${uploadScript}" "${videoPath}" "${videoName}"`,
            {
                timeout: CONFIG.VIDEO_TIMEOUT,
                maxBuffer: 10 * 1024 * 1024
            }
        );
        
        if (stdout.includes('Video ID:')) {
            console.log('  ✅ Upload successful');
        }
        
    } catch (error) {
        console.error(`  ❌ Cloudflare upload failed: ${error.message}`);
        productionState.errors.push({
            type: 'cloudflare_upload',
            video: videoName,
            error: error.message
        });
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
        let freedSpace = 0;
        
        for (const dir of dirs) {
            // Skip if not a date directory
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue;
            
            const dirDate = new Date(dir);
            if (dirDate < cutoffDate) {
                const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
                
                // Calculate size before deletion
                try {
                    const files = await fs.readdir(dirPath);
                    for (const file of files) {
                        const filePath = path.join(dirPath, file);
                        const stats = await fs.stat(filePath);
                        freedSpace += stats.size;
                    }
                } catch (error) {
                    // Directory might not exist or be accessible
                }
                
                await fs.rm(dirPath, { recursive: true });
                deletedCount++;
                console.log(`  Deleted: ${dir}`);
            }
        }
        
        if (deletedCount > 0) {
            console.log(`✅ Cleaned up ${deletedCount} old directories (${(freedSpace / 1024 / 1024).toFixed(2)} MB freed)`);
        } else {
            console.log('✅ No old frames to clean');
        }
        
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        // Don't throw - cleanup failure shouldn't stop the process
    }
}

// Clean up old videos (keep only last 3 days of videos)
async function cleanupOldVideos() {
    console.log('\n🎬 Cleaning up old videos...');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 3); // Keep last 3 days of videos
    
    try {
        const files = await fs.readdir(CONFIG.VIDEOS_DIR);
        let deletedCount = 0;
        let freedSpace = 0;
        
        for (const file of files) {
            // Skip if not a video file with date pattern
            const match = file.match(/heliosphere_.*_(\d{4}-\d{2}-\d{2})\.mp4$/);
            if (!match) continue;
            
            const fileDate = new Date(match[1]);
            if (fileDate < cutoffDate) {
                const filePath = path.join(CONFIG.VIDEOS_DIR, file);
                
                // Get file size before deletion
                try {
                    const stats = await fs.stat(filePath);
                    freedSpace += stats.size;
                    
                    await fs.unlink(filePath);
                    deletedCount++;
                    console.log(`  Deleted video: ${file}`);
                } catch (error) {
                    console.error(`  Failed to delete ${file}:`, error.message);
                }
            }
        }
        
        if (deletedCount > 0) {
            console.log(`✅ Cleaned up ${deletedCount} old videos (${(freedSpace / 1024 / 1024).toFixed(2)} MB freed)`);
        } else {
            console.log('✅ No old videos to clean');
        }
        
    } catch (error) {
        console.error('❌ Error cleaning up videos:', error);
    }
}

// Check disk space
async function checkDiskSpace() {
    try {
        const { stdout } = await execAsync("df -BG / | tail -1 | awk '{print $4}'");
        const freeGB = parseInt(stdout.replace('G', ''));
        return freeGB;
    } catch (error) {
        console.error('Failed to check disk space:', error);
        return 100; // Assume enough space if check fails
    }
}

// Create or check lock file
async function acquireLock() {
    try {
        // Check if lock file exists
        const exists = await fs.access(CONFIG.LOCK_FILE).then(() => true).catch(() => false);
        if (exists) {
            const lockData = await fs.readFile(CONFIG.LOCK_FILE, 'utf-8');
            const lock = JSON.parse(lockData);
            const lockAge = Date.now() - lock.timestamp;
            
            // If lock is older than 12 hours, assume stale and remove
            if (lockAge > 12 * 60 * 60 * 1000) {
                console.log('⚠️ Removing stale lock file (>12 hours old)');
                await fs.unlink(CONFIG.LOCK_FILE);
            } else {
                console.error(`❌ Production already running (PID: ${lock.pid}, started: ${new Date(lock.timestamp).toISOString()})`);
                return false;
            }
        }
        
        // Create lock file
        await fs.writeFile(CONFIG.LOCK_FILE, JSON.stringify({
            pid: process.pid,
            timestamp: Date.now(),
            startTime: new Date().toISOString()
        }));
        return true;
    } catch (error) {
        console.error('Failed to acquire lock:', error);
        return false;
    }
}

// Release lock file
async function releaseLock() {
    try {
        await fs.unlink(CONFIG.LOCK_FILE);
    } catch (error) {
        // Ignore errors when releasing lock
    }
}

// Write health check file
async function writeHealthCheck(status, details = {}) {
    try {
        await fs.writeFile(CONFIG.HEALTH_FILE, JSON.stringify({
            status,
            timestamp: Date.now(),
            lastRun: new Date().toISOString(),
            ...details
        }, null, 2));
    } catch (error) {
        console.error('Failed to write health check:', error);
    }
}

// Main production run with comprehensive error handling
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
    console.log(`   Parallel fetches: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log('');
    
    // Check if already running
    if (!await acquireLock()) {
        console.error('❌ Another instance is already running');
        process.exit(4);
    }
    
    // Check disk space
    const freeSpace = await checkDiskSpace();
    console.log(`💾 Free disk space: ${freeSpace}GB`);
    if (freeSpace < CONFIG.MIN_DISK_SPACE_GB) {
        console.error(`❌ Insufficient disk space (${freeSpace}GB < ${CONFIG.MIN_DISK_SPACE_GB}GB required)`);
        await releaseLock();
        process.exit(5);
    }
    
    productionState.status = 'running';
    productionState.startTime = startTime;
    
    let exitCode = 0;
    
    try {
        // Ensure directories exist
        await ensureDirectories();
        
        // Load previous state
        await loadState();
        await loadManifest();
        
        // Process all frames
        await processDateRange();
        
        // Generate videos only if we have enough frames
        if (productionState.processedFrames + productionState.skippedFrames > 0) {
            // Generate full desktop video (56 days, 1460x1200)
            await generateVideo(CONFIG.TOTAL_DAYS, 'heliosphere_full');
            
            // Generate portrait/mobile video (56 days, 900x1200 cropped)
            await generatePortraitVideo(CONFIG.TOTAL_DAYS, 'heliosphere_portrait');
            
            // Generate social media video (30 days, 1200x1200 cropped, 60 seconds)
            await generateSocialVideo(CONFIG.SOCIAL_DAYS, 'heliosphere_social');
            
            // Deploy updated website with new video IDs
            await deployToCloudflarePages();
        } else {
            console.error('⚠️ No frames available for video generation');
            exitCode = 2;
        }
        
        // Clean up old frames
        await cleanupOldFrames();
        
        // Clean up old videos
        await cleanupOldVideos();
        
        productionState.status = 'completed';
        productionState.lastUpdate = Date.now();
        
        const duration = (Date.now() - startTime) / 1000;
        console.log('');
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Production Completed                  ║');
        console.log('╚════════════════════════════════════════╝');
        console.log(`⏱️ Duration: ${Math.floor(duration / 60)} min ${Math.floor(duration % 60)} sec`);
        console.log(`📊 Frames processed: ${productionState.processedFrames}`);
        console.log(`⏭️ Frames skipped: ${productionState.skippedFrames}`);
        console.log(`🔄 Frames retried: ${productionState.retriedFrames}`);
        console.log(`❌ Frames failed: ${productionState.failedFrames}`);
        console.log(`⏸️ Frames abandoned: ${productionState.abandonedFrames}`);
        console.log(`⚠️ Fallbacks used: ${productionState.fallbacksUsed}`);
        console.log(`❌ Errors: ${productionState.errors.length}`);
        
        if (productionState.errors.length > 0) {
            console.log('\nError summary:');
            const errorTypes = {};
            productionState.errors.forEach(e => {
                const type = e.type || 'frame';
                errorTypes[type] = (errorTypes[type] || 0) + 1;
            });
            Object.entries(errorTypes).forEach(([type, count]) => {
                console.log(`  ${type}: ${count} errors`);
            });
            
            // Exit with warning code if there were errors
            if (productionState.errors.length > productionState.totalFrames * 0.1) {
                exitCode = 3; // More than 10% errors
            }
        }
        
        // Save final state
        await saveState();
        await saveManifest();
        
        // Write health check
        await writeHealthCheck('success', {
            duration: Math.floor(duration),
            framesProcessed: productionState.processedFrames,
            framesSkipped: productionState.skippedFrames,
            framesFailed: productionState.failedFrames,
            errors: productionState.errors.length
        });
        
    } catch (error) {
        productionState.status = 'error';
        productionState.errors.push({
            type: 'fatal',
            message: error.message,
            stack: error.stack,
            timestamp: Date.now()
        });
        
        console.error('');
        console.error('╔════════════════════════════════════════╗');
        console.error('║   Production Failed                     ║');
        console.error('╚════════════════════════════════════════╝');
        console.error('❌ Fatal error:', error.message);
        console.error(error.stack);
        
        // Save error state
        await saveState().catch(console.error);
        
        // Write health check
        await writeHealthCheck('failed', {
            error: error.message,
            duration: Math.floor((Date.now() - startTime) / 1000)
        });
        
        exitCode = 1;
    }
    
    // Log final memory usage
    const memUsage = process.memoryUsage();
    console.log(`\n💾 Final memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB used`);
    
    // Release lock and exit
    await releaseLock();
    process.exit(exitCode);
}

// Set up graceful shutdown
process.on('SIGTERM', async () => {
    console.log('\n⚠️ SIGTERM received, saving state and shutting down...');
    productionState.status = 'terminated';
    await saveState().catch(console.error);
    await saveManifest().catch(console.error);
    await releaseLock();
    process.exit(130);
});

process.on('SIGINT', async () => {
    console.log('\n⚠️ SIGINT received, saving state and shutting down...');
    productionState.status = 'interrupted';
    await saveState().catch(console.error);
    await saveManifest().catch(console.error);
    await releaseLock();
    process.exit(130);
});

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
    console.error('💥 Uncaught exception:', error);
    productionState.errors.push({
        type: 'uncaught_exception',
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
    });
    await saveState().catch(console.error);
    process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
    productionState.errors.push({
        type: 'unhandled_rejection',
        message: String(reason),
        timestamp: Date.now()
    });
    await saveState().catch(console.error);
    process.exit(1);
});

// Run immediately
runDailyProduction().catch(error => {
    console.error('💥 Unhandled error in main:', error);
    process.exit(1);
});