#!/usr/bin/env node

/**
 * VPS Production Script - Highest Quality Encoding
 * Generates maximum quality videos for Cloudflare Stream
 * CRF 10 with veryslow preset for best compression efficiency
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

// Configuration for highest quality
const CONFIG = {
    // Encoding settings - MAXIMUM QUALITY
    VIDEO_ENCODING: {
        CRF: 8,                    // Ultra high quality (0=lossless, lower=better)
        PRESET: 'veryslow',        // Best compression efficiency
        PROFILE: 'high',           // H.264 High Profile
        LEVEL: '5.2',              // Support up to 4K@60fps
        PIXEL_FORMAT: 'yuv420p',   // Compatible pixel format
        TUNE: 'animation',         // Optimize for synthetic content
        X264_PARAMS: [
            'deblock=-1:-1',       // Reduce deblocking for sharper image
            'aq-mode=3',           // Auto-variance AQ for better quality distribution
            'aq-strength=0.8',     // Adaptive quantization strength
            'psy-rd=1.2:0.2',      // Psychovisual optimization
            'me=umh',              // Uneven multi-hexagon motion estimation
            'subme=10',            // Highest subpixel motion estimation
            'trellis=2',           // Full trellis quantization
            'ref=8',               // Reference frames
            'bframes=8',           // B-frames for better compression
            'b-adapt=2'            // Adaptive B-frame placement
        ].join(':')
    },
    
    // Frame processing - maximum quality
    FRAME_QUALITY: {
        JPEG_QUALITY: 98,          // Near-lossless JPEG
        USE_MOZJPEG: true,         // Better JPEG encoder
        PNG_COMPRESSION: 1,        // Low compression for speed (frames are temporary)
        SHARP_OPTIONS: {
            kernel: sharp.kernel.lanczos3,  // Best downsampling kernel
            fastShrinkOnLoad: false         // Don't use fast shrink
        }
    },
    
    // Processing settings
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 100,
    
    // Production parameters  
    PRODUCTION_DAYS: 56,           // 8 weeks of data
    FRAMES_PER_DAY: 96,            // Every 15 minutes
    SAFE_DELAY_DAYS: 2,            // 48-hour delay
    FPS: 24,
    
    // Storage
    DESKTOP_FRAMES_DIR: '/opt/heliosphere/production_desktop',
    MOBILE_FRAMES_DIR: '/opt/heliosphere/production_mobile',
    VIDEOS_DIR: '/opt/heliosphere/production_videos',
    STATE_FILE: '/opt/heliosphere/production_state.json',
    TEMP_DIR: '/tmp/heliosphere_production'
};

// Generate FFmpeg command with highest quality settings
function getFFmpegCommand(inputDir, outputPath, format) {
    const dimensions = format === 'mobile' ? '1080:1350' : '1460:1200';
    
    return `ffmpeg -y \
        -framerate ${CONFIG.FPS} \
        -pattern_type glob -i "${inputDir}/frame_*.jpg" \
        -c:v libx264 \
        -preset ${CONFIG.VIDEO_ENCODING.PRESET} \
        -crf ${CONFIG.VIDEO_ENCODING.CRF} \
        -profile:v ${CONFIG.VIDEO_ENCODING.PROFILE} \
        -level:v ${CONFIG.VIDEO_ENCODING.LEVEL} \
        -pix_fmt ${CONFIG.VIDEO_ENCODING.PIXEL_FORMAT} \
        -tune ${CONFIG.VIDEO_ENCODING.TUNE} \
        -x264-params "${CONFIG.VIDEO_ENCODING.X264_PARAMS}" \
        -movflags +faststart \
        -vf "scale=${dimensions}:flags=lanczos,setsar=1:1" \
        -color_range tv \
        -colorspace bt709 \
        -color_primaries bt709 \
        -color_trc bt709 \
        "${outputPath}"`;
}

// Apply highest quality color grading
async function gradeCorona(buffer) {
    return await sharp(buffer)
        .modulate({ 
            saturation: 0.3, 
            brightness: 1.0, 
            hue: -5 
        })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

async function gradeSunDisk(buffer) {
    return await sharp(buffer)
        .modulate({ 
            saturation: 1.2, 
            brightness: 1.4, 
            hue: 15 
        })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

// Apply circular feathering with highest quality
async function applyCircularFeather(buffer) {
    const finalSize = 1435;
    const compositeRadius = 400;
    const featherRadius = 40;
    
    const resizedImage = await sharp(buffer)
        .resize(finalSize, finalSize, CONFIG.FRAME_QUALITY.SHARP_OPTIONS)
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
    
    const mask = await sharp(Buffer.from(svgMask))
        .png({ compressionLevel: CONFIG.FRAME_QUALITY.PNG_COMPRESSION })
        .toBuffer();
        
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png({ compressionLevel: CONFIG.FRAME_QUALITY.PNG_COMPRESSION })
        .toBuffer();
}

// Create composite with maximum quality
async function createComposite(coronaBuffer, sunDiskBuffer, format = 'desktop') {
    // Create full-size composite canvas
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
    .png({ compressionLevel: CONFIG.FRAME_QUALITY.PNG_COMPRESSION })
    .toBuffer();
    
    // Extract region based on format
    let extractRegion;
    if (format === 'mobile') {
        // Portrait crop for mobile (1080×1350)
        extractRegion = {
            left: 420,  // (1920-1080)/2
            top: 42,    // Slight top bias
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
    
    // Save with highest quality JPEG settings
    const finalImage = await sharp(compositeImage)
        .extract(extractRegion)
        .jpeg({ 
            quality: CONFIG.FRAME_QUALITY.JPEG_QUALITY, 
            mozjpeg: CONFIG.FRAME_QUALITY.USE_MOZJPEG,
            chromaSubsampling: '4:4:4',  // No chroma subsampling
            trellisQuantisation: true,    // Better compression
            overshootDeringing: true      // Reduce ringing artifacts
        })
        .toBuffer();
    
    return finalImage;
}

// Fetch image from Helioviewer
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
    
    return buffer;
}

// Process single frame with highest quality
async function processFrame(frameNumber, date) {
    try {
        // Fetch both images
        const [coronaBuffer, sunDiskBuffer] = await Promise.all([
            fetchImage(4, date.toISOString()),
            fetchImage(10, date.toISOString())
        ]);
        
        // Apply color grading
        const [gradedCorona, gradedSunDisk] = await Promise.all([
            gradeCorona(coronaBuffer),
            gradeSunDisk(sunDiskBuffer)
        ]);
        
        // Apply feathering
        const featheredSunDisk = await applyCircularFeather(gradedSunDisk);
        
        // Create both format composites
        const [desktopComposite, mobileComposite] = await Promise.all([
            createComposite(gradedCorona, featheredSunDisk, 'desktop'),
            createComposite(gradedCorona, featheredSunDisk, 'mobile')
        ]);
        
        // Save both frames
        const frameNum = String(frameNumber).padStart(5, '0');
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
        
        return { success: true, frameNumber };
        
    } catch (error) {
        console.error(`Frame ${frameNumber} failed:`, error.message);
        return { success: false, frameNumber, error: error.message };
    }
}

// Generate highest quality video
async function generateVideo(format, outputName) {
    const inputDir = format === 'mobile' ? CONFIG.MOBILE_FRAMES_DIR : CONFIG.DESKTOP_FRAMES_DIR;
    const outputPath = path.join(CONFIG.VIDEOS_DIR, outputName);
    
    console.log(`\n🎬 Generating ${format} video with MAXIMUM QUALITY...`);
    console.log(`   CRF: ${CONFIG.VIDEO_ENCODING.CRF} (ultra high quality)`);
    console.log(`   Preset: ${CONFIG.VIDEO_ENCODING.PRESET}`);
    console.log(`   Profile: ${CONFIG.VIDEO_ENCODING.PROFILE}`);
    
    const ffmpegCmd = getFFmpegCommand(inputDir, outputPath, format);
    
    const startTime = Date.now();
    const { stdout, stderr } = await execAsync(ffmpegCmd, { 
        maxBuffer: 50 * 1024 * 1024  // 50MB buffer for large output
    });
    
    const encodingTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = await fs.stat(outputPath);
    
    console.log(`   ✅ Encoded in ${encodingTime}s`);
    console.log(`   💾 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   🌟 Quality: Maximum (CRF ${CONFIG.VIDEO_ENCODING.CRF})`);
    
    return {
        path: outputPath,
        size: stats.size,
        encodingTime,
        format
    };
}

// Main production function
async function runProduction() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  VPS PRODUCTION - HIGHEST QUALITY              ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    // Setup directories
    await fs.mkdir(CONFIG.DESKTOP_FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.MOBILE_FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    
    // Calculate date range
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    endDate.setHours(0, 0, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.PRODUCTION_DAYS);
    
    const totalFrames = CONFIG.PRODUCTION_DAYS * CONFIG.FRAMES_PER_DAY;
    
    console.log(`📅 Date Range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    console.log(`🎥 Total Frames: ${totalFrames}`);
    console.log(`💾 Output: Desktop (1460×1200) + Mobile (1080×1350)`);
    console.log(`⚙️ Quality Settings:`);
    console.log(`   - Frame JPEG Quality: ${CONFIG.FRAME_QUALITY.JPEG_QUALITY}`);
    console.log(`   - Video CRF: ${CONFIG.VIDEO_ENCODING.CRF} (lower = better)`);
    console.log(`   - Encoding Preset: ${CONFIG.VIDEO_ENCODING.PRESET}`);
    console.log('\n');
    
    // Process frames
    const startTime = Date.now();
    let processedCount = 0;
    
    for (let i = 0; i < totalFrames; i++) {
        const frameDate = new Date(startDate);
        frameDate.setMinutes(frameDate.getMinutes() + i * 15);
        
        const result = await processFrame(i, frameDate);
        
        if (result.success) {
            processedCount++;
            
            if (processedCount % 100 === 0) {
                const progress = (processedCount / totalFrames * 100).toFixed(1);
                const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
                const rate = (processedCount / (Date.now() - startTime) * 60000).toFixed(1);
                console.log(`Progress: ${progress}% | ${processedCount}/${totalFrames} | ${elapsed} min | ${rate} frames/min`);
            }
        }
    }
    
    console.log(`\n✅ Frame processing complete: ${processedCount}/${totalFrames} frames`);
    
    // Generate videos with maximum quality
    console.log('\n🎬 Encoding videos with MAXIMUM QUALITY...');
    console.log('This will take significant time due to quality settings...\n');
    
    const [desktopVideo, mobileVideo] = await Promise.all([
        generateVideo('desktop', `heliosphere_desktop_${new Date().toISOString().split('T')[0]}.mp4`),
        generateVideo('mobile', `heliosphere_mobile_${new Date().toISOString().split('T')[0]}.mp4`)
    ]);
    
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    console.log('\n' + '═'.repeat(50));
    console.log('🎆 PRODUCTION COMPLETE - HIGHEST QUALITY');
    console.log('═'.repeat(50));
    console.log(`Total Time: ${totalTime} minutes`);
    console.log(`Desktop Video: ${(desktopVideo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Mobile Video: ${(mobileVideo.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`\n🚀 Ready for upload to Cloudflare Stream!`);
}

// Express server for monitoring
const app = express();
const PORT = 3006;

app.get('/status', (req, res) => {
    res.json({ status: 'Production script ready', quality: 'MAXIMUM' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`📡 Monitor: http://65.109.0.112:${PORT}/status`);
    
    // Run production
    runProduction().catch(error => {
        console.error('❌ Production failed:', error);
        process.exit(1);
    });
});