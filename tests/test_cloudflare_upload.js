#!/usr/bin/env node

/**
 * Test Cloudflare Stream Upload
 * Tests uploading the optimized test video
 */

import fs from 'fs/promises';
import FormData from 'form-data';
import fetch from 'node-fetch';

// Cloudflare configuration
const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com'
};

async function testUpload() {
    if (!CLOUDFLARE_CONFIG.API_TOKEN) {
        console.error('❌ CLOUDFLARE_API_TOKEN environment variable not set');
        console.log('\nTo set the token, run:');
        console.log('export CLOUDFLARE_API_TOKEN="your-token-here"');
        process.exit(1);
    }
    
    const videoPath = '/opt/heliosphere/test_optimized_videos/optimized_test.mp4';
    
    try {
        // Check video exists
        const stats = await fs.stat(videoPath);
        console.log(`\n📹 Video found: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Read video
        console.log('📤 Uploading to Cloudflare Stream...');
        const videoBuffer = await fs.readFile(videoPath);
        
        // Create form data
        const form = new FormData();
        form.append('file', videoBuffer, {
            filename: 'heliosphere_test.mp4',
            contentType: 'video/mp4'
        });
        
        // Upload to Cloudflare
        const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream`;
        
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
                ...form.getHeaders()
            },
            body: form
        });
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(`Upload failed: ${JSON.stringify(result.errors)}`);
        }
        
        const video = result.result;
        
        console.log('\n✅ Upload successful!');
        console.log('═'.repeat(60));
        console.log(`Video ID: ${video.uid}`);
        console.log(`Status: ${video.status?.state || 'processing'}`);
        console.log('\n🎬 Video URLs:');
        console.log(`Embed: https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/iframe`);
        console.log(`Stream: https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/manifest/video.m3u8`);
        console.log(`Thumbnail: https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/thumbnails/thumbnail.jpg`);
        console.log('═'.repeat(60));
        
        // Save video ID for website
        const videoData = {
            test: {
                id: video.uid,
                uploadedAt: new Date().toISOString(),
                size: stats.size,
                embedUrl: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/iframe`
            }
        };
        
        await fs.writeFile(
            '/opt/heliosphere/cloudflare_videos.json',
            JSON.stringify(videoData, null, 2)
        );
        
        console.log('\n📝 Video ID saved to cloudflare_videos.json');
        console.log('\n🌐 To view the video:');
        console.log(`1. Open: https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/iframe`);
        console.log('2. Video will be ready in 1-2 minutes after processing');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run test
testUpload();