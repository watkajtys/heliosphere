#!/usr/bin/env node

/**
 * Update website with new video IDs and deploy to Cloudflare Pages
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    INDEX_PATH: '/opt/heliosphere/heliosphere-pages/index.html',
    CLOUDFLARE_SUBDOMAIN: 'customer-931z4aajcqul6afi',
    VIDEO_IDS: {
        full: process.argv[2] || '934cf6e795676afecc4a75c1dd523c46',
        social: process.argv[3] || '2eec0a2f85cb7a7aa60b0566daf720e9'
    }
};

async function updateIndex() {
    console.log('📝 Updating index.html with new video IDs...');
    
    // Read current index.html
    const indexContent = await fs.readFile(CONFIG.INDEX_PATH, 'utf-8');
    
    // Find and replace old video IDs
    // Pattern to match any video ID (32 character hex string)
    const videoIdPattern = /([a-f0-9]{32})/g;
    
    // Replace all occurrences of old video ID with new one
    let updatedContent = indexContent;
    
    // Count replacements
    const matches = indexContent.match(videoIdPattern);
    if (matches) {
        console.log(`Found ${matches.length} video ID references to update`);
        // Replace the main video ID (appears most frequently)
        const oldVideoId = matches[0]; // Get the first/most common ID
        updatedContent = updatedContent.replace(new RegExp(oldVideoId, 'g'), CONFIG.VIDEO_IDS.full);
        console.log(`Replaced ${oldVideoId} with ${CONFIG.VIDEO_IDS.full}`);
    }
    
    // Update the upload date to today
    const today = new Date().toISOString().split('T')[0];
    updatedContent = updatedContent.replace(/"uploadDate": "\d{4}-\d{2}-\d{2}"/, `"uploadDate": "${today}"`);
    updatedContent = updatedContent.replace(/Last updated: \d{4}-\d{2}-\d{2}/, `Last updated: ${today}`);
    
    // Write updated content
    await fs.writeFile(CONFIG.INDEX_PATH, updatedContent);
    console.log('✅ index.html updated successfully');
    
    return true;
}

async function deployToCloudflare() {
    console.log('\n☁️ Deploying to Cloudflare Pages...');
    
    try {
        // Use wrangler to deploy
        const { stdout, stderr } = await execAsync(
            'cd /opt/heliosphere/heliosphere-pages && npx wrangler pages deploy . --project-name heliolens --branch main',
            { env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN } }
        );
        
        console.log(stdout);
        if (stderr) console.error('Deploy warnings:', stderr);
        
        console.log('✅ Website deployed to Cloudflare Pages');
        return true;
    } catch (error) {
        console.error('❌ Failed to deploy:', error.message);
        return false;
    }
}

async function main() {
    console.log('🌐 Website Update Process Starting...\n');
    
    // Update index.html
    await updateIndex();
    
    // Deploy to Cloudflare
    await deployToCloudflare();
    
    console.log('\n✅ Website update complete!');
    console.log(`   Full video: https://${CONFIG.CLOUDFLARE_SUBDOMAIN}.cloudflarestream.com/${CONFIG.VIDEO_IDS.full}/iframe`);
    console.log(`   Social video: https://${CONFIG.CLOUDFLARE_SUBDOMAIN}.cloudflarestream.com/${CONFIG.VIDEO_IDS.social}/iframe`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { updateIndex, deployToCloudflare };