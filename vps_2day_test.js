#!/usr/bin/env node

/**
 * Heliosphere 2-Day Test
 * Complete test of daily production system with:
 * - 2 days of frames (192 frames)
 * - Video generation
 * - Monitoring integration
 * - Full pipeline validation
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

// TEST CONFIGURATION - 2 DAYS
const CONFIG = {
    PORT: 3002, // Different port for test
    
    // Time windows - TEST VALUES
    SAFE_DELAY_DAYS: 2,      // 48-hour delay for data
    TOTAL_DAYS: 2,           // ← TEST: Just 2 days (192 frames)
    SOCIAL_DAYS: 1,          // ← TEST: 1 day for social video
    
    // Frame settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    FPS: 24,
    
    // Frame dimensions
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    
    // Processing
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 50,
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14,
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    // Cloudflare proxy
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Storage paths - TEST DIRECTORIES
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/test_frames',
    VIDEOS_DIR: '/opt/heliosphere/test_videos',
    STATE_FILE: '/opt/heliosphere/test_state.json',
    MANIFEST_FILE: '/opt/heliosphere/test_manifest.json',
    TEMP_DIR: '/tmp/heliosphere_test'
};

// Global state
let testState = {
    status: 'idle',
    startTime: null,
    lastUpdate: null,
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
    },
    videos: {
        full: null,
        social: null
    }
};

// Initialize Express for monitoring
const app = express();
app.use(express.json());

// Serve monitoring dashboard
app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'cloud_monitor.html'));
});

// Status endpoint for monitoring
app.get('/status', (req, res) => {
    const runtime = testState.startTime 
        ? ((Date.now() - testState.startTime) / 1000).toFixed(1)
        : 0;
    
    const progress = testState.totalFrames > 0
        ? ((testState.processedFrames / testState.totalFrames) * 100).toFixed(1)
        : '0.0';
    
    res.json({
        ...testState,
        runtime,
        progress,
        checksums: {
            corona: testState.checksums.corona.size,
            sunDisk: testState.checksums.sunDisk.size
        }
    });
});

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    console.log('✓ Directories created');
}

// Calculate date range with 48-hour delay
function calculateDateRange() {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    endDate.setHours(23, 45, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.TOTAL_DAYS + 1);
    startDate.setHours(0, 0, 0, 0);
    
    return { startDate, endDate };
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
                testState.checksums.corona : 
                testState.checksums.sunDisk;
            
            if (checksumSet.has(checksum) && minuteOffset !== 0) {
                continue; // Try next fallback
            }
            
            checksumSet.add(checksum);
            
            if (minuteOffset !== 0) {
                testState.fallbacksUsed++;
                console.log(`  ⟲ Used ${minuteOffset}min fallback for ${sourceType}`);
            }
            
            return {
                buffer: imageBuffer,
                checksum,
                fallbackMinutes: minuteOffset,
                fallbackUsed: minuteOffset !== 0
            };
            
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed: ${error.message}`);
            }
        }
    }
}

// Fetch single image
async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
        `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;
    
    const fetchUrl = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/?url=${encodeURIComponent(apiUrl)}`
        : apiUrl;
    
    const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}.png`);
    
    await execAsync(`curl -s -o "${tempFile}" "${fetchUrl}"`, { timeout: 30000 });
    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});
    return buffer;
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
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

// Apply circular feathering
async function applyCircularFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
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

// Process single frame
async function processFrame(coronaData, sunDiskData) {
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCorona(coronaData.buffer),
        gradeSunDisk(sunDiskData.buffer)
    ]);
    
    const featheredSunDisk = await applyCircularFeather(
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
        { input: gradedCorona, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
    
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

// Generate video from frames
async function generateVideo(days, outputName) {
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    
    const framesPattern = path.join(CONFIG.FRAMES_DIR, 'frame_%05d.jpg');
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}.mp4`);
    
    const ffmpegCommand = `ffmpeg -y -framerate ${CONFIG.FPS} -i "${framesPattern}" ` +
        `-c:v libx264 -pix_fmt yuv420p -preset slow -crf 18 "${outputPath}"`;
    
    await execAsync(ffmpegCommand, { timeout: 60000 });
    const stats = await fs.stat(outputPath);
    
    const frameCount = days * CONFIG.FRAMES_PER_DAY;
    const duration = frameCount / CONFIG.FPS;
    
    console.log(`  ✓ Video: ${outputPath}`);
    console.log(`  ✓ Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  ✓ Duration: ${duration.toFixed(1)} seconds`);
    
    return {
        path: outputPath,
        size: stats.size,
        duration: duration,
        frames: frameCount
    };
}

// Main test function
async function runTest() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   2-Day Production Test                ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    testState.status = 'running';
    testState.startTime = Date.now();
    
    await ensureDirectories();
    
    const { startDate, endDate } = calculateDateRange();
    testState.dateRange = {
        start: startDate.toISOString(),
        end: endDate.toISOString()
    };
    
    console.log('📅 Date Range:');
    console.log(`   From: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   To:   ${endDate.toISOString().split('T')[0]}`);
    console.log(`   Total: ${CONFIG.TOTAL_DAYS} days\n`);
    
    // Generate frame timestamps
    const frames = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
        frames.push(new Date(currentDate));
        currentDate.setMinutes(currentDate.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    testState.totalFrames = frames.length;
    console.log(`📊 Total frames: ${frames.length}\n`);
    
    // Process frames
    for (let i = 0; i < frames.length; i++) {
        const frameDate = frames[i];
        
        try {
            // Update progress
            if (i % 10 === 0) {
                const progress = ((i / frames.length) * 100).toFixed(1);
                console.log(`Progress: ${progress}% (${i}/${frames.length})`);
                testState.lastUpdate = Date.now();
            }
            
            // Fetch with fallback
            const [coronaData, sunDiskData] = await Promise.all([
                fetchImageWithFallback(frameDate, 4, 'SOHO'),
                fetchImageWithFallback(frameDate, 10, 'SDO')
            ]);
            
            // Process frame
            const processedFrame = await processFrame(coronaData, sunDiskData);
            
            // Save frame
            const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${String(i).padStart(5, '0')}.jpg`);
            await fs.writeFile(framePath, processedFrame);
            
            testState.processedFrames++;
            testState.fetchedFrames++;
            
        } catch (error) {
            console.error(`  ✗ Frame ${i} failed: ${error.message}`);
            testState.errors.push({
                frame: i,
                date: frameDate.toISOString(),
                error: error.message
            });
        }
    }
    
    console.log(`\n✓ Processed ${testState.processedFrames}/${testState.totalFrames} frames`);
    console.log(`  Fallbacks used: ${testState.fallbacksUsed}`);
    console.log(`  Errors: ${testState.errors.length}`);
    
    // Generate videos
    try {
        testState.videos.full = await generateVideo(CONFIG.TOTAL_DAYS, 'test_full');
        testState.videos.social = await generateVideo(CONFIG.SOCIAL_DAYS, 'test_social');
    } catch (error) {
        console.error('Video generation failed:', error.message);
    }
    
    testState.status = 'completed';
    testState.lastUpdate = Date.now();
    
    const totalTime = ((Date.now() - testState.startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(40));
    console.log('📊 TEST RESULTS');
    console.log('═'.repeat(40));
    console.log(`Total Time: ${totalTime} seconds`);
    console.log(`Frames: ${testState.processedFrames}/${testState.totalFrames}`);
    console.log(`Videos: ${testState.videos.full ? '✓' : '✗'} Full, ${testState.videos.social ? '✓' : '✗'} Social`);
    console.log(`Fallbacks: ${testState.fallbacksUsed}`);
    console.log(`Errors: ${testState.errors.length}`);
    
    if (testState.errors.length === 0 && testState.videos.full) {
        console.log('\n✅ TEST PASSED! Ready for production.');
    } else {
        console.log('\n⚠️  Test had issues. Review before production.');
    }
}

// Start server
app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`📡 Test monitor: http://65.109.0.112:${CONFIG.PORT}/monitor`);
    console.log(`📊 Status API: http://65.109.0.112:${CONFIG.PORT}/status\n`);
    
    // Start test
    runTest().catch(error => {
        console.error('❌ Test failed:', error);
        testState.status = 'error';
        testState.errors.push({ type: 'fatal', message: error.message });
    });
});