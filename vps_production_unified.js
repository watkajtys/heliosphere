#!/usr/bin/env node

/**
 * Unified Heliosphere Production System
 * Combines parallel fetching with robust error handling and monitoring
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
    
    // Processing (optimized for parallel)
    FETCH_CONCURRENCY: 8,     // Parallel image fetches
    PROCESS_CONCURRENCY: 4,   // Parallel frame processing
    BATCH_SIZE: 100,         // Save state every N frames
    MAX_RETRIES: 3,          // Max retry attempts for failed fetches
    
    // Fallback limits - max ±7min to stay safely within 15min frame boundaries
    MAX_FALLBACK_MINUTES: 7, // Stay well within 15min frame boundary
    FALLBACK_STEPS_SOHO: [0, -1, -3, -5, -7, 1, 3, 5, 7],  // Try negative first to avoid cascade
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7],   // Alternate +/- for better coverage
    
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
    MAX_MISSING_FRAMES_PERCENT: 5,  // Fail if more than 5% frames missing
    MIN_FRAME_SIZE_KB: 50,          // Minimum valid frame size
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
    missingFrames: [],  // Track frame numbers that couldn't be fetched
    fallbacksUsed: 0,
    retryCount: 0,
    errors: [],
    frameManifest: {},
    checksums: {
        corona: new Map(),  // checksum -> [frameNumbers]
        sunDisk: new Map()  // checksum -> [frameNumbers]
    },
    failureStats: {
        coronaFailures: 0,
        sunDiskFailures: 0,
        bothFailures: 0
    }
};

// Initialize Express
const app = express();
app.use(express.json());

// Serve static files for monitor
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
        // Restore Maps from array entries
        if (saved.checksums) {
            saved.checksums.corona = new Map(saved.checksums.corona || []);
            saved.checksums.sunDisk = new Map(saved.checksums.sunDisk || []);
        }
        // Initialize missing arrays if not present (for backward compatibility)
        if (!saved.missingFrames) {
            saved.missingFrames = [];
        }
        if (!saved.failureStats) {
            saved.failureStats = { coronaFailures: 0, sunDiskFailures: 0, bothFailures: 0 };
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
                // Convert Maps to Arrays of entries for JSON serialization
                corona: Array.from(productionState.checksums.corona.entries()),
                sunDisk: Array.from(productionState.checksums.sunDisk.entries())
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

// Calculate checksum for image buffer
function calculateChecksum(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// Check if checksum is duplicate
function isDuplicate(checksum, sourceType, frameNumber) {
    const checksumMap = sourceType === 'corona' 
        ? productionState.checksums.corona
        : productionState.checksums.sunDisk;
    
    if (checksumMap.has(checksum)) {
        const existingFrames = checksumMap.get(checksum);
        // It's a duplicate if this checksum was seen in a different frame
        const isDupe = existingFrames.some(f => Math.abs(f - frameNumber) > 1);
        if (isDupe) {
            console.log(`⚠️ Duplicate ${sourceType} detected! Frame ${frameNumber} matches frames ${existingFrames.join(', ')}`);
            return true;
        }
    }
    
    // Add to cache
    if (!checksumMap.has(checksum)) {
        checksumMap.set(checksum, []);
    }
    checksumMap.get(checksum).push(frameNumber);
    
    return false;
}

// Fetch single image with retry logic
async function fetchImageWithRetry(sourceId, date, retries = CONFIG.MAX_RETRIES) {
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
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}_${Math.random()}.png`);
        
        try {
            await execAsync(`curl -s -o "${tempFile}" "${fetchUrl}"`, { timeout: 30000 });
            const buffer = await fs.readFile(tempFile);
            await fs.unlink(tempFile).catch(() => {});
            
            // Validate frame size
            if (buffer.length < CONFIG.MIN_FRAME_SIZE_KB * 1024) {
                throw new Error(`Frame too small: ${buffer.length} bytes`);
            }
            
            return {
                buffer,
                checksum: calculateChecksum(buffer)
            };
        } catch (error) {
            await fs.unlink(tempFile).catch(() => {});
            if (attempt === retries) {
                throw error;
            }
            productionState.retryCount++;
            console.log(`  Retry ${attempt}/${retries} for ${sourceId === 4 ? 'SOHO' : 'SDO'}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        }
    }
}

// Fetch image with fallback logic
async function fetchImageWithFallback(targetDate, sourceId, sourceType, frameNumber) {
    const fallbackSteps = sourceType === 'SOHO' 
        ? CONFIG.FALLBACK_STEPS_SOHO 
        : CONFIG.FALLBACK_STEPS_SDO;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate.getTime() + minuteOffset * 60 * 1000);
        
        try {
            const result = await fetchImageWithRetry(sourceId, tryDate.toISOString());
            
            // Check for duplicate
            if (isDuplicate(result.checksum, sourceType.toLowerCase(), frameNumber)) {
                if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                    // Last fallback, have to use it even if duplicate
                    console.log(`  ⚠️ Using duplicate for frame ${frameNumber} (no alternatives)`);
                    return {
                        ...result,
                        fallbackMinutes: minuteOffset,
                        isDuplicate: true
                    };
                }
                // Try next fallback
                continue;
            }
            
            // Not a duplicate, use it
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

// Process frames with parallel fetching
async function processFramesParallel(frames) {
    console.log(`\n📊 Processing ${frames.length} frames with parallel fetching`);
    console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}`);
    
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    
    async function fetchNextFrame() {
        if (fetchQueue.length === 0) return null;
        
        const frame = fetchQueue.shift();
        const { number, date } = frame;
        
        try {
            // Fetch both images in parallel, tracking individual failures
            let coronaResult = null;
            let sunDiskResult = null;
            let coronaError = null;
            let sunDiskError = null;
            
            await Promise.allSettled([
                fetchImageWithFallback(date, 4, 'SOHO', number).then(r => coronaResult = r).catch(e => coronaError = e),
                fetchImageWithFallback(date, 10, 'SDO', number).then(r => sunDiskResult = r).catch(e => sunDiskError = e)
            ]);
            
            // Track which component(s) failed
            if (coronaError && sunDiskError) {
                productionState.failureStats.bothFailures++;
                console.error(`❌ Frame ${number}: Both corona and sun disk failed`);
            } else if (coronaError) {
                productionState.failureStats.coronaFailures++;
                console.error(`❌ Frame ${number}: Corona failed - ${coronaError.message}`);
            } else if (sunDiskError) {
                productionState.failureStats.sunDiskFailures++;
                console.error(`❌ Frame ${number}: Sun disk failed - ${sunDiskError.message}`);
            }
            
            // If either component failed, drop the entire frame
            if (coronaError || sunDiskError) {
                productionState.missingFrames.push(number);
                productionState.errors.push({
                    frame: number,
                    date: date.toISOString(),
                    coronaError: coronaError?.message,
                    sunDiskError: sunDiskError?.message
                });
                return null;
            }
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: coronaResult,
                sunDisk: sunDiskResult
            };
        } catch (error) {
            console.error(`❌ Frame ${number} unexpected error: ${error.message}`);
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
            // Process frame
            const processedFrame = await processFrame(frameData.corona, frameData.sunDisk);
            
            // Save frame
            const dir = path.dirname(framePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(framePath, processedFrame);
            
            // Update manifest
            const frameKey = getFrameKey(frameData.frameDate);
            productionState.frameManifest[frameKey] = {
                path: framePath,
                date: frameData.frameDate.toISOString(),
                frameNumber: frameData.frameNumber,
                coronaChecksum: frameData.corona.checksum,
                sunDiskChecksum: frameData.sunDisk.checksum,
                coronaFallback: frameData.corona.fallbackMinutes,
                sunDiskFallback: frameData.sunDisk.fallbackMinutes
            };
            
            productionState.processedFrames++;
            productionState.fetchedFrames++;
            
            // Progress update
            if (productionState.processedFrames % 10 === 0) {
                const progress = (productionState.processedFrames / frames.length * 100).toFixed(1);
                const runtime = (Date.now() - productionState.startTime) / 1000;
                const fps = (productionState.processedFrames / (runtime / 60)).toFixed(1);
                console.log(`Progress: ${progress}% (${productionState.processedFrames}/${frames.length}) - ${fps} frames/min`);
            }
            
            // Save state periodically
            if (productionState.processedFrames % CONFIG.BATCH_SIZE === 0) {
                await saveState();
                await saveManifest();
            }
            
            return true;
        } catch (error) {
            console.error(`❌ Frame ${frameData.frameNumber} processing failed: ${error.message}`);
            productionState.errors.push({
                frame: frameData.frameNumber,
                date: frameData.frameDate.toISOString(),
                error: error.message
            });
            return false;
        }
    }
    
    // Start parallel processing
    while (fetchQueue.length > 0 || activeFetches.size > 0 || processingQueue.length > 0 || activeProcesses.size > 0) {
        // Start new fetches up to concurrency limit
        while (activeFetches.size < CONFIG.FETCH_CONCURRENCY && fetchQueue.length > 0) {
            const fetchPromise = fetchNextFrame();
            activeFetches.add(fetchPromise);
            
            fetchPromise.then(result => {
                activeFetches.delete(fetchPromise);
                if (result) {
                    processingQueue.push(result);
                }
            });
        }
        
        // Start new processing up to concurrency limit
        while (activeProcesses.size < CONFIG.PROCESS_CONCURRENCY && processingQueue.length > 0) {
            const processPromise = processNextFrame();
            activeProcesses.add(processPromise);
            
            processPromise.then(() => {
                activeProcesses.delete(processPromise);
            });
        }
        
        // Wait a bit before checking again
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Final save
    await saveState();
    await saveManifest();
}

// Validate and interpolate missing frames before video generation
async function validateAndInterpolateFrames(frames) {
    console.log('\n🔍 Validating frames...');
    
    const missingFrames = [];
    
    // Check which frames are missing
    for (let i = 0; i < frames.length; i++) {
        const framePath = getFramePath(frames[i]);
        if (!await fileExists(framePath)) {
            missingFrames.push(i);
        }
    }
    
    if (missingFrames.length === 0) {
        console.log('✅ All frames present');
        return true;
    }
    
    const missingPercent = (missingFrames.length / frames.length * 100).toFixed(1);
    console.log(`⚠️ Missing ${missingFrames.length} frames (${missingPercent}%)`);
    
    // Check for large gaps (consecutive missing frames)
    let maxGap = 0;
    let currentGap = 1;
    for (let i = 1; i < missingFrames.length; i++) {
        if (missingFrames[i] === missingFrames[i-1] + 1) {
            currentGap++;
            maxGap = Math.max(maxGap, currentGap);
        } else {
            currentGap = 1;
        }
    }
    
    if (maxGap > 10) {
        console.warn(`⚠️ Large gap detected: ${maxGap} consecutive frames missing!`);
        console.warn('   This may indicate systematic data availability issues');
    }
    
    // Check if too many frames are missing
    if (missingPercent > CONFIG.MAX_MISSING_FRAMES_PERCENT) {
        console.error(`❌ Too many frames missing (${missingPercent}% > ${CONFIG.MAX_MISSING_FRAMES_PERCENT}%)`);
        return false;
    }
    
    // Interpolate missing frames
    console.log('🔧 Interpolating missing frames...');
    let interpolated = 0;
    
    for (const frameIndex of missingFrames) {
        if (frameIndex > 0 && frameIndex < frames.length - 1) {
            const prevPath = getFramePath(frames[frameIndex - 1]);
            const nextPath = getFramePath(frames[frameIndex + 1]);
            const targetPath = getFramePath(frames[frameIndex]);
            
            if (await fileExists(prevPath) && await fileExists(nextPath)) {
                try {
                    const prevFrame = await fs.readFile(prevPath);
                    const nextFrame = await fs.readFile(nextPath);
                    const interpolatedFrame = await interpolateFrame(prevFrame, nextFrame);
                    
                    const dir = path.dirname(targetPath);
                    await fs.mkdir(dir, { recursive: true });
                    await fs.writeFile(targetPath, interpolatedFrame);
                    
                    interpolated++;
                    console.log(`  ✓ Interpolated frame ${frameIndex}`);
                } catch (error) {
                    console.error(`  ❌ Failed to interpolate frame ${frameIndex}: ${error.message}`);
                }
            }
        }
    }
    
    console.log(`✅ Interpolated ${interpolated}/${missingFrames.length} missing frames`);
    return true;
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
    
    // Filter out already processed frames
    const framesToProcess = [];
    for (let i = 0; i < frames.length; i++) {
        const frameKey = getFrameKey(frames[i]);
        const framePath = getFramePath(frames[i]);
        
        if (!productionState.frameManifest[frameKey] || !await fileExists(framePath)) {
            framesToProcess.push({ number: i, date: frames[i] });
        } else {
            productionState.processedFrames++;
        }
    }
    
    console.log(`📊 Frames to fetch: ${framesToProcess.length}`);
    console.log(`📊 Already processed: ${productionState.processedFrames}`);
    
    // Process remaining frames with parallel fetching
    if (framesToProcess.length > 0) {
        await processFramesParallel(framesToProcess);
    }
    
    // Validate and interpolate missing frames
    const valid = await validateAndInterpolateFrames(frames);
    if (!valid) {
        throw new Error('Frame validation failed - too many missing frames');
    }
    
    console.log(`\n✅ Processing complete!`);
    console.log(`   Processed: ${productionState.processedFrames}/${productionState.totalFrames}`);
    console.log(`   Fetched: ${productionState.fetchedFrames}`);
    console.log(`   Interpolated: ${productionState.interpolatedFrames}`);
    console.log(`   Fallbacks used: ${productionState.fallbacksUsed}`);
    console.log(`   Retries: ${productionState.retryCount}`);
    
    return frames;
}

// Generate video from frames
async function generateVideo(frames, days, outputName) {
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    
    const endDate = frames[frames.length - 1];
    const videoStartDate = new Date(endDate);
    videoStartDate.setDate(videoStartDate.getDate() - days + 1);
    videoStartDate.setHours(0, 0, 0, 0);
    
    // Create frame list file
    const frameListPath = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    const frameList = [];
    let skippedFrames = 0;
    
    for (const frame of frames) {
        if (frame >= videoStartDate) {
            const framePath = getFramePath(frame);
            if (await fileExists(framePath)) {
                frameList.push(`file '${framePath}'`);
            } else {
                skippedFrames++;
            }
        }
    }
    
    if (skippedFrames > 0) {
        console.log(`⚠️ Skipping ${skippedFrames} missing frames in video`);
    }
    
    // Check if we have enough frames for a meaningful video
    if (frameList.length === 0) {
        console.error(`❌ No frames available for ${outputName} video generation`);
        return null;
    }
    
    if (frameList.length < 100) {
        console.warn(`⚠️ Only ${frameList.length} frames available for ${outputName} (minimum recommended: 100)`);
        if (frameList.length < 24) {  // Less than 1 second at 24fps
            console.error(`❌ Not enough frames for viable video: ${frameList.length} < 24 (1 second)`);
            return null;
        }
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

// Generate summary report
function generateReport() {
    const runtime = (Date.now() - productionState.startTime) / 1000;
    const fps = (productionState.processedFrames / (runtime / 60)).toFixed(1);
    
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║            PRODUCTION SUMMARY REPORT               ║');
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
    console.log('╚════════════════════════════════════════════════════╝');
    
    if (productionState.errors.length > 0) {
        console.log('\n❌ Errors encountered:');
        productionState.errors.slice(0, 10).forEach(err => {
            console.log(`   Frame ${err.frame}: ${err.error}`);
        });
        if (productionState.errors.length > 10) {
            console.log(`   ... and ${productionState.errors.length - 10} more`);
        }
    }
}

// Main daily production run
async function runDailyProduction() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Heliosphere Unified Production       ║');
    console.log('╚════════════════════════════════════════╝');
    
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    try {
        // Load previous state
        await loadState();
        await loadManifest();
        
        // Process all frames
        const frames = await processDateRange();
        
        // Generate videos
        await generateVideo(frames, CONFIG.TOTAL_DAYS, 'heliosphere_full');
        await generateVideo(frames, CONFIG.SOCIAL_DAYS, 'heliosphere_social');
        
        // Clean up old frames
        await cleanupOldFrames();
        
        productionState.status = 'completed';
        productionState.lastUpdate = Date.now();
        
        // Generate report
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
        checksums: {
            corona: productionState.checksums.corona.size,
            sunDisk: productionState.checksums.sunDisk.size
        },
        framesPerMinute: runtime > 0 ? 
            (productionState.processedFrames / (runtime / 60)).toFixed(1) : 0
    });
});

// Also provide /api/status for monitor compatibility
app.get('/api/status', (req, res) => {
    const runtime = productionState.startTime 
        ? (Date.now() - productionState.startTime) / 1000
        : 0;
    
    res.json({
        ...productionState,
        runtime,
        checksums: {
            corona: productionState.checksums.corona.size,
            sunDisk: productionState.checksums.sunDisk.size
        },
        framesPerMinute: runtime > 0 ? 
            (productionState.processedFrames / (runtime / 60)).toFixed(1) : 0
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

// Serve monitor page
app.get('/monitor', (req, res) => {
    res.sendFile(path.join('/opt/heliosphere', 'monitor_production.html'), (err) => {
        if (err) {
            // Fallback to monitor_optimized.html if monitor_production.html doesn't exist
            res.sendFile(path.join('/opt/heliosphere', 'monitor_optimized.html'), (err2) => {
                if (err2) {
                    console.error('Monitor file error:', err2);
                    res.status(500).send('Monitor temporarily unavailable');
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
        frameList: manifestKeys.slice(-10), // Last 10 frames
        missingFrames: productionState.missingFrames.length,
        interpolatedFrames: productionState.interpolatedFrames
    });
});

// Start server
async function start() {
    await ensureDirectories();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Unified Production Server Ready      ║');
        console.log(`║   Port: ${CONFIG.PORT}                           ║`);
        console.log('╚════════════════════════════════════════╝');
        console.log('');
        console.log('📅 Configuration:');
        console.log(`   Data delay: ${CONFIG.SAFE_DELAY_DAYS} days`);
        console.log(`   Full video: ${CONFIG.TOTAL_DAYS} days`);
        console.log(`   Social video: ${CONFIG.SOCIAL_DAYS} days`);
        console.log(`   Frame rate: ${CONFIG.FPS} fps`);
        console.log(`   Parallel fetching: ${CONFIG.FETCH_CONCURRENCY} concurrent`);
        console.log('');
        console.log('🔧 Endpoints:');
        console.log(`   POST /run - Start production`);
        console.log(`   GET /status - Check status`);
        console.log(`   GET /monitor - Web dashboard`);
        console.log(`   GET /health - Health check`);
        
        // Run immediately if --run flag
        if (process.argv.includes('--run')) {
            console.log('\n🚀 Starting production run...\n');
            runDailyProduction().catch(console.error);
        }
    });
}

start().catch(console.error);