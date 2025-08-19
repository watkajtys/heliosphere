#!/usr/bin/env node

/**
 * Generate missing social and portrait videos from existing frames
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
    CRF: 18,
    PRESET: 'veryslow',
    SOCIAL_DAYS: 7,
    TOTAL_DAYS: 56,
    FRAMES_PER_DAY: 96
};

// Get today's date
function getToday() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Get list of frames for video generation
async function getFramesList(days) {
    const totalFrames = CONFIG.TOTAL_DAYS * CONFIG.FRAMES_PER_DAY;
    const socialFrames = days * CONFIG.FRAMES_PER_DAY;
    const startFrame = totalFrames - socialFrames;
    
    console.log(`📋 Preparing ${socialFrames} frames (last ${days} days)`);
    
    const frames = [];
    for (let i = startFrame; i < totalFrames; i++) {
        const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${String(i).padStart(5, '0')}.jpg`);
        if (await fileExists(framePath)) {
            frames.push(framePath);
        }
    }
    
    console.log(`   Found ${frames.length} frames`);
    return frames;
}

// Check if file exists
async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

// Generate video using FFmpeg
async function generateVideo(frames, outputName, aspectRatio = '73:60') {
    const today = getToday();
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${today}.mp4`);
    
    // Create temp directory
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    
    // Create frames list file
    const framesFile = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    const framesContent = frames.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(framesFile, framesContent);
    
    console.log(`\n🎬 Generating ${outputName} video...`);
    console.log(`   Output: ${outputPath}`);
    console.log(`   Frames: ${frames.length}`);
    console.log(`   Duration: ${(frames.length / CONFIG.FPS).toFixed(1)} seconds`);
    console.log(`   Aspect ratio: ${aspectRatio}`);
    
    // Build FFmpeg command
    let ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${framesFile}" `;
    
    // Add aspect ratio adjustment for portrait
    if (outputName === 'heliosphere_portrait') {
        // Crop to 9:16 portrait (675x1200 from 1460x1200)
        const cropWidth = 675;
        const cropX = Math.floor((1460 - cropWidth) / 2);
        ffmpegCmd += `-vf "crop=${cropWidth}:1200:${cropX}:0" `;
    }
    
    ffmpegCmd += `-c:v libx264 -preset ${CONFIG.PRESET} -crf ${CONFIG.CRF} `;
    ffmpegCmd += `-pix_fmt yuv420p -movflags +faststart `;
    ffmpegCmd += `-r ${CONFIG.FPS} "${outputPath}"`;
    
    try {
        const { stdout, stderr } = await execAsync(ffmpegCmd, {
            maxBuffer: 50 * 1024 * 1024
        });
        
        // Get file size
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
        console.log('║   Generate Missing Videos              ║');
        console.log('╚════════════════════════════════════════╝');
        
        // Check if full frames exist
        const fullFramesExist = await fileExists(path.join(CONFIG.FRAMES_DIR, 'frame_05375.jpg'));
        if (!fullFramesExist) {
            console.error('❌ Full frames not found. Run production first.');
            process.exit(1);
        }
        
        // Generate social video (7 days)
        console.log('\n📱 Generating Social Video (7 days)...');
        const socialFrames = await getFramesList(CONFIG.SOCIAL_DAYS);
        const socialPath = await generateVideo(socialFrames, 'heliosphere_social');
        
        // Generate portrait video (full 56 days, 9:16 aspect)
        console.log('\n📱 Generating Portrait Video (9:16)...');
        const fullFrames = await getFramesList(CONFIG.TOTAL_DAYS);
        const portraitPath = await generateVideo(fullFrames, 'heliosphere_portrait', '9:16');
        
        console.log('\n✅ All videos generated successfully!');
        console.log('\n📺 Generated videos:');
        console.log(`   - ${socialPath}`);
        console.log(`   - ${portraitPath}`);
        
        // Clean up temp files
        await fs.rm(CONFIG.TEMP_DIR, { recursive: true, force: true });
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
main().catch(console.error);

export { generateVideo, getFramesList };