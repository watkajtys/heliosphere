#!/usr/bin/env node

/**
 * Cloudflare Stream Upload Module
 * Uploads videos to Cloudflare Stream and replaces existing ones
 */

import fs from 'fs/promises';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Cloudflare configuration
const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, // Set this in environment
    SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com',
    
    // Store current video IDs (will be saved to file)
    CURRENT_VIDEOS: {
        full: null,
        social: null
    }
};

/**
 * Upload video to Cloudflare Stream
 * @param {string} videoPath - Path to video file
 * @param {string} name - Name for the video
 * @returns {Object} Video details including ID and URLs
 */
async function uploadToCloudflare(videoPath, name) {
    if (!CLOUDFLARE_CONFIG.API_TOKEN) {
        throw new Error('CLOUDFLARE_API_TOKEN environment variable not set');
    }
    
    console.log(`📤 Uploading ${name} to Cloudflare Stream...`);
    
    // Get file stats and create read stream
    const stats = await fs.stat(videoPath);
    console.log(`   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Use createReadStream for large files
    const { createReadStream } = await import('fs');
    const videoStream = createReadStream(videoPath);
    
    // Create form data
    const form = new FormData();
    form.append('file', videoStream, {
        filename: `${name}.mp4`,
        contentType: 'video/mp4',
        knownLength: stats.size
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
    
    const responseText = await response.text();
    
    let result;
    try {
        result = JSON.parse(responseText);
    } catch (error) {
        console.error(`   Response status: ${response.status}`);
        console.error(`   Response headers:`, response.headers);
        console.error(`   Response body: ${responseText.substring(0, 500)}...`);
        throw new Error(`Invalid JSON response: ${responseText.substring(0, 200)}`);
    }
    
    if (!result.success) {
        throw new Error(`Upload failed: ${JSON.stringify(result.errors)}`);
    }
    
    const video = result.result;
    console.log(`   ✓ Uploaded! Video ID: ${video.uid}`);
    
    return {
        id: video.uid,
        playbackUrl: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/manifest/video.m3u8`,
        embedUrl: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/iframe`,
        thumbnailUrl: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${video.uid}/thumbnails/thumbnail.jpg`,
        duration: video.duration,
        size: video.size,
        status: video.status
    };
}

/**
 * Delete video from Cloudflare Stream
 * @param {string} videoId - Video ID to delete
 */
async function deleteFromCloudflare(videoId) {
    if (!videoId || !CLOUDFLARE_CONFIG.API_TOKEN) {
        return;
    }
    
    console.log(`🗑️  Deleting old video ${videoId}...`);
    
    const deleteUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream/${videoId}`;
    
    try {
        const response = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}`
            }
        });
        
        if (response.ok) {
            console.log(`   ✓ Deleted old video`);
        }
    } catch (error) {
        console.error(`   ⚠️ Could not delete old video: ${error.message}`);
    }
}

/**
 * Replace video on Cloudflare Stream
 * Deletes old video and uploads new one
 * @param {string} videoPath - Path to new video
 * @param {string} type - 'full' or 'social'
 * @returns {Object} New video details
 */
async function replaceVideo(videoPath, type) {
    // Load current video IDs
    try {
        const saved = await fs.readFile('/opt/heliosphere/cloudflare_videos.json', 'utf8');
        CLOUDFLARE_CONFIG.CURRENT_VIDEOS = JSON.parse(saved);
    } catch (error) {
        // File doesn't exist yet, use defaults
    }
    
    // Delete old video if exists
    if (CLOUDFLARE_CONFIG.CURRENT_VIDEOS[type]) {
        await deleteFromCloudflare(CLOUDFLARE_CONFIG.CURRENT_VIDEOS[type]);
    }
    
    // Upload new video
    const videoName = `heliosphere_${type}_${new Date().toISOString().split('T')[0]}`;
    const result = await uploadToCloudflare(videoPath, videoName);
    
    // Save new video ID
    CLOUDFLARE_CONFIG.CURRENT_VIDEOS[type] = result.id;
    await fs.writeFile(
        '/opt/heliosphere/cloudflare_videos.json',
        JSON.stringify(CLOUDFLARE_CONFIG.CURRENT_VIDEOS, null, 2)
    );
    
    console.log(`\n📺 Video available at:`);
    console.log(`   Embed: ${result.embedUrl}`);
    console.log(`   Stream: ${result.playbackUrl}`);
    
    return result;
}

/**
 * Upload both full and social videos to Cloudflare
 * @param {string} fullVideoPath - Path to full video
 * @param {string} socialVideoPath - Path to social video
 */
async function uploadDailyVideos(fullVideoPath, socialVideoPath) {
    console.log('\n' + '═'.repeat(50));
    console.log('📤 CLOUDFLARE STREAM UPLOAD');
    console.log('═'.repeat(50) + '\n');
    
    const results = {
        full: null,
        social: null
    };
    
    try {
        // Upload full video
        if (fullVideoPath && await fs.access(fullVideoPath).then(() => true).catch(() => false)) {
            results.full = await replaceVideo(fullVideoPath, 'full');
        }
        
        // Upload social video
        if (socialVideoPath && await fs.access(socialVideoPath).then(() => true).catch(() => false)) {
            results.social = await replaceVideo(socialVideoPath, 'social');
        }
        
        console.log('\n✅ Videos uploaded successfully!');
        
    } catch (error) {
        console.error('❌ Upload failed:', error.message);
        throw error;
    }
    
    return results;
}

// Export functions for use in other scripts
export { 
    uploadToCloudflare, 
    deleteFromCloudflare, 
    replaceVideo, 
    uploadDailyVideos 
};

// If run directly, upload test videos
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage: node cloudflare_upload.js <video_path> [type]');
        console.log('  type: "full" or "social" (default: "full")');
        process.exit(1);
    }
    
    const videoPath = args[0];
    const type = args[1] || 'full';
    
    replaceVideo(videoPath, type)
        .then(result => {
            console.log('\n✅ Upload complete!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Upload failed:', error);
            process.exit(1);
        });
}