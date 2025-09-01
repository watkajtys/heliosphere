#!/usr/bin/env node

/**
 * Generate Latest Social Video and Download Locally
 * 
 * This script:
 * 1. Connects to VPS to generate social video with latest data
 * 2. Downloads it to your local computer
 * 3. Optionally posts to social media via PostBridge
 * 
 * Built with AI + Vibes | www.builtbyvibes.com | @builtbyvibes
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);

const CONFIG = {
    VPS_HOST: process.env.VPS_HOST || '65.109.0.112',
    VPS_USER: process.env.VPS_USER || 'root',
    LOCAL_DOWNLOAD_PATH: path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads'),
    SAFE_DELAY_DAYS: 2,  // 48-hour delay for data availability
    SOCIAL_VIDEO_DAYS: 30,  // 30 days for social video
};

/**
 * Generate social video on VPS with latest data
 */
async function generateSocialVideoOnVPS() {
    console.log('🚀 Generating social video on VPS with latest data...');
    
    // Calculate date range
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.SOCIAL_VIDEO_DAYS);
    
    const endDateStr = endDate.toISOString().split('T')[0];
    const startDateStr = startDate.toISOString().split('T')[0];
    const outputFileName = `heliolens_social_${endDateStr}.mp4`;
    
    console.log(`📅 Date range: ${startDateStr} to ${endDateStr}`);
    
    // SSH command to generate video on VPS
    const sshCommand = `ssh ${CONFIG.VPS_USER}@${CONFIG.VPS_HOST} "cd /opt/heliolens && node generate_social_video.js --start ${startDateStr} --end ${endDateStr} --output ${outputFileName}"`;
    
    try {
        console.log('⏳ This may take a few minutes...');
        const { stdout, stderr } = await execAsync(sshCommand, {
            maxBuffer: 10 * 1024 * 1024
        });
        
        if (stdout) console.log(stdout);
        if (stderr && !stderr.includes('Warning')) console.error('⚠️', stderr);
        
        console.log('✅ Social video generated on VPS');
        return outputFileName;
        
    } catch (error) {
        // If the generate script doesn't exist, try using existing frames
        console.log('⚠️ Trying alternative method...');
        return await generateFromExistingFrames(startDateStr, endDateStr);
    }
}

/**
 * Alternative: Generate video from existing frames on VPS
 */
async function generateFromExistingFrames(startDateStr, endDateStr) {
    console.log('📸 Generating from existing frames on VPS...');
    
    const outputFileName = `heliolens_social_${endDateStr}.mp4`;
    
    // Create ffmpeg command to generate video from latest frames
    const ffmpegCommand = `
        cd /opt/heliolens && \\
        ls frames/frame_*.jpg | tail -n 2880 > social_frames.txt && \\
        ffmpeg -y -r 24 -f concat -safe 0 -i <(awk '{print "file '\\''"\$0"'\\''"}' social_frames.txt) \\
        -vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080" \\
        -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p \\
        -movflags +faststart \\
        /opt/heliolens/videos/${outputFileName} && \\
        rm social_frames.txt
    `;
    
    const sshCommand = `ssh ${CONFIG.VPS_USER}@${CONFIG.VPS_HOST} 'bash -c "${ffmpegCommand}"'`;
    
    try {
        const { stdout, stderr } = await execAsync(sshCommand, {
            maxBuffer: 10 * 1024 * 1024
        });
        
        console.log('✅ Video generated from existing frames');
        return outputFileName;
        
    } catch (error) {
        console.error('❌ Failed to generate video:', error.message);
        throw error;
    }
}

/**
 * Download video from VPS to local computer
 */
async function downloadVideo(fileName) {
    console.log('💾 Downloading video to local computer...');
    
    const remotePath = `/opt/heliolens/videos/${fileName}`;
    const localPath = path.join(CONFIG.LOCAL_DOWNLOAD_PATH, fileName);
    
    // SCP command to download
    const scpCommand = `scp ${CONFIG.VPS_USER}@${CONFIG.VPS_HOST}:${remotePath} "${localPath}"`;
    
    try {
        const { stdout, stderr } = await execAsync(scpCommand);
        
        // Check file exists and get size
        const stats = await fs.stat(localPath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ Downloaded: ${localPath}`);
        console.log(`   File size: ${fileSizeMB} MB`);
        
        return localPath;
        
    } catch (error) {
        console.error('❌ Download failed:', error.message);
        throw error;
    }
}

/**
 * Post to social media via PostBridge
 */
async function postToSocialMedia(videoPath) {
    console.log('📤 Posting to social media...');
    
    try {
        // Use the existing post_to_twitter.js script
        const { stdout, stderr } = await execAsync(`node post_to_twitter.js "${videoPath}"`);
        
        if (stdout) console.log(stdout);
        if (stderr && !stderr.includes('Warning')) console.error(stderr);
        
    } catch (error) {
        console.error('⚠️ Social media posting failed:', error.message);
        console.log('   You can manually post the video from:', videoPath);
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
        // Step 1: Generate video on VPS
        const fileName = await generateSocialVideoOnVPS();
        
        // Step 2: Download to local computer
        const localPath = await downloadVideo(fileName);
        
        // Step 3: Optionally post to social media
        const shouldPost = process.argv.includes('--post');
        if (shouldPost) {
            await postToSocialMedia(localPath);
        }
        
        console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ✅ SOCIAL VIDEO READY                                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

📹 Video saved to: ${localPath}

To post to social media, run:
   node post_to_twitter.js "${localPath}"

Or use --post flag:
   node generate_and_download_social.js --post
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

export { generateSocialVideoOnVPS, downloadVideo };