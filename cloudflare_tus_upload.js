#!/usr/bin/env node

/**
 * Cloudflare Stream TUS Upload for Large Files
 * Handles resumable uploads for files over 200MB
 */

import fs from 'fs';
import * as tus from 'tus-js-client';

// Cloudflare configuration
const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
    TUS_ENDPOINT: `https://api.cloudflare.com/client/v4/accounts/f7e27d63f4766d7fb6a0f5b4789e2cdb/stream`
};

/**
 * Upload large video to Cloudflare Stream using tus
 * @param {string} videoPath - Path to video file
 * @param {string} name - Name for the video
 * @returns {Promise<Object>} Video details including ID and URLs
 */
async function uploadLargeVideo(videoPath, name) {
    if (!CLOUDFLARE_CONFIG.API_TOKEN) {
        throw new Error('CLOUDFLARE_API_TOKEN environment variable not set');
    }

    console.log(`📤 Uploading ${name} to Cloudflare Stream (TUS resumable)...`);
    
    // Get file info
    const stats = fs.statSync(videoPath);
    const file = fs.createReadStream(videoPath);
    
    console.log(`   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    return new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
            endpoint: CLOUDFLARE_CONFIG.TUS_ENDPOINT,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            chunkSize: 50 * 1024 * 1024, // 50MB chunks (recommended for reliable connections)
            metadata: {
                name: name,
                filetype: 'video/mp4'
            },
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`
            },
            onError: function(error) {
                console.error('❌ Upload failed:', error);
                reject(error);
            },
            onProgress: function(bytesUploaded, bytesTotal) {
                const percentage = (bytesUploaded / bytesTotal * 100).toFixed(2);
                process.stdout.write(`\r   Progress: ${percentage}% (${(bytesUploaded / 1024 / 1024).toFixed(1)}MB / ${(bytesTotal / 1024 / 1024).toFixed(1)}MB)`);
            },
            onSuccess: function() {
                console.log('\n   ✓ Upload completed!');
                
                // Extract video ID from upload URL
                const uploadUrl = upload.url;
                const videoId = uploadUrl.split('/').pop();
                
                console.log(`   Video ID: ${videoId}`);
                
                resolve({
                    id: videoId,
                    playbackUrl: `https://customer-931z4aajcqul6afi.cloudflarestream.com/${videoId}/manifest/video.m3u8`,
                    embedUrl: `https://customer-931z4aajcqul6afi.cloudflarestream.com/${videoId}/iframe`,
                    thumbnailUrl: `https://customer-931z4aajcqul6afi.cloudflarestream.com/${videoId}/thumbnails/thumbnail.jpg`,
                    uploadUrl: uploadUrl
                });
            }
        });

        // Start the upload
        upload.start();
    });
}

/**
 * Replace video on Cloudflare Stream using TUS
 * @param {string} videoPath - Path to new video
 * @param {string} type - 'full', 'social', or 'portrait'
 * @returns {Object} New video details
 */
async function replaceVideoTUS(videoPath, type) {
    const videoName = `heliosphere_${type}_${new Date().toISOString().split('T')[0]}`;
    const result = await uploadLargeVideo(videoPath, videoName);
    
    // Load and update video IDs
    let currentVideos = {};
    try {
        const saved = fs.readFileSync('/opt/heliosphere/cloudflare_videos.json', 'utf8');
        currentVideos = JSON.parse(saved);
    } catch (error) {
        // File doesn't exist yet
    }
    
    // Save new video ID
    currentVideos[type] = result.id;
    fs.writeFileSync(
        '/opt/heliosphere/cloudflare_videos.json',
        JSON.stringify(currentVideos, null, 2)
    );
    
    console.log(`\n📺 Video available at:`);
    console.log(`   Embed: ${result.embedUrl}`);
    console.log(`   Stream: ${result.playbackUrl}`);
    
    return result;
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node cloudflare_tus_upload.js <video_path> [type]');
        console.log('  type: "full", "social", or "portrait" (default: "full")');
        process.exit(1);
    }
    
    const videoPath = args[0];
    const type = args[1] || 'full';
    
    replaceVideoTUS(videoPath, type)
        .then(result => {
            console.log('\n✅ Upload complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Upload failed:', error);
            process.exit(1);
        });
}

export { uploadLargeVideo, replaceVideoTUS };