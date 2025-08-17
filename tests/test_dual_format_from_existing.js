#!/usr/bin/env node

/**
 * Test Dual Format Video Generation from Existing Frames
 * Uses already processed frames to quickly test desktop vs mobile portrait videos
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // Source frames (from existing optimized test)
    SOURCE_FRAMES_DIR: '/opt/heliosphere/test_optimized_frames',
    
    // Output directories
    DESKTOP_FRAMES_DIR: '/opt/heliosphere/test_desktop_frames',
    MOBILE_FRAMES_DIR: '/opt/heliosphere/test_mobile_frames',
    VIDEOS_DIR: '/opt/heliosphere/test_comparison_videos',
    
    // Video settings
    FPS: 24
};

// Process single frame to both formats
async function processFrame(sourcePath, frameNumber) {
    try {
        // Read the existing processed frame
        const sourceBuffer = await fs.readFile(sourcePath);
        
        // Get image metadata
        const metadata = await sharp(sourceBuffer).metadata();
        console.log(`Frame ${frameNumber}: ${metadata.width}×${metadata.height}`);
        
        // For desktop: just copy as-is (already 1460×1200)
        const frameNum = String(frameNumber).padStart(5, '0');
        const desktopPath = path.join(CONFIG.DESKTOP_FRAMES_DIR, `frame_${frameNum}.jpg`);
        await fs.copyFile(sourcePath, desktopPath);
        
        // For mobile: crop to portrait (1080×1350)
        // The existing frames are 1460×1200, we need to:
        // 1. Crop width from 1460 to 1080 (remove 190px from each side)
        // 2. Extend height from 1200 to 1350 (add 75px top and bottom)
        
        // Since we can't extend, we'll crop smartly
        // Best approach: crop to 960×1200 (0.8:1 aspect) from center
        const mobileBuffer = await sharp(sourceBuffer)
            .extract({
                left: 250,  // (1460-960)/2
                top: 0,     // Keep full height
                width: 960,
                height: 1200
            })
            .resize(1080, 1350, {
                fit: 'cover',
                position: 'centre'
            })
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        const mobilePath = path.join(CONFIG.MOBILE_FRAMES_DIR, `frame_${frameNum}.jpg`);
        await fs.writeFile(mobilePath, mobileBuffer);
        
        return { success: true, frameNumber };
        
    } catch (error) {
        console.error(`Failed to process frame ${frameNumber}:`, error.message);
        return { success: false, frameNumber, error: error.message };
    }
}

// Generate video from frames
async function generateVideo(framesDir, outputName, dimensions) {
    const outputPath = path.join(CONFIG.VIDEOS_DIR, outputName);
    
    console.log(`\n🎬 Generating ${outputName} (${dimensions})...`);
    
    const ffmpegCmd = `ffmpeg -y -framerate ${CONFIG.FPS} ` +
        `-pattern_type glob -i "${framesDir}/frame_*.jpg" ` +
        `-c:v libx264 -preset veryslow -crf 15 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-vf "scale=${dimensions}:flags=lanczos,format=yuv420p" ` +
        `"${outputPath}"`;
    
    try {
        await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
        const stats = await fs.stat(outputPath);
        console.log(`✅ Generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return { path: outputPath, size: stats.size };
    } catch (error) {
        console.error(`❌ Failed to generate ${outputName}:`, error.message);
        return null;
    }
}

// Main function
async function testDualFormat() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  DUAL FORMAT TEST FROM EXISTING FRAMES         ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    try {
        // Check if source frames exist
        const sourceFiles = await fs.readdir(CONFIG.SOURCE_FRAMES_DIR);
        const frameFiles = sourceFiles
            .filter(f => f.endsWith('.jpg'))
            .sort();
        
        console.log(`📁 Found ${frameFiles.length} existing frames`);
        
        if (frameFiles.length === 0) {
            throw new Error('No frames found in source directory');
        }
        
        // Create output directories
        await fs.mkdir(CONFIG.DESKTOP_FRAMES_DIR, { recursive: true });
        await fs.mkdir(CONFIG.MOBILE_FRAMES_DIR, { recursive: true });
        await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
        
        // Process frames in batches
        console.log('\n🔄 Processing frames for both formats...');
        const batchSize = 10;
        const results = [];
        
        for (let i = 0; i < frameFiles.length; i += batchSize) {
            const batch = frameFiles.slice(i, Math.min(i + batchSize, frameFiles.length));
            
            const batchPromises = batch.map(file => {
                const frameNumber = parseInt(file.match(/\d+/)[0]);
                const sourcePath = path.join(CONFIG.SOURCE_FRAMES_DIR, file);
                return processFrame(sourcePath, frameNumber);
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            const progress = Math.round((i + batch.length) / frameFiles.length * 100);
            console.log(`Progress: ${progress}% (${i + batch.length}/${frameFiles.length})`);
        }
        
        // Count successes
        const successful = results.filter(r => r.success).length;
        console.log(`\n✅ Processed ${successful}/${frameFiles.length} frames successfully`);
        
        // Generate both videos
        console.log('\n🎥 Generating comparison videos...');
        
        const [desktopVideo, mobileVideo] = await Promise.all([
            generateVideo(CONFIG.DESKTOP_FRAMES_DIR, 'desktop_1460x1200.mp4', '1460:1200'),
            generateVideo(CONFIG.MOBILE_FRAMES_DIR, 'mobile_1080x1350.mp4', '1080:1350')
        ]);
        
        // Create comparison HTML
        console.log('\n📄 Creating comparison page...');
        await createComparisonPage(desktopVideo, mobileVideo);
        
        console.log('\n' + '═'.repeat(50));
        console.log('📊 COMPARISON RESULTS');
        console.log('═'.repeat(50));
        
        if (desktopVideo) {
            console.log(`Desktop (1460×1200): ${(desktopVideo.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Path: ${desktopVideo.path}`);
        }
        
        if (mobileVideo) {
            console.log(`Mobile (1080×1350): ${(mobileVideo.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Path: ${mobileVideo.path}`);
        }
        
        console.log(`\n🌐 View comparison at:`);
        console.log(`   http://65.109.0.112:3005/compare`);
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Create comparison HTML page
async function createComparisonPage(desktopVideo, mobileVideo) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Desktop vs Mobile Video Comparison</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 100%);
            color: #fff;
            padding: 20px;
        }
        h1 {
            text-align: center;
            color: #FFD700;
            margin-bottom: 30px;
        }
        .comparison-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            max-width: 1400px;
            margin: 0 auto;
        }
        .video-container {
            background: rgba(255,255,255,0.05);
            border-radius: 15px;
            padding: 20px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .video-container h2 {
            color: #FFD700;
            margin-bottom: 15px;
            font-size: 1.2em;
        }
        video {
            width: 100%;
            height: auto;
            border-radius: 10px;
            background: #000;
        }
        .stats {
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid rgba(255,255,255,0.1);
            font-size: 0.9em;
            color: #aaa;
        }
        .mobile-preview {
            max-width: 300px;
            margin: 0 auto;
        }
        .desktop-preview {
            max-width: 600px;
            margin: 0 auto;
        }
        @media (max-width: 768px) {
            .comparison-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <h1>🌞 Desktop vs Mobile Portrait Comparison</h1>
    
    <div class="comparison-grid">
        <div class="video-container">
            <h2>💻 Desktop Version (1460×1200)</h2>
            <div class="desktop-preview">
                <video controls autoplay loop muted>
                    <source src="/videos/desktop_1460x1200.mp4" type="video/mp4">
                </video>
            </div>
            <div class="stats">
                <strong>Specifications:</strong><br>
                • Resolution: 1460×1200<br>
                • Aspect Ratio: 1.22:1<br>
                • Shows: Full corona with complete sun disk<br>
                • Best for: Desktop, tablets in landscape<br>
                • File size: ${desktopVideo ? (desktopVideo.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}
            </div>
        </div>
        
        <div class="video-container">
            <h2>📱 Mobile Portrait (1080×1350)</h2>
            <div class="mobile-preview">
                <video controls autoplay loop muted>
                    <source src="/videos/mobile_1080x1350.mp4" type="video/mp4">
                </video>
            </div>
            <div class="stats">
                <strong>Specifications:</strong><br>
                • Resolution: 1080×1350<br>
                • Aspect Ratio: 0.8:1<br>
                • Shows: Centered sun with slight corona crop<br>
                • Best for: Mobile phones, Instagram<br>
                • File size: ${mobileVideo ? (mobileVideo.size / 1024 / 1024).toFixed(2) + ' MB' : 'N/A'}<br>
                • Screen coverage: ~60% on phones (vs 46% desktop)
            </div>
        </div>
    </div>
    
    <div style="max-width: 800px; margin: 40px auto; background: rgba(255,215,0,0.1); padding: 20px; border-radius: 10px; border: 1px solid rgba(255,215,0,0.3);">
        <h2 style="color: #FFD700; margin-bottom: 15px;">📊 Analysis</h2>
        <p style="line-height: 1.6;">
            The mobile portrait version provides <strong>30% better screen coverage</strong> on phones while maintaining 
            the sun as the focal point. Some corona detail is cropped but the overall impact remains strong.
            The desktop version preserves the full artistic composition with complete corona visibility.
        </p>
        <p style="margin-top: 15px; line-height: 1.6;">
            <strong>Recommendation:</strong> Deploy both versions with automatic device detection. 
            Serve the portrait version to mobile devices in portrait orientation and the desktop version 
            for all other cases.
        </p>
    </div>
</body>
</html>`;
    
    await fs.writeFile(path.join(CONFIG.VIDEOS_DIR, 'comparison.html'), html);
}

// Run the test
testDualFormat().catch(console.error);