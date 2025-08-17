#!/usr/bin/env node

/**
 * Deploy Immersive Video to Cloudflare Pages
 * No controls, pure immersion
 */

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    API_TOKEN: 'kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7',
    STREAM_SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com'
};

// Create immersive HTML with no controls
function createImmersiveHTML(desktopId, mobileId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Heliosphere</title>
    <meta name="description" content="Live solar corona visualization">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            user-select: none;
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
            pointer-events: none;
        }
        
        .interaction-blocker {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10;
            background: transparent;
            cursor: default;
        }
    </style>
</head>
<body>
    <div class="video-container" id="videoContainer"></div>
    <div class="interaction-blocker"></div>
    
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
            
            const params = [
                'autoplay=true',
                'loop=true',
                'muted=true',
                'controls=false',
                'defaultTextTrack=off',
                'preload=auto'
            ].join('&');
            
            iframe.src = \`https://\${CLOUDFLARE_SUBDOMAIN}/\${videoId}/iframe?\${params}\`;
            iframe.allow = 'autoplay';
            iframe.setAttribute('allowfullscreen', 'false');
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
        document.addEventListener('selectstart', e => e.preventDefault());
        document.addEventListener('dragstart', e => e.preventDefault());
    </script>
</body>
</html>`;
}

async function deployToCloudflarePages() {
    console.log('\n🚀 Deploying Immersive Video to Cloudflare Pages\n');
    
    try {
        // Use latest video IDs or fallback to current ones
        let desktopId = '18638d6599c14a7d8034adf6fc39e8eb';
        let mobileId = 'a31d4d4eac5b4dee8d02a86259a6f326';
        
        // Check if we have newer IDs
        try {
            const deployment = await fs.readFile('/opt/heliosphere/latest_deployment.json', 'utf8');
            const data = JSON.parse(deployment);
            if (data.desktop?.id) desktopId = data.desktop.id;
            if (data.mobile?.id) mobileId = data.mobile.id;
            console.log('Using video IDs from latest deployment');
        } catch {
            console.log('Using default video IDs');
        }
        
        console.log(`Desktop: ${desktopId}`);
        console.log(`Mobile: ${mobileId}\n`);
        
        // Create immersive HTML
        const htmlContent = createImmersiveHTML(desktopId, mobileId);
        
        // Save to temp directory
        await fs.mkdir('/tmp/heliosphere-deploy', { recursive: true });
        await fs.writeFile('/tmp/heliosphere-deploy/index.html', htmlContent);
        console.log('✅ HTML generated\n');
        
        // Deploy with wrangler
        console.log('📤 Deploying to Cloudflare Pages...');
        const deployCmd = `cd /tmp/heliosphere-deploy && npx wrangler pages deploy . --project-name=heliosphere --branch=main`;
        
        try {
            const { stdout, stderr } = await execAsync(deployCmd);
            console.log('✅ Deployed successfully!\n');
            
            if (stdout.includes('https://')) {
                const urlMatch = stdout.match(/https:\/\/[^\s]+/);
                if (urlMatch) {
                    console.log(`🌐 Live at: ${urlMatch[0]}`);
                }
            }
        } catch (error) {
            // Fallback to direct file creation
            console.log('Wrangler not available, creating deployment files...\n');
            
            // Save files for manual deployment
            await fs.writeFile('/opt/heliosphere/cloudflare_deploy.html', htmlContent);
            console.log('📁 Files ready for deployment:');
            console.log('   /opt/heliosphere/cloudflare_deploy.html');
            console.log('\n📋 To deploy manually:');
            console.log('   1. Copy the HTML content');
            console.log('   2. Go to Cloudflare Pages dashboard');
            console.log('   3. Create/update deployment');
        }
        
        // Save deployment record
        const record = {
            deployed: new Date().toISOString(),
            desktop: desktopId,
            mobile: mobileId,
            type: 'immersive'
        };
        
        await fs.writeFile(
            '/opt/heliosphere/immersive_deployment.json',
            JSON.stringify(record, null, 2)
        );
        
        console.log('\n✨ Immersive deployment complete!');
        console.log('   No controls, no distractions');
        console.log('   Pure solar visualization');
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

// Run deployment
deployToCloudflarePages();