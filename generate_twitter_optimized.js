#!/usr/bin/env node

/**
 * Generate Twitter-optimized 1080x1080 video from existing frames
 * Uses H.264 codec and MP4 format for best Twitter compatibility
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    TEMP_DIR: '/opt/heliosphere/temp',
    FPS: 24,
    SOCIAL_DAYS: 30
};

async function generateTwitterVideo() {
    console.log('🐦 Generating Twitter-optimized video (1080x1080)...');
    console.log('================================================\n');
    
    // Ensure directories exist
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    
    // Get all frame files (last 30 days for social media)
    const frameDirs = await fs.readdir(CONFIG.FRAMES_DIR);
    frameDirs.sort();
    
    const allFrames = [];
    
    for (const dir of frameDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
        const stat = await fs.stat(dirPath);
        
        if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort();
            
            for (const file of jpgFiles) {
                allFrames.push(`file '${path.join(dirPath, file)}'`);
            }
        }
    }
    
    // Get last 30 days of frames
    const socialFrames = allFrames.slice(-(CONFIG.SOCIAL_DAYS * 96));
    console.log(`📊 Using ${socialFrames.length} frames (last 30 days)`);
    
    if (socialFrames.length === 0) {
        console.error('❌ No frames found!');
        return;
    }
    
    // Write frame list
    const frameListPath = path.join(CONFIG.TEMP_DIR, 'twitter_frames.txt');
    await fs.writeFile(frameListPath, socialFrames.join('\n'));
    
    const dateStr = new Date().toISOString().split('T')[0];
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_twitter_1080_${dateStr}.mp4`);
    
    // Generate video with Twitter-optimal settings:
    // 1. Crop to 1080x1080 from center of 1460x1200 frame
    // 2. Use H.264 codec with good quality
    // 3. Add proper pixel format for compatibility
    // 4. Two-pass encoding for better quality at smaller size
    
    console.log('\n🎬 Pass 1: Analyzing video...');
    const pass1Command = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-vf "crop=1080:1080:190:60,scale=1080:1080:flags=lanczos" ` +
        `-c:v libx264 -preset slow -crf 20 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-pass 1 -f null /dev/null`;
    
    try {
        await execAsync(pass1Command, { timeout: 300000 });
        console.log('✓ Analysis complete');
    } catch (error) {
        console.log('Single-pass encoding (analysis skipped)');
    }
    
    console.log('\n🎬 Pass 2: Encoding video...');
    const pass2Command = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-vf "crop=1080:1080:190:60,scale=1080:1080:flags=lanczos" ` +
        `-c:v libx264 -preset slow -crf 20 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-metadata title="Heliolens - 30 Days of Solar Activity" ` +
        `-metadata artist="Built by Vibes" ` +
        `"${outputPath}"`;
    
    console.log('Encoding with settings:');
    console.log('  Resolution: 1080x1080');
    console.log('  Codec: H.264');
    console.log('  Quality: CRF 20 (high)');
    console.log('  Format: MP4');
    console.log('  Optimization: Twitter compatibility\n');
    
    const startTime = Date.now();
    await execAsync(pass2Command, { timeout: 600000 });
    const elapsed = (Date.now() - startTime) / 1000;
    
    // Get file stats
    const stats = await fs.stat(outputPath);
    const duration = socialFrames.length / CONFIG.FPS;
    
    console.log('\n✅ Video generated successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📁 File: ${outputPath}`);
    console.log(`📐 Resolution: 1080x1080 (1:1 square)`);
    console.log(`📦 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`⏱️ Duration: ${duration.toFixed(1)} seconds`);
    console.log(`🎞️ Frames: ${socialFrames.length}`);
    console.log(`⚡ Generation time: ${elapsed.toFixed(1)} seconds`);
    console.log('\n🐦 Ready for Twitter/PostBridge upload!');
    
    // Clean up temp files
    try {
        await fs.unlink(frameListPath);
        await fs.unlink('ffmpeg2pass-0.log').catch(() => {});
        await fs.unlink('ffmpeg2pass-0.log.mbtree').catch(() => {});
    } catch (e) {
        // Ignore cleanup errors
    }
    
    return outputPath;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    generateTwitterVideo().catch(console.error);
}

export { generateTwitterVideo };