#!/usr/bin/env node

/**
 * Automated Twitter posting for Heliosphere daily pipeline
 * Generates 60-second video and posts to Twitter via PostBridge
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import fsSync from 'fs';
import https from 'https';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    TEMP_DIR: '/opt/heliosphere/temp',
    FPS: 24,
    TWITTER_DAYS: 15,  // 15 days = 60 seconds at 24fps
    
    // PostBridge API
    API_KEY: '3ZgMcYiuv8Exs4xbC4KBnMX1',
    API_BASE: 'https://api.post-bridge.com/v1',
    TWITTER_ACCOUNT_ID: 28180  // @Heliolens
};

// HTTP request helper for PostBridge
function httpsRequest(url, options, body = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 300000 // 5 minute timeout
        };
        
        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = data ? JSON.parse(data) : {};
                    resolve({ 
                        ok: res.statusCode >= 200 && res.statusCode < 300, 
                        data: result, 
                        status: res.statusCode 
                    });
                } catch (e) {
                    resolve({ 
                        ok: res.statusCode < 300, 
                        data: data, 
                        status: res.statusCode 
                    });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (body) req.write(body);
        req.end();
    });
}

// Generate 60-second Twitter video
async function generateTwitterVideo() {
    console.log('🎬 Generating 60-second Twitter video...');
    
    // Ensure directories exist
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    
    // Get all frame directories
    const frameDirs = await fs.readdir(CONFIG.FRAMES_DIR);
    frameDirs.sort();
    
    const allFrames = [];
    for (const dir of frameDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
        const stat = await fs.stat(dirPath);
        
        if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort();
            
            for (const file of jpgFiles) {
                allFrames.push(`file '${path.join(dirPath, file)}'`);
            }
        }
    }
    
    // Get last 15 days for 60-second video
    const twitterFrames = allFrames.slice(-(CONFIG.TWITTER_DAYS * 96));
    console.log(`   Using ${twitterFrames.length} frames (${CONFIG.TWITTER_DAYS} days)`);
    
    if (twitterFrames.length === 0) {
        throw new Error('No frames found for video generation');
    }
    
    // Write frame list
    const frameListPath = path.join(CONFIG.TEMP_DIR, 'twitter_auto_frames.txt');
    await fs.writeFile(frameListPath, twitterFrames.join('\n'));
    
    const dateStr = new Date().toISOString().split('T')[0];
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_twitter_auto_${dateStr}.mp4`);
    
    // Generate H.264 MP4 optimized for Twitter
    const ffmpegCommand = `ffmpeg -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-vf "crop=1080:1080:190:60" ` +
        `-c:v libx264 -preset faster -crf 23 ` +
        `-pix_fmt yuv420p -movflags +faststart ` +
        `-metadata title="Heliolens Solar Activity" ` +
        `"${outputPath}"`;
    
    console.log('   Encoding H.264 MP4 (1080x1080)...');
    const startTime = Date.now();
    
    try {
        await execAsync(ffmpegCommand, { 
            timeout: 300000,  // 5 minute timeout
            maxBuffer: 10 * 1024 * 1024
        });
        
        const elapsed = (Date.now() - startTime) / 1000;
        const stats = await fs.stat(outputPath);
        
        console.log(`   ✅ Video generated in ${elapsed.toFixed(1)}s`);
        console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Clean up temp file
        await fs.unlink(frameListPath).catch(() => {});
        
        return outputPath;
        
    } catch (error) {
        console.error('   ❌ Video generation failed:', error.message);
        throw error;
    }
}

// Upload video to PostBridge
async function uploadToPostBridge(videoPath) {
    console.log('📤 Uploading to PostBridge...');
    
    const stats = fsSync.statSync(videoPath);
    const fileName = path.basename(videoPath);
    
    console.log(`   File: ${fileName}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 1: Create upload URL
    const uploadUrlResponse = await httpsRequest(
        `${CONFIG.API_BASE}/media/create-upload-url`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.API_KEY}`,
                'Content-Type': 'application/json'
            }
        },
        JSON.stringify({
            mime_type: 'video/mp4',
            size_bytes: stats.size,
            name: fileName
        })
    );
    
    if (!uploadUrlResponse.ok) {
        throw new Error(`Failed to create upload URL: ${JSON.stringify(uploadUrlResponse.data)}`);
    }
    
    const uploadData = uploadUrlResponse.data;
    console.log(`   Media ID: ${uploadData.media_id}`);
    
    // Step 2: Upload the video
    const videoBuffer = fsSync.readFileSync(videoPath);
    
    return new Promise((resolve, reject) => {
        const uploadUrl = new URL(uploadData.upload_url);
        const reqOptions = {
            hostname: uploadUrl.hostname,
            path: uploadUrl.pathname + uploadUrl.search,
            method: 'PUT',
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': videoBuffer.length
            },
            timeout: 600000 // 10 minute timeout
        };
        
        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('   ✅ Upload successful');
                    resolve(uploadData.media_id);
                } else {
                    reject(new Error(`Upload failed with status ${res.statusCode}`));
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Upload timeout'));
        });
        
        // Upload with progress tracking
        let uploaded = 0;
        const chunkSize = 1024 * 1024; // 1MB chunks
        const totalChunks = Math.ceil(videoBuffer.length / chunkSize);
        
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, videoBuffer.length);
            const chunk = videoBuffer.slice(start, end);
            
            req.write(chunk);
            uploaded += chunk.length;
            
            if (i % 5 === 0 || i === totalChunks - 1) {
                const percent = ((uploaded / videoBuffer.length) * 100).toFixed(1);
                process.stdout.write(`\r   Upload progress: ${percent}%`);
            }
        }
        
        console.log(''); // New line after progress
        req.end();
    });
}

// Create Twitter post
async function createTwitterPost(mediaId) {
    console.log('📝 Creating Twitter post...');
    
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
    });
    
    // Daily caption
    const caption = `☀️ ${CONFIG.TWITTER_DAYS} days of solar activity through ${dateStr}

Watch our Sun's corona dance with solar winds and CMEs in this NASA satellite timelapse.

Daily updates at heliolens.builtbyvibes.com

#SolarActivity #SpaceWeather #NASA #Heliolens`;
    
    console.log(`   Caption: ${caption.length} chars`);
    
    const response = await httpsRequest(
        `${CONFIG.API_BASE}/posts`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CONFIG.API_KEY}`,
                'Content-Type': 'application/json'
            }
        },
        JSON.stringify({
            social_accounts: [CONFIG.TWITTER_ACCOUNT_ID],
            media: [mediaId],
            caption: caption
        })
    );
    
    if (!response.ok) {
        throw new Error(`Failed to create post: ${JSON.stringify(response.data)}`);
    }
    
    console.log(`   ✅ Post created: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    
    return response.data;
}

// Main automation function
async function main() {
    console.log('🐦 Heliosphere Twitter Auto-Post');
    console.log('==================================');
    console.log(`📅 Date: ${new Date().toISOString()}\n`);
    
    try {
        // 1. Generate 60-second video
        const videoPath = await generateTwitterVideo();
        
        // 2. Upload to PostBridge
        const mediaId = await uploadToPostBridge(videoPath);
        
        // 3. Create Twitter post
        const post = await createTwitterPost(mediaId);
        
        console.log('\n✅ Twitter post scheduled successfully!');
        console.log(`🔗 PostBridge: https://app.post-bridge.com/posts/${post.id}`);
        console.log(`🐦 Will appear on @Heliolens timeline`);
        
        // Clean up video file to save space (optional)
        // await fs.unlink(videoPath).catch(() => {});
        
    } catch (error) {
        console.error('\n❌ Twitter auto-post failed:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        // Don't exit with error to not break the pipeline
        // Just log the error and continue
    }
    
    console.log('\n==================================');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Fatal error:', error);
        // Don't exit with error code to not break pipeline
    });
}

export { main as postToTwitter };