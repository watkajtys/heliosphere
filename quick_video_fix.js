#!/usr/bin/env node

/**
 * Quick video regeneration with MJPEG lossless format
 * Should take only 5 minutes total for both videos!
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    TEMP_DIR: '/tmp/heliosphere',
    FPS: 24,
    TOTAL_DAYS: 56,
    SOCIAL_DAYS: 30
};

async function getAllFrames() {
    console.log('📊 Collecting all frames...');
    const frames = [];
    
    // Get all frame directories
    const dirs = await fs.readdir(CONFIG.FRAMES_DIR);
    const frameDirs = dirs.filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/)).sort();
    
    for (const dir of frameDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
        const files = await fs.readdir(dirPath);
        const frameFiles = files.filter(f => f.endsWith('.jpg')).sort();
        
        for (const file of frameFiles) {
            frames.push(path.join(dirPath, file));
        }
    }
    
    console.log(`✓ Found ${frames.length} total frames`);
    console.log(`  First: ${path.basename(path.dirname(frames[0]))}`);
    console.log(`  Last: ${path.basename(path.dirname(frames[frames.length - 1]))}`);
    
    return frames;
}

async function generateVideo(frames, days, outputName) {
    console.log(`\n🎬 Generating ${outputName} (${days} days)...`);
    const startTime = Date.now();
    
    // Calculate how many frames to use
    const framesPerDay = 96;
    const totalFramesNeeded = days * framesPerDay;
    
    // Take the most recent frames
    const videoFrames = frames.slice(-totalFramesNeeded);
    
    // IMPORTANT: Reverse to play chronologically (oldest to newest)
    // videoFrames.reverse() - Disabled to play newest to oldest;
    
    console.log(`  Using ${videoFrames.length} frames`);
    console.log(`  Duration: ${(videoFrames.length / CONFIG.FPS).toFixed(1)} seconds`);
    
    // Create frame list file
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    const frameListPath = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    const frameList = videoFrames.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(frameListPath, frameList);
    
    // Generate video with MJPEG (lossless and FAST!)
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${new Date().toISOString().split('T')[0]}.mov`);
    
    // MJPEG command - just packages JPEGs, no re-encoding!
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-c:v mjpeg -q:v 1 "${outputPath}"`;
    
    console.log('  Running FFmpeg (MJPEG lossless)...');
    
    try {
        await execAsync(ffmpegCommand);
        const stats = await fs.stat(outputPath);
        const elapsed = (Date.now() - startTime) / 1000;
        
        console.log(`✓ Video generated in ${elapsed.toFixed(1)} seconds!`);
        console.log(`  Output: ${outputPath}`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        return outputPath;
    } catch (error) {
        console.error(`❌ Failed to generate ${outputName}:`, error.message);
        return null;
    }
}

async function uploadToCloudflare(videoPath, type) {
    console.log(`\n☁️ Uploading ${type} to Cloudflare...`);
    
    try {
        const uploadCommand = `cd /opt/heliosphere && export $(grep -v '^#' .env | xargs) && ` +
            `node cloudflare_tus_upload.js "${videoPath}" ${type}`;
        
        const { stdout } = await execAsync(uploadCommand);
        
        // Extract video ID from output
        const idMatch = stdout.match(/Video ID: ([a-f0-9]+)/);
        if (idMatch) {
            const videoId = idMatch[1].replace('?tusv2=true', '');
            console.log(`✓ Uploaded! Video ID: ${videoId}`);
            return videoId;
        }
        
        console.log(stdout);
        return null;
    } catch (error) {
        console.error(`❌ Upload failed:`, error.message);
        return null;
    }
}

async function updateWebsite(fullId, socialId) {
    console.log('\n🌐 Updating website...');
    
    try {
        const updateCommand = `cd /opt/heliosphere && export $(grep -v '^#' .env | xargs) && ` +
            `node update_website.js ${fullId} ${socialId}`;
        
        await execAsync(updateCommand);
        console.log('✓ Website updated!');
    } catch (error) {
        console.error('❌ Website update failed:', error.message);
    }
}

async function main() {
    console.log('🚀 Quick Video Fix - MJPEG Lossless Generation\n');
    console.log('This should take only 5-10 minutes total!\n');
    
    // Get all frames
    const frames = await getAllFrames();
    
    // Generate videos (FAST with MJPEG!)
    const fullVideo = await generateVideo(frames, CONFIG.TOTAL_DAYS, 'heliosphere_full');
    const socialVideo = await generateVideo(frames, CONFIG.SOCIAL_DAYS, 'heliosphere_social');
    
    if (!fullVideo || !socialVideo) {
        console.error('❌ Video generation failed');
        return;
    }
    
    // Upload to Cloudflare
    const fullId = await uploadToCloudflare(fullVideo, 'full');
    const socialId = await uploadToCloudflare(socialVideo, 'social');
    
    if (fullId && socialId) {
        // Update website
        await updateWebsite(fullId, socialId);
        
        console.log('\n✅ Complete! New videos are live:');
        console.log(`   Full: https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/iframe`);
        console.log(`   Social: https://customer-931z4aajcqul6afi.cloudflarestream.com/${socialId}/iframe`);
    }
}

main().catch(console.error);