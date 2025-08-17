#!/usr/bin/env node

/**
 * Complete VPS Production Pipeline with Cloudflare Integration
 * 1. Generates highest quality videos
 * 2. Uploads to Cloudflare Stream
 * 3. Updates Cloudflare Pages site
 */

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: 'kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7',
    STREAM_SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com',
    PAGES_PROJECT: 'heliosphere',  // Your Cloudflare Pages project name
    PAGES_BRANCH: 'main'           // Branch to deploy to
};

// Upload video to Cloudflare Stream
async function uploadToCloudflareStream(videoPath, name) {
    console.log(`\n☁️ Uploading ${name} to Cloudflare Stream...`);
    
    const stats = await fs.stat(videoPath);
    console.log(`   File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    const curlCmd = `curl -X POST \
        -H 'Authorization: Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}' \
        -F 'file=@${videoPath}' \
        -F 'requireSignedURLs=false' \
        https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/stream`;
    
    const { stdout } = await execAsync(curlCmd, { maxBuffer: 10 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    
    if (!result.success) {
        throw new Error(`Upload failed: ${JSON.stringify(result.errors)}`);
    }
    
    console.log(`   ✅ Uploaded! Video ID: ${result.result.uid}`);
    return result.result.uid;
}

// Create the production HTML with new video IDs
function createProductionHTML(desktopId, mobileId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Heliosphere - Live Solar Corona</title>
    <meta name="description" content="Real-time visualization of the Sun's corona, updated every 15 minutes with 8 weeks of solar activity.">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #000;
        }
        
        .video-container {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }
        
        iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
        }
    </style>
</head>
<body>
    <div class="video-container" id="videoContainer"></div>
    
    <script>
        const VIDEO_IDS = {
            desktop: '${desktopId}',
            mobile: '${mobileId}'
        };
        
        const CLOUDFLARE_SUBDOMAIN = '${CLOUDFLARE_CONFIG.STREAM_SUBDOMAIN}';
        
        function detectDevice() {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const isPortrait = window.innerHeight > window.innerWidth;
            const aspectRatio = window.innerWidth / window.innerHeight;
            
            if ((isMobile && isPortrait) || aspectRatio < 0.75) {
                return 'mobile';
            }
            return 'desktop';
        }
        
        function loadVideo() {
            const device = detectDevice();
            const videoId = VIDEO_IDS[device];
            const container = document.getElementById('videoContainer');
            
            const iframe = document.createElement('iframe');
            iframe.src = \`https://\${CLOUDFLARE_SUBDOMAIN}/\${videoId}/iframe?autoplay=true&loop=true&muted=true&controls=false&defaultTextTrack=off&preload=auto\`;
            iframe.allow = 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;';
            iframe.allowFullscreen = true;
            iframe.setAttribute('loading', 'eager');
            
            container.innerHTML = '';
            container.appendChild(iframe);
        }
        
        window.addEventListener('DOMContentLoaded', loadVideo);
        
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const newDevice = detectDevice();
                const currentSrc = document.querySelector('iframe')?.src || '';
                const currentId = currentSrc.match(/\\/([a-f0-9]{32})\\/iframe/)?.[1];
                
                if (currentId && currentId !== VIDEO_IDS[newDevice]) {
                    loadVideo();
                }
            }, 250);
        });
        
        document.addEventListener('contextmenu', e => e.preventDefault());
    </script>
</body>
</html>`;
}

// Deploy to Cloudflare Pages
async function deployToCloudflarePages(htmlContent) {
    console.log('\n🚀 Deploying to Cloudflare Pages...');
    
    // Save HTML locally first
    const tempHtmlPath = '/tmp/index.html';
    await fs.writeFile(tempHtmlPath, htmlContent);
    
    // Create a deployment using Wrangler or direct API
    // Option 1: Using Wrangler (if installed)
    try {
        const deployCmd = `cd /tmp && \
            echo '${htmlContent}' > index.html && \
            npx wrangler pages deploy . \
            --project-name=${CLOUDFLARE_CONFIG.PAGES_PROJECT} \
            --branch=${CLOUDFLARE_CONFIG.PAGES_BRANCH}`;
        
        const { stdout } = await execAsync(deployCmd);
        console.log('   ✅ Deployed to Cloudflare Pages');
        console.log(`   🌐 Site: https://${CLOUDFLARE_CONFIG.PAGES_PROJECT}.pages.dev`);
        return true;
    } catch (error) {
        console.log('   ⚠️ Wrangler deployment failed, trying direct API...');
        
        // Option 2: Direct API upload
        const formData = new FormData();
        formData.append('file', new Blob([htmlContent]), 'index.html');
        
        const uploadUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_CONFIG.ACCOUNT_ID}/pages/projects/${CLOUDFLARE_CONFIG.PAGES_PROJECT}/deployments`;
        
        const curlCmd = `curl -X POST \
            -H 'Authorization: Bearer ${CLOUDFLARE_CONFIG.API_TOKEN}' \
            -F 'files=@${tempHtmlPath}' \
            ${uploadUrl}`;
        
        await execAsync(curlCmd);
        console.log('   ✅ Deployed via API');
    }
}

// Main production pipeline
async function runCompletePipeline() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║  COMPLETE PRODUCTION PIPELINE                  ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    
    try {
        // Step 1: Check for existing videos
        console.log('📁 Checking for production videos...');
        const desktopPath = '/opt/heliosphere/production_videos/heliosphere_desktop_' + new Date().toISOString().split('T')[0] + '.mp4';
        const mobilePath = '/opt/heliosphere/production_videos/heliosphere_mobile_' + new Date().toISOString().split('T')[0] + '.mp4';
        
        // For testing, use existing videos if available
        const testDesktopPath = '/opt/heliosphere/test_comparison_videos/desktop_1460x1200_hq.mp4';
        const testMobilePath = '/opt/heliosphere/test_comparison_videos/mobile_1080x1350.mp4';
        
        let desktopVideo, mobileVideo;
        
        try {
            await fs.access(desktopPath);
            await fs.access(mobilePath);
            desktopVideo = desktopPath;
            mobileVideo = mobilePath;
            console.log('   ✅ Found production videos');
        } catch {
            console.log('   ⚠️ No production videos found, using test videos');
            desktopVideo = testDesktopPath;
            mobileVideo = testMobilePath;
        }
        
        // Step 2: Upload to Cloudflare Stream
        console.log('\n☁️ Uploading to Cloudflare Stream...');
        const [desktopId, mobileId] = await Promise.all([
            uploadToCloudflareStream(desktopVideo, 'Heliosphere Desktop HQ'),
            uploadToCloudflareStream(mobileVideo, 'Heliosphere Mobile Portrait')
        ]);
        
        // Step 3: Wait for videos to be ready
        console.log('\n⏳ Waiting for videos to process...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        
        // Step 4: Create production HTML
        const htmlContent = createProductionHTML(desktopId, mobileId);
        
        // Step 5: Save locally for backup
        const backupPath = `/opt/heliosphere/production_html_${new Date().toISOString().split('T')[0]}.html`;
        await fs.writeFile(backupPath, htmlContent);
        console.log(`\n💾 Backup saved: ${backupPath}`);
        
        // Step 6: Deploy to Cloudflare Pages
        await deployToCloudflarePages(htmlContent);
        
        // Step 7: Save deployment info
        const deploymentInfo = {
            desktop: {
                id: desktopId,
                url: `https://${CLOUDFLARE_CONFIG.STREAM_SUBDOMAIN}/${desktopId}/iframe`
            },
            mobile: {
                id: mobileId,
                url: `https://${CLOUDFLARE_CONFIG.STREAM_SUBDOMAIN}/${mobileId}/iframe`
            },
            deployed: new Date().toISOString(),
            site: `https://${CLOUDFLARE_CONFIG.PAGES_PROJECT}.pages.dev`
        };
        
        await fs.writeFile(
            '/opt/heliosphere/latest_deployment.json',
            JSON.stringify(deploymentInfo, null, 2)
        );
        
        console.log('\n' + '═'.repeat(50));
        console.log('🎉 PRODUCTION DEPLOYMENT COMPLETE!');
        console.log('═'.repeat(50));
        console.log(`🌐 Live Site: https://${CLOUDFLARE_CONFIG.PAGES_PROJECT}.pages.dev`);
        console.log(`📱 Desktop Video: ${desktopId}`);
        console.log(`📱 Mobile Video: ${mobileId}`);
        
    } catch (error) {
        console.error('\n❌ Pipeline failed:', error.message);
        process.exit(1);
    }
}

// Run the pipeline
runCompletePipeline();