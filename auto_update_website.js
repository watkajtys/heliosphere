#!/usr/bin/env node

/**
 * Automatic Website Update Script
 * Finds latest videos, uploads to Cloudflare Stream, and updates website
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { createReadStream } from 'fs';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    VIDEOS_DIR: '/opt/heliosphere/videos',
    WEBSITE_DIR: '/opt/heliosphere/heliosphere-pages',
    CLOUDFLARE: {
        ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
        API_TOKEN: process.env.CLOUDFLARE_STREAM_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
        PAGES_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
        SUBDOMAIN: 'customer-931z4aajcqul6afi'
    }
};

// Video type mapping
const VIDEO_TYPES = {
    full: { pattern: /heliosphere_full_(\d{4}-\d{2}-\d{2})\.(mp4|mov)$/, name: 'Full Resolution' },
    social: { pattern: /heliosphere_social_(\d{4}-\d{2}-\d{2})\.(mp4|mov)$/, name: 'Social Square' },
    portrait: { pattern: /heliosphere_portrait_(\d{4}-\d{2}-\d{2})\.(mp4|mov)$/, name: 'Portrait' }
};

/**
 * Find the latest video files
 */
async function findLatestVideos() {
    console.log('🔍 Finding latest videos...');
    const files = await fs.readdir(CONFIG.VIDEOS_DIR);
    
    const videos = {
        full: null,
        social: null,
        portrait: null
    };
    
    // Group files by type and find most recent
    for (const file of files) {
        for (const [type, config] of Object.entries(VIDEO_TYPES)) {
            const match = file.match(config.pattern);
            if (match) {
                const date = match[1];
                if (!videos[type] || date > videos[type].date) {
                    videos[type] = {
                        path: path.join(CONFIG.VIDEOS_DIR, file),
                        filename: file,
                        date: date
                    };
                }
            }
        }
    }
    
    // Report findings
    console.log('\n📹 Latest videos found:');
    for (const [type, video] of Object.entries(videos)) {
        if (video) {
            const stats = await fs.stat(video.path);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
            console.log(`   ${type}: ${video.date} (${sizeMB} MB)`);
        } else {
            console.log(`   ${type}: Not found`);
        }
    }
    
    return videos;
}

/**
 * Upload video to Cloudflare Stream
 */
async function uploadToCloudflare(videoPath, videoType) {
    console.log(`\n📤 Uploading ${videoType} video to Cloudflare Stream...`);
    
    const stats = await fs.stat(videoPath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    
    // For large files (>100MB), use TUS upload
    if (stats.size > 100 * 1024 * 1024) {
        console.log(`   Using TUS upload for large file (${fileSizeMB} MB)...`);
        
        // Step 1: Create TUS upload URL
        const createResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CONFIG.CLOUDFLARE.ACCOUNT_ID}/stream?direct_user=true`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.CLOUDFLARE.API_TOKEN}`,
                    'Tus-Resumable': '1.0.0',
                    'Upload-Length': stats.size.toString(),
                    'Upload-Metadata': `name ${Buffer.from(path.basename(videoPath)).toString('base64')}`
                }
            }
        );
        
        const location = createResponse.headers.get('location');
        if (!location) {
            throw new Error('Failed to get TUS upload URL');
        }
        
        // Step 2: Upload the file
        const fileStream = createReadStream(videoPath);
        const uploadResponse = await fetch(location, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${CONFIG.CLOUDFLARE.API_TOKEN}`,
                'Tus-Resumable': '1.0.0',
                'Upload-Offset': '0',
                'Content-Type': 'application/offset+octet-stream'
            },
            body: fileStream
        });
        
        const streamId = location.split('/').pop().split('?')[0];
        console.log(`   ✅ Uploaded! Stream ID: ${streamId}`);
        return streamId;
        
    } else {
        // Use regular upload for smaller files
        console.log(`   Using standard upload (${fileSizeMB} MB)...`);
        
        const form = new FormData();
        form.append('file', createReadStream(videoPath));
        
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CONFIG.CLOUDFLARE.ACCOUNT_ID}/stream`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.CLOUDFLARE.API_TOKEN}`,
                    ...form.getHeaders()
                },
                body: form
            }
        );
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(`Upload failed: ${JSON.stringify(data.errors)}`);
        }
        
        console.log(`   ✅ Uploaded! Stream ID: ${data.result.uid}`);
        return data.result.uid;
    }
}

/**
 * Update website HTML with new video IDs
 */
async function updateWebsiteHTML(videoIds) {
    console.log('\n📝 Updating website HTML...');
    
    const indexPath = path.join(CONFIG.WEBSITE_DIR, 'index.html');
    let content = await fs.readFile(indexPath, 'utf-8');
    
    // Update the VIDEO_IDS JavaScript object in the HTML
    const videoIdsPattern = /const VIDEO_IDS = {[\s\S]*?};/;
    const videoIdsMatch = content.match(videoIdsPattern);
    
    if (videoIdsMatch) {
        // Build new VIDEO_IDS object
        const newVideoIds = `const VIDEO_IDS = {
            desktop: '${videoIds.full || '137e76fccaed499af2dfcf0145014c84'}', // Full video
            mobile: '${videoIds.portrait || '90c2570ebb09cc12679f12a6d0ea3a9f'}', // Portrait video
            social: '${videoIds.social || 'fe13d11a22ab783c73babf05ff09d643'}' // Social square video
        };`;
        
        content = content.replace(videoIdsPattern, newVideoIds);
        console.log('   Updated VIDEO_IDS object with new IDs');
        if (videoIds.full) console.log(`   Desktop (full): ${videoIds.full}`);
        if (videoIds.portrait) console.log(`   Mobile (portrait): ${videoIds.portrait}`);
        if (videoIds.social) console.log(`   Social (square): ${videoIds.social}`);
    }
    
    // Also update the main stream src and metadata URLs
    if (videoIds.full) {
        // Update the stream element src
        content = content.replace(/src="[a-f0-9]{32}"/g, `src="${videoIds.full}"`);
        
        // Update all Cloudflare URLs in meta tags
        const streamUrlPattern = /https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[a-f0-9]{32}/g;
        content = content.replace(streamUrlPattern, `https://${CONFIG.CLOUDFLARE.SUBDOMAIN}.cloudflarestream.com/${videoIds.full}`);
        
        console.log(`   Updated meta tags with primary video ID`);
    }
    
    // Update dates
    const today = new Date().toISOString().split('T')[0];
    content = content.replace(/"uploadDate": "\d{4}-\d{2}-\d{2}"/g, `"uploadDate": "${today}"`);
    content = content.replace(/"datePublished": "\d{4}-\d{2}-\d{2}"/g, `"datePublished": "${today}"`);
    content = content.replace(/"dateModified": "\d{4}-\d{2}-\d{2}"/g, `"dateModified": "${today}"`);
    
    // Update any visible "Last updated" text
    content = content.replace(/Last updated: \d{4}-\d{2}-\d{2}/g, `Last updated: ${today}`);
    
    // Save updated content
    await fs.writeFile(indexPath, content);
    console.log('   ✅ Website HTML updated');
}

/**
 * Deploy website to Cloudflare Pages
 */
async function deployWebsite() {
    console.log('\n🚀 Deploying to Cloudflare Pages...');
    
    try {
        const { stdout, stderr } = await execAsync(
            `cd ${CONFIG.WEBSITE_DIR} && npx wrangler pages deploy . --project-name heliosphere --branch main`,
            { 
                env: { 
                    ...process.env, 
                    CLOUDFLARE_API_TOKEN: CONFIG.CLOUDFLARE.PAGES_TOKEN 
                }
            }
        );
        
        if (stdout.includes('Success')) {
            console.log('   ✅ Successfully deployed!');
            
            // Extract URL from output
            const urlMatch = stdout.match(/https:\/\/[^\s]+/);
            if (urlMatch) {
                console.log(`   🌐 Live at: ${urlMatch[0]}`);
            }
        } else {
            console.log(stdout);
        }
        
        if (stderr && !stderr.includes('warning')) {
            console.error('   Warnings:', stderr);
        }
    } catch (error) {
        console.error('   ❌ Deployment failed:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║    Automatic Website Update Process    ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    try {
        // 1. Find latest videos
        const videos = await findLatestVideos();
        
        if (!videos.full) {
            console.error('❌ No full resolution video found!');
            process.exit(1);
        }
        
        // 2. Upload videos to Cloudflare Stream
        const videoIds = {};
        
        for (const [type, video] of Object.entries(videos)) {
            if (video) {
                try {
                    videoIds[type] = await uploadToCloudflare(video.path, type);
                } catch (error) {
                    console.error(`   ⚠️ Failed to upload ${type}: ${error.message}`);
                    // Continue with other videos
                }
            }
        }
        
        if (!videoIds.full) {
            console.error('❌ Failed to upload primary video!');
            process.exit(1);
        }
        
        // 3. Update website HTML
        await updateWebsiteHTML(videoIds);
        
        // 4. Deploy to Cloudflare Pages
        await deployWebsite();
        
        // 5. Summary
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║         Update Complete! 🎉            ║');
        console.log('╚════════════════════════════════════════╝');
        console.log('\n📺 Video URLs:');
        for (const [type, id] of Object.entries(videoIds)) {
            if (id) {
                console.log(`   ${type}: https://${CONFIG.CLOUDFLARE.SUBDOMAIN}.cloudflarestream.com/${id}/iframe`);
            }
        }
        console.log('\n🌐 Website: https://heliosphere.pages.dev');
        
    } catch (error) {
        console.error('\n❌ Update failed:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
    main().catch(console.error);
}

export { findLatestVideos, uploadToCloudflare, updateWebsiteHTML, deployWebsite };