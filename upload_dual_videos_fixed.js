#!/usr/bin/env node

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: 'kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7',
    SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com'
};

async function uploadVideo(filePath, name) {
    console.log(`\nUploading ${name}...`);
    
    const stats = await fs.stat(filePath);
    console.log(`File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Use curl to upload
    const curlCmd = `curl -X POST \
        -H "Authorization: Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}" \
        -F "file=@${filePath}" \
        -F "meta={\"name\":\"${name}\"}" \
        -F "requireSignedURLs=false" \
        -F 'allowedOrigins=["http://65.109.0.112:3000","http://65.109.0.112:3001","http://65.109.0.112:3005","http://65.109.0.112","https://heliosphere.app","https://www.heliosphere.app"]' \
        https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream`;
    
    const { stdout, stderr } = await execAsync(curlCmd);
    
    if (stderr && !stderr.includes('Total')) {
        console.error('Error:', stderr);
    }
    
    const result = JSON.parse(stdout);
    
    if (!result.success) {
        throw new Error(`Upload failed: ${JSON.stringify(result.errors)}`);
    }
    
    console.log(`✅ Uploaded successfully!`);
    console.log(`   Video ID: ${result.result.uid}`);
    console.log(`   Status: ${result.result.status?.state || 'processing'}`);
    
    return result.result;
}

async function main() {
    console.log('🎬 Uploading Dual Format Videos to Cloudflare Stream\n');
    
    try {
        // Check which videos exist
        const desktopPath = '/opt/heliosphere/test_comparison_videos/desktop_hq.mp4';
        const mobilePath = '/opt/heliosphere/test_comparison_videos/mobile_1080x1350.mp4';
        
        // Upload desktop video
        console.log('Uploading desktop video...');
        const desktopResult = await uploadVideo(
            desktopPath,
            'Heliosphere Desktop HQ (1460x1200)'
        );
        
        // Upload mobile video
        console.log('\nUploading mobile video...');
        const mobileResult = await uploadVideo(
            mobilePath,
            'Heliosphere Mobile Portrait (1080x1350)'
        );
        
        // Save video IDs for reference
        const videoIds = {
            desktop: {
                id: desktopResult.uid,
                status: desktopResult.status,
                embed: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${desktopResult.uid}/manifest/video.m3u8`,
                iframe: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${desktopResult.uid}/iframe`
            },
            mobile: {
                id: mobileResult.uid,
                status: mobileResult.status,
                embed: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${mobileResult.uid}/manifest/video.m3u8`,
                iframe: `https://${CLOUDFLARE_CONFIG.SUBDOMAIN}/${mobileResult.uid}/iframe`
            },
            uploadedAt: new Date().toISOString()
        };
        
        await fs.writeFile(
            '/opt/heliosphere/cloudflare_video_ids.json',
            JSON.stringify(videoIds, null, 2)
        );
        
        console.log('\n📝 Video IDs saved to cloudflare_video_ids.json');
        console.log('\n🎥 Embed URLs:');
        console.log(`   Desktop: ${videoIds.desktop.iframe}`);
        console.log(`   Mobile: ${videoIds.mobile.iframe}`);
        
    } catch (error) {
        console.error('❌ Upload failed:', error.message);
        process.exit(1);
    }
}

main();