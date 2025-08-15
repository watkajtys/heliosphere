#!/usr/bin/env node

/**
 * Optimized 2-Day Test with Parallel Processing
 * Tests duplicate detection and performance improvements
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import express from 'express';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // Concurrency settings - OPTIMIZED
    FETCH_CONCURRENCY: 8,     // Parallel image fetches
    PROCESS_CONCURRENCY: 4,   // Parallel frame processing
    BATCH_SIZE: 50,           // Save state every N frames
    
    // Test parameters
    TEST_DAYS: 2,
    FRAMES_PER_DAY: 96,
    
    // Time windows
    SAFE_DELAY_DAYS: 2,
    INTERVAL_MINUTES: 15,
    FPS: 24,
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14,
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    // Storage
    FRAMES_DIR: '/opt/heliosphere/test_optimized_frames',
    VIDEOS_DIR: '/opt/heliosphere/test_optimized_videos',
    STATE_FILE: '/opt/heliosphere/optimized_test_state.json',
    TEMP_DIR: '/tmp/heliosphere_optimized',
    
    // Server
    PORT: 3003
};

// Global state with duplicate tracking
let testState = {
    status: 'idle',
    startTime: null,
    endTime: null,
    totalFrames: 0,
    processedFrames: 0,
    fetchedFrames: 0,
    duplicateRetries: 0,
    fallbacksUsed: 0,
    errors: [],
    checksumCache: {
        corona: new Map(),
        sunDisk: new Map()
    },
    videos: {
        full: null,
        social: null
    },
    performance: {
        fetchTimes: [],
        processTimes: [],
        avgFetchTime: 0,
        avgProcessTime: 0,
        parallelSpeedup: 0
    }
};

// Express server for monitoring
const app = express();

app.get('/status', (req, res) => {
    const runtime = testState.startTime ? 
        ((Date.now() - testState.startTime) / 1000).toFixed(1) : 0;
    
    res.json({
        ...testState,
        runtime,
        progress: testState.totalFrames > 0 ? 
            (testState.processedFrames / testState.totalFrames * 100).toFixed(1) : 0,
        checksums: {
            corona: testState.checksumCache.corona.size,
            sunDisk: testState.checksumCache.sunDisk.size
        },
        performance: {
            ...testState.performance,
            framesPerMinute: runtime > 0 ? 
                (testState.processedFrames / (runtime / 60)).toFixed(1) : 0
        }
    });
});

app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'monitor_optimized.html'));
});

// Serve frame images for spot checking
app.get('/frame/:frameNumber', (req, res) => {
    const frameNumber = req.params.frameNumber;
    const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${frameNumber}.jpg`);
    
    fs.access(framePath)
        .then(() => {
            res.sendFile(framePath);
        })
        .catch(() => {
            res.status(404).send('Frame not found');
        });
});

// Check if ffmpeg is running
app.get('/ffmpeg-status', (req, res) => {
    exec('ps aux | grep ffmpeg | grep -v grep', (error, stdout) => {
        const running = !error && stdout.length > 0;
        res.json({
            running,
            progress: running ? 'Encoding in progress' : 'Not running'
        });
    });
});

// Calculate checksum
function calculateChecksum(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// Track checksum and detect duplicates
function isDuplicate(checksum, sourceType, frameNumber) {
    const cache = sourceType === 'corona' 
        ? testState.checksumCache.corona
        : testState.checksumCache.sunDisk;
    
    if (cache.has(checksum)) {
        const existingFrames = cache.get(checksum);
        const isDupe = existingFrames.some(f => Math.abs(f - frameNumber) > 1);
        if (isDupe) {
            console.log(`  ⚠️ Duplicate ${sourceType} detected! Frame ${frameNumber} matches ${existingFrames[0]}`);
            return true;
        }
    }
    
    if (!cache.has(checksum)) {
        cache.set(checksum, []);
    }
    cache.get(checksum).push(frameNumber);
    
    return false;
}

// Fetch single image
async function fetchImage(sourceId, date) {
    const startTime = Date.now();
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
    
    const fetchTime = Date.now() - startTime;
    testState.performance.fetchTimes.push(fetchTime);
    
    return {
        buffer,
        checksum: calculateChecksum(buffer),
        fetchTime
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
            
            if (isDuplicate(result.checksum, sourceType.toLowerCase(), frameNumber)) {
                if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                    console.log(`    Using duplicate (no alternatives)`);
                    testState.duplicateRetries++;
                    return { ...result, fallbackMinutes: minuteOffset, isDuplicate: true };
                }
                testState.duplicateRetries++;
                continue;
            }
            
            if (minuteOffset !== 0) {
                console.log(`    ✓ Fallback ${minuteOffset}min for ${sourceType}`);
                testState.fallbacksUsed++;
            }
            
            return { ...result, fallbackMinutes: minuteOffset, isDuplicate: false };
            
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed: ${error.message}`);
            }
        }
    }
}

// Process frames with parallel optimization
async function processFramesOptimized(frames) {
    console.log(`\n🚀 OPTIMIZED PROCESSING`);
    console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}`);
    console.log(`   Total frames: ${frames.length}\n`);
    
    const results = [];
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    
    async function fetchFrameWithDuplicateHandling(frame) {
        const { number, date } = frame;
        const startTime = Date.now();
        
        try {
            console.log(`Fetching frame ${number}...`);
            testState.fetchedFrames++;
            
            // Parallel fetch both images
            const [coronaResult, sunDiskResult] = await Promise.all([
                fetchImage(4, date.toISOString()),
                fetchImage(10, date.toISOString())
            ]);
            
            // Check for duplicates
            const coronaDupe = isDuplicate(coronaResult.checksum, 'corona', number);
            const sunDiskDupe = isDuplicate(sunDiskResult.checksum, 'sunDisk', number);
            
            let finalCorona = coronaResult;
            let finalSunDisk = sunDiskResult;
            
            // Handle duplicates with fallbacks
            if (coronaDupe) {
                console.log(`  🔄 Corona duplicate, trying fallbacks...`);
                finalCorona = await fetchImageWithFallback(date, 4, 'SOHO', number);
            }
            
            if (sunDiskDupe) {
                console.log(`  🔄 Sun disk duplicate, trying fallbacks...`);
                finalSunDisk = await fetchImageWithFallback(date, 10, 'SDO', number);
            }
            
            const totalFetchTime = Date.now() - startTime;
            console.log(`  ✓ Frame ${number} fetched in ${(totalFetchTime/1000).toFixed(1)}s`);
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: finalCorona,
                sunDisk: finalSunDisk,
                fetchTime: totalFetchTime
            };
            
        } catch (error) {
            console.error(`  ❌ Frame ${number} fetch failed:`, error.message);
            testState.errors.push({ frame: number, error: error.message });
            return null;
        }
    }
    
    async function processFrame(frameData) {
        const startTime = Date.now();
        
        try {
            // Apply color grading
            const [gradedCorona, gradedSunDisk] = await Promise.all([
                gradeCorona(frameData.corona.buffer),
                gradeSunDisk(frameData.sunDisk.buffer)
            ]);
            
            // Apply feathering and composite
            const featheredSunDisk = await applyCircularFeather(gradedSunDisk);
            const composite = await createComposite(gradedCorona, featheredSunDisk);
            
            // Save frame
            const framePath = path.join(
                CONFIG.FRAMES_DIR, 
                `frame_${String(frameData.frameNumber).padStart(5, '0')}.jpg`
            );
            await fs.writeFile(framePath, composite);
            
            const processTime = Date.now() - startTime;
            testState.performance.processTimes.push(processTime);
            
            return {
                frameNumber: frameData.frameNumber,
                success: true,
                processTime
            };
        } catch (error) {
            console.error(`  ❌ Process failed for frame ${frameData.frameNumber}:`, error.message);
            return null;
        }
    }
    
    // Main pipeline loop
    while (fetchQueue.length > 0 || activeFetches.size > 0 || 
           processingQueue.length > 0 || activeProcesses.size > 0) {
        
        // Start fetches
        while (activeFetches.size < CONFIG.FETCH_CONCURRENCY && fetchQueue.length > 0) {
            const frame = fetchQueue.shift();
            const fetchPromise = fetchFrameWithDuplicateHandling(frame);
            activeFetches.add(fetchPromise);
            
            fetchPromise.then(result => {
                activeFetches.delete(fetchPromise);
                if (result) {
                    processingQueue.push(result);
                }
            });
        }
        
        // Start processing
        while (activeProcesses.size < CONFIG.PROCESS_CONCURRENCY && processingQueue.length > 0) {
            const frameData = processingQueue.shift();
            const processPromise = processFrame(frameData);
            activeProcesses.add(processPromise);
            
            processPromise.then(result => {
                activeProcesses.delete(processPromise);
                if (result) {
                    results.push(result);
                    testState.processedFrames++;
                    
                    // Progress update
                    if (testState.processedFrames % 10 === 0) {
                        const progress = (testState.processedFrames / frames.length * 100).toFixed(1);
                        const runtime = ((Date.now() - testState.startTime) / 1000).toFixed(1);
                        const rate = (testState.processedFrames / (runtime / 60)).toFixed(1);
                        console.log(`\nProgress: ${progress}% | Rate: ${rate} frames/min`);
                        console.log(`Duplicates handled: ${testState.duplicateRetries}`);
                    }
                }
            });
        }
        
        // Small delay to prevent CPU spinning
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Calculate performance metrics
    const avgFetchTime = testState.performance.fetchTimes.reduce((a,b) => a+b, 0) / 
                        testState.performance.fetchTimes.length;
    const avgProcessTime = testState.performance.processTimes.reduce((a,b) => a+b, 0) / 
                          testState.performance.processTimes.length;
    
    testState.performance.avgFetchTime = avgFetchTime;
    testState.performance.avgProcessTime = avgProcessTime;
    
    // Calculate speedup vs sequential
    const sequentialTime = frames.length * (avgFetchTime + avgProcessTime);
    const actualTime = (Date.now() - testState.startTime);
    testState.performance.parallelSpeedup = (sequentialTime / actualTime).toFixed(2);
    
    console.log(`\n✅ Optimization Results:`);
    console.log(`   Parallel speedup: ${testState.performance.parallelSpeedup}x`);
    console.log(`   Avg fetch time: ${(avgFetchTime/1000).toFixed(1)}s`);
    console.log(`   Avg process time: ${(avgProcessTime/1000).toFixed(1)}s`);
    
    return results;
}

// Color grading functions
async function gradeCorona(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

async function gradeSunDisk(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

async function applyCircularFeather(buffer) {
    const finalSize = 1435;
    const compositeRadius = 400;
    const featherRadius = 40;
    
    // First resize the sun disk to the proper size
    const resizedImage = await sharp(buffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();
    
    if (featherRadius <= 0) return resizedImage;
    
    // Calculate feathering ratios
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

async function createComposite(coronaBuffer, sunDiskBuffer) {
    // Create full-size composite canvas first
    const compositeImage = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: coronaBuffer, gravity: 'center' },
        { input: sunDiskBuffer, gravity: 'center', blend: 'screen' }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
    
    // Extract final frame at highest quality
    const finalImage = await sharp(compositeImage)
        .extract({
            left: 230,
            top: 117,
            width: 1460,
            height: 1200
        })
        .jpeg({ quality: 95, mozjpeg: true }) // Higher quality, use mozjpeg for better compression
        .toBuffer();
    
    return finalImage;
}

async function generateVideo(days, name) {
    const framesPerDay = CONFIG.FRAMES_PER_DAY;
    const totalFrames = days * framesPerDay;
    const lastFrame = Math.min(totalFrames, testState.processedFrames) - 1;
    
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${name}.mp4`);
    
    console.log(`\n🎬 Generating ${name} video (${days} days)...`);
    
    const ffmpegCmd = `ffmpeg -y -framerate ${CONFIG.FPS} ` +
        `-start_number 0 -i "${CONFIG.FRAMES_DIR}/frame_%05d.jpg" ` +
        `-frames:v ${lastFrame + 1} ` +
        `-c:v libx264 -preset veryslow -crf 15 ` +  // Higher quality: crf 15 instead of 18
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-vf "scale=1460:1200:flags=lanczos" ` +  // Ensure proper scaling with lanczos
        `"${outputPath}"`;
    
    await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
    
    const stats = await fs.stat(outputPath);
    console.log(`  ✓ Generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    return {
        path: outputPath,
        size: stats.size,
        frames: lastFrame + 1,
        duration: (lastFrame + 1) / CONFIG.FPS
    };
}

// Main test function
async function runOptimizedTest() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   OPTIMIZED 2-Day Test                 ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    // Setup directories
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    
    // Generate frames list
    const frames = [];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    endDate.setHours(0, 0, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.TEST_DAYS);
    
    const totalFrames = CONFIG.TEST_DAYS * CONFIG.FRAMES_PER_DAY;
    
    for (let i = 0; i < totalFrames; i++) {
        const frameDate = new Date(startDate);
        frameDate.setMinutes(frameDate.getMinutes() + i * CONFIG.INTERVAL_MINUTES);
        frames.push({
            number: i,
            date: frameDate
        });
    }
    
    console.log(`📅 Date Range: ${frames[0].date.toISOString().split('T')[0]} to ${frames[frames.length-1].date.toISOString().split('T')[0]}`);
    console.log(`📊 Total frames: ${totalFrames}`);
    
    // Initialize state
    testState.status = 'running';
    testState.startTime = Date.now();
    testState.totalFrames = totalFrames;
    
    // Process frames with optimization
    const results = await processFramesOptimized(frames);
    
    // Generate videos
    try {
        testState.videos.full = await generateVideo(CONFIG.TEST_DAYS, 'optimized_test');
    } catch (error) {
        console.error('Video generation failed:', error.message);
    }
    
    // Final results
    testState.status = 'completed';
    testState.endTime = Date.now();
    
    const totalTime = ((testState.endTime - testState.startTime) / 1000).toFixed(1);
    const framesPerMin = (testState.processedFrames / (totalTime / 60)).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('📊 OPTIMIZED TEST RESULTS');
    console.log('═'.repeat(50));
    console.log(`Total Time: ${totalTime} seconds`);
    console.log(`Frames Processed: ${testState.processedFrames}/${testState.totalFrames}`);
    console.log(`Processing Rate: ${framesPerMin} frames/minute`);
    console.log(`Parallel Speedup: ${testState.performance.parallelSpeedup}x`);
    console.log(`Duplicate Retries: ${testState.duplicateRetries}`);
    console.log(`Fallbacks Used: ${testState.fallbacksUsed}`);
    console.log(`Errors: ${testState.errors.length}`);
    console.log(`\nUnique Images:`);
    console.log(`  Corona: ${testState.checksumCache.corona.size}`);
    console.log(`  Sun Disk: ${testState.checksumCache.sunDisk.size}`);
    
    if (testState.errors.length === 0 && testState.videos.full) {
        console.log('\n✅ OPTIMIZED TEST PASSED!');
        console.log(`   Performance improvement confirmed: ${framesPerMin} fps`);
    }
}

// Start server and run test
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`📡 Optimized monitor: http://65.109.0.112:${CONFIG.PORT}/monitor`);
    console.log(`📊 Status API: http://65.109.0.112:${CONFIG.PORT}/status`);
    
    runOptimizedTest().catch(error => {
        console.error('❌ Test failed:', error);
        testState.status = 'error';
        testState.errors.push({ type: 'fatal', message: error.message });
    });
});