#!/usr/bin/env node

/**
 * Generate preview social video from available recent frames
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
    FPS: 24,
    CRF: 15,  // High quality
};

async function generatePreviewVideo() {
    console.log('🎬 Generating preview video from available frames...\n');
    
    try {
        // Get all available frames
        const frameDirs = await fs.readdir(CONFIG.FRAMES_DIR);
        const sortedDirs = frameDirs.sort().reverse(); // Most recent first
        
        console.log(`📁 Found ${sortedDirs.length} date directories`);
        
        // Collect all frame paths
        const framePaths = [];
        let totalFrames = 0;
        
        for (const dir of sortedDirs) {
            const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
            const stats = await fs.stat(dirPath);
            
            if (stats.isDirectory()) {
                const files = await fs.readdir(dirPath);
                const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort();
                
                for (const file of jpgFiles) {
                    framePaths.push(path.join(dirPath, file));
                    totalFrames++;
                }
                
                console.log(`   ${dir}: ${jpgFiles.length} frames`);
            }
        }
        
        if (totalFrames < 48) {
            console.log(`\n⚠️ Only ${totalFrames} frames available. Need at least 48 (12 hours) for a meaningful video.`);
            return;
        }
        
        console.log(`\n📊 Total frames available: ${totalFrames}`);
        const durationSeconds = totalFrames / CONFIG.FPS;
        console.log(`⏱️ Video duration: ${durationSeconds.toFixed(1)} seconds`);
        
        // Create frame list file for ffmpeg
        const frameListPath = path.join(CONFIG.VIDEOS_DIR, 'preview_frames.txt');
        let frameListContent = '';
        
        for (const framePath of framePaths) {
            frameListContent += `file '${framePath}'\n`;
            frameListContent += `duration ${1/CONFIG.FPS}\n`;
        }
        
        // Add last frame again (ffmpeg requirement)
        if (framePaths.length > 0) {
            frameListContent += `file '${framePaths[framePaths.length - 1]}'\n`;
        }
        
        await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
        await fs.writeFile(frameListPath, frameListContent);
        
        // Generate preview video
        const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_preview_${new Date().toISOString().split('T')[0]}.mp4`);
        
        console.log('\n🎥 Generating preview video...');
        
        const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${frameListPath}" ` +
            `-c:v libx264 -preset slow -crf ${CONFIG.CRF} -pix_fmt yuv420p ` +
            `-vf "scale=1200:1200:flags=lanczos,crop=1200:1200" ` +
            `-r ${CONFIG.FPS} "${outputPath}"`;
        
        const { stdout, stderr } = await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
        
        // Check if video was created
        const stats = await fs.stat(outputPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        
        console.log(`\n✅ Preview video created!`);
        console.log(`   Path: ${outputPath}`);
        console.log(`   Size: ${sizeMB}MB`);
        console.log(`   Duration: ${durationSeconds.toFixed(1)}s`);
        console.log(`   Frames: ${totalFrames}`);
        
        // Clean up temp file
        await fs.unlink(frameListPath);
        
        // Generate a social square version too (cropped)
        const socialPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_social_preview_${new Date().toISOString().split('T')[0]}.mp4`);
        
        console.log('\n🎥 Generating social square version...');
        
        const socialCmd = `ffmpeg -y -i "${outputPath}" ` +
            `-vf "crop=1200:1200:130:0" ` +
            `-c:v libx264 -preset slow -crf ${CONFIG.CRF} -pix_fmt yuv420p ` +
            `"${socialPath}"`;
        
        await execAsync(socialCmd, { maxBuffer: 10 * 1024 * 1024 });
        
        const socialStats = await fs.stat(socialPath);
        const socialSizeMB = (socialStats.size / 1024 / 1024).toFixed(1);
        
        console.log(`\n✅ Social square video created!`);
        console.log(`   Path: ${socialPath}`);
        console.log(`   Size: ${socialSizeMB}MB`);
        console.log(`   Aspect: 1:1 (perfect for Instagram/Twitter)`);
        
        console.log('\n🎉 Preview videos ready!');
        console.log(`\nView at:`);
        console.log(`   http://65.109.0.112:8080/videos/`);
        
    } catch (error) {
        console.error('❌ Error generating video:', error.message);
        process.exit(1);
    }
}

// Run
generatePreviewVideo().catch(console.error);