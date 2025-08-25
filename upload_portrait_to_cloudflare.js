#!/usr/bin/env node

/**
 * Upload portrait video to Cloudflare Stream
 */

import fs from 'fs/promises';
import FormData from 'form-data';
import fetch from 'node-fetch';

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: 'GCifOYEQ3YaLNh1gD_UcnMRJx04pgrqGdCY4C1yE'
};

async function uploadVideo() {
    const videoPath = '/opt/heliosphere/videos/heliosphere_portrait_2025-08-19.mp4';
    
    try {
        console.log('🚀 Uploading portrait video to Cloudflare Stream...');
        
        // Check file
        const stats = await fs.stat(videoPath);
        console.log(`   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Use TUS upload for large file
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        
        // Create TUS upload script
        const tusScript = `
import fs from 'fs';
import * as tus from 'tus-js-client';

const file = fs.createReadStream('${videoPath}');
const size = ${stats.size};

const upload = new tus.Upload(file, {
    endpoint: 'https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream',
    headers: {
        'Authorization': 'Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}'
    },
    chunkSize: 50 * 1024 * 1024, // 50MB chunks
    retryDelays: [0, 3000, 5000, 10000, 20000],
    metadata: {
        name: 'heliosphere_portrait',
        requiresignedurls: 'false',
        allowedorigins: '*',
        thumbnailTimestampPct: '0.5'
    },
    uploadSize: size,
    onError: function (error) {
        console.error('Upload failed:', error);
        process.exit(1);
    },
    onProgress: function (bytesUploaded, bytesTotal) {
        const percentage = (bytesUploaded / bytesTotal * 100).toFixed(2);
        process.stdout.write('\\r   Progress: ' + percentage + '%');
    },
    onSuccess: function () {
        console.log('\\n✅ Upload completed!');
        const videoId = upload.url.split('/').pop();
        console.log('Video ID:', videoId);
        console.log('Stream URL: https://customer-931z4aajcqul6afi.cloudflarestream.com/' + videoId + '/manifest/video.m3u8');
        console.log('Iframe URL: https://customer-931z4aajcqul6afi.cloudflarestream.com/' + videoId + '/iframe');
    }
});

upload.start();
`;
        
        // Save and run TUS script
        await fs.writeFile('/tmp/upload_portrait_tus.mjs', tusScript);
        
        console.log('   Starting TUS upload...');
        const { stdout, stderr } = await execAsync('cd /tmp && npm install tus-js-client && node upload_portrait_tus.mjs', {
            maxBuffer: 10 * 1024 * 1024
        });
        
        if (stderr && !stderr.includes('npm notice')) {
            console.error('Warning:', stderr);
        }
        
        console.log(stdout);
        
        // Extract video ID from output
        const videoIdMatch = stdout.match(/Video ID: ([a-f0-9]{32})/);
        if (videoIdMatch) {
            const videoId = videoIdMatch[1];
            console.log('\n🎆 Portrait video uploaded successfully!');
            console.log(`   Video ID: ${videoId}`);
            console.log(`   Update index.html with this ID for mobile/portrait viewing`);
            return videoId;
        }
        
    } catch (error) {
        console.error('❌ Upload failed:', error.message);
        
        // Fallback to direct upload for smaller files
        console.log('\n🔄 Trying direct upload...');
        
        const formData = new FormData();
        const videoBuffer = await fs.readFile(videoPath);
        formData.append('file', videoBuffer, 'heliosphere_portrait.mp4');
        
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`,
                    ...formData.getHeaders()
                },
                body: formData
            }
        );
        
        const result = await response.json();
        
        if (result.success) {
            const videoId = result.result.uid;
            console.log('✅ Portrait video uploaded!');
            console.log(`   Video ID: ${videoId}`);
            return videoId;
        } else {
            console.error('❌ Upload failed:', result.errors);
            throw new Error('Upload failed');
        }
    }
}

uploadVideo().catch(console.error);