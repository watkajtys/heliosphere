#!/usr/bin/env node

/**
 * Dual Format Video Generation - Desktop and Mobile Portrait
 * Generates both 1460x1200 (desktop) and 1080x1350 (mobile) versions
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
    // Concurrency settings
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 50,
    
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
    
    // Storage - separate directories for each format
    DESKTOP_FRAMES_DIR: '/opt/heliosphere/frames_desktop',
    MOBILE_FRAMES_DIR: '/opt/heliosphere/frames_mobile',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/dual_format_state.json',
    TEMP_DIR: '/tmp/heliosphere_dual',
    
    // Server
    PORT: 3004
};

// Global state
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
        desktop: null,
        mobile: null
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
            (testState.processedFrames / testState.totalFrames * 100).toFixed(1) : 0
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
    
    return {
        buffer,
        checksum: calculateChecksum(buffer),
        fetchTime: Date.now() - startTime
    };
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
    
    const resizedImage = await sharp(buffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
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

// Create composite with format option
async function createComposite(coronaBuffer, sunDiskBuffer, format = 'desktop') {
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
    
    // Extract region based on format
    let extractRegion;
    if (format === 'mobile') {
        // Portrait crop for mobile (1080×1350)
        // Center the crop, slightly favor the top to keep more corona
        extractRegion = {
            left: 420,  // (1920-1080)/2
            top: 42,    // Slight top bias to keep upper corona
            width: 1080,
            height: 1350
        };
    } else {
        // Desktop landscape (1460×1200)
        extractRegion = {
            left: 230,
            top: 117,
            width: 1460,
            height: 1200
        };
    }
    
    const finalImage = await sharp(compositeImage)
        .extract(extractRegion)
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
    
    return finalImage;
}

// Process frames for both formats
async function processFramesWithDualFormat(frames) {
    console.log(`\n🚀 DUAL FORMAT PROCESSING`);
    console.log(`   Generating desktop (1460×1200) and mobile (1080×1350) versions`);
    console.log(`   Total frames: ${frames.length}\n`);
    
    const results = [];
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    
    async function fetchFrameData(frame) {
        const { number, date } = frame;
        console.log(`Fetching frame ${number}...`);
        testState.fetchedFrames++;
        
        try {
            // Parallel fetch both images
            const [coronaResult, sunDiskResult] = await Promise.all([
                fetchImage(4, date.toISOString()),
                fetchImage(10, date.toISOString())
            ]);
            
            // Check for duplicates
            const coronaDupe = isDuplicate(coronaResult.checksum, 'corona', number);
            const sunDiskDupe = isDuplicate(sunDiskResult.checksum, 'sunDisk', number);
            
            if (coronaDupe || sunDiskDupe) {
                console.log(`  ⚠️ Duplicate detected, skipping alternatives for demo`);
                testState.duplicateRetries++;
            }
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: coronaResult,
                sunDisk: sunDiskResult
            };
        } catch (error) {
            console.error(`  ❌ Frame ${number} fetch failed:`, error.message);
            testState.errors.push({ frame: number, error: error.message });
            return null;
        }
    }
    
    async function processFrame(frameData) {
        try {
            // Apply color grading
            const [gradedCorona, gradedSunDisk] = await Promise.all([
                gradeCorona(frameData.corona.buffer),
                gradeSunDisk(frameData.sunDisk.buffer)
            ]);
            
            // Apply feathering
            const featheredSunDisk = await applyCircularFeather(gradedSunDisk);
            
            // Create both format composites in parallel
            const [desktopComposite, mobileComposite] = await Promise.all([
                createComposite(gradedCorona, featheredSunDisk, 'desktop'),
                createComposite(gradedCorona, featheredSunDisk, 'mobile')
            ]);
            
            // Save both frames
            const frameNum = String(frameData.frameNumber).padStart(5, '0');
            await Promise.all([
                fs.writeFile(
                    path.join(CONFIG.DESKTOP_FRAMES_DIR, `frame_${frameNum}.jpg`),
                    desktopComposite
                ),
                fs.writeFile(
                    path.join(CONFIG.MOBILE_FRAMES_DIR, `frame_${frameNum}.jpg`),
                    mobileComposite
                )
            ]);
            
            return {
                frameNumber: frameData.frameNumber,
                success: true
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
            const fetchPromise = fetchFrameData(frame);
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
                    
                    if (testState.processedFrames % 10 === 0) {
                        const progress = (testState.processedFrames / frames.length * 100).toFixed(1);
                        console.log(`Progress: ${progress}% | Frames: ${testState.processedFrames}/${frames.length}`);
                    }
                }
            });
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return results;
}

async function generateVideo(format, days, name) {
    const framesDir = format === 'mobile' ? CONFIG.MOBILE_FRAMES_DIR : CONFIG.DESKTOP_FRAMES_DIR;
    const dimensions = format === 'mobile' ? '1080:1350' : '1460:1200';
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${name}_${format}.mp4`);
    
    console.log(`\n🎬 Generating ${format} video (${dimensions})...`);
    
    const ffmpegCmd = `ffmpeg -y -framerate ${CONFIG.FPS} ` +
        `-start_number 0 -i "${framesDir}/frame_%05d.jpg" ` +
        `-c:v libx264 -preset veryslow -crf 15 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-vf "scale=${dimensions}:flags=lanczos" ` +
        `"${outputPath}"`;
    
    await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
    
    const stats = await fs.stat(outputPath);
    console.log(`  ✓ Generated ${format}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    return {
        path: outputPath,
        size: stats.size,
        format,
        dimensions
    };
}

// Main test function
async function runDualFormatTest() {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   DUAL FORMAT TEST                     ║');
    console.log('║   Desktop + Mobile Portrait            ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    // Setup directories
    await fs.mkdir(CONFIG.DESKTOP_FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.MOBILE_FRAMES_DIR, { recursive: true });
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
    console.log(`📱 Formats: Desktop (1460×1200) + Mobile (1080×1350)`);
    
    // Initialize state
    testState.status = 'running';
    testState.startTime = Date.now();
    testState.totalFrames = totalFrames;
    
    // Process frames for both formats
    const results = await processFramesWithDualFormat(frames);
    
    // Generate both videos
    try {
        const [desktopVideo, mobileVideo] = await Promise.all([
            generateVideo('desktop', CONFIG.TEST_DAYS, 'heliosphere'),
            generateVideo('mobile', CONFIG.TEST_DAYS, 'heliosphere')
        ]);
        
        testState.videos.desktop = desktopVideo;
        testState.videos.mobile = mobileVideo;
    } catch (error) {
        console.error('Video generation failed:', error.message);
    }
    
    // Final results
    testState.status = 'completed';
    testState.endTime = Date.now();
    
    const totalTime = ((testState.endTime - testState.startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('📊 DUAL FORMAT TEST RESULTS');
    console.log('═'.repeat(50));
    console.log(`Total Time: ${totalTime} seconds`);
    console.log(`Frames Processed: ${testState.processedFrames}/${testState.totalFrames}`);
    console.log(`Desktop Video: ${testState.videos.desktop?.size ? (testState.videos.desktop.size / 1024 / 1024).toFixed(2) + ' MB' : 'Failed'}`);
    console.log(`Mobile Video: ${testState.videos.mobile?.size ? (testState.videos.mobile.size / 1024 / 1024).toFixed(2) + ' MB' : 'Failed'}`);
    console.log(`Errors: ${testState.errors.length}`);
    
    if (testState.errors.length === 0 && testState.videos.desktop && testState.videos.mobile) {
        console.log('\n✅ DUAL FORMAT TEST PASSED!');
        console.log('   Both desktop and mobile versions generated successfully');
    }
}

// Start server and run test
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`📡 Dual format monitor: http://65.109.0.112:${CONFIG.PORT}/status`);
    
    runDualFormatTest().catch(error => {
        console.error('❌ Test failed:', error);
        testState.status = 'error';
        testState.errors.push({ type: 'fatal', message: error.message });
    });
});