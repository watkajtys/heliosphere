#!/usr/bin/env node

// Regenerate specific July dates with correct grading
// This is a modified version of vps_daily_cron.js that only processes July 10-12

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import sharp from 'sharp';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration - ONLY process July 10-12
const CONFIG = {
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames',
    START_DATE: new Date('2025-07-10T00:00:00Z'),
    END_DATE: new Date('2025-07-12T23:45:00Z'),
    
    // Frame settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    
    // Composite settings  
    FINAL_WIDTH: 1460,
    FINAL_HEIGHT: 1200,
    SUN_DISK_SIZE: 1435,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    
    // Processing
    BATCH_SIZE: 8,
    API_TIMEOUT: 30000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    
    // Fallback timing
    MAX_FALLBACK_OFFSET: 14,
};

console.log('🔄 Regenerating July 10-12 frames with correct white corona...\n');

// Simple fetch with timeout
async function fetchWithTimeout(url, timeout = CONFIG.API_TIMEOUT) {
    const https = await import('https');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Request timeout'));
        }, timeout);
        
        https.get(url, (res) => {
            clearTimeout(timer);
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Apply circular feather
async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize)
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    const imageRadius = finalSize / 2;
    const compositeRatio = compositeRadius / imageRadius;
    const featherStart = Math.max(0, compositeRadius - featherRadius);
    const featherStartRatio = featherStart / imageRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${featherStartRatio * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${compositeRatio * 100}%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="50%" cy="50%" r="50%" fill="url(#feather)" />
        </svg>`;

    return await sharp(resizedImage)
        .composite([{
            input: Buffer.from(svgMask),
            blend: 'dest-in'
        }])
        .toBuffer();
}

// Process single frame
async function processFrame(frameDate) {
    const dateStr = frameDate.toISOString().split('T')[0];
    const timeStr = frameDate.toTimeString().slice(0, 5).replace(':', '');
    const frameDir = path.join(CONFIG.FRAMES_DIR, dateStr);
    const framePath = path.join(frameDir, `frame_${timeStr}.jpg`);
    
    // Create directory
    await fs.mkdir(frameDir, { recursive: true });
    
    // Remove milliseconds from date string (causes API errors)
    const apiDateStr = frameDate.toISOString().replace(/\.\d{3}/, '');
    
    // Fetch corona (SOHO/LASCO C2)
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${apiDateStr}&layers=[4,1,100]&imageScale=8&width=1920&height=1200` +
        `&x0=0&y0=0&display=true&watermark=false`;
    
    // Fetch sun disk (SDO/AIA 171)
    const sunUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${apiDateStr}&layers=[10,1,100]&imageScale=2.5&width=1920&height=1920` +
        `&x0=0&y0=0&display=true&watermark=false`;
    
    console.log(`  Processing ${dateStr} ${timeStr}...`);
    
    try {
        // Fetch both images in parallel
        const [coronaBuffer, sunBuffer] = await Promise.all([
            fetchWithTimeout(coronaUrl),
            fetchWithTimeout(sunUrl)
        ]);
        
        // Apply warm grading to sun disk BEFORE feathering
        const gradedSunDisk = await sharp(sunBuffer)
            .modulate({
                brightness: 1.3,
                saturation: 0.95
            })
            .gamma(1.05)
            .linear(1.3, -8)
            .toBuffer();
        
        // Apply circular feather
        const featheredSunDisk = await applyCircularFeather(
            gradedSunDisk,
            CONFIG.SUN_DISK_SIZE,
            CONFIG.COMPOSITE_RADIUS,
            CONFIG.FEATHER_RADIUS
        );
        
        // Apply cool/blue grading to corona for white appearance
        const gradedCorona = await sharp(coronaBuffer)
            .modulate({ 
                saturation: 0.3,
                brightness: 1.0,
                hue: -5
            })
            .tint({ r: 220, g: 230, b: 240 })  // Blue-white tint
            .linear(1.2, -12)
            .gamma(1.2)
            .toBuffer();
        
        // Create composite
        const compositeImage = await sharp({
            create: {
                width: 1920,
                height: 1435,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([
            { input: gradedCorona, gravity: 'center' },
            { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
        ])
        .png()
        .toBuffer();
        
        // Crop to final size
        const finalFrame = await sharp(compositeImage)
            .extract({ 
                left: 230,
                top: 117,
                width: CONFIG.FINAL_WIDTH,
                height: CONFIG.FINAL_HEIGHT
            })
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        // Save frame
        await fs.writeFile(framePath, finalFrame);
        console.log(`    ✅ Saved ${framePath}`);
        
    } catch (error) {
        console.error(`    ❌ Failed: ${error.message}`);
    }
}

// Main processing
async function main() {
    const frames = [];
    const current = new Date(CONFIG.START_DATE);
    
    // Generate list of frames to process
    while (current <= CONFIG.END_DATE) {
        frames.push(new Date(current));
        current.setMinutes(current.getMinutes() + CONFIG.INTERVAL_MINUTES);
    }
    
    console.log(`📊 Processing ${frames.length} frames from July 10-12\n`);
    
    // Process in batches
    for (let i = 0; i < frames.length; i += CONFIG.BATCH_SIZE) {
        const batch = frames.slice(i, i + CONFIG.BATCH_SIZE);
        await Promise.all(batch.map(frame => processFrame(frame)));
        
        const progress = ((i + batch.length) / frames.length * 100).toFixed(1);
        console.log(`  Progress: ${progress}%\n`);
    }
    
    console.log('✨ Regeneration complete!\n');
    
    // Verify frames
    console.log('📊 Verification:');
    for (const date of ['2025-07-10', '2025-07-11', '2025-07-12']) {
        try {
            const testFrame = path.join(CONFIG.FRAMES_DIR, date, 'frame_1200.jpg');
            await fs.access(testFrame);
            const stats = await fs.stat(testFrame);
            console.log(`  ✅ ${date}: ${(stats.size / 1024).toFixed(1)} KB`);
        } catch {
            console.log(`  ❌ ${date}: Missing`);
        }
    }
}

main().catch(console.error);