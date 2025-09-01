#!/usr/bin/env node

/**
 * Memory-Safe Recovery Script for Heliosphere Production
 * Resumes from existing state with minimal memory usage
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
    STATE_FILE: '/opt/heliosphere/production_state.json',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    BATCH_SIZE: 20,  // Process in small batches
    MEMORY_CHECK_INTERVAL: 10,  // Check memory every N frames
    MAX_MEMORY_MB: 2500,  // Max memory usage before pause (MB)
    PAUSE_DURATION: 30000,  // Pause for 30 seconds when memory high
};

async function getMemoryUsage() {
    const memUsage = process.memoryUsage();
    return {
        rss: memUsage.rss / 1024 / 1024,
        heap: memUsage.heapUsed / 1024 / 1024,
        total: memUsage.heapTotal / 1024 / 1024
    };
}

async function checkMemoryAndPause() {
    const mem = await getMemoryUsage();
    console.log(`💾 Memory: RSS=${mem.rss.toFixed(0)}MB, Heap=${mem.heap.toFixed(0)}MB/${mem.total.toFixed(0)}MB`);
    
    if (mem.rss > CONFIG.MAX_MEMORY_MB) {
        console.log(`⚠️ Memory usage high (${mem.rss.toFixed(0)}MB), pausing for ${CONFIG.PAUSE_DURATION/1000}s...`);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log('🔄 Forced garbage collection');
        }
        
        await new Promise(resolve => setTimeout(resolve, CONFIG.PAUSE_DURATION));
        
        const newMem = await getMemoryUsage();
        console.log(`✅ Resumed. Memory now: ${newMem.rss.toFixed(0)}MB`);
    }
}

async function loadState() {
    try {
        const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        console.log(`📋 Loaded state: ${state.processedFrames} frames processed`);
        return state;
    } catch (error) {
        console.error('❌ Failed to load state:', error.message);
        process.exit(1);
    }
}

async function loadManifest() {
    try {
        const data = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf8');
        const manifest = JSON.parse(data);
        console.log(`📊 Loaded manifest with ${Object.keys(manifest).length} frames`);
        return manifest;
    } catch (error) {
        console.log('⚠️ No manifest found, will rebuild from frames directory');
        return {};
    }
}

async function findMissingFrames(manifest, totalFrames) {
    const missing = [];
    for (let i = 0; i < totalFrames; i++) {
        const frameKey = `frame_${String(i).padStart(4, '0')}`;
        if (!manifest[frameKey]) {
            missing.push(i);
        }
    }
    return missing;
}

async function verifyFrames() {
    console.log('\n🔍 Verifying existing frames...');
    
    const state = await loadState();
    const manifest = await loadManifest();
    
    // Calculate expected total frames
    const totalFrames = state.totalFrames || 5376;  // 56 days * 96 frames/day
    
    // Find missing frames
    const missing = await findMissingFrames(manifest, totalFrames);
    
    console.log(`📊 Frame Status:`);
    console.log(`   Total expected: ${totalFrames}`);
    console.log(`   Frames in manifest: ${Object.keys(manifest).length}`);
    console.log(`   Missing frames: ${missing.length}`);
    
    if (missing.length > 0) {
        console.log(`\n⚠️ Missing frame numbers (first 20):`, missing.slice(0, 20));
        
        // Save missing frames list
        await fs.writeFile(
            '/opt/heliosphere/missing_frames.json',
            JSON.stringify(missing, null, 2)
        );
        console.log(`💾 Full list saved to missing_frames.json`);
    }
    
    return { state, manifest, missing, totalFrames };
}

async function generateVideos() {
    console.log('\n🎬 Generating videos from existing frames...');
    
    try {
        // Check if frames exist
        const framesDirs = await fs.readdir(CONFIG.FRAMES_DIR);
        if (framesDirs.length === 0) {
            console.error('❌ No frame directories found');
            return false;
        }
        
        console.log(`📁 Found ${framesDirs.length} frame directories`);
        
        // Generate frame list file
        const frameListPath = path.join(CONFIG.FRAMES_DIR, 'frame_list.txt');
        let frameList = '';
        
        for (const dir of framesDirs.sort()) {
            const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
            const files = await fs.readdir(dirPath);
            
            for (const file of files.sort()) {
                if (file.endsWith('.jpg')) {
                    const framePath = path.join(dirPath, file);
                    frameList += `file '${framePath}'\n`;
                    frameList += `duration 0.041667\n`;  // 1/24 second per frame
                }
            }
        }
        
        await fs.writeFile(frameListPath, frameList);
        console.log(`📝 Created frame list with ${frameList.split('\n').filter(l => l.startsWith('file')).length} frames`);
        
        // Generate full video
        const fullVideoPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_full_recovery_${new Date().toISOString().split('T')[0]}.mp4`);
        console.log('\n🎥 Generating full video...');
        
        const ffmpegCmd = `ffmpeg -y -f concat -safe 0 -i "${frameListPath}" ` +
            `-c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p ` +
            `-vf "scale=1460:1200:flags=lanczos" ` +
            `-r 24 "${fullVideoPath}"`;
        
        const { stdout, stderr } = await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
        
        // Check if video was created
        const stats = await fs.stat(fullVideoPath);
        console.log(`✅ Video created: ${(stats.size / 1024 / 1024).toFixed(1)}MB`);
        
        return true;
    } catch (error) {
        console.error('❌ Video generation failed:', error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 Heliosphere Recovery Script');
    console.log('================================\n');
    
    // Check system memory
    const systemMem = await execAsync('free -m | grep Mem | awk \'{print $2, $3, $4}\'');
    const [total, used, free] = systemMem.stdout.trim().split(' ').map(Number);
    console.log(`💻 System Memory: ${total}MB total, ${used}MB used, ${free}MB free\n`);
    
    // Verify frames
    const { state, manifest, missing, totalFrames } = await verifyFrames();
    
    // Decision tree
    console.log('\n📋 Recovery Options:');
    console.log('1. Generate videos from existing frames');
    console.log('2. Resume frame fetching (if missing < 5%)');
    console.log('3. Full restart (if missing > 5%)');
    
    const missingPercent = (missing.length / totalFrames) * 100;
    
    if (missingPercent < 5) {
        console.log(`\n✅ Missing only ${missingPercent.toFixed(1)}% of frames, proceeding with video generation...`);
        
        // Generate videos
        const success = await generateVideos();
        
        if (success) {
            console.log('\n🎉 Recovery complete! Videos generated successfully.');
        } else {
            console.log('\n⚠️ Video generation had issues, please check manually.');
        }
    } else {
        console.log(`\n⚠️ Missing ${missingPercent.toFixed(1)}% of frames.`);
        console.log('Recommendation: Run the full production script with --resume flag');
        console.log('Command: pm2 start vps_production_unified.js --name heliosphere-prod -- --resume');
    }
    
    // Final memory check
    await checkMemoryAndPause();
    console.log('\n✨ Recovery script complete');
}

// Run with proper error handling
main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});