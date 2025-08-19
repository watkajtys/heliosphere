#!/usr/bin/env node

/**
 * Generate 60-second social media video
 * Perfect length for Twitter/X, Instagram, TikTok
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

async function generateSocialVideo() {
    console.log('🎬 Generating 60-second social media video...');
    
    const framesDir = path.join(__dirname, 'frames');
    const outputPath = path.join(__dirname, 'heliosphere_social_60s.mp4');
    
    // Check if we have frames
    if (!fs.existsSync(framesDir)) {
        console.error('❌ No frames directory found. Run production script first.');
        process.exit(1);
    }
    
    const frames = fs.readdirSync(framesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();
    
    if (frames.length === 0) {
        console.error('❌ No frames found in directory');
        process.exit(1);
    }
    
    console.log(`📊 Found ${frames.length} frames`);
    
    // For a 60-second video at 24fps, we need 1440 frames
    // If we have more frames, we'll speed up the video
    // If we have fewer, we'll use what we have
    
    const targetFrames = 1440; // 60 seconds * 24 fps
    const frameRate = Math.min(24, Math.floor(frames.length / 60));
    
    console.log(`🎞️ Using frame rate: ${frameRate} fps`);
    
    // Generate video with specific social media optimizations
    const ffmpegCmd = `ffmpeg -y \
        -framerate ${frameRate} \
        -pattern_type glob -i "${framesDir}/*.jpg" \
        -c:v libx264 \
        -preset slow \
        -crf 20 \
        -pix_fmt yuv420p \
        -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p" \
        -t 60 \
        -movflags +faststart \
        "${outputPath}"`;
    
    console.log('🔧 Running FFmpeg...');
    
    try {
        const { stdout, stderr } = await execAsync(ffmpegCmd);
        console.log('✅ Social media video generated successfully!');
        console.log(`📁 Output: ${outputPath}`);
        
        // Get file size
        const stats = fs.statSync(outputPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`📦 File size: ${fileSizeMB} MB`);
        
        // Generate a square version for Instagram/TikTok
        const squareOutput = path.join(__dirname, 'heliosphere_social_square_60s.mp4');
        const squareCmd = `ffmpeg -y \
            -i "${outputPath}" \
            -vf "crop=1080:1080" \
            -c:v libx264 \
            -preset slow \
            -crf 20 \
            -pix_fmt yuv420p \
            -movflags +faststart \
            "${squareOutput}"`;
        
        console.log('🔳 Generating square version for Instagram...');
        await execAsync(squareCmd);
        console.log(`✅ Square version: ${squareOutput}`);
        
        // Generate vertical version for TikTok/Reels
        const verticalOutput = path.join(__dirname, 'heliosphere_social_vertical_60s.mp4');
        const verticalCmd = `ffmpeg -y \
            -i "${outputPath}" \
            -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
            -c:v libx264 \
            -preset slow \
            -crf 20 \
            -pix_fmt yuv420p \
            -movflags +faststart \
            "${verticalOutput}"`;
        
        console.log('📱 Generating vertical version for TikTok/Reels...');
        await execAsync(verticalCmd);
        console.log(`✅ Vertical version: ${verticalOutput}`);
        
        console.log('\n🎉 All social media videos generated!');
        console.log('📹 Formats created:');
        console.log('  - Landscape (16:9): heliosphere_social_60s.mp4');
        console.log('  - Square (1:1): heliosphere_social_square_60s.mp4');
        console.log('  - Vertical (9:16): heliosphere_social_vertical_60s.mp4');
        
    } catch (error) {
        console.error('❌ Error generating video:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    generateSocialVideo();
}

module.exports = { generateSocialVideo };