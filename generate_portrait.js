#\!/usr/bin/env node

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
    TOTAL_DAYS: 56
};

async function getAllFrames() {
    console.log('📊 Collecting all frames...');
    const frames = [];
    
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
    return frames;
}

async function generatePortraitVideo(frames) {
    console.log(`\n🎬 Generating heliosphere_portrait (56 days, vertical crop)...`);
    const startTime = Date.now();
    
    const framesPerDay = 96;
    const totalFramesNeeded = CONFIG.TOTAL_DAYS * framesPerDay;
    const videoFrames = frames.slice(-totalFramesNeeded);
    
    // IMPORTANT: Reverse to play chronologically
    videoFrames.reverse();
    
    console.log(`  Using ${videoFrames.length} frames`);
    console.log(`  Duration: ${(videoFrames.length / CONFIG.FPS).toFixed(1)} seconds`);
    
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    const frameListPath = path.join(CONFIG.TEMP_DIR, 'portrait_frames.txt');
    const frameList = videoFrames.map(f => `file '${f}'`).join('\n');
    await fs.writeFile(frameListPath, frameList);
    
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_portrait_${new Date().toISOString().split('T')[0]}.mov`);
    
    // Portrait crop: Center crop to 900x1200 (3:4 aspect ratio)
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-vf "crop=900:1200:280:0" ` +
        `-c:v mjpeg -q:v 1 "${outputPath}"`;
    
    console.log('  Running FFmpeg (MJPEG lossless, portrait crop)...');
    
    try {
        await execAsync(ffmpegCommand);
        const stats = await fs.stat(outputPath);
        const elapsed = (Date.now() - startTime) / 1000;
        
        console.log(`✓ Portrait video generated in ${elapsed.toFixed(1)} seconds\!`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        return outputPath;
    } catch (error) {
        console.error(`❌ Failed:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 Portrait Video Generation\n');
    
    const frames = await getAllFrames();
    const portraitVideo = await generatePortraitVideo(frames);
    
    if (portraitVideo) {
        console.log(`\n✅ Portrait video ready at: ${portraitVideo}`);
    }
}

main().catch(console.error);
EOF < /dev/null
