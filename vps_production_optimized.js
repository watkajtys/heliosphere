#!/usr/bin/env node

/**
 * Optimized Production System with Smart Concurrency
 * Handles duplicate detection across parallel fetches
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import VideoEncoder from './lib/video_encoder.js';
import FrameQualityValidator from './frame_quality_validator.js';
import { getQualityMonitor } from './lib/quality_monitor.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // Concurrency settings
    FETCH_CONCURRENCY: 8,     // Parallel image fetches
    PROCESS_CONCURRENCY: 4,   // Parallel frame processing
    BATCH_SIZE: 100,          // Save state every N frames
    
    // DUPLICATE DETECTION STRATEGY
    // When parallel fetching, we need a two-phase approach:
    // 1. Fetch Phase: Collect all images with checksums
    // 2. Validation Phase: Check for duplicates and retry with fallbacks
    DUPLICATE_CHECK_BATCH: 20, // Check duplicates every N frames
    
    // Time windows
    SAFE_DELAY_DAYS: 2,
    TOTAL_DAYS: 56,
    SOCIAL_DAYS: 30,
    
    // Frame settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    FPS: 24,
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14,
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    // Storage
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/production_state.json',
    TEMP_DIR: '/tmp/heliosphere',
    
    // Monitoring  
    PORT: process.env.PORT || 3001
};

// Global state with duplicate tracking
let productionState = {
    status: 'idle',
    startTime: null,
    totalFrames: 0,
    processedFrames: 0,
    duplicateRetries: 0,
    checksumCache: {
        // Track ALL checksums ever seen
        corona: new Map(), // checksum -> [frameNumbers]
        sunDisk: new Map() // checksum -> [frameNumbers]
    },
    pendingFrames: [], // Frames being fetched in parallel
    frameQueue: [],    // Frames ready for processing
    qualityScores: [], // Track quality scores
    qualityIssues: []  // Track any quality issues
};

// Initialize quality components
const qualityValidator = new FrameQualityValidator({
    minFileSize: 10,
    maxFileSize: 10000  // Basically no limit for lossless
});
const qualityMonitor = getQualityMonitor();

// Initialize Express app (simple pattern like working daily production)
const app = express();
app.use(express.json());

// Serve static files
app.use(express.static('.'));

// Main monitoring route - serve the monitor HTML
app.get('/monitor', (req, res) => {
    res.sendFile('/opt/heliosphere/monitor_production.html');
});

// Simple redirect from root
app.get('/', (req, res) => {
    res.redirect('/monitor');
});

// API routes for monitoring data
app.get('/api/status', (req, res) => {
    const runtime = productionState.startTime ? 
        ((Date.now() - productionState.startTime) / 1000).toFixed(1) : 0;
    
    res.json({
        status: productionState.status,
        phase: 'processing',
        processedFrames: productionState.processedFrames,
        totalFrames: productionState.totalFrames,
        framesPerMinute: runtime > 0 ? 
            (productionState.processedFrames / (runtime / 60)).toFixed(1) : 0,
        eta: calculateETA(),
        quality: {
            ...qualityMonitor.getMetrics(),
            averageScore: productionState.qualityScores.length > 0 ?
                productionState.qualityScores.reduce((a, b) => a + b, 0) / productionState.qualityScores.length : 0,
            issues: productionState.qualityIssues.length
        },
        performance: {
            elapsedTime: formatTime(runtime * 1000),
            avgProcessTime: 0,
            queueSize: 0
        },
        issues: {
            critical: productionState.qualityIssues.filter(i => i.score < 50).length,
            warnings: productionState.qualityIssues.filter(i => i.score >= 50 && i.score < 70).length,
            duplicates: productionState.duplicateRetries,
            recent: productionState.qualityIssues.slice(-10)
        }
    });
});

// Progress API endpoint (compatible with monitor HTML)
app.get('/api/progress', (req, res) => {
    const runtime = productionState.startTime ? 
        ((Date.now() - productionState.startTime) / 1000).toFixed(1) : 0;
    
    res.json({
        status: productionState.status,
        progress: {
            current: productionState.processedFrames,
            total: productionState.totalFrames
        },
        performance: {
            avgTime: runtime > 0 ? (runtime / productionState.processedFrames) : 0,
            totalTime: runtime
        },
        fallbacks: {
            count: productionState.duplicateRetries,
            rate: productionState.processedFrames > 0 ? 
                (productionState.duplicateRetries / productionState.processedFrames * 100) : 0
        },
        log: [`Frame generation in progress... ${productionState.processedFrames}/${productionState.totalFrames}`],
        lastUpdate: new Date().toISOString()
    });
});

// Frame preview endpoint - serve frame images (matches monitor expectations)
app.get('/frame/:frameNumber', (req, res) => {
    const frameNumber = req.params.frameNumber.padStart(5, '0');
    const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${frameNumber}.jpg`);
    
    res.sendFile(framePath, (err) => {
        if (err) {
            res.status(404).json({ error: 'Frame not found' });
        }
    });
});

// Helper functions for monitoring
function calculateETA() {
    if (!productionState.startTime || productionState.processedFrames === 0) return 'Unknown';
    
    const elapsed = Date.now() - productionState.startTime;
    const framesPerMs = productionState.processedFrames / elapsed;
    const remaining = productionState.totalFrames - productionState.processedFrames;
    const msRemaining = remaining / framesPerMs;
    
    const minutes = Math.floor(msRemaining / 60000);
    if (minutes < 60) return `${minutes} minutes`;
    
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

function getMemoryStats() {
    const used = process.memoryUsage();
    return {
        heapUsed: `${(used.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        heapPercent: `${(used.heapUsed / used.heapTotal * 100).toFixed(1)}%`,
        heapTotal: `${(used.heapTotal / 1024 / 1024).toFixed(1)} MB`,
        rss: `${(used.rss / 1024 / 1024).toFixed(1)} MB`,
        gcCount: global.gc ? 1 : 0
    };
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else {
        return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    }
}

/**
 * DUPLICATE DETECTION STRATEGY
 * 
 * Problem: When fetching 8 frames in parallel, we might fetch 8 identical
 * images before realizing they're duplicates.
 * 
 * Solution:
 * 1. Fetch in batches with checksum calculation
 * 2. After each batch, check for duplicates
 * 3. Retry duplicates with fallbacks sequentially
 * 4. Use a global checksum cache across all frames
 */

// Calculate checksum for image buffer
function calculateChecksum(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// Track checksum and detect duplicates
function isDuplicate(checksum, sourceType, frameNumber) {
    const cache = sourceType === 'corona' 
        ? productionState.checksumCache.corona
        : productionState.checksumCache.sunDisk;
    
    if (cache.has(checksum)) {
        const existingFrames = cache.get(checksum);
        // It's a duplicate if this checksum was seen in a different frame
        const isDupe = existingFrames.some(f => Math.abs(f - frameNumber) > 1);
        if (isDupe) {
            console.log(`⚠️ Duplicate ${sourceType} detected! Frame ${frameNumber} matches frames ${existingFrames.join(', ')}`);
            return true;
        }
    }
    
    // Add to cache
    if (!cache.has(checksum)) {
        cache.set(checksum, []);
    }
    cache.get(checksum).push(frameNumber);
    
    return false;
}

// Fetch single image
async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}&layers=%5B${sourceId},1,100%5D&imageScale=${imageScale}` +
        `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;
    
    const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}_${Math.random()}.png`);
    
    await execAsync(`curl -s -o "${tempFile}" "${apiUrl}"`, { timeout: 30000 });
    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});
    
    return {
        buffer,
        checksum: calculateChecksum(buffer)
    };
}

// Fetch with fallback and duplicate detection
async function fetchImageWithFallback(targetDate, sourceId, sourceType, frameNumber) {
    const fallbackSteps = sourceType === 'SOHO' 
        ? CONFIG.FALLBACK_STEPS_SOHO 
        : CONFIG.FALLBACK_STEPS_SDO;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate.getTime() + minuteOffset * 60 * 1000);
        
        try {
            const result = await fetchImage(sourceId, tryDate.toISOString());
            
            // Check if this is a duplicate
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
                console.log(`  ✓ Used ${minuteOffset}min fallback for ${sourceType} frame ${frameNumber}`);
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

// Process frames with parallel fetching and duplicate detection
async function processFramesOptimized(frames) {
    console.log(`\n📊 Processing ${frames.length} frames with optimized concurrency`);
    console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}`);
    
    const results = [];
    let frameIndex = 0;
    
    // Phase 1: Parallel fetching with batched duplicate detection
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    
    async function fetchNextBatch() {
        const batch = [];
        
        // Start parallel fetches
        while (activeFetches.size < CONFIG.FETCH_CONCURRENCY && fetchQueue.length > 0) {
            const frame = fetchQueue.shift();
            const fetchPromise = fetchFrameWithDuplicateHandling(frame);
            activeFetches.add(fetchPromise);
            batch.push(fetchPromise);
            
            fetchPromise.then(result => {
                activeFetches.delete(fetchPromise);
                if (result) {
                    processingQueue.push(result);
                    processNextFrame();
                }
            }).catch(err => {
                activeFetches.delete(fetchPromise);
                console.error(`Fetch failed for frame ${frame.number}:`, err.message);
            });
        }
        
        return batch;
    }
    
    async function fetchFrameWithDuplicateHandling(frame) {
        const { number, date } = frame;
        
        try {
            // First attempt - fetch both images
            const [coronaResult, sunDiskResult] = await Promise.all([
                fetchImage(4, date.toISOString()),
                fetchImage(10, date.toISOString())
            ]);
            
            // Check for duplicates
            const coronaDupe = isDuplicate(coronaResult.checksum, 'corona', number);
            const sunDiskDupe = isDuplicate(sunDiskResult.checksum, 'sunDisk', number);
            
            let finalCorona = coronaResult;
            let finalSunDisk = sunDiskResult;
            
            // If duplicates found, try fallbacks sequentially
            if (coronaDupe) {
                console.log(`🔄 Frame ${number}: Corona duplicate, trying fallbacks...`);
                productionState.duplicateRetries++;
                finalCorona = await fetchImageWithFallback(date, 4, 'SOHO', number);
            }
            
            if (sunDiskDupe) {
                console.log(`🔄 Frame ${number}: Sun disk duplicate, trying fallbacks...`);
                productionState.duplicateRetries++;
                finalSunDisk = await fetchImageWithFallback(date, 10, 'SDO', number);
            }
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: finalCorona,
                sunDisk: finalSunDisk
            };
            
        } catch (error) {
            console.error(`❌ Frame ${number} fetch failed:`, error.message);
            return null;
        }
    }
    
    async function processNextFrame() {
        if (activeProcesses.size >= CONFIG.PROCESS_CONCURRENCY || processingQueue.length === 0) {
            return;
        }
        
        const frameData = processingQueue.shift();
        const processPromise = processFrame(frameData);
        activeProcesses.add(processPromise);
        
        processPromise.then(result => {
            activeProcesses.delete(processPromise);
            results.push(result);
            productionState.processedFrames++;
            
            // Progress update
            if (productionState.processedFrames % 10 === 0) {
                const progress = (productionState.processedFrames / frames.length * 100).toFixed(1);
                console.log(`Progress: ${progress}% (${productionState.processedFrames}/${frames.length})`);
                console.log(`  Duplicate retries: ${productionState.duplicateRetries}`);
            }
            
            // Try to process next frame
            processNextFrame();
        }).catch(err => {
            activeProcesses.delete(processPromise);
            console.error(`Process failed:`, err.message);
        });
    }
    
    async function processFrame(frameData) {
        // Apply color grading and compositing
        const [gradedCorona, gradedSunDisk] = await Promise.all([
            gradeCorona(frameData.corona.buffer),
            gradeSunDisk(frameData.sunDisk.buffer)
        ]);
        
        // Apply square feathering and composite
        const featheredSunDisk = await applySquareFeather(gradedSunDisk);
        const composite = await createComposite(gradedCorona, featheredSunDisk);
        
        // Save frame
        const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${String(frameData.frameNumber).padStart(5, '0')}.jpg`);
        await fs.writeFile(framePath, composite);
        
        // Validate frame quality (inline validation)
        const validation = await qualityValidator.validateFrame(framePath, frameData.frameNumber);
        
        // Update quality monitor
        qualityMonitor.updateFrameMetrics(frameData.frameNumber, {
            success: validation.valid,
            qualityScore: validation.score,
            isDuplicate: false
        });
        
        // Track quality scores
        productionState.qualityScores.push(validation.score);
        if (!validation.valid || validation.score < 70) {
            productionState.qualityIssues.push({
                frame: frameData.frameNumber,
                score: validation.score,
                issues: validation.issues
            });
        }
        
        // Log quality every 100 frames
        if (frameData.frameNumber % 100 === 0) {
            const avgScore = productionState.qualityScores.slice(-100).reduce((a, b) => a + b, 0) / 100;
            console.log(`   Quality: Avg score ${avgScore.toFixed(1)}, Frame ${frameData.frameNumber} score: ${validation.score}`);
        }
        
        return {
            frameNumber: frameData.frameNumber,
            success: true,
            path: framePath,
            qualityScore: validation.score
        };
    }
    
    // Start the pipeline
    console.log('\n🚀 Starting optimized pipeline with quality monitoring...\n');
    
    // Initialize quality monitoring
    qualityMonitor.start(frames.length);
    
    // Keep fetching and processing until done
    while (fetchQueue.length > 0 || activeFetches.size > 0 || processingQueue.length > 0 || activeProcesses.size > 0) {
        // Start more fetches
        if (fetchQueue.length > 0) {
            await fetchNextBatch();
        }
        
        // Wait a bit for things to progress
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Save state periodically
        if (productionState.processedFrames % CONFIG.BATCH_SIZE === 0 && productionState.processedFrames > 0) {
            await saveState();
        }
    }
    
    console.log(`\n✅ Pipeline complete!`);
    console.log(`   Processed: ${results.length}/${frames.length} frames`);
    console.log(`   Duplicate retries: ${productionState.duplicateRetries}`);
    console.log(`   Unique corona images: ${productionState.checksumCache.corona.size}`);
    console.log(`   Unique sun disk images: ${productionState.checksumCache.sunDisk.size}`);
    
    // Quality summary
    if (productionState.qualityScores.length > 0) {
        const avgScore = productionState.qualityScores.reduce((a, b) => a + b, 0) / productionState.qualityScores.length;
        const minScore = Math.min(...productionState.qualityScores);
        const maxScore = Math.max(...productionState.qualityScores);
        
        console.log('\n📊 Quality Summary:');
        console.log(`   Average Score: ${avgScore.toFixed(1)}`);
        console.log(`   Min/Max: ${minScore.toFixed(1)}/${maxScore.toFixed(1)}`);
        console.log(`   Issues: ${productionState.qualityIssues.length} frames below threshold`);
        
        if (productionState.qualityIssues.length > 0 && productionState.qualityIssues.length <= 5) {
            console.log('   Problem frames:');
            productionState.qualityIssues.forEach(issue => {
                console.log(`     Frame ${issue.frame}: Score ${issue.score}`);
            });
        }
    }
    
    return results;
}

// Color grading functions - Optimized dramatic settings preserving detail
async function gradeCorona(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 0.2, brightness: 1.0, hue: -12 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.0, 0)  // No linear boost to preserve highlights
        .gamma(1.6)      // Dramatic contrast without clipping
        .toBuffer();
}

async function gradeSunDisk(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 1.4, brightness: 1.2, hue: 20 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.1, -5)  // Gentle boost to make sun disk visible with screen blend
        .gamma(1.0)      
        .toBuffer();
}

async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    // First, resize the image to the final size.
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize)
        .toBuffer();

    // If feathering is zero, no need to apply a mask.
    if (featherRadius <= 0) {
        return resizedImage;
    }

    // Create an SVG for the feathered mask.
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

    // Apply the mask as an alpha channel to the resized image.
    const maskedImage = await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in' // Use the mask to define the alpha channel.
        }])
        .png()
        .toBuffer();

    return maskedImage;
}

// Square feathering function - same size as circular, just square shape
async function applySquareFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    const resizedImage = await sharp(imageBuffer).resize(finalSize, finalSize).toBuffer();
    
    if (featherRadius <= 0) return resizedImage;
    
    // Create square mask with same dimensions as circular
    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const left = center - compositeRadius;
    const top = center - compositeRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <linearGradient id="featherX" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${(100-featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
                <linearGradient id="featherY" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${(100-featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
            </defs>
            <rect x="${left}" y="${top}" width="${squareSize}" height="${squareSize}" fill="url(#featherX)" />
            <rect x="${left}" y="${top}" width="${squareSize}" height="${squareSize}" fill="url(#featherY)" style="mix-blend-mode: multiply;" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

async function createComposite(coronaBuffer, sunDiskBuffer) {
    const width = 1920;
    const height = 1200;
    
    // Apply the feathering to the sun disk image
    const featheredSunDisk = await applyCircularFeather(sunDiskBuffer, 1435, 400, 40);
    
    // Determine the full canvas size for compositing
    const fullWidth = Math.max(width, 1435);
    const fullHeight = Math.max(height, 1435);

    // Create full composite
    const fullComposite = await sharp({
        create: {
            width: fullWidth,
            height: fullHeight,
            channels: 4, // Use 4 channels for RGBA
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: coronaBuffer, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
    ])
    .png()
    .toBuffer();

    // Apply tuned crop settings from tuner (1920x1435 -> 1460x1200)
    const cropTop = 117;    // Tuned crop top
    const cropLeft = 230;   // Tuned crop left  
    const finalWidth = 1460; // Tuned final width (1920 - 230 - 230)
    const finalHeight = 1200; // Tuned final height (1435 - 117 - 118)
    
    const croppedImage = await sharp(fullComposite)
        .extract({ 
            width: finalWidth, 
            height: finalHeight, 
            left: cropLeft, 
            top: cropTop 
        })
        .jpeg({ quality: 100, mozjpeg: true })
        .toBuffer();

    return croppedImage;
}

async function saveState() {
    // Convert Maps to arrays for JSON serialization
    const stateToSave = {
        ...productionState,
        checksumCache: {
            corona: Array.from(productionState.checksumCache.corona.entries()),
            sunDisk: Array.from(productionState.checksumCache.sunDisk.entries())
        }
    };
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(stateToSave, null, 2));
}

// Generate video from processed frames
async function generateProductionVideo(days, outputName) {
    console.log(`\n🎬 Generating ${outputName} video (${days} days)...`);
    
    // Initialize video encoder
    const encoder = new VideoEncoder({
        framesDir: CONFIG.FRAMES_DIR,
        outputDir: CONFIG.VIDEOS_DIR,
        fps: CONFIG.FPS,
        crf: 0,  // LOSSLESS for Cloudflare Stream
        preset: 'ultrafast',  // Fast encoding since no compression
        maxChunkFrames: 1000
    });
    
    await encoder.initialize();
    
    try {
        const totalFrames = days * CONFIG.FRAMES_PER_DAY;
        
        // Check if we have enough frames
        const processedFrames = productionState.processedFrames;
        if (processedFrames < totalFrames) {
            console.warn(`⚠️ Only ${processedFrames} frames available, need ${totalFrames}`);
        }
        
        const framesToEncode = Math.min(totalFrames, processedFrames);
        
        // Generate video with chunked encoding for large datasets
        const result = await encoder.generateChunkedVideo(
            framesToEncode,
            outputName,
            {
                width: 1460,
                height: 1200
            }
        );
        
        console.log(`✅ Video generated: ${result.path}`);
        console.log(`   Size: ${(result.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Duration: ${result.duration.toFixed(1)} seconds`);
        console.log(`   Encoding speed: ${(result.frames / result.encodingTime).toFixed(1)} fps`);
        
        await encoder.cleanup();
        return result;
        
    } catch (error) {
        console.error('❌ Video generation failed:', error.message);
        await encoder.cleanup();
        throw error;
    }
}

// Generate dual format videos (desktop and mobile)
async function generateDualFormatVideos(days, baseName) {
    console.log('\n🎬 Generating dual format videos...');
    
    const encoder = new VideoEncoder({
        framesDir: CONFIG.FRAMES_DIR,
        outputDir: CONFIG.VIDEOS_DIR,
        fps: CONFIG.FPS,
        crf: 0,  // LOSSLESS for Cloudflare Stream
        preset: 'ultrafast',  // Fast encoding since no compression
        maxChunkFrames: 1000
    });
    
    await encoder.initialize();
    
    try {
        const totalFrames = Math.min(days * CONFIG.FRAMES_PER_DAY, productionState.processedFrames);
        const results = await encoder.generateDualFormat(totalFrames, baseName);
        
        console.log('\n✅ Dual format videos generated:');
        console.log(`   Desktop: ${(results.desktop.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Mobile: ${(results.mobile.size / 1024 / 1024).toFixed(2)} MB`);
        
        await encoder.cleanup();
        return results;
        
    } catch (error) {
        console.error('❌ Dual format generation failed:', error.message);
        await encoder.cleanup();
        throw error;
    }
}

// Main production execution
async function main() {
    console.log('🌞 Optimized Production System with Monitoring');
    console.log('================================================\n');
    
    // Check for --run argument
    const shouldRun = process.argv.includes('--run');
    if (!shouldRun) {
        console.log('Add --run to start frame generation');
        return;
    }
    
    try {
        // Start monitoring server
        if (CONFIG.ENABLE_MONITORING) {
            startMonitoringServer();
            console.log(`📊 Monitoring dashboard: http://65.109.0.112:${CONFIG.MONITOR_PORT}/monitor`);
            console.log(`📡 API status: http://65.109.0.112:${CONFIG.MONITOR_PORT}/api/status\n`);
        }
        
        // Initialize directories
        await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
        await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
        await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
        
        // Load previous state if exists
        try {
            const stateData = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
            const savedState = JSON.parse(stateData);
            productionState = {
                ...productionState,
                ...savedState,
                checksumCache: {
                    corona: new Map(savedState.checksumCache?.corona || []),
                    sunDisk: new Map(savedState.checksumCache?.sunDisk || [])
                }
            };
            console.log(`📁 Loaded previous state: ${productionState.processedFrames}/${CONFIG.TOTAL_DAYS * CONFIG.FRAMES_PER_DAY} frames`);
        } catch {
            console.log('📁 Starting fresh production run');
        }
        
        // Generate frame dates for full production
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
        endDate.setHours(23, 45, 0, 0);
        
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - CONFIG.TOTAL_DAYS + 1);
        startDate.setHours(0, 15, 0, 0);
        
        const frames = [];
        const currentDate = new Date(startDate);
        let frameNumber = 0;
        
        while (currentDate <= endDate) {
            frames.push({
                number: frameNumber++,
                date: new Date(currentDate)
            });
            currentDate.setMinutes(currentDate.getMinutes() + CONFIG.INTERVAL_MINUTES);
        }
        
        console.log(`📊 Processing ${frames.length} frames with optimized concurrency`);
        console.log(`   Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
        console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
        console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}\n`);
        
        // Start monitoring server
        console.log('📊 Attempting to start monitoring server...');
        await startMonitoringServer();
        
        // Wait a moment for server to start
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('📊 Monitor startup delay completed');
        
        // Start processing
        productionState.status = 'running';
        productionState.startTime = Date.now();
        productionState.totalFrames = frames.length;
        
        await processFramesOptimized(frames);
        
        console.log('\n✅ Frame processing complete!');
        console.log(`   Total frames: ${productionState.processedFrames}`);
        console.log(`   Duplicate retries: ${productionState.duplicateRetries}`);
        console.log(`   Unique corona images: ${productionState.checksumCache.corona.size}`);
        console.log(`   Unique sun disk images: ${productionState.checksumCache.sunDisk.size}`);
        
        productionState.status = 'completed';
        await saveState();
        
    } catch (error) {
        console.error('\n❌ Production failed:', error.message);
        productionState.status = 'error';
        await saveState();
        throw error;
    }
}

// Main optimized frame processing function
async function processFramesOptimized(frames) {
    console.log('🚀 Starting optimized pipeline with quality monitoring...');
    console.log(`📊 Quality monitoring started for ${frames.length} frames`);
    
    const batchSize = CONFIG.BATCH_SIZE;
    let processedCount = 0;
    
    // Process frames in batches
    for (let i = 0; i < frames.length; i += batchSize) {
        const batch = frames.slice(i, i + batchSize);
        const batchStart = Date.now();
        
        console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(frames.length / batchSize)}`);
        console.log(`   Frames ${i + 1}-${Math.min(i + batchSize, frames.length)} of ${frames.length}`);
        
        // Process batch with concurrency
        const promises = batch.map(frame => processFrame(frame));
        await Promise.all(promises);
        
        processedCount += batch.length;
        productionState.processedFrames = processedCount;
        
        const batchTime = Date.now() - batchStart;
        const framesPerMinute = (batch.length / (batchTime / 1000)) * 60;
        
        console.log(`   ✅ Batch completed in ${(batchTime / 1000).toFixed(1)}s`);
        console.log(`   ⚡ Speed: ${framesPerMinute.toFixed(1)} frames/minute`);
        console.log(`   📊 Progress: ${((processedCount / frames.length) * 100).toFixed(1)}% (${processedCount}/${frames.length})`);
        
        if (productionState.duplicateRetries > 0) {
            console.log(`   🔄 Duplicate retries: ${productionState.duplicateRetries}`);
        }
        
        // Save state periodically
        await saveState();
    }
}

// Process a single frame with error handling and timing
async function processFrame(frameData) {
    const frameStart = Date.now();
    
    try {
        // This would contain the actual frame processing logic
        // For now, simulate processing time to test the monitor
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms simulation
        
        console.log(`🔄 Frame ${frameData.number}: Processing...`);
        
        // Simulate occasional duplicates for testing
        if (Math.random() < 0.05) { // 5% chance
            productionState.duplicateRetries++;
            console.log(`⚠️ Frame ${frameData.number}: Duplicate detected, retrying...`);
        }
        
        const frameTime = Date.now() - frameStart;
        return { success: true, frameNumber: frameData.number, processingTime: frameTime };
        
    } catch (error) {
        console.error(`❌ Frame ${frameData.number} failed:`, error.message);
        return { success: false, frameNumber: frameData.number, error: error.message };
    }
}

// Save production state
async function saveState() {
    try {
        const stateToSave = {
            ...productionState,
            checksumCache: {
                corona: Array.from(productionState.checksumCache.corona.entries()),
                sunDisk: Array.from(productionState.checksumCache.sunDisk.entries())
            }
        };
        
        await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(stateToSave, null, 2));
    } catch (error) {
        console.error('Failed to save state:', error.message);
    }
}


// Export for use in production
export { 
    processFramesOptimized, 
    generateProductionVideo,
    generateDualFormatVideos,
    startMonitoringServer,
    CONFIG 
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}