#!/usr/bin/env node

import express from 'express';
import { Storage } from '@google-cloud/storage';
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
    PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT || 'heliosphere-solar',
    NASA_API_KEY: process.env.NASA_API_KEY || 'DEMO_KEY',
    PORT: process.env.PORT || 8080,
    
    // Generation settings
    TOTAL_DAYS: 56,
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    TOTAL_FRAMES: 5376,
    FPS: 24,
    
    // Tuning parameters
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    
    // Cloud Storage buckets
    FRAMES_BUCKET: 'heliosphere-frames',
    VIDEOS_BUCKET: 'heliosphere-videos',
    MANIFESTS_BUCKET: 'heliosphere-manifests',
    
    // Local processing options
    LOCAL_MODE: process.env.LOCAL_MODE === 'true',
    LOCAL_FRAMES_DIR: process.env.LOCAL_FRAMES_DIR || './local_frames',
    
    // Cloudflare Worker proxy
    USE_CLOUDFLARE_PROXY: process.env.USE_CLOUDFLARE_PROXY === 'true',
    CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL || 'https://heliosphere-proxy.matty-f7e.workers.dev'
};

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Initialize Cloud Storage
const storage = new Storage({
    projectId: CONFIG.PROJECT_ID
});

const buckets = {
    frames: storage.bucket(CONFIG.FRAMES_BUCKET),
    videos: storage.bucket(CONFIG.VIDEOS_BUCKET),
    manifests: storage.bucket(CONFIG.MANIFESTS_BUCKET)
};

// Generation state (loaded from Cloud Storage)
let generationState = {
    status: 'idle',
    startTime: null,
    lastUpdate: null,
    currentFrame: 0,
    totalFrames: CONFIG.TOTAL_FRAMES,
    completedFrames: 0,
    failedFrames: 0,
    fallbacks: {
        corona: 0,
        sunDisk: 0,
        total: 0
    },
    duplicates: {
        corona: 0,
        sunDisk: 0,
        resolved: 0,
        skipped: 0
    },
    manifest: {
        version: '1.0',
        frames: [],
        checksums: []
    },
    // Track component checksums during parallel processing
    componentChecksums: {
        corona: new Set(),
        sunDisk: new Set()
    }
};

/**
 * Load state from Cloud Storage
 */
async function loadState() {
    try {
        const file = buckets.manifests.file('current-status.json');
        const [exists] = await file.exists();
        
        if (exists) {
            const [contents] = await file.download();
            generationState = JSON.parse(contents.toString());
            
            // Convert componentChecksums back to Sets if they exist
            if (generationState.componentChecksums) {
                generationState.componentChecksums.corona = new Set(generationState.componentChecksums.corona || []);
                generationState.componentChecksums.sunDisk = new Set(generationState.componentChecksums.sunDisk || []);
            } else {
                // Initialize if not present
                generationState.componentChecksums = {
                    corona: new Set(),
                    sunDisk: new Set()
                };
            }
            
            console.log('📋 Loaded state from Cloud Storage');
            return true;
        }
    } catch (error) {
        console.error('Error loading state:', error);
    }
    return false;
}

/**
 * Save state to Cloud Storage
 */
async function saveState() {
    try {
        // Convert Sets to Arrays for serialization
        const stateToSave = { ...generationState };
        if (stateToSave.componentChecksums) {
            stateToSave.componentChecksums = {
                corona: Array.from(stateToSave.componentChecksums.corona || new Set()),
                sunDisk: Array.from(stateToSave.componentChecksums.sunDisk || new Set())
            };
        }
        
        const file = buckets.manifests.file('current-status.json');
        await file.save(JSON.stringify(stateToSave, null, 2), {
            metadata: {
                contentType: 'application/json',
                cacheControl: 'no-cache'
            }
        });
        console.log('💾 State saved to Cloud Storage');
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

/**
 * Log to Cloud Storage
 */
async function logToCloud(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${message}\n`;
    
    console.log(logEntry);
    
    try {
        const today = new Date().toISOString().split('T')[0];
        const logFile = buckets.manifests.file(`logs/${today}.log`);
        
        // Append to existing log or create new
        const [exists] = await logFile.exists();
        let content = '';
        
        if (exists) {
            const [existing] = await logFile.download();
            content = existing.toString();
        }
        
        content += logEntry;
        
        await logFile.save(content, {
            metadata: {
                contentType: 'text/plain',
                cacheControl: 'no-cache'
            }
        });
    } catch (error) {
        console.error('Error logging to cloud:', error);
    }
}

/**
 * Calculate checksum
 */
function calculateChecksum(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Fetch image from Helioviewer API using curl for better performance
 */
async function fetchHelioviewerImage(isoDate, sourceId, imageScale, width, height) {
    const apiUrl = new URL('https://api.helioviewer.org/v2/takeScreenshot/');
    apiUrl.searchParams.set('date', isoDate);
    apiUrl.searchParams.set('layers', `[${sourceId},1,100]`);
    apiUrl.searchParams.set('imageScale', imageScale.toString());
    apiUrl.searchParams.set('width', width.toString());
    apiUrl.searchParams.set('height', height.toString());
    apiUrl.searchParams.set('x0', '0');
    apiUrl.searchParams.set('y0', '0');
    apiUrl.searchParams.set('display', 'true');
    apiUrl.searchParams.set('watermark', 'false');

    // Use Cloudflare Worker proxy if configured
    let finalUrl = apiUrl.toString();
    
    if (CONFIG.USE_CLOUDFLARE_PROXY) {
        // Route through Cloudflare Worker for better performance from Cloud Run
        const encodedUrl = encodeURIComponent(apiUrl.toString());
        finalUrl = `${CONFIG.CLOUDFLARE_WORKER_URL}?url=${encodedUrl}`;
        await logToCloud(`Using Cloudflare Worker proxy for Helioviewer request`, 'info');
    } else if (process.env.USE_PROXY === 'true') {
        // Fallback to allorigins.win proxy
        const encodedUrl = encodeURIComponent(apiUrl.toString());
        finalUrl = `https://api.allorigins.win/raw?url=${encodedUrl}`;
        await logToCloud(`Using allorigins proxy for Helioviewer request`, 'info');
    }

    // Use curl instead of fetch for better performance from Cloud Run
    try {
        // Add more aggressive timeouts and retries for Cloudflare proxy
        const curlOptions = CONFIG.USE_CLOUDFLARE_PROXY 
            ? '--connect-timeout 10 --max-time 30 --retry 2 --retry-delay 2'
            : '--keepalive-time 30 --max-time 60';
            
        const { stdout, stderr } = await execAsync(
            `curl -s ${curlOptions} "${finalUrl}"`, 
            { 
                encoding: 'buffer',
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer for images
            }
        );
        
        if (stderr && stderr.length > 0) {
            throw new Error(`Helioviewer API failed: ${stderr.toString()}`);
        }
        
        if (!stdout || stdout.length === 0) {
            throw new Error('Helioviewer API returned empty response');
        }
        
        return stdout; // Already a Buffer
    } catch (error) {
        throw new Error(`Helioviewer API failed: ${error.message}`);
    }
}

/**
 * Fetch with fallback
 */
async function fetchImageWithFallback(targetDate, sourceId, imageScale, width, height, sourceType, extendedFallback = false) {
    // Standard fallback steps
    let fallbackSteps = sourceType.includes('SOHO') 
        ? [0, -3, -7, -1, 1, 3, -5, 5, 7]
        : [0, 1, -1, 3, -3, 5, -5, 7, -7];
    
    // Extended fallback steps for duplicate resolution
    if (extendedFallback) {
        const extendedSteps = sourceType.includes('SOHO')
            ? [-10, 10, -15, 15, -20, 20, -30, 30, -45, 45, -60, 60, -90, 90]
            : [10, -10, 15, -15, 20, -20, 30, -30, 45, -45, 60, -60, 90, -90];
        fallbackSteps = [...fallbackSteps, ...extendedSteps];
    }
    
    for (const step of fallbackSteps) {
        try {
            const adjustedDate = new Date(targetDate.getTime() + step * 60 * 1000);
            const imageBuffer = await fetchHelioviewerImage(
                adjustedDate.toISOString(), sourceId, imageScale, width, height
            );
            
            // Calculate checksum to verify uniqueness
            const checksum = calculateChecksum(imageBuffer);
            
            return { 
                imageBuffer, 
                checksum,
                fallbackMinutes: step,
                fallbackUsed: step !== 0,
                extendedFallbackUsed: Math.abs(step) > 9
            };
        } catch (error) {
            if (step === fallbackSteps[fallbackSteps.length - 1]) {
                throw error;
            }
        }
    }
}

/**
 * Apply circular feathering
 */
async function applyCircularFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,  // High-quality resize
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

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
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

/**
 * Apply Ad Astra color grading
 */
async function gradeSunDisk(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

async function gradeCorona(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}


/**
 * Main generation handler
 */
async function handleGeneration(req, res) {
    const frames = parseInt(req.query.frames) || CONFIG.TOTAL_FRAMES;
    
    if (generationState.status === 'running') {
        return res.status(400).json({ error: 'Generation already in progress' });
    }
    
    res.json({ 
        message: 'Generation started',
        frames: frames,
        monitor: `https://${req.get('host')}/monitor`
    });
    
    // Start generation in background
    generateFrames(frames).catch(console.error);
}

/**
 * Fetch images for a frame with duplicate detection and resolution
 */
async function fetchFrameImages(frameNumber, frameDate) {
    const fetchStart = Date.now();
    
    try {
        // First attempt: standard fetch
        let [coronaResult, sunDiskResult] = await Promise.all([
            fetchImageWithFallback(frameDate, 4, 8, 1920, 1200, 'SOHO/LASCO', false),
            fetchImageWithFallback(frameDate, 10, 2.5, 1920, 1920, 'SDO/AIA', false)
        ]);
        
        // Check for duplicates against global component checksums
        const coronaIsDuplicate = generationState.componentChecksums.corona.has(coronaResult.checksum);
        const sunDiskIsDuplicate = generationState.componentChecksums.sunDisk.has(sunDiskResult.checksum);
        
        // If duplicates found, attempt extended fallback
        if (coronaIsDuplicate) {
            await logToCloud(`Frame ${frameNumber}: Corona duplicate detected, attempting extended fallback`, 'warning');
            generationState.duplicates.corona++;
            
            // Try to find a unique corona image with extended fallback
            const extendedResult = await fetchImageWithFallback(frameDate, 4, 8, 1920, 1200, 'SOHO/LASCO', true);
            
            // Check if the extended fallback found a unique image
            if (!generationState.componentChecksums.corona.has(extendedResult.checksum)) {
                coronaResult = extendedResult;
                generationState.duplicates.resolved++;
                await logToCloud(`Frame ${frameNumber}: Corona duplicate resolved with ${extendedResult.fallbackMinutes}min offset`, 'success');
            } else {
                generationState.duplicates.skipped++;
                await logToCloud(`Frame ${frameNumber}: Corona duplicate could not be resolved, using best available`, 'warning');
            }
        }
        
        if (sunDiskIsDuplicate) {
            await logToCloud(`Frame ${frameNumber}: Sun disk duplicate detected, attempting extended fallback`, 'warning');
            generationState.duplicates.sunDisk++;
            
            // Try to find a unique sun disk image with extended fallback
            const extendedResult = await fetchImageWithFallback(frameDate, 10, 2.5, 1920, 1920, 'SDO/AIA', true);
            
            // Check if the extended fallback found a unique image
            if (!generationState.componentChecksums.sunDisk.has(extendedResult.checksum)) {
                sunDiskResult = extendedResult;
                generationState.duplicates.resolved++;
                await logToCloud(`Frame ${frameNumber}: Sun disk duplicate resolved with ${extendedResult.fallbackMinutes}min offset`, 'success');
            } else {
                generationState.duplicates.skipped++;
                await logToCloud(`Frame ${frameNumber}: Sun disk duplicate could not be resolved, using best available`, 'warning');
            }
        }
        
        // Add checksums to global tracking
        generationState.componentChecksums.corona.add(coronaResult.checksum);
        generationState.componentChecksums.sunDisk.add(sunDiskResult.checksum);
        
        await logToCloud(`Frame ${frameNumber} fetch: ${Date.now() - fetchStart}ms`, 'info');
        
        return {
            frameNumber,
            frameDate,
            coronaResult,
            sunDiskResult,
            coronaChecksum: coronaResult.checksum,
            sunDiskChecksum: sunDiskResult.checksum,
            fetchTime: Date.now() - fetchStart
        };
    } catch (error) {
        await logToCloud(`Frame ${frameNumber} fetch failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Process a frame locally (without uploading)
 */
async function processFrame(fetchedData) {
    const { frameNumber, frameDate, coronaResult, sunDiskResult, coronaChecksum, sunDiskChecksum } = fetchedData;
    const processStart = Date.now();
    
    // Update current frame being processed for monitor
    generationState.currentFrame = frameNumber;
    
    // Check for duplicate source images
    const existingFrames = generationState.manifest.frames || [];
    const duplicateCorona = existingFrames.find(f => f.coronaChecksum === coronaChecksum);
    const duplicateSunDisk = existingFrames.find(f => f.sunDiskChecksum === sunDiskChecksum);
    
    if (duplicateCorona) {
        await logToCloud(`WARNING: Frame ${frameNumber} corona matches frame ${duplicateCorona.number}`, 'warning');
    }
    if (duplicateSunDisk) {
        await logToCloud(`WARNING: Frame ${frameNumber} sun disk matches frame ${duplicateSunDisk.number}`, 'warning');
    }
    
    const fallbackInfo = {
        corona: 0,
        sunDisk: 0,
        total: 0
    };
    
    try {
        // Process fallback info
        if (coronaResult.fallbackUsed) {
            fallbackInfo.corona = coronaResult.fallbackMinutes;
            fallbackInfo.total++;
            generationState.fallbacks.corona++;
            
            if (coronaResult.extendedFallbackUsed) {
                await logToCloud(`Frame ${frameNumber}: Used extended corona fallback (${coronaResult.fallbackMinutes}min)`, 'info');
            }
        }
        if (sunDiskResult.fallbackUsed) {
            fallbackInfo.sunDisk = sunDiskResult.fallbackMinutes;
            fallbackInfo.total++;
            generationState.fallbacks.sunDisk++;
            
            if (sunDiskResult.extendedFallbackUsed) {
                await logToCloud(`Frame ${frameNumber}: Used extended sun disk fallback (${sunDiskResult.fallbackMinutes}min)`, 'info');
            }
        }
        
        // Apply color grading in parallel
        await logToCloud(`Frame ${frameNumber}: Starting color grading`, 'info');
        const [gradedCorona, gradedSunDisk] = await Promise.all([
            gradeCorona(coronaResult.imageBuffer),
            gradeSunDisk(sunDiskResult.imageBuffer)
        ]).catch(error => {
            throw new Error(`Color grading failed: ${error.message}`);
        });
        
        // Apply feathering
        const featheredSunDisk = await applyCircularFeather(
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
        .png({ compressionLevel: 9, quality: 100 }) // Maximum quality PNG
        .toBuffer();
        
        // Crop to final dimensions
        const finalImage = await sharp(compositeImage)
            .extract({
                left: 230,
                top: 117,
                width: CONFIG.FRAME_WIDTH,
                height: CONFIG.FRAME_HEIGHT
            })
            .png({ compressionLevel: 9, quality: 100 }) // Maximum quality PNG
            .toBuffer();
        
        // Calculate checksum for duplicate detection
        const checksum = calculateChecksum(finalImage);
        
        const processTime = Date.now() - processStart;
        await logToCloud(`Frame ${frameNumber} processed in ${processTime}ms`, 'success');
        
        // Return frame data for batch processing
        return {
            success: true,
            frameNumber,
            frameDate: frameDate.toISOString(),
            frameName: `frames/frame_${frameNumber.toString().padStart(4, '0')}.png`,
            imageBuffer: finalImage,
            checksum,
            coronaChecksum,
            sunDiskChecksum,
            fallbackInfo,
            processTime
        };
    } catch (error) {
        await logToCloud(`Frame ${frameNumber} processing failed: ${error.message}`, 'error');
        return {
            success: false,
            frameNumber,
            error: error.message
        };
    }
}


/**
 * Batch upload frames to Cloud Storage or save locally
 */
async function batchUploadFrames(frameResults) {
    const successful = [];
    const failed = [];
    
    if (CONFIG.LOCAL_MODE) {
        // In local mode, save frames to local directory and queue for background upload
        await fs.mkdir(CONFIG.LOCAL_FRAMES_DIR, { recursive: true });
        
        for (const result of frameResults) {
            if (!result.success) {
                failed.push(result);
                continue;
            }
            
            try {
                // Save frame locally
                const localPath = path.join(CONFIG.LOCAL_FRAMES_DIR, `frame_${result.frameNumber.toString().padStart(4, '0')}.png`);
                await fs.writeFile(localPath, result.imageBuffer);
                
                successful.push(result);
                await logToCloud(`Saved frame ${result.frameNumber} locally to ${localPath}`, 'info');
                
                // Queue for background upload (non-blocking)
                uploadToCloudInBackground(result).catch(err => 
                    console.error(`Background upload failed for frame ${result.frameNumber}:`, err)
                );
            } catch (error) {
                await logToCloud(`Failed to save frame ${result.frameNumber} locally: ${error.message}`, 'error');
                failed.push({ ...result, saveError: error.message });
            }
        }
    } else {
        // Original cloud upload mode - upload in parallel batches
        const BATCH_SIZE = 5;
        for (let i = 0; i < frameResults.length; i += BATCH_SIZE) {
            const batch = frameResults.slice(i, i + BATCH_SIZE);
            
            await Promise.all(batch.map(async (result) => {
                if (!result.success) {
                    failed.push(result);
                    return;
                }
                
                try {
                    const file = buckets.frames.file(`frames/frame_${result.frameNumber.toString().padStart(4, '0')}.png`);
                    await file.save(result.imageBuffer, {
                        metadata: {
                            contentType: 'image/png',
                            metadata: {
                                frameNumber: result.frameNumber.toString(),
                                date: result.frameDate,
                                fallbacks: JSON.stringify(result.fallbackInfo)
                            }
                        }
                    });
                    successful.push(result);
                    await logToCloud(`Uploaded frame ${result.frameNumber} to Cloud Storage`, 'info');
                } catch (error) {
                    await logToCloud(`Failed to upload frame ${result.frameNumber}: ${error.message}`, 'error');
                    failed.push({ ...result, uploadError: error.message });
                }
            }));
        }
    }
    
    return { successful, failed };
}

/**
 * Background upload to Cloud Storage (fire-and-forget)
 */
async function uploadToCloudInBackground(result) {
    try {
        const file = buckets.frames.file(`frames/frame_${result.frameNumber.toString().padStart(4, '0')}.png`);
        await file.save(result.imageBuffer, {
            metadata: {
                contentType: 'image/png',
                metadata: {
                    frameNumber: result.frameNumber.toString(),
                    date: result.frameDate,
                    fallbacks: JSON.stringify(result.fallbackInfo)
                }
            }
        });
        console.log(`Background upload completed for frame ${result.frameNumber}`);
    } catch (error) {
        console.error(`Background upload failed for frame ${result.frameNumber}:`, error.message);
        throw error;
    }
}

/**
 * Background frame generation with pipelining
 */
async function generateFrames(totalFrames) {
    // Reset state for new generation
    generationState = {
        status: 'running',
        startTime: Date.now(),
        lastUpdate: null,
        currentFrame: 0,
        totalFrames: totalFrames,
        completedFrames: 0,
        failedFrames: 0,
        fallbacks: {
            corona: 0,
            sunDisk: 0,
            total: 0
        },
        duplicates: {
            corona: 0,
            sunDisk: 0,
            resolved: 0,
            skipped: 0
        },
        manifest: {
            version: '1.0',
            frames: [],
            checksums: []
        },
        // Reset component checksum tracking
        componentChecksums: {
            corona: new Set(),
            sunDisk: new Set()
        }
    };
    await saveState();
    
    const endDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const startDate = new Date(endDate.getTime() - CONFIG.TOTAL_DAYS * 24 * 60 * 60 * 1000);
    
    // Create frame metadata array
    const frames = [];
    for (let i = 0; i < totalFrames; i++) {
        const frameNumber = i + 1;
        const minutesFromStart = i * CONFIG.INTERVAL_MINUTES;
        const frameDate = new Date(startDate.getTime() + minutesFromStart * 60 * 1000);
        frames.push({ frameNumber, frameDate });
    }
    
    // Pipeline configuration - optimized for 2 CPU Cloud Run
    const FETCH_CONCURRENCY = 5;  // Fetch up to 5 frames ahead (I/O bound)
    const PROCESS_CONCURRENCY = 3; // Process up to 3 frames at once (CPU bound)
    
    // Create queues for fetching and processing
    const pendingFetches = [];
    const pendingProcesses = [];
    let nextFrameToFetch = 0;
    let framesStartedProcessing = 0;
    
    // Helper to start fetching next frame
    const startNextFetch = () => {
        if (nextFrameToFetch < totalFrames && generationState.status === 'running') {
            const frame = frames[nextFrameToFetch++];
            generationState.currentFrame = frame.frameNumber;
            const fetchPromise = fetchFrameImages(frame.frameNumber, frame.frameDate);
            pendingFetches.push(fetchPromise);
            return true;
        }
        return false;
    };
    
    // Start initial fetches
    for (let i = 0; i < Math.min(FETCH_CONCURRENCY, totalFrames); i++) {
        startNextFetch();
    }
    
    // Collect frame results as they complete
    const frameResults = [];
    
    // Process frames as they become available
    while (generationState.status === 'running') {
        // Log pipeline state for debugging
        if (frameResults.length % 10 === 0 || pendingFetches.length === 0) {
            await logToCloud(`Pipeline: ${pendingFetches.length} fetches, ${pendingProcesses.length} processes, ${frameResults.length} completed`, 'info');
        }
        
        // Check if we're completely done
        if (pendingFetches.length === 0 && pendingProcesses.length === 0 && nextFrameToFetch >= totalFrames) {
            await logToCloud(`Pipeline complete: All frames processed`, 'info');
            break;
        }
        
        // If we can start processing and have fetched frames ready
        if (pendingProcesses.length < PROCESS_CONCURRENCY && pendingFetches.length > 0) {
            // Wait for next fetch to complete
            const fetchedData = await pendingFetches.shift();
            
            if (fetchedData) {
                // Start processing this frame
                await logToCloud(`Starting to process frame ${fetchedData.frameNumber}`, 'info');
                const processPromise = processFrame(fetchedData).catch(error => {
                    logToCloud(`Frame ${fetchedData.frameNumber} processing error: ${error.message}`, 'error');
                    return { success: false, frameNumber: fetchedData.frameNumber, error: error.message };
                });
                pendingProcesses.push(processPromise);
                framesStartedProcessing++;
            }
            
            // Start fetching another frame to maintain pipeline
            startNextFetch();
        }
        
        // If we're at process capacity or no more fetches, wait for a process to complete
        if (pendingProcesses.length >= PROCESS_CONCURRENCY || 
            (pendingProcesses.length > 0 && pendingFetches.length === 0 && nextFrameToFetch >= totalFrames)) {
            const result = await pendingProcesses.shift();
            if (result) {
                frameResults.push(result);
                await logToCloud(`Frame ${result.frameNumber} complete: ${result.success ? 'success' : 'failed'}`, 'info');
            }
        }
        
        // Prevent infinite loop if stuck
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Collect any remaining frame results
    while (pendingProcesses.length > 0) {
        const result = await pendingProcesses.shift();
        if (result) {
            frameResults.push(result);
        }
    }
    
    // Batch upload frames to Cloud Storage
    await logToCloud(`Uploading ${frameResults.length} frames to Cloud Storage in batches...`, 'info');
    const { successful, failed } = await batchUploadFrames(frameResults);
    
    // Update state with all results atomically
    generationState.completedFrames = successful.length;
    generationState.failedFrames = failed.length;
    
    // Build manifest from successful frames
    generationState.manifest.frames = successful
        .filter(r => r.success)
        .map(r => ({
            number: r.frameNumber,
            date: r.frameDate,
            checksum: r.checksum,
            coronaChecksum: r.coronaChecksum,
            sunDiskChecksum: r.sunDiskChecksum,
            fallbacks: r.fallbackInfo
        }))
        .sort((a, b) => a.number - b.number);
    
    // Count fallbacks
    generationState.fallbacks.total = successful.filter(r => r.fallbackInfo && r.fallbackInfo.total > 0).length;
    
    generationState.status = 'completed';
    generationState.lastUpdate = Date.now();
    
    // Log component statistics
    const componentStats = {
        uniqueCoronas: generationState.componentChecksums.corona.size,
        uniqueSunDisks: generationState.componentChecksums.sunDisk.size
    };
    
    // Save final state once
    await saveState();
    
    await logToCloud(`Generation completed: ${generationState.completedFrames}/${totalFrames} frames`, 'success');
    if (failed.length > 0) {
        await logToCloud(`Failed frames: ${failed.map(f => f.frameNumber).join(', ')}`, 'warning');
    }
    await logToCloud(`Duplicate stats - Corona: ${generationState.duplicates.corona}, Sun: ${generationState.duplicates.sunDisk}, Resolved: ${generationState.duplicates.resolved}, Skipped: ${generationState.duplicates.skipped}`, 'info');
    await logToCloud(`Unique components - Corona: ${componentStats.uniqueCoronas}, Sun Disk: ${componentStats.uniqueSunDisks}`, 'info');
}

/**
 * Generate video from frames
 */
async function generateVideo(req, res) {
    try {
        await logToCloud('Starting video generation', 'info');
        
        // Download frames from Cloud Storage to temp directory
        const tempDir = '/tmp/frames';
        await fs.mkdir(tempDir, { recursive: true });
        
        // List all frames
        const [files] = await buckets.frames.getFiles({ prefix: 'frames/' });
        
        await logToCloud(`Downloading ${files.length} frames for video generation`, 'info');
        
        // Download frames
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const frameNumber = file.name.match(/frame_(\d+)\.png/)[1];
            await file.download({ 
                destination: path.join(tempDir, `frame_${frameNumber}.png`) 
            });
            
            if ((i + 1) % 100 === 0) {
                await logToCloud(`Downloaded ${i + 1}/${files.length} frames`, 'info');
            }
        }
        
        // Generate video with FFmpeg
        const outputPath = '/tmp/heliosphere.mp4';
        const ffmpegCmd = `ffmpeg -y -framerate ${CONFIG.FPS} -i "${tempDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 "${outputPath}"`;
        
        await logToCloud('Running FFmpeg to create video', 'info');
        await execAsync(ffmpegCmd);
        
        // Upload video to Cloud Storage
        const videoName = `heliosphere_${new Date().toISOString().split('T')[0]}.mp4`;
        const videoFile = buckets.videos.file(videoName);
        
        await videoFile.save(await fs.readFile(outputPath), {
            metadata: {
                contentType: 'video/mp4',
                cacheControl: 'public, max-age=86400'
            }
        });
        
        // Don't use makePublic with uniform bucket-level access
        const publicUrl = `https://storage.googleapis.com/${CONFIG.VIDEOS_BUCKET}/${videoName}`;
        
        await logToCloud(`Video generated and uploaded: ${publicUrl}`, 'success');
        
        // Clean up temp files
        await fs.rm(tempDir, { recursive: true, force: true });
        await fs.unlink(outputPath);
        
        res.json({
            success: true,
            url: publicUrl,
            frames: files.length,
            duration: `${Math.floor(files.length / CONFIG.FPS / 60)}:${(files.length / CONFIG.FPS % 60).toFixed(0).padStart(2, '0')}`
        });
        
    } catch (error) {
        await logToCloud(`Video generation failed: ${error.message}`, 'error');
        res.status(500).json({ error: error.message });
    }
}

// API Routes
app.post('/generate', handleGeneration);

app.get('/status', async (req, res) => {
    await loadState();
    res.json({
        ...generationState,
        progress: (generationState.completedFrames / generationState.totalFrames * 100).toFixed(1),
        runtime: generationState.startTime ? (Date.now() - generationState.startTime) / 1000 : 0
    });
});

app.post('/compile-video', generateVideo);

app.post('/stop', async (req, res) => {
    generationState.status = 'stopped';
    await saveState();
    res.json({ message: 'Generation stopped' });
});

app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'cloud_monitor.html'));
});

app.get('/api/frame/:number', async (req, res) => {
    try {
        const frameNumber = req.params.number.padStart(4, '0');
        const file = buckets.frames.file(`frames/frame_${frameNumber}.png`);
        
        const [exists] = await file.exists();
        if (!exists) {
            return res.status(404).send('Frame not found');
        }
        
        const [data] = await file.download();
        res.contentType('image/png');
        res.send(data);
    } catch (error) {
        res.status(500).send('Error retrieving frame');
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', project: CONFIG.PROJECT_ID });
});

// Start server
const server = app.listen(CONFIG.PORT, async () => {
    console.log(`
╔════════════════════════════════════════════╗
║   Heliosphere Cloud Run Server             ║
║                                            ║
║   Project: ${CONFIG.PROJECT_ID.padEnd(32)}║
║   Port: ${CONFIG.PORT.toString().padEnd(36)}║
║   Frames: ${CONFIG.TOTAL_FRAMES} (${CONFIG.TOTAL_DAYS} days)              ║
║                                            ║
║   Endpoints:                               ║
║   POST /generate - Start generation        ║
║   GET  /status - Get current status        ║
║   GET  /monitor - View dashboard           ║
║   POST /compile-video - Generate video     ║
║                                            ║
╚════════════════════════════════════════════╝
    `);
    
    await loadState();
    await logToCloud('Cloud server started', 'info');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    await logToCloud('Server shutting down', 'info');
    await saveState();
    server.close(() => {
        console.log('Server closed');
    });
});