#!/usr/bin/env node

/**
 * Post Heliolens video to Twitter/X using Post Bridge API
 * Built with AI + Vibes | www.builtbyvibes.com | @builtbyvibes
 */

import fs from 'fs/promises';
import https from 'https';
import { URL } from 'url';

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
    const fileName = filePath.split('/').pop().split('\\').pop();
    
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
    
    // Step 2: Upload the video using PUT
    const videoBuffer = await fs.readFile(filePath);
    
    const uploadUrl = new URL(uploadData.upload_url);
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

async function createPost(caption, mediaId) {
    console.log('📝 Creating post...');
    
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
            caption: caption,
            social_accounts: [TWITTER_ACCOUNT_ID],
            media: [mediaId]
        })
    );
    
    if (!response.ok) {
        throw new Error(`Failed to create post: ${JSON.stringify(response.data)}`);
    }
    
    return response.data;
}

async function postToTwitter() {
    const videoPath = process.argv[2] || 'heliolens_social_latest.mp4';
    
    // Generate dynamic caption with current date
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    const caption = `☀️ HELIOLENS ${dateStr} - 30 days of solar activity from NASA satellites

Watch our Sun's corona dance with solar flares and CMEs 🌟

Built with AI + Vibes
www.builtbyvibes.com | @builtbyvibes

#Heliolens #SolarActivity #SpaceWeather #NASA #BuiltByVibes`;
    
    console.log('🚀 Posting to Twitter/X via Post Bridge');
    console.log(`📹 Video: ${videoPath}`);
    console.log(`👤 Account: @Heliolens`);
    
    try {
        // Upload video
        const mediaId = await uploadVideo(videoPath);
        
        // Create post
        const post = await createPost(caption, mediaId);
        
        console.log('\n✅ Successfully posted to Twitter!');
        console.log(`📊 Post ID: ${post.id}`);
        console.log(`🔗 Check your Twitter: https://twitter.com/Heliolens`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
postToTwitter();