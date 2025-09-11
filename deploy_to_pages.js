#!/usr/bin/env node

/**
 * Deploy updated Heliosphere site to Cloudflare Pages
 * Updates video IDs from cloudflare_videos.json and deploys
 */

import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLOUDFLARE_CONFIG = {
    PROJECT_NAME: 'heliosphere',
    PAGES_API_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN,
    ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID
};

// Validate environment variables
function validateEnvironment() {
    const required = ['CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => console.error(`   - ${key}`));
        console.error('\n📝 Set these in your .env file or environment');
        process.exit(1);
    }
}

async function updateIndexHtml() {
    console.log('📝 Updating index.html with new video IDs...');
    
    // Read video IDs from cloudflare_videos.json
    const videoJsonPath = '/opt/heliosphere/cloudflare_videos.json';
    let videoIds;
    
    try {
        const videoData = fs.readFileSync(videoJsonPath, 'utf8');
        videoIds = JSON.parse(videoData);
        console.log('   Found video IDs:', videoIds);
    } catch (error) {
        console.error('❌ Failed to read video IDs:', error);
        process.exit(1);
    }
    
    // Extract just the video ID (remove ?tusv2=true if present)
    const fullId = videoIds.full ? videoIds.full.split('?')[0] : null;
    const socialId = videoIds.social ? videoIds.social.split('?')[0] : null;
    const portraitId = videoIds.portrait ? videoIds.portrait.split('?')[0] : null;
    
    if (!fullId || !socialId || !portraitId) {
        console.error('❌ Missing required video IDs');
        process.exit(1);
    }
    
    // Read the template index.html
    const templatePath = path.join(__dirname, 'heliosphere-pages', 'index.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');
    
    // Get current date for updates
    const todayISO = new Date().toISOString();
    const todayDate = todayISO.split('T')[0];
    const formattedDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    // Update the VIDEO_IDS object
    htmlContent = htmlContent.replace(
        /const VIDEO_IDS = \{[^}]+\}/s,
        `const VIDEO_IDS = {
            desktop: '${fullId}', // Full video (updated ${formattedDate})
            mobile: '${portraitId}', // Portrait video (updated ${formattedDate})
            social: '${socialId}' // Social square video (updated ${formattedDate})
        }`
    );
    
    // Update the default iframe src
    htmlContent = htmlContent.replace(
        /src="https:\/\/customer-[^"]+"/,
        `src="https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/iframe?autoplay=true&muted=true&loop=true&controls=false&preload=auto"`
    );
    
    // Update Open Graph video meta tags
    htmlContent = htmlContent.replace(
        /<meta property="og:video" content="[^"]+"/,
        `<meta property="og:video" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/iframe"`
    );
    
    htmlContent = htmlContent.replace(
        /<meta property="og:image" content="[^"]+"/,
        `<meta property="og:image" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/thumbnails/thumbnail.jpg?time=30s"`
    );
    
    // Update Twitter player meta tags
    htmlContent = htmlContent.replace(
        /<meta property="twitter:player" content="[^"]+"/,
        `<meta property="twitter:player" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/iframe"`
    );
    
    htmlContent = htmlContent.replace(
        /<meta property="twitter:image" content="[^"]+"/,
        `<meta property="twitter:image" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/thumbnails/thumbnail.jpg?time=30s"`
    );
    
    // Update structured data dates
    htmlContent = htmlContent.replace(
        /"uploadDate": "[^"]+"/g,
        `"uploadDate": "${todayDate}"`
    );
    
    htmlContent = htmlContent.replace(
        /"datePublished": "[^"]+"/g,
        `"datePublished": "${todayDate}"`
    );
    
    htmlContent = htmlContent.replace(
        /"dateModified": "[^"]+"/g,
        `"dateModified": "${todayDate}"`
    );
    
    // Update structured data video URLs
    htmlContent = htmlContent.replace(
        /"thumbnailUrl": "https:\/\/customer-[^"]+"/,
        `"thumbnailUrl": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/thumbnails/thumbnail.jpg?time=30s"`
    );
    
    htmlContent = htmlContent.replace(
        /"contentUrl": "https:\/\/customer-[^"]+"/,
        `"contentUrl": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/manifest/video.m3u8"`
    );
    
    htmlContent = htmlContent.replace(
        /"embedUrl": "https:\/\/customer-[^"]+"/,
        `"embedUrl": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${fullId}/iframe"`
    );
    
    // Write updated HTML
    const outputPath = path.join(__dirname, 'heliosphere-pages', 'index.html');
    fs.writeFileSync(outputPath, htmlContent);
    console.log('✅ index.html updated successfully');
    
    return { fullId, socialId, portraitId };
}

async function deployToPages() {
    console.log('\n🚀 Deploying to Cloudflare Pages...');
    
    if (!CLOUDFLARE_CONFIG.PAGES_API_TOKEN) {
        console.error('❌ CLOUDFLARE_PAGES_API_TOKEN not set');
        console.log('   Please set the API token in environment or .env file');
        process.exit(1);
    }
    
    const deployDir = path.join(__dirname, 'heliosphere-pages');
    
    // Deploy using wrangler with API token
    const deployCmd = `CLOUDFLARE_API_TOKEN="${CLOUDFLARE_CONFIG.PAGES_API_TOKEN}" npx wrangler pages deploy "${deployDir}" --project-name=${CLOUDFLARE_CONFIG.PROJECT_NAME} --branch=main`;
    
    console.log('⬆️ Uploading to Cloudflare Pages...');
    
    try {
        const { stdout, stderr } = await execAsync(deployCmd, {
            maxBuffer: 10 * 1024 * 1024,
            cwd: __dirname,
            env: {
                ...process.env,
                CLOUDFLARE_API_TOKEN: CLOUDFLARE_CONFIG.PAGES_API_TOKEN
            }
        });
        
        if (stderr && !stderr.includes('Success')) {
            console.error('⚠️ Warning:', stderr);
        }
        
        console.log(stdout);
        console.log('\n✅ Deployment successful!');
        console.log('🌐 Site will be live at: https://heliolens.builtbyvibes.com');
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('🌟 Heliosphere Cloudflare Pages Deployment');
    console.log('==========================================\n');
    
    // Validate environment before proceeding
    validateEnvironment();
    
    try {
        // Update HTML with new video IDs
        const videoIds = await updateIndexHtml();
        
        // Deploy to Cloudflare Pages
        await deployToPages();
        
        console.log('\n📊 Summary:');
        console.log(`   Full Video ID: ${videoIds.fullId}`);
        console.log(`   Social Video ID: ${videoIds.socialId}`);
        console.log(`   Portrait Video ID: ${videoIds.portraitId}`);
        console.log(`   Deployment: Success`);
        console.log(`   Time: ${new Date().toISOString()}`);
        
    } catch (error) {
        console.error('\n❌ Deployment failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { updateIndexHtml, deployToPages };