#!/usr/bin/env node

/**
 * Generate correct social (60 sec) and portrait (full, high quality) videos
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
const execAsync = promisify(exec);

const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    TEMP_DIR: '/tmp/heliosphere',
    FPS: 24,
    CRF_HIGH: 15,      // Very high quality
    CRF_SOCIAL: 18,    // High quality for social
    PRESET: 'veryslow'
};

// Get today's date
function getToday() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get all frames sorted
async function getAllFramesSorted() {
    console.log('📋 Collecting all frames...');
    
    const dirs = await fs.readdir(CONFIG.FRAMES_DIR);
    const dateDirs = dirs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    
    const allFrames = [];
    
    for (const dir of dateDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
        const files = await fs.readdir(dirPath);
        const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort();
        
        for (const file of jpgFiles) {
            allFrames.push(path.join(dirPath, file));
        }
    }
    
    console.log(`   Found ${allFrames.length} total frames`);
    return allFrames;
}

// Generate social video (60 seconds)
async function generateSocialVideo() {
    const allFrames = await getAllFramesSorted();
    const framesNeeded = 60 * CONFIG.FPS; // 60 seconds × 24 fps = 1440 frames
    
    // Take last 1440 frames for social
    const socialFrames = allFrames.slice(-framesNeeded);
    
    console.log(`\n📱 Generating Social Video (60 seconds)...`);
    console.log(`   Using last ${socialFrames.length} frames`);
    
    const today = getToday();
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_social_${today}.mp4`);
    
    // Create temp directory
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    
    // Create frames list file
    const framesFile = path.join(CONFIG.TEMP_DIR, 'social_frames.txt');
    const framesContent = socialFrames.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(framesFile, framesContent);
    
    // FFmpeg command with high quality
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${framesFile}" ` +
        `-c:v libx264 -preset ${CONFIG.PRESET} -crf ${CONFIG.CRF_SOCIAL} ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-r ${CONFIG.FPS} "${outputPath}"`;
    
    console.log(`   Output: ${outputPath}`);
    console.log(`   Duration: ${(socialFrames.length / CONFIG.FPS).toFixed(1)} seconds`);
    
    try {
        await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });
        const stats = await fs.stat(outputPath);
        console.log(`   ✓ Generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return outputPath;
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        throw error;
    }
}

// Generate portrait video (full length, high quality)
async function generatePortraitVideo() {
    const allFrames = await getAllFramesSorted();
    
    console.log(`\n📱 Generating Portrait Video (9:16, full length)...`);
    console.log(`   Using all ${allFrames.length} frames`);
    
    const today = getToday();
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_portrait_${today}.mp4`);
    
    // Create frames list file
    const framesFile = path.join(CONFIG.TEMP_DIR, 'portrait_frames.txt');
    const framesContent = allFrames.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(framesFile, framesContent);
    
    // Crop to 9:16 portrait (675x1200 from 1460x1200)
    const cropWidth = 675;
    const cropX = Math.floor((1460 - cropWidth) / 2);
    
    // FFmpeg command with very high quality
    const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${framesFile}" ` +
        `-vf "crop=${cropWidth}:1200:${cropX}:0" ` +
        `-c:v libx264 -preset ${CONFIG.PRESET} -crf ${CONFIG.CRF_HIGH} ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-r ${CONFIG.FPS} "${outputPath}"`;
    
    console.log(`   Output: ${outputPath}`);
    console.log(`   Duration: ${(allFrames.length / CONFIG.FPS).toFixed(1)} seconds`);
    console.log(`   Quality: CRF ${CONFIG.CRF_HIGH} (very high)`);
    
    try {
        await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });
        const stats = await fs.stat(outputPath);
        console.log(`   ✓ Generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        return outputPath;
    } catch (error) {
        console.error(`   ❌ Failed: ${error.message}`);
        throw error;
    }
}

// Main function
async function main() {
    try {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Generate Correct Videos              ║');
        console.log('╚════════════════════════════════════════╝');
        
        // Generate both videos
        const socialPath = await generateSocialVideo();
        const portraitPath = await generatePortraitVideo();
        
        console.log('\n✅ All videos generated successfully!');
        console.log('\n📺 Generated videos:');
        console.log(`   - Social (60s): ${socialPath}`);
        console.log(`   - Portrait (full): ${portraitPath}`);
        
        // Clean up temp files
        await fs.rm(CONFIG.TEMP_DIR, { recursive: true, force: true });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);