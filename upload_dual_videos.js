#!/usr/bin/env node

import fs from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { createReadStream } from 'fs';

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: 'kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7',
    SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com'
};

async function uploadVideo(filePath, name) {
    console.log(`\nUploading ${name}...`);
    
    const stats = await fs.stat(filePath);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Upload via tus protocol
    const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream`;
    
    const formData = new FormData();
    formData.append('file', createReadStream(filePath));
    
    const metadata = {
        name: name,
        requireSignedURLs: false,
        allowedOrigins: [
            'http://65.109.0.112:3000',
            'http://65.109.0.112:3001', 
            'http://65.109.0.112:3005',
            'http://65.109.0.112',
            'https://heliosphere.app',
            'https://www.heliosphere.app'
        ]
    };
    
    // Add metadata to form
    Object.keys(metadata).forEach(key => {
        if (key === 'allowedOrigins') {
            formData.append(key, JSON.stringify(metadata[key]));
        } else {
            formData.append(key, metadata[key]);
        }
    });
    
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`
        },
        body: formData
    });
    
    const result = await response.json();
    
    if (!result.success) {
        throw new Error(`Upload failed: ${JSON.stringify(result.errors)}`);
    }
    
    console.log(`✅ Uploaded successfully!`);
    console.log(`   Video ID: ${result.result.uid}`);
    console.log(`   Playback ID: ${result.result.playback?.hls || 'Processing...'}`);
    
    return result.result;
}

async function main() {
    console.log('🎬 Uploading Dual Format Videos to Cloudflare Stream\n');
    
    try {
        // Upload desktop video
        const desktopResult = await uploadVideo(
            '/opt/heliosphere/test_comparison_videos/desktop_1460x1200.mp4',
            'Heliosphere Desktop (1460x1200)'
        );
        
        // Upload mobile video
        const mobileResult = await uploadVideo(
            '/opt/heliosphere/test_comparison_videos/mobile_1080x1350.mp4',
            'Heliosphere Mobile Portrait (1080x1350)'
        );
        
        // Save video IDs for reference
        const videoIds = {
            desktop: {
                id: desktopResult.uid,
                playback: desktopResult.playback,
                embed: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${desktopResult.uid}/manifest/video.m3u8`
            },
            mobile: {
                id: mobileResult.uid,
                playback: mobileResult.playback,
                embed: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${mobileResult.uid}/manifest/video.m3u8`
            },
            iframeSrc: {
                desktop: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${desktopResult.uid}/iframe`,
                mobile: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${mobileResult.uid}/iframe`
            }
        };
        
        await fs.writeFile(
            '/opt/heliosphere/cloudflare_video_ids.json',
            JSON.stringify(videoIds, null, 2)
        );
        
        console.log('\n📝 Video IDs saved to cloudflare_video_ids.json');
        console.log('\n🎥 Embed URLs:');
        console.log(`   Desktop: ${videoIds.iframeSrc.desktop}`);
        console.log(`   Mobile: ${videoIds.iframeSrc.mobile}`);
        
    } catch (error) {
        console.error('❌ Upload failed:', error.message);
        process.exit(1);
    }
}

main();