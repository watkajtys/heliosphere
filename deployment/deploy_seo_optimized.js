#!/usr/bin/env node

/**
 * Deploy SEO-Optimized Immersive Video to Cloudflare Pages
 */

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    PAGES_TOKEN: 'Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ',
    STREAM_SUBDOMAIN: 'customer-931z4aajcqul6afi.cloudflarestream.com'
};

function createSEOOptimizedHTML(desktopId, mobileId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    
    <!-- Primary Meta Tags -->
    <title>Heliosphere - Real-Time Solar Corona Visualization</title>
    <meta name="title" content="Heliosphere - Real-Time Solar Corona Visualization">
    <meta name="description" content="Experience the sun's corona in real-time. Watch 8 weeks of solar activity in a mesmerizing 56-second loop, updated daily with NASA satellite imagery.">
    <meta name="keywords" content="solar corona, sun visualization, heliosphere, solar activity, NASA, SDO, SOHO, space weather, solar dynamics, real-time sun">
    <meta name="robots" content="index, follow">
    <meta name="language" content="English">
    <meta name="author" content="Heliosphere">
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://heliosphere.pages.dev/">
    <meta property="og:title" content="Heliosphere - Real-Time Solar Corona Visualization">
    <meta property="og:description" content="Experience the sun's corona in real-time. Watch 8 weeks of solar activity in a mesmerizing 56-second loop.">
    <meta property="og:image" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${desktopId}/thumbnails/thumbnail.jpg?time=4s">
    <meta property="og:image:width" content="1460">
    <meta property="og:image:height" content="1200">
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image">
    <meta property="twitter:url" content="https://heliosphere.pages.dev/">
    <meta property="twitter:title" content="Heliosphere - Real-Time Solar Corona">
    <meta property="twitter:description" content="Watch 8 weeks of solar activity in 56 seconds. Updated daily with NASA satellite imagery.">
    <meta property="twitter:image" content="https://customer-931z4aajcqul6afi.cloudflarestream.com/${desktopId}/thumbnails/thumbnail.jpg?time=4s">
    
    <!-- PWA & Mobile -->
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <meta name="apple-mobile-web-app-title" content="Heliosphere">
    <meta name="application-name" content="Heliosphere">
    <meta name="theme-color" content="#000000">
    
    <!-- Canonical -->
    <link rel="canonical" href="https://heliosphere.pages.dev/">
    
    <!-- Preconnect for performance -->
    <link rel="preconnect" href="https://customer-931z4aajcqul6afi.cloudflarestream.com">
    <link rel="dns-prefetch" href="https://customer-931z4aajcqul6afi.cloudflarestream.com">
    
    <!-- Structured Data -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "Heliosphere",
        "description": "Real-time solar corona visualization showing 8 weeks of solar activity",
        "url": "https://heliosphere.pages.dev",
        "applicationCategory": "EducationalApplication",
        "operatingSystem": "Any",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD"
        },
        "creator": {
            "@type": "Organization",
            "name": "Heliosphere",
            "url": "https://heliosphere.pages.dev"
        },
        "keywords": "solar corona, sun, space, astronomy, NASA, real-time",
        "screenshot": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${desktopId}/thumbnails/thumbnail.jpg?time=4s",
        "video": {
            "@type": "VideoObject",
            "name": "Solar Corona Time-Lapse",
            "description": "8 weeks of solar corona activity",
            "thumbnailUrl": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${desktopId}/thumbnails/thumbnail.jpg?time=4s",
            "uploadDate": "${new Date().toISOString()}",
            "duration": "PT56S",
            "contentUrl": "https://customer-931z4aajcqul6afi.cloudflarestream.com/${desktopId}/manifest/video.m3u8"
        }
    }
    </script>
    
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
        
        /* Hidden SEO content for crawlers */
        .seo-content {
            position: absolute;
            left: -9999px;
            width: 1px;
            height: 1px;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div class="video-container" id="videoContainer"></div>
    <div class="interaction-blocker"></div>
    
    <!-- Hidden content for SEO -->
    <div class="seo-content">
        <h1>Heliosphere - Real-Time Solar Corona Visualization</h1>
        <p>Experience the breathtaking beauty of our sun's corona through Heliosphere, a real-time visualization that captures 8 weeks of solar activity in a mesmerizing 56-second loop. Updated daily with the latest imagery from NASA's Solar Dynamics Observatory (SDO) and ESA/NASA's Solar and Heliospheric Observatory (SOHO), witness solar flares, coronal mass ejections, and the dynamic dance of plasma in the sun's atmosphere.</p>
        <h2>Features</h2>
        <ul>
            <li>Real-time solar corona imagery updated every 24 hours</li>
            <li>8 weeks of solar activity compressed into 56 seconds</li>
            <li>High-resolution visualization from NASA satellites</li>
            <li>Seamless loop showing the sun's dynamic atmosphere</li>
            <li>Mobile and desktop optimized viewing experience</li>
        </ul>
    </div>
    
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
            iframe.setAttribute('title', 'Solar Corona Visualization');
            
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

async function deploySEOOptimized() {
    console.log('\n🚀 Deploying SEO-Optimized Immersive Video\n');
    
    try {
        let desktopId = '18638d6599c14a7d8034adf6fc39e8eb';
        let mobileId = 'a31d4d4eac5b4dee8d02a86259a6f326';
        
        try {
            const deployment = await fs.readFile('/opt/heliosphere/latest_deployment.json', 'utf8');
            const data = JSON.parse(deployment);
            if (data.desktop?.id) desktopId = data.desktop.id;
            if (data.mobile?.id) mobileId = data.mobile.id;
        } catch {}
        
        const htmlContent = createSEOOptimizedHTML(desktopId, mobileId);
        
        await fs.mkdir('/tmp/heliosphere-seo', { recursive: true });
        await fs.writeFile('/tmp/heliosphere-seo/index.html', htmlContent);
        
        console.log('✅ SEO-optimized HTML generated\n');
        
        const deployCmd = `CLOUDFLARE_API_TOKEN='${CLOUDFLARE_CONFIG.PAGES_TOKEN}' wrangler pages deploy /tmp/heliosphere-seo --project-name=heliosphere --branch=main`;
        
        const { stdout } = await execAsync(deployCmd);
        
        const urlMatch = stdout.match(/https:\/\/[^\s]+\.pages\.dev/);
        if (urlMatch) {
            console.log(`\n🌐 Deployed to: ${urlMatch[0]}`);
        }
        
        console.log('\n✨ SEO-Optimized Deployment Complete!');
        console.log('\n📊 SEO Features:');
        console.log('   ✅ Rich meta tags');
        console.log('   ✅ Open Graph for social sharing');
        console.log('   ✅ Twitter Cards');
        console.log('   ✅ Structured data (Schema.org)');
        console.log('   ✅ Canonical URL');
        console.log('   ✅ Performance optimizations');
        console.log('\n🌐 https://heliosphere.pages.dev');
        
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

deploySEOOptimized();