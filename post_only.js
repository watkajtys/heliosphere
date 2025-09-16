#!/usr/bin/env node

import https from 'https';
import { URL } from 'url';

const API_KEY = '3ZgMcYiuv8Exs4xbC4KBnMX1';
const API_BASE = 'https://api.post-bridge.com/v1';
const TWITTER_ACCOUNT_ID = 28180;

// Media already uploaded (H.264 version)
const MEDIA_ID = 'b563b31e-bee8-4722-9647-58de3395fd84';

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
                    resolve({ ok: res.statusCode < 300, data: result, status: res.statusCode });
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

async function createPost() {
    const caption = `☀️ 30 days of solar activity through Sep 2

Watch our Sun's corona dance with solar winds and CMEs in this NASA satellite timelapse.

Daily updates at heliolens.builtbyvibes.com

#SolarActivity #SpaceWeather #NASA #Heliolens`;
    
    console.log('Creating post with uploaded video...');
    
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
            media: [MEDIA_ID],
            caption: caption
        })
    );
    
    if (!response.ok) {
        console.error('Response:', response);
        throw new Error(`Failed: ${JSON.stringify(response.data)}`);
    }
    
    console.log('✅ Post created!');
    console.log('Post ID:', response.data.id);
    console.log('View at: https://app.post-bridge.com/posts/' + response.data.id);
}

createPost().catch(console.error);