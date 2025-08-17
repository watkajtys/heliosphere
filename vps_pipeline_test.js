#!/usr/bin/env node

/**
 * VPS Pipeline Performance Test
 * Tests fetching, processing, and video generation for 10 frames
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
    // Test parameters
    TEST_FRAMES: 10,
    START_DATE: '2024-01-01T12:00:00Z',
    INTERVAL_MINUTES: 15,
    
    // Processing settings
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    FPS: 24,
    
    // Cloudflare proxy (optional)
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Local paths
    OUTPUT_DIR: './test_output',
    TEMP_DIR: './test_temp'
};

// Performance tracking
const metrics = {
    startTime: null,
    fetchTimes: [],
    processTimes: [],
    totalFetchTime: 0,
    totalProcessTime: 0,
    videoGenTime: 0,
    memoryUsage: [],
    errors: []
};

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(CONFIG.OUTPUT_DIR, 'frames'), { recursive: true });
}

// Log with timestamp
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

// Fetch image using takeScreenshot API
async function fetchImage(sourceId, date, name) {
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
    
    const outputPath = path.join(CONFIG.TEMP_DIR, `${name}.png`);
    
    const startTime = Date.now();
    try {
        await execAsync(`curl -s -o "${outputPath}" "${fetchUrl}"`, { timeout: 30000 });
        const duration = Date.now() - startTime;
        metrics.fetchTimes.push({ name, duration });
        log(`Fetched ${name} in ${duration}ms`);
        return outputPath;
    } catch (error) {
        log(`Failed to fetch ${name}: ${error.message}`, 'ERROR');
        metrics.errors.push({ stage: 'fetch', name, error: error.message });
        throw error;
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

// Process a single frame
async function processFrame(coronaPath, sunDiskPath, frameIndex) {
    const startTime = Date.now();
    
    try {
        // Load images
        const coronaBuffer = await fs.readFile(coronaPath);
        const sunDiskBuffer = await fs.readFile(sunDiskPath);
        
        log(`Frame ${frameIndex}: Applying color grading...`);
        
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
        
        const duration = Date.now() - startTime;
        metrics.processTimes.push({ frame: frameIndex, duration });
        log(`Frame ${frameIndex} processed in ${duration}ms`, 'SUCCESS');
        
        return finalImage;
    } catch (error) {
        log(`Failed to process frame ${frameIndex}: ${error.message}`, 'ERROR');
        metrics.errors.push({ stage: 'process', frame: frameIndex, error: error.message });
        throw error;
    }
}

// Save frame to disk
async function saveFrame(buffer, frameIndex) {
    const fileName = `frame_${String(frameIndex).padStart(4, '0')}.jpg`;
    const filePath = path.join(CONFIG.OUTPUT_DIR, 'frames', fileName);
    await fs.writeFile(filePath, buffer);
    return filePath;
}

// Generate video from frames
async function generateVideo() {
    const startTime = Date.now();
    const framesDir = path.join(CONFIG.OUTPUT_DIR, 'frames');
    const outputPath = path.join(CONFIG.OUTPUT_DIR, 'test_video.mp4');
    
    const ffmpegCommand = `ffmpeg -y -framerate ${CONFIG.FPS} -i "${framesDir}/frame_%04d.jpg" ` +
        `-c:v libx264 -pix_fmt yuv420p -preset medium -crf 18 "${outputPath}"`;
    
    try {
        log('Generating video with FFmpeg...');
        await execAsync(ffmpegCommand, { timeout: 60000 });
        
        metrics.videoGenTime = Date.now() - startTime;
        log(`Video generated in ${metrics.videoGenTime}ms`, 'SUCCESS');
        
        // Get file size
        const stats = await fs.stat(outputPath);
        return {
            path: outputPath,
            size: `${(stats.size / 1024 / 1024).toFixed(2)} MB`,
            duration: `${CONFIG.TEST_FRAMES / CONFIG.FPS} seconds`
        };
    } catch (error) {
        log(`Failed to generate video: ${error.message}`, 'ERROR');
        metrics.errors.push({ stage: 'video', error: error.message });
        throw error;
    }
}

// Main test function
async function runPipelineTest() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   VPS Pipeline Performance Test        ║');
    console.log(`║   Frames: ${CONFIG.TEST_FRAMES}                           ║`);
    console.log('╚════════════════════════════════════════╝\n');
    
    metrics.startTime = Date.now();
    
    try {
        await ensureDirectories();
        
        // Generate frame dates
        const baseDate = new Date(CONFIG.START_DATE);
        const frames = [];
        for (let i = 0; i < CONFIG.TEST_FRAMES; i++) {
            const frameDate = new Date(baseDate.getTime() + i * CONFIG.INTERVAL_MINUTES * 60000);
            frames.push({
                index: i,
                date: frameDate.toISOString()
            });
        }
        
        log(`Starting test with ${CONFIG.TEST_FRAMES} frames...`);
        
        // Process each frame
        for (const frame of frames) {
            log(`\nProcessing frame ${frame.index + 1}/${CONFIG.TEST_FRAMES}`);
            
            // Record memory usage
            const memUsage = process.memoryUsage();
            metrics.memoryUsage.push({
                frame: frame.index,
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            });
            
            try {
                // Fetch images
                const fetchStart = Date.now();
                const [coronaPath, sunDiskPath] = await Promise.all([
                    fetchImage(4, frame.date, `corona_${frame.index}`),
                    fetchImage(10, frame.date, `sun_${frame.index}`)
                ]);
                metrics.totalFetchTime += Date.now() - fetchStart;
                
                // Process frame
                const processStart = Date.now();
                const processedFrame = await processFrame(coronaPath, sunDiskPath, frame.index);
                metrics.totalProcessTime += Date.now() - processStart;
                
                // Save frame
                await saveFrame(processedFrame, frame.index);
                
                // Clean up temp files
                await fs.unlink(coronaPath).catch(() => {});
                await fs.unlink(sunDiskPath).catch(() => {});
                
            } catch (error) {
                log(`Frame ${frame.index} failed: ${error.message}`, 'ERROR');
            }
        }
        
        // Generate video
        const videoInfo = await generateVideo();
        
        // Calculate final metrics
        const totalTime = Date.now() - metrics.startTime;
        const avgFetchTime = metrics.fetchTimes.length > 0 
            ? metrics.fetchTimes.reduce((sum, t) => sum + t.duration, 0) / metrics.fetchTimes.length
            : 0;
        const avgProcessTime = metrics.processTimes.length > 0
            ? metrics.processTimes.reduce((sum, t) => sum + t.duration, 0) / metrics.processTimes.length
            : 0;
        const maxMemory = Math.max(...metrics.memoryUsage.map(m => m.heapUsed));
        
        // Generate report
        const report = {
            summary: {
                totalFrames: CONFIG.TEST_FRAMES,
                successfulFrames: metrics.processTimes.length,
                failedFrames: CONFIG.TEST_FRAMES - metrics.processTimes.length,
                totalTime: `${(totalTime / 1000).toFixed(2)} seconds`,
                averageFrameTime: `${(totalTime / CONFIG.TEST_FRAMES / 1000).toFixed(2)} seconds`
            },
            performance: {
                totalFetchTime: `${(metrics.totalFetchTime / 1000).toFixed(2)} seconds`,
                totalProcessTime: `${(metrics.totalProcessTime / 1000).toFixed(2)} seconds`,
                videoGenTime: `${(metrics.videoGenTime / 1000).toFixed(2)} seconds`,
                avgFetchPerImage: `${avgFetchTime.toFixed(0)}ms`,
                avgProcessPerFrame: `${avgProcessTime.toFixed(0)}ms`
            },
            memory: {
                peakUsage: `${maxMemory} MB`,
                averageUsage: `${Math.round(metrics.memoryUsage.reduce((sum, m) => sum + m.heapUsed, 0) / metrics.memoryUsage.length)} MB`
            },
            video: videoInfo,
            errors: metrics.errors
        };
        
        // Print report
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║        PERFORMANCE TEST RESULTS        ║');
        console.log('╚════════════════════════════════════════╝\n');
        
        console.log('📊 Summary:');
        console.log(`   Total Time: ${report.summary.totalTime}`);
        console.log(`   Frames Processed: ${report.summary.successfulFrames}/${report.summary.totalFrames}`);
        console.log(`   Average per Frame: ${report.summary.averageFrameTime}`);
        
        console.log('\n⚡ Performance Breakdown:');
        console.log(`   Fetching: ${report.performance.totalFetchTime} (${report.performance.avgFetchPerImage} per image)`);
        console.log(`   Processing: ${report.performance.totalProcessTime} (${report.performance.avgProcessPerFrame} per frame)`);
        console.log(`   Video Generation: ${report.performance.videoGenTime}`);
        
        console.log('\n💾 Memory Usage:');
        console.log(`   Peak: ${report.memory.peakUsage}`);
        console.log(`   Average: ${report.memory.averageUsage}`);
        
        console.log('\n🎬 Video Output:');
        console.log(`   Path: ${report.video.path}`);
        console.log(`   Size: ${report.video.size}`);
        console.log(`   Duration: ${report.video.duration}`);
        
        if (report.errors.length > 0) {
            console.log('\n⚠️ Errors:');
            report.errors.forEach(err => {
                console.log(`   ${err.stage}: ${err.error}`);
            });
        }
        
        // Save report to file
        await fs.writeFile(
            path.join(CONFIG.OUTPUT_DIR, 'performance_report.json'),
            JSON.stringify(report, null, 2)
        );
        
        console.log('\n✅ Test complete! Report saved to performance_report.json');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
runPipelineTest().catch(console.error);