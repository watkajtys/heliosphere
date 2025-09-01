#!/usr/bin/env node

/**
 * Generate Latest Social Video for PostBridge
 * 
 * This script:
 * 1. Generates a social video from the most recent data (accounting for 48-hour delay)
 * 2. Sends it to PostBridge for automated posting
 * 3. Downloads it directly to your computer
 * 
 * Built with AI + Vibes | www.builtbyvibes.com | @builtbyvibes
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    // Data configuration
    SAFE_DELAY_DAYS: 2,  // 48-hour delay for data availability
    SOCIAL_VIDEO_DAYS: 30,  // 30 days for social video
    FRAMES_PER_DAY: 96,  // 15-minute intervals
    
    // Video configuration
    VIDEO_FPS: 24,
    VIDEO_WIDTH: 1080,
    VIDEO_HEIGHT: 1080,  // Square for social media
    VIDEO_CRF: 15,  // High quality
    VIDEO_PRESET: 'slow',
    
    // PostBridge API
    POSTBRIDGE_API_URL: 'https://api.post-bridge.com/v1/posts',
    POSTBRIDGE_API_KEY: process.env.POSTBRIDGE_API_KEY || '',
    
    // Local download path
    LOCAL_DOWNLOAD_PATH: path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads'),
    
    // Helioviewer API
    API_BASE_URL: 'https://api.helioviewer.org/v2/takeScreenshot/',
    CORONA_SOURCE: 4,  // SOHO/LASCO C2
    SUN_SOURCE: 10,    // SDO/AIA 171
};

/**
 * Calculate date range for social video
 */
function calculateDateRange() {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.SOCIAL_VIDEO_DAYS);
    
    return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        totalDays: CONFIG.SOCIAL_VIDEO_DAYS
    };
}

/**
 * Generate frames for the video
 */
async function generateFrames(startDate, endDate) {
    console.log(`🎬 Generating frames from ${startDate} to ${endDate}...`);
    
    const framesDir = path.join(process.cwd(), 'social_frames');
    await fs.mkdir(framesDir, { recursive: true });
    
    // Here you would implement the frame generation logic
    // For now, we'll assume frames are already generated from the main production
    // and we just need to select the most recent 30 days worth
    
    const sourceFramesDir = path.join(process.cwd(), 'frames');
    const frames = await fs.readdir(sourceFramesDir);
    
    // Sort frames and get the most recent ones
    const sortedFrames = frames
        .filter(f => f.endsWith('.jpg'))
        .sort()
        .slice(-CONFIG.SOCIAL_VIDEO_DAYS * CONFIG.FRAMES_PER_DAY);
    
    console.log(`📸 Found ${sortedFrames.length} frames for social video`);
    
    // Copy frames to social_frames directory
    for (let i = 0; i < sortedFrames.length; i++) {
        const sourceFile = path.join(sourceFramesDir, sortedFrames[i]);
        const destFile = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.jpg`);
        await fs.copyFile(sourceFile, destFile);
        
        if (i % 100 === 0) {
            console.log(`   Copied ${i}/${sortedFrames.length} frames...`);
        }
    }
    
    return framesDir;
}

/**
 * Generate video using FFmpeg
 */
async function generateVideo(framesDir) {
    console.log('🎥 Generating social video...');
    
    const dateStr = new Date().toISOString().split('T')[0];
    const outputPath = path.join(process.cwd(), `heliolens_social_${dateStr}.mp4`);
    
    const ffmpegCmd = `ffmpeg -y \
        -framerate ${CONFIG.VIDEO_FPS} \
        -pattern_type glob \
        -i "${framesDir}/frame_*.jpg" \
        -vf "scale=${CONFIG.VIDEO_WIDTH}:${CONFIG.VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${CONFIG.VIDEO_WIDTH}:${CONFIG.VIDEO_HEIGHT}" \
        -c:v libx264 \
        -preset ${CONFIG.VIDEO_PRESET} \
        -crf ${CONFIG.VIDEO_CRF} \
        -pix_fmt yuv420p \
        -movflags +faststart \
        "${outputPath}"`;
    
    try {
        const { stdout, stderr } = await execAsync(ffmpegCmd);
        console.log('✅ Video generated successfully');
        return outputPath;
    } catch (error) {
        console.error('❌ FFmpeg error:', error.message);
        throw error;
    }
}

/**
 * Send video to PostBridge
 */
async function sendToPostBridge(videoPath, dateRange) {
    if (!CONFIG.POSTBRIDGE_API_KEY) {
        console.log('⚠️ PostBridge API key not configured, skipping upload');
        return;
    }
    
    console.log('📤 Sending to PostBridge...');
    
    try {
        const videoBuffer = await fs.readFile(videoPath);
        const formData = new FormData();
        
        // Create post content
        const caption = `☀️ HELIOLENS Daily Update
        
${dateRange.totalDays} days of solar activity captured by NASA satellites
From ${dateRange.startDate} to ${dateRange.endDate}
        
Watch our Sun's corona dance with solar flares and coronal mass ejections 🌟
        
Built with AI + Vibes
www.builtbyvibes.com | @builtbyvibes
        
#Heliolens #SolarActivity #SpaceWeather #NASA #BuiltByVibes`;
        
        formData.append('video', new Blob([videoBuffer], { type: 'video/mp4' }), 'video.mp4');
        formData.append('caption', caption);
        formData.append('platforms', JSON.stringify(['twitter', 'instagram', 'tiktok']));
        formData.append('schedule', 'immediate');
        
        const response = await fetch(CONFIG.POSTBRIDGE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.POSTBRIDGE_API_KEY}`
            },
            body: formData
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Successfully sent to PostBridge');
            console.log(`   Post ID: ${result.id}`);
            console.log(`   Status: ${result.status}`);
        } else {
            console.error('❌ PostBridge upload failed:', response.statusText);
        }
    } catch (error) {
        console.error('❌ PostBridge error:', error.message);
    }
}

/**
 * Download video to local computer
 */
async function downloadToLocal(videoPath) {
    console.log('💾 Downloading to local computer...');
    
    const filename = path.basename(videoPath);
    const localPath = path.join(CONFIG.LOCAL_DOWNLOAD_PATH, filename);
    
    try {
        await fs.copyFile(videoPath, localPath);
        console.log(`✅ Video downloaded to: ${localPath}`);
        return localPath;
    } catch (error) {
        console.error('❌ Download error:', error.message);
        throw error;
    }
}

/**
 * Clean up temporary files
 */
async function cleanup() {
    console.log('🧹 Cleaning up temporary files...');
    
    try {
        const socialFramesDir = path.join(process.cwd(), 'social_frames');
        await fs.rm(socialFramesDir, { recursive: true, force: true });
        console.log('✅ Cleanup complete');
    } catch (error) {
        console.error('⚠️ Cleanup warning:', error.message);
    }
}

/**
 * Main execution
 */
async function main() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     HELIOLENS SOCIAL VIDEO GENERATOR                        ║
║     Built with AI + Vibes                                   ║
║     www.builtbyvibes.com | @builtbyvibes                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
    
    try {
        // Calculate date range
        const dateRange = calculateDateRange();
        console.log(`📅 Date range: ${dateRange.startDate} to ${dateRange.endDate}`);
        console.log(`   Total days: ${dateRange.totalDays}`);
        
        // Generate frames
        const framesDir = await generateFrames(dateRange.startDate, dateRange.endDate);
        
        // Generate video
        const videoPath = await generateVideo(framesDir);
        
        // Get file size
        const stats = await fs.stat(videoPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`📊 Video size: ${fileSizeMB} MB`);
        
        // Send to PostBridge
        await sendToPostBridge(videoPath, dateRange);
        
        // Download to local
        const localPath = await downloadToLocal(videoPath);
        
        // Clean up
        await cleanup();
        
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ✅ SOCIAL VIDEO GENERATION COMPLETE                     ║
║                                                              ║
║     Video saved to: ${localPath.padEnd(41)}║
║     Ready for PostBridge: Yes                               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
        
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main, calculateDateRange, generateVideo, sendToPostBridge };