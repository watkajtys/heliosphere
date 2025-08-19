#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
const execAsync = promisify(exec);

async function main() {
    console.log('🎬 Generating portrait video from full video...');
    
    const inputVideo = '/opt/heliosphere/videos/heliosphere_full_2025-08-19.mp4';
    const outputVideo = '/opt/heliosphere/videos/heliosphere_portrait_2025-08-19.mp4';
    
    // Crop center 675x1200 from 1460x1200 video
    const cropWidth = 675;
    const cropX = Math.floor((1460 - cropWidth) / 2);
    
    const ffmpegCmd = `ffmpeg -y -i "${inputVideo}" -vf "crop=${cropWidth}:1200:${cropX}:0" -c:v libx264 -preset fast -crf 20 "${outputVideo}"`;
    
    console.log('   Converting to 9:16 portrait format...');
    console.log(`   Input: ${inputVideo}`);
    console.log(`   Output: ${outputVideo}`);
    
    try {
        await execAsync(ffmpegCmd, { maxBuffer: 100 * 1024 * 1024 });
        
        const stats = await fs.stat(outputVideo);
        console.log(`   ✓ Generated: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log('✅ Portrait video created successfully!');
    } catch (error) {
        console.error('❌ Failed:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);