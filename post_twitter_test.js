#!/usr/bin/env node

/**
 * Post Twitter-optimized 1080x1080 video to Twitter/X using Post Bridge API
 * Test script for the new format
 */

import fs from 'fs/promises';
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
            headers: options.headers || {}
        };
        
        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = data ? JSON.parse(data) : {};
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ ok: true, data: result, status: res.statusCode });
                    } else {
                        resolve({ ok: false, data: result, status: res.statusCode });
                    }
                } catch (e) {
                    resolve({ ok: res.statusCode < 300, data: data, status: res.statusCode });
                }
            });
        });
        
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function uploadVideo(filePath) {
    console.log('📤 Uploading video to Post Bridge...');
    
    // Get file stats
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    
    console.log(`   File: ${fileName}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 1: Create upload URL
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
        throw new Error(`Failed to create upload URL: ${JSON.stringify(uploadUrlResponse.data)}`);
    }
    
    const uploadData = uploadUrlResponse.data;
    console.log('✅ Got upload URL');
    
    // Step 2: Upload the video
    const videoBuffer = await fs.readFile(filePath);
    
    const uploadResponse = await httpsRequest(
        uploadData.upload_url,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Length': stats.size
            }
        },
        videoBuffer
    );
    
    if (!uploadResponse.ok) {
        throw new Error(`Failed to upload video: ${uploadResponse.status}`);
    }
    
    console.log('✅ Video uploaded successfully');
    return uploadData.media_id;
}

async function createPost(mediaId) {
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
    });
    
    // Caption for Twitter (280 char limit)
    const caption = `☀️ 30 days of solar activity - updated ${dateStr}

Watch coronal mass ejections and solar winds dance around our Sun in this real-time view from NASA satellites.

🛰️ Data: SOHO/LASCO + SDO
🎬 Daily updates
🌍 Space weather monitoring

#Heliolens #SolarActivity #SpaceWeather`;
    
    console.log('\n📝 Creating post...');
    console.log(`   Caption length: ${caption.length} chars`);
    
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
            account_ids: [TWITTER_ACCOUNT_ID],
            media_ids: [mediaId],
            text: caption,
            status: 'draft'  // Change to 'scheduled' to post immediately
        })
    );
    
    if (!response.ok) {
        throw new Error(`Failed to create post: ${JSON.stringify(response.data)}`);
    }
    
    console.log('✅ Post created successfully!');
    console.log(`   Post ID: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    
    return response.data;
}

async function main() {
    console.log('🐦 Twitter Post Test - 1080x1080 Format');
    console.log('========================================\n');
    
    // Use the video we just created
    const videoPath = 'C:/Users/watka/Downloads/heliosphere_twitter_1080_2025-09-02.mp4';
    
    try {
        // Check if file exists
        await fs.access(videoPath);
        
        // Upload video
        const mediaId = await uploadVideo(videoPath);
        
        // Create post
        const post = await createPost(mediaId);
        
        console.log('\n✨ Success! Your post is ready.');
        console.log('📱 View in PostBridge dashboard to publish');
        console.log(`   URL: https://app.post-bridge.com/posts/${post.id}`);
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

// Run immediately
main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});