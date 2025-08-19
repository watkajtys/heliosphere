#!/usr/bin/env node

/**
 * Generate Twitter-optimized video from VPS frames
 * Creates a 16:9 landscape video perfect for Twitter/X
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

const CONFIG = {
    FRAME_COUNT: 1440,  // Exactly 60 seconds at 24fps
    FPS: 24,
    OUTPUT_WIDTH: 1920,
    OUTPUT_HEIGHT: 1080,
    CRF: 23, // Good quality, smaller file for social media
    OUTPUT_FILE: 'heliosphere_twitter_60s.mp4'
};

async function generateTwitterVideo() {
    console.log('🐦 Generating Twitter-optimized video...');
    console.log(`📊 Configuration:`);
    console.log(`   - Frames: ${CONFIG.FRAME_COUNT}`);
    console.log(`   - Duration: ${(CONFIG.FRAME_COUNT / CONFIG.FPS).toFixed(1)} seconds`);
    console.log(`   - Resolution: ${CONFIG.OUTPUT_WIDTH}×${CONFIG.OUTPUT_HEIGHT} (16:9)`);
    console.log(`   - Frame rate: ${CONFIG.FPS} fps`);

    try {
        // First, create a list of frames from the VPS
        console.log('\n📥 Creating frame list from VPS...');
        
        // Get list of frames from server (sorted by date)
        const { stdout: frameList } = await execAsync(
            `ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.0.112 "find /opt/heliosphere/frames -name '*.jpg' -type f | sort | head -${CONFIG.FRAME_COUNT}"`
        );
        
        const frames = frameList.trim().split('\n').filter(f => f);
        console.log(`✓ Found ${frames.length} frames on server`);

        if (frames.length < CONFIG.FRAME_COUNT) {
            console.log(`⚠️  Only ${frames.length} frames available (requested ${CONFIG.FRAME_COUNT})`);
        }

        // Create frame list file locally first
        const frameListPath = 'twitter_frames.txt';
        const frameListContent = frames.map(f => `file '${f}'`).join('\n');
        
        // Write frame list locally
        console.log('\n📝 Creating frame list file...');
        await fs.writeFile(frameListPath, frameListContent);
        
        // Upload frame list to server
        console.log('📤 Uploading frame list to server...');
        await execAsync(
            `scp -i ~/.ssh/id_ed25519_hetzner ${frameListPath} root@65.109.0.112:/opt/heliosphere/twitter_frames.txt`
        );

        // Generate video on VPS with Twitter-optimized settings
        console.log('\n🎬 Generating video on VPS...');
        const ffmpegCommand = `ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.0.112 "cd /opt/heliosphere && ffmpeg -y ` +
            `-r ${CONFIG.FPS} ` +
            `-f concat -safe 0 -i twitter_frames.txt ` +
            `-vf 'scale=${CONFIG.OUTPUT_WIDTH}:${CONFIG.OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${CONFIG.OUTPUT_WIDTH}:${CONFIG.OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1' ` +
            `-c:v libx264 ` +
            `-preset slow ` +
            `-crf ${CONFIG.CRF} ` +
            `-pix_fmt yuv420p ` +
            `-movflags +faststart ` +
            `twitter_video.mp4"`;

        console.log('⏳ Processing (this may take a minute)...');
        await execAsync(ffmpegCommand, { maxBuffer: 1024 * 1024 * 10 });
        console.log('✓ Video generated on server');

        // Download the video
        console.log('\n📥 Downloading video from VPS...');
        await execAsync(
            `scp -i ~/.ssh/id_ed25519_hetzner root@65.109.0.112:/opt/heliosphere/twitter_video.mp4 ${CONFIG.OUTPUT_FILE}`
        );

        // Get file stats
        const stats = await fs.stat(CONFIG.OUTPUT_FILE);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log('\n✅ Twitter video generated successfully!');
        console.log(`📁 Output: ${CONFIG.OUTPUT_FILE}`);
        console.log(`📦 File size: ${fileSizeMB} MB`);
        console.log(`⏱️ Duration: ${(frames.length / CONFIG.FPS).toFixed(1)} seconds`);
        console.log('\n🐦 Ready to upload to Twitter/X!');
        
        // Clean up files
        console.log('\n🧹 Cleaning up files...');
        await execAsync(
            `ssh -i ~/.ssh/id_ed25519_hetzner root@65.109.0.112 "rm -f /opt/heliosphere/twitter_frames.txt /opt/heliosphere/twitter_video.mp4"`
        );
        await fs.unlink(frameListPath).catch(() => {});

    } catch (error) {
        console.error('❌ Error generating video:', error.message);
        if (error.stderr) {
            console.error('stderr:', error.stderr);
        }
        process.exit(1);
    }
}

// Run if called directly
generateTwitterVideo();