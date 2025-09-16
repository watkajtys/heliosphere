#!/usr/bin/env node

/**
 * Generate Twitter-compatible H.264 MP4 video
 * Optimized for fast encoding and Twitter requirements
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
    SOCIAL_DAYS: 15  // 15 days = 60 seconds at 24fps
};

async function generateTwitterVideo() {
    console.log('🐦 Generating Twitter H.264 video (1080x1080)...');
    console.log('==============================================\n');
    
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
    
    // Get last 15 days of frames for 60-second video
    const socialFrames = allFrames.slice(-(CONFIG.SOCIAL_DAYS * 96));
    console.log(`📊 Using ${socialFrames.length} frames (last ${CONFIG.SOCIAL_DAYS} days = 60 seconds)`);
    
    if (socialFrames.length === 0) {
        console.error('❌ No frames found!');
        return;
    }
    
    // Write frame list
    const frameListPath = path.join(CONFIG.TEMP_DIR, 'twitter_h264_frames.txt');
    await fs.writeFile(frameListPath, socialFrames.join('\n'));
    
    const dateStr = new Date().toISOString().split('T')[0];
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_twitter_60s_${dateStr}.mp4`);
    
    // Generate video with Twitter-optimal settings:
    // Using libx264 with faster preset and proper format
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-vf "crop=1080:1080:190:60" ` +
        `-c:v libx264 -preset faster -crf 23 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-metadata title="Heliolens Solar Activity" ` +
        `"${outputPath}"`;
    
    console.log('Encoding settings:');
    console.log('  Resolution: 1080x1080');
    console.log('  Codec: H.264 (libx264)');
    console.log('  Quality: CRF 23');
    console.log('  Preset: faster (for quicker encoding)');
    console.log('  Format: MP4\n');
    
    console.log('🎬 Encoding video...');
    const startTime = Date.now();
    
    try {
        const { stdout, stderr } = await execAsync(ffmpegCommand, { 
            timeout: 300000,  // 5 minute timeout
            maxBuffer: 10 * 1024 * 1024
        });
        
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
        console.log(`⚡ Encoding time: ${elapsed.toFixed(1)} seconds`);
        console.log('\n🐦 Ready for Twitter upload!');
        
        // Verify it's proper H.264
        const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`;
        const { stdout: codec } = await execAsync(probeCmd);
        console.log(`🎥 Codec verified: ${codec.trim()}`);
        
    } catch (error) {
        console.error('❌ Encoding failed:', error.message);
        if (error.stderr) {
            console.error('FFmpeg error:', error.stderr);
        }
        process.exit(1);
    }
    
    // Clean up temp files
    try {
        await fs.unlink(frameListPath);
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