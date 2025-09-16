#!/usr/bin/env node

/**
 * Direct PostBridge API upload with better error handling
 */

import fs from 'fs';
import https from 'https';
import { URL } from 'url';
import path from 'path';

const API_KEY = '3ZgMcYiuv8Exs4xbC4KBnMX1';
const API_BASE = 'https://api.post-bridge.com/v1';
const TWITTER_ACCOUNT_ID = 28180; // @Heliolens

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
        
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function uploadVideoInChunks(filePath) {
    console.log('📤 Starting PostBridge upload...');
    
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    
    console.log(`   File: ${fileName}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 1: Create upload URL
    console.log('\n1️⃣ Creating upload URL...');
    const uploadUrlResponse = await httpsRequest(
        `${API_BASE}/media/create-upload-url`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
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
        console.error('Response:', uploadUrlResponse);
        throw new Error(`Failed to create upload URL: ${JSON.stringify(uploadUrlResponse.data)}`);
    }
    
    const uploadData = uploadUrlResponse.data;
    console.log('✅ Upload URL created');
    console.log(`   Media ID: ${uploadData.media_id}`);
    
    // Step 2: Upload the video
    console.log('\n2️⃣ Uploading video file...');
    console.log('   Reading file into memory...');
    const videoBuffer = fs.readFileSync(filePath);
    console.log(`   Loaded ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('   Uploading to PostBridge CDN...');
    const uploadUrl = new URL(uploadData.upload_url);
    
    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: uploadUrl.hostname,
            path: uploadUrl.pathname + uploadUrl.search,
            method: 'PUT',
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': videoBuffer.length
            },
            timeout: 600000 // 10 minute timeout for upload
        };
        
        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('✅ Video uploaded successfully!');
                    resolve(uploadData.media_id);
                } else {
                    reject(new Error(`Upload failed with status ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', (err) => {
            console.error('Upload error:', err.message);
            reject(err);
        });
        
        req.on('timeout', () => {
            console.error('❌ Upload timeout after 10 minutes');
            req.destroy();
            reject(new Error('Upload timeout'));
        });
        
        // Track upload progress
        let uploaded = 0;
        const chunkSize = 1024 * 1024; // 1MB chunks
        const totalChunks = Math.ceil(videoBuffer.length / chunkSize);
        
        console.log(`   Uploading in ${totalChunks} chunks...`);
        
        // Write in chunks to show progress
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, videoBuffer.length);
            const chunk = videoBuffer.slice(start, end);
            
            req.write(chunk);
            uploaded += chunk.length;
            
            const percent = ((uploaded / videoBuffer.length) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${percent}% (${(uploaded / 1024 / 1024).toFixed(1)}MB / ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
        }
        
        console.log('\n   Finalizing upload...');
        req.end();
    });
}

async function createPost(mediaId) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
    });
    
    // Shorter caption for Twitter (60-second video = 15 days)
    const caption = `☀️ 15 days of solar activity through Sep ${dateStr.split(' ')[1]}

Watch our Sun's corona dance with solar winds and CMEs in this NASA satellite timelapse.

Daily updates at heliolens.builtbyvibes.com

#SolarActivity #SpaceWeather #NASA #Heliolens`;
    
    console.log('\n3️⃣ Creating Twitter post...');
    console.log(`   Caption: ${caption.length} chars`);
    
    const response = await httpsRequest(
        `${API_BASE}/posts`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        },
        JSON.stringify({
            social_accounts: [TWITTER_ACCOUNT_ID],
            media: [mediaId],
            caption: caption
        })
    );
    
    if (!response.ok) {
        throw new Error(`Failed to create post: ${JSON.stringify(response.data)}`);
    }
    
    console.log('✅ Post created and scheduled!');
    console.log(`   Post ID: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    
    return response.data;
}

async function main() {
    console.log('🐦 PostBridge Twitter Upload - 1080x1080 Optimized');
    console.log('==================================================\n');
    
    const videoPath = 'C:/Users/watka/Downloads/heliosphere_twitter_60s_2025-09-02.mp4';
    
    try {
        // Check file exists
        if (!fs.existsSync(videoPath)) {
            throw new Error(`Video not found: ${videoPath}`);
        }
        
        // Upload video with progress tracking
        const mediaId = await uploadVideoInChunks(videoPath);
        
        // Create and schedule post
        const post = await createPost(mediaId);
        
        console.log('\n🎉 SUCCESS! Video posted to Twitter');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📱 View on PostBridge: https://app.post-bridge.com/posts/' + post.id);
        console.log('🐦 Will appear on @Heliolens timeline shortly');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    }
}

// Run immediately
main();