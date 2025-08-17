#!/usr/bin/env node

/**
 * Upload production videos to Cloudflare Stream and update frontend
 * This will upload the three videos from VPS and update the HTML
 */

import { uploadToCloudflare, deleteFromCloudflare } from './cloudflare_upload.js';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const VPS_IP = '65.109.0.112';
const LOCAL_TEMP = './temp_videos';
const VIDEOS = {
    full: {
        remote: '/opt/heliosphere/videos/heliosphere_full_lossless.mp4',
        local: `${LOCAL_TEMP}/heliosphere_full_lossless.mp4`,
        name: 'heliosphere_full_56days'
    },
    portrait: {
        remote: '/opt/heliosphere/videos/heliosphere_portrait_full.mp4',
        local: `${LOCAL_TEMP}/heliosphere_portrait_full.mp4`,
        name: 'heliosphere_portrait_56days'
    },
    social: {
        remote: '/opt/heliosphere/videos/heliosphere_social_60s.mp4',
        local: `${LOCAL_TEMP}/heliosphere_social_60s.mp4`,
        name: 'heliosphere_social_60s'
    }
};

// Old video ID to delete
const OLD_VIDEO_ID = '23033e88e44f4dd58d25e113fb199b82';

async function downloadVideos() {
    console.log('📥 Downloading videos from VPS...');
    
    // Create temp directory
    await fs.mkdir(LOCAL_TEMP, { recursive: true });
    
    // Download each video
    for (const [type, video] of Object.entries(VIDEOS)) {
        console.log(`   Downloading ${type} video...`);
        const cmd = `scp -i ~/.ssh/id_rsa root@${VPS_IP}:${video.remote} ${video.local}`;
        
        try {
            await execAsync(cmd);
            const stats = await fs.stat(video.local);
            console.log(`   ✓ Downloaded ${type}: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
        } catch (error) {
            console.error(`   ❌ Failed to download ${type}: ${error.message}`);
            throw error;
        }
    }
}

async function uploadVideos() {
    console.log('\n📤 Uploading to Cloudflare Stream...');
    
    const results = {};
    
    // Upload each video
    for (const [type, video] of Object.entries(VIDEOS)) {
        try {
            console.log(`\n   Uploading ${type} video...`);
            const result = await uploadToCloudflare(video.local, video.name);
            results[type] = result;
            
            console.log(`   ✓ ${type} uploaded: ${result.id}`);
            console.log(`     Embed: ${result.embedUrl}`);
            console.log(`     Stream: ${result.playbackUrl}`);
        } catch (error) {
            console.error(`   ❌ Failed to upload ${type}: ${error.message}`);
        }
    }
    
    return results;
}

async function updateFrontend(videoId, videoType = 'full') {
    console.log('\n📝 Updating frontend HTML...');
    
    // Read current HTML
    const htmlPath = './index.html';
    let html = await fs.readFile(htmlPath, 'utf8');
    
    // Replace old video ID with new one
    const oldId = '23033e88e44f4dd58d25e113fb199b82';
    html = html.replace(new RegExp(oldId, 'g'), videoId);
    
    // Update the upload date
    const today = new Date().toISOString().split('T')[0];
    html = html.replace(/"uploadDate": "\d{4}-\d{2}-\d{2}"/, `"uploadDate": "${today}"`);
    
    // Update duration (224 seconds = 3m44s)
    html = html.replace(/"duration": "PT\d+S"/, '"duration": "PT224S"');
    
    // Save updated HTML
    await fs.writeFile(htmlPath, html);
    console.log('   ✓ Updated index.html');
    
    // Create mobile version if portrait video exists
    if (videoType === 'portrait') {
        const mobileHtml = html.replace(
            'const videoAspect = 1460 / 1200;',
            'const videoAspect = 1080 / 1920;'
        );
        await fs.writeFile('./mobile.html', mobileHtml);
        console.log('   ✓ Created mobile.html');
    }
}

async function cleanupOldVideo() {
    console.log('\n🗑️  Cleaning up old video...');
    try {
        await deleteFromCloudflare(OLD_VIDEO_ID);
        console.log('   ✓ Deleted old video from Cloudflare');
    } catch (error) {
        console.log('   ⚠️ Could not delete old video:', error.message);
    }
}

async function cleanupLocalFiles() {
    console.log('\n🧹 Cleaning up local files...');
    try {
        await fs.rm(LOCAL_TEMP, { recursive: true });
        console.log('   ✓ Removed temporary files');
    } catch (error) {
        console.log('   ⚠️ Could not clean up:', error.message);
    }
}

async function main() {
    console.log('═'.repeat(60));
    console.log('🌞 HELIOSPHERE PRODUCTION VIDEO UPLOAD');
    console.log('═'.repeat(60));
    console.log();
    
    try {
        // Check for API token
        if (!process.env.CLOUDFLARE_API_TOKEN) {
            console.error('❌ CLOUDFLARE_API_TOKEN environment variable not set!');
            console.log('\nSet it with:');
            console.log('export CLOUDFLARE_API_TOKEN="your_token_here"');
            process.exit(1);
        }
        
        // Download videos from VPS
        await downloadVideos();
        
        // Upload to Cloudflare
        const results = await uploadVideos();
        
        // Update frontend with full video
        if (results.full) {
            await updateFrontend(results.full.id, 'full');
        }
        
        // Save video IDs
        await fs.writeFile(
            './cloudflare_videos.json',
            JSON.stringify(results, null, 2)
        );
        console.log('\n📁 Saved video IDs to cloudflare_videos.json');
        
        // Delete old video
        await cleanupOldVideo();
        
        // Clean up local files
        await cleanupLocalFiles();
        
        console.log('\n');
        console.log('═'.repeat(60));
        console.log('✅ UPLOAD COMPLETE!');
        console.log('═'.repeat(60));
        console.log('\nVideo URLs:');
        
        if (results.full) {
            console.log('\n📺 Full (Desktop):');
            console.log(`   View: https://heliosphere.app/`);
            console.log(`   Embed: ${results.full.embedUrl}`);
        }
        
        if (results.portrait) {
            console.log('\n📱 Portrait (Mobile):');
            console.log(`   View: https://heliosphere.app/mobile.html`);
            console.log(`   Embed: ${results.portrait.embedUrl}`);
        }
        
        if (results.social) {
            console.log('\n📲 Social (60s):');
            console.log(`   Embed: ${results.social.embedUrl}`);
        }
        
        console.log('\n🚀 Deploy the updated HTML to your hosting!');
        
    } catch (error) {
        console.error('\n❌ Upload failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { downloadVideos, uploadVideos, updateFrontend };