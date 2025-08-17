#!/usr/bin/env node

/**
 * Heliosphere VPS Production Server
 * Carefully migrated from cloud_server.js with working pipeline logic
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
    PORT: process.env.PORT || 3000,
    
    // Generation settings - same as original
    TOTAL_DAYS: 56,
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    TOTAL_FRAMES: 5376,
    FPS: 24,
    
    // Tuning parameters - same as original
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    
    // VPS optimized concurrency
    FETCH_CONCURRENCY: 10,  // VPS has great network
    PROCESS_CONCURRENCY: 4, // 2 CPUs, 4GB RAM
    
    // Cloudflare proxy (optional but faster)
    USE_CLOUDFLARE_PROXY: process.env.USE_CLOUDFLARE_PROXY !== 'false',
    CLOUDFLARE_WORKER_URL: process.env.CLOUDFLARE_WORKER_URL || 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Local storage paths
    OUTPUT_DIR: '/opt/heliosphere/output',
    TEMP_DIR: '/tmp/heliosphere',
    STATE_FILE: '/opt/heliosphere/state.json'
};

// Generation state - exactly like cloud_server.js
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
    componentChecksums: {
        corona: new Set(),
        sunDisk: new Set()
    }
};

// Initialize Express
const app = express();
app.use(express.json());
app.use(express.static(__dirname)); // Serve monitor page

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(CONFIG.OUTPUT_DIR, 'frames'), { recursive: true });
    await fs.mkdir(path.join(CONFIG.OUTPUT_DIR, 'logs'), { recursive: true });
}

// Load state from disk
async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
        const saved = JSON.parse(data);
        // Restore Sets from arrays
        saved.componentChecksums = {
            corona: new Set(saved.componentChecksums?.corona || []),
            sunDisk: new Set(saved.componentChecksums?.sunDisk || [])
        };
        generationState = { ...generationState, ...saved };
        console.log('📋 Loaded state from disk');
    } catch (error) {
        console.log('📋 No previous state found, starting fresh');
    }
}

// Save state to disk
async function saveState() {
    try {
        // Convert Sets to arrays for JSON serialization
        const toSave = {
            ...generationState,
            componentChecksums: {
                corona: Array.from(generationState.componentChecksums.corona),
                sunDisk: Array.from(generationState.componentChecksums.sunDisk)
            }
        };
        await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
    } catch (error) {
        console.error('Failed to save state:', error);
    }
}

// Log to file and console
async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    
    const logFile = path.join(CONFIG.OUTPUT_DIR, 'logs', `generation_${new Date().toISOString().split('T')[0]}.log`);
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
}

// Fetch frame images - adapted from cloud_server.js
async function fetchFrameImages(frameNumber, frameDate) {
    const dateString = frameDate.toISOString();
    
    // Fetch both images in parallel
    const [coronaImage, sunDiskImage] = await Promise.all([
        fetchImage(4, dateString, `corona_${frameNumber}`),
        fetchImage(10, dateString, `sun_${frameNumber}`)
    ]);
    
    const startTime = Date.now();
    await log(`Frame ${frameNumber} fetch: ${Date.now() - startTime}ms`);
    
    return {
        frameNumber,
        frameDate: dateString,
        coronaPath: coronaImage,
        sunDiskPath: sunDiskImage
    };
}

// Fetch single image with curl using takeScreenshot API (returns PNG that Sharp can process)
async function fetchImage(sourceId, date, name) {
    // Use same parameters as src/index.ts
    // sourceId 4 = Corona (SOHO/LASCO C2)
    // sourceId 10 = Sun Disk (SDO/AIA 171) - matching src/index.ts
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    // Use takeScreenshot API which returns actual PNG that Sharp can process
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}` +
        `&layers=[${sourceId},1,100]` +
        `&imageScale=${imageScale}` +
        `&width=${width}` +
        `&height=${height}` +
        `&x0=0&y0=0` +
        `&display=true` +
        `&watermark=false`;
    
    const fetchUrl = CONFIG.USE_CLOUDFLARE_PROXY 
        ? `${CONFIG.CLOUDFLARE_WORKER_URL}/?url=${encodeURIComponent(apiUrl)}`
        : apiUrl;
    
    const outputPath = path.join(CONFIG.TEMP_DIR, `${name}.png`);
    
    const curlOptions = '--connect-timeout 10 --max-time 30 --retry 2 --retry-delay 2';
    const curlCommand = `curl ${curlOptions} -s -o "${outputPath}" "${fetchUrl}"`;
    
    const startTime = Date.now();
    try {
        await execAsync(curlCommand, { timeout: 35000 });
        await log(`Fetched ${name} in ${Date.now() - startTime}ms`);
        return outputPath;
    } catch (error) {
        await log(`Failed to fetch ${name}: ${error.message}`, 'ERROR');
        throw error;
    }
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

// Apply color grading to corona
async function gradeCorona(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

// Apply circular feathering
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

// Process frame - exactly from cloud_server.js
async function processFrame(frameData) {
    const startTime = Date.now();
    const { frameNumber, frameDate, coronaPath, sunDiskPath } = frameData;
    
    try {
        // Load images
        const coronaBuffer = await fs.readFile(coronaPath);
        const sunDiskBuffer = await fs.readFile(sunDiskPath);
        
        // Calculate checksums for duplicate detection
        const coronaChecksum = crypto.createHash('md5').update(coronaBuffer).digest('hex');
        const sunDiskChecksum = crypto.createHash('md5').update(sunDiskBuffer).digest('hex');
        
        // Track component checksums
        generationState.componentChecksums.corona.add(coronaChecksum);
        generationState.componentChecksums.sunDisk.add(sunDiskChecksum);
        
        await log(`Frame ${frameNumber}: Starting color grading`);
        
        // Apply color grading in parallel
        const [gradedCorona, gradedSunDisk] = await Promise.all([
            gradeCorona(coronaBuffer),
            gradeSunDisk(sunDiskBuffer)
        ]);
        
        // Apply feathering to sun disk (1435px fixed size)
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
            .jpeg({ quality: 90 })
            .toBuffer();
        
        const finalChecksum = crypto.createHash('md5').update(finalImage).digest('hex');
        
        await log(`Frame ${frameNumber} processed in ${Date.now() - startTime}ms`, 'SUCCESS');
        
        // Clean up temp files
        await fs.unlink(coronaPath).catch(() => {});
        await fs.unlink(sunDiskPath).catch(() => {});
        
        return {
            success: true,
            frameNumber,
            frameDate,
            imageBuffer: finalImage,
            checksum: finalChecksum,
            coronaChecksum,
            sunDiskChecksum,
            fallbackInfo: { total: 0 }
        };
    } catch (error) {
        await log(`Frame ${frameNumber} processing failed: ${error.message}`, 'ERROR');
        
        // Clean up on error
        await fs.unlink(coronaPath).catch(() => {});
        await fs.unlink(sunDiskPath).catch(() => {});
        
        return {
            success: false,
            frameNumber,
            frameDate,
            error: error.message
        };
    }
}

// Save frames locally
async function saveFramesLocally(frameResults) {
    const successful = [];
    const failed = [];
    
    for (const result of frameResults) {
        if (!result.success) {
            failed.push(result);
            continue;
        }
        
        try {
            const fileName = `frame_${result.frameNumber.toString().padStart(5, '0')}.jpg`;
            const filePath = path.join(CONFIG.OUTPUT_DIR, 'frames', fileName);
            
            await fs.writeFile(filePath, result.imageBuffer);
            successful.push(result);
            await log(`Saved frame ${result.frameNumber} to ${fileName}`);
        } catch (error) {
            await log(`Failed to save frame ${result.frameNumber}: ${error.message}`, 'ERROR');
            failed.push({ ...result, saveError: error.message });
        }
    }
    
    return { successful, failed };
}

// Background frame generation with pipelining - EXACT logic from cloud_server.js
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
    
    // Create queues for fetching and processing
    const pendingFetches = [];
    const pendingProcesses = [];
    let nextFrameToFetch = 0;
    
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
    for (let i = 0; i < Math.min(CONFIG.FETCH_CONCURRENCY, totalFrames); i++) {
        startNextFetch();
    }
    
    // Collect frame results as they complete
    const frameResults = [];
    
    // Process frames as they become available
    while (generationState.status === 'running') {
        // Log pipeline state
        if (frameResults.length % 10 === 0 || pendingFetches.length === 0) {
            await log(`Pipeline: ${pendingFetches.length} fetches, ${pendingProcesses.length} processes, ${frameResults.length} completed`);
        }
        
        // Check if we're completely done
        if (pendingFetches.length === 0 && pendingProcesses.length === 0 && nextFrameToFetch >= totalFrames) {
            await log(`Pipeline complete: All frames processed`);
            break;
        }
        
        // If we can start processing and have fetched frames ready
        if (pendingProcesses.length < CONFIG.PROCESS_CONCURRENCY && pendingFetches.length > 0) {
            // Wait for next fetch to complete
            const fetchedData = await pendingFetches.shift();
            
            if (fetchedData) {
                // Start processing this frame
                await log(`Starting to process frame ${fetchedData.frameNumber}`);
                const processPromise = processFrame(fetchedData).catch(error => {
                    log(`Frame ${fetchedData.frameNumber} processing error: ${error.message}`, 'ERROR');
                    return { success: false, frameNumber: fetchedData.frameNumber, error: error.message };
                });
                pendingProcesses.push(processPromise);
            }
            
            // Start fetching another frame
            startNextFetch();
        }
        
        // If at process capacity or no more fetches, wait for process to complete
        if (pendingProcesses.length >= CONFIG.PROCESS_CONCURRENCY || 
            (pendingProcesses.length > 0 && pendingFetches.length === 0 && nextFrameToFetch >= totalFrames)) {
            const result = await pendingProcesses.shift();
            if (result) {
                frameResults.push(result);
                await log(`Frame ${result.frameNumber} complete: ${result.success ? 'success' : 'failed'}`);
            }
        }
        
        // Prevent infinite loop
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Collect any remaining frame results
    while (pendingProcesses.length > 0) {
        const result = await pendingProcesses.shift();
        if (result) {
            frameResults.push(result);
        }
    }
    
    // Save frames locally
    await log(`Saving ${frameResults.length} frames locally...`);
    const { successful, failed } = await saveFramesLocally(frameResults);
    
    // Update state with results
    generationState.completedFrames = successful.length;
    generationState.failedFrames = failed.length;
    
    // Build manifest
    generationState.manifest.frames = successful
        .filter(r => r.success)
        .map(r => ({
            number: r.frameNumber,
            date: r.frameDate,
            checksum: r.checksum
        }))
        .sort((a, b) => a.number - b.number);
    
    generationState.status = 'completed';
    generationState.lastUpdate = Date.now();
    
    await saveState();
    
    await log(`Generation completed: ${generationState.completedFrames}/${totalFrames} frames`, 'SUCCESS');
    if (failed.length > 0) {
        await log(`Failed frames: ${failed.map(f => f.frameNumber).join(', ')}`, 'WARNING');
    }
}

// API Endpoints

// Serve monitor page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'cloud_monitor.html'));
});

app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'cloud_monitor.html'));
});

// Status endpoint
app.get('/status', (req, res) => {
    const runtime = generationState.startTime 
        ? Math.floor((Date.now() - generationState.startTime) / 1000)
        : 0;
    
    const progress = generationState.totalFrames > 0
        ? ((generationState.completedFrames / generationState.totalFrames) * 100).toFixed(1)
        : '0.0';
    
    res.json({
        ...generationState,
        runtime,
        progress
    });
});

// Start generation
app.post('/generate', async (req, res) => {
    if (generationState.status === 'running') {
        return res.status(400).json({ error: 'Generation already in progress' });
    }
    
    const frames = parseInt(req.query.frames) || CONFIG.TOTAL_FRAMES;
    
    res.json({ 
        message: 'Generation started',
        frames,
        monitor: `/monitor`
    });
    
    // Start generation in background
    generateFrames(frames).catch(error => {
        console.error('Generation error:', error);
        generationState.status = 'error';
        generationState.lastUpdate = Date.now();
        saveState();
    });
});

// Stop generation
app.post('/stop', async (req, res) => {
    if (generationState.status === 'running') {
        generationState.status = 'stopped';
        await saveState();
        res.json({ message: 'Generation stopped' });
    } else {
        res.json({ message: 'No generation in progress' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Compile video endpoint
app.post('/compile-video', async (req, res) => {
    const framesDir = path.join(CONFIG.OUTPUT_DIR, 'frames');
    const outputPath = path.join(CONFIG.OUTPUT_DIR, `heliosphere_${Date.now()}.mp4`);
    
    try {
        const ffmpegCommand = `ffmpeg -framerate ${CONFIG.FPS} -pattern_type glob -i '${framesDir}/*.jpg' -c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 "${outputPath}"`;
        
        await execAsync(ffmpegCommand, { timeout: 300000 });
        
        const stats = await fs.stat(outputPath);
        const duration = Math.floor(generationState.completedFrames / CONFIG.FPS);
        
        res.json({
            success: true,
            path: outputPath,
            size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
            duration: `${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}`
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server
async function start() {
    await ensureDirectories();
    await loadState();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Heliosphere VPS Production Server    ║');
        console.log(`║   Port: ${CONFIG.PORT}                           ║`);
        console.log('║   Ready for generation!                ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('');
        console.log(`📊 Monitor: http://localhost:${CONFIG.PORT}/monitor`);
        console.log(`📁 Output: ${CONFIG.OUTPUT_DIR}`);
        console.log(`⚡ Using Cloudflare: ${CONFIG.USE_CLOUDFLARE_PROXY}`);
    });
}

start().catch(console.error);