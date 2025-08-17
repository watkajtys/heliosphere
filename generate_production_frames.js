#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import fetch from 'node-fetch';

const execAsync = promisify(exec);

// Production configuration
const CONFIG = {
    TOTAL_DAYS: 56,
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    TOTAL_FRAMES: 5376, // 56 × 96
    FPS: 24,
    OUTPUT_DIR: 'production_frames',
    MANIFEST_FILE: 'production_manifest.json',
    API_KEY: process.env.NASA_API_KEY || 'DEMO_KEY',
    MONITOR_URL: 'http://localhost:3001/api',
    // Tuning parameters
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    // Frame dimensions
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200
};

// Manifest structure
let manifest = {
    version: '1.0',
    config: CONFIG,
    startTime: null,
    lastUpdate: null,
    frames: [],
    completed: [],
    failed: [],
    stats: {
        totalFrames: CONFIG.TOTAL_FRAMES,
        completedFrames: 0,
        failedFrames: 0,
        fallbacksUsed: 0,
        coronaFallbacks: 0,
        sunDiskFallbacks: 0,
        totalRetries: 0
    },
    checksums: new Set()
};

/**
 * Load existing manifest or create new one
 */
async function loadManifest() {
    try {
        const data = await fs.readFile(CONFIG.MANIFEST_FILE, 'utf-8');
        const loaded = JSON.parse(data);
        manifest = {
            ...loaded,
            checksums: new Set(loaded.checksums || [])
        };
        console.log(`📋 Loaded existing manifest: ${manifest.stats.completedFrames}/${CONFIG.TOTAL_FRAMES} frames`);
        return true;
    } catch (error) {
        console.log('📝 Creating new manifest');
        manifest.startTime = new Date().toISOString();
        return false;
    }
}

/**
 * Save manifest to disk
 */
async function saveManifest() {
    manifest.lastUpdate = new Date().toISOString();
    const toSave = {
        ...manifest,
        checksums: Array.from(manifest.checksums)
    };
    await fs.writeFile(CONFIG.MANIFEST_FILE, JSON.stringify(toSave, null, 2));
}

/**
 * Send update to monitor
 */
async function updateMonitor(frameNumber, success, fallbackInfo = null, checksum = null) {
    try {
        await fetch(`${CONFIG.MONITOR_URL}/frame-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                frameNumber,
                success,
                fallbackInfo,
                checksum,
                timestamp: new Date().toISOString()
            })
        });
    } catch (error) {
        // Monitor might not be running, that's OK
    }
}

/**
 * Log to monitor
 */
async function logToMonitor(message, type = 'info') {
    try {
        await fetch(`${CONFIG.MONITOR_URL}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, type })
        });
    } catch (error) {
        // Monitor might not be running, that's OK
    }
}

/**
 * Calculate SHA-256 checksum
 */
function calculateChecksum(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Fetch image from Helioviewer API with smart fallback
 */
async function fetchHelioviewerImage(isoDate, sourceId, imageScale, width, height) {
    const apiUrl = new URL('https://api.helioviewer.org/v2/takeScreenshot/');
    apiUrl.searchParams.set('date', isoDate);
    apiUrl.searchParams.set('layers', `[${sourceId},1,100]`);
    apiUrl.searchParams.set('imageScale', imageScale.toString());
    apiUrl.searchParams.set('width', width.toString());
    apiUrl.searchParams.set('height', height.toString());
    apiUrl.searchParams.set('x0', '0');
    apiUrl.searchParams.set('y0', '0');
    apiUrl.searchParams.set('display', 'true');
    apiUrl.searchParams.set('watermark', 'false');

    const response = await fetch(apiUrl.toString(), {
        headers: {
            'X-API-Key': CONFIG.API_KEY,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Helioviewer API failed: ${response.status} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * Fetch with fallback - THIS IS EXPECTED BEHAVIOR, NOT A FAILURE
 */
async function fetchImageWithFallback(targetDate, sourceId, imageScale, width, height, sourceType) {
    const fallbackSteps = sourceType.includes('SOHO') 
        ? [0, -3, -7, -1, 1, 3, -5, 5, 7] // Optimized for SOHO
        : [0, 1, -1, 3, -3, 5, -5, 7, -7]; // Standard for SDO
    
    for (const step of fallbackSteps) {
        try {
            const adjustedDate = new Date(targetDate.getTime() + step * 60 * 1000);
            const isoDate = adjustedDate.toISOString();
            
            const imageBuffer = await fetchHelioviewerImage(
                isoDate, sourceId, imageScale, width, height
            );
            
            return { 
                imageBuffer, 
                actualDate: adjustedDate, 
                fallbackMinutes: step,
                fallbackUsed: step !== 0
            };
        } catch (error) {
            if (step === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks exhausted for ${sourceType}: ${error.message}`);
            }
        }
    }
}

/**
 * Apply circular feathering
 */
async function applyCircularFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize)
        .toBuffer();

    if (featherRadius <= 0) {
        return resizedImage;
    }

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
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();

    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

/**
 * Apply Ad Astra color grading
 */
async function gradeSunDisk(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

async function gradeCorona(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

/**
 * Create composite frame with fallback tracking
 */
async function createProductionFrame(frameDate, frameNumber) {
    console.log(`\n🎬 Frame ${frameNumber}/${CONFIG.TOTAL_FRAMES}`);
    console.log(`   📅 Target: ${frameDate.toISOString()}`);
    
    const fallbackInfo = {
        corona: 0,
        sunDisk: 0,
        totalFallbacks: 0
    };
    
    try {
        // Fetch corona (SOHO/LASCO C2)
        const coronaResult = await fetchImageWithFallback(
            frameDate, 4, 8, 1920, 1200, 'SOHO/LASCO'
        );
        
        if (coronaResult.fallbackUsed) {
            fallbackInfo.corona = coronaResult.fallbackMinutes;
            fallbackInfo.totalFallbacks++;
            manifest.stats.coronaFallbacks++;
            console.log(`   ⏰ Corona fallback: ${coronaResult.fallbackMinutes}min (EXPECTED)`);
            await logToMonitor(`Frame ${frameNumber}: Corona using ${coronaResult.fallbackMinutes}min offset`, 'warning');
        }
        
        // Fetch sun disk (SDO/AIA 171)
        const sunDiskResult = await fetchImageWithFallback(
            frameDate, 10, 2.5, 1920, 1920, 'SDO/AIA'
        );
        
        if (sunDiskResult.fallbackUsed) {
            fallbackInfo.sunDisk = sunDiskResult.fallbackMinutes;
            fallbackInfo.totalFallbacks++;
            manifest.stats.sunDiskFallbacks++;
            console.log(`   ⏰ Sun disk fallback: ${sunDiskResult.fallbackMinutes}min (EXPECTED)`);
            await logToMonitor(`Frame ${frameNumber}: Sun disk using ${sunDiskResult.fallbackMinutes}min offset`, 'warning');
        }
        
        // Apply color grading
        const gradedCorona = await gradeCorona(coronaResult.imageBuffer);
        const gradedSunDisk = await gradeSunDisk(sunDiskResult.imageBuffer);
        
        // Apply feathering
        const featheredSunDisk = await applyCircularFeather(
            gradedSunDisk, 1435, CONFIG.COMPOSITE_RADIUS, CONFIG.FEATHER_RADIUS
        );
        
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
        
        // Crop to final dimensions
        const finalImage = await sharp(compositeImage)
            .extract({
                left: 230,
                top: 117,
                width: CONFIG.FRAME_WIDTH,
                height: CONFIG.FRAME_HEIGHT
            })
            .png()
            .toBuffer();
        
        // Calculate checksum
        const checksum = calculateChecksum(finalImage);
        
        // Check for duplicates
        if (manifest.checksums.has(checksum)) {
            console.log(`   ⚠️  Duplicate detected (expected with fallbacks)`);
        }
        manifest.checksums.add(checksum);
        
        // Save frame
        const framePath = path.join(CONFIG.OUTPUT_DIR, `frame_${frameNumber.toString().padStart(4, '0')}.png`);
        await fs.writeFile(framePath, finalImage);
        
        // Update manifest
        manifest.frames.push({
            number: frameNumber,
            date: frameDate.toISOString(),
            checksum,
            fallbacks: fallbackInfo,
            path: framePath
        });
        manifest.completed.push(frameNumber);
        manifest.stats.completedFrames++;
        
        if (fallbackInfo.totalFallbacks > 0) {
            manifest.stats.fallbacksUsed++;
        }
        
        console.log(`   ✅ Frame ${frameNumber} complete (fallbacks: ${fallbackInfo.totalFallbacks})`);
        await updateMonitor(frameNumber, true, fallbackInfo, checksum);
        
        return true;
        
    } catch (error) {
        console.error(`   ❌ Frame ${frameNumber} FAILED: ${error.message}`);
        await logToMonitor(`Frame ${frameNumber} FAILED: ${error.message}`, 'error');
        
        manifest.failed.push({
            number: frameNumber,
            date: frameDate.toISOString(),
            error: error.message,
            retries: manifest.failed.filter(f => f.number === frameNumber).length + 1
        });
        manifest.stats.failedFrames++;
        
        await updateMonitor(frameNumber, false);
        return false;
    }
}

/**
 * Main production generation
 */
async function generateProduction() {
    console.log('🌟 Heliosphere Production Frame Generator');
    console.log(`📊 Target: ${CONFIG.TOTAL_FRAMES} frames (${CONFIG.TOTAL_DAYS} days)`);
    console.log(`🎬 Output: ${Math.floor(CONFIG.TOTAL_FRAMES / CONFIG.FPS / 60)}:${(CONFIG.TOTAL_FRAMES / CONFIG.FPS % 60).toFixed(0).padStart(2, '0')} at ${CONFIG.FPS} FPS\n`);
    
    // Create output directory
    await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
    
    // Load existing manifest
    const resuming = await loadManifest();
    
    if (resuming) {
        console.log(`📂 Resuming from frame ${manifest.stats.completedFrames + 1}`);
        await logToMonitor(`Resuming generation from frame ${manifest.stats.completedFrames + 1}`, 'info');
    } else {
        await logToMonitor('Starting new production generation', 'success');
    }
    
    // Calculate time range
    const endDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago for availability
    const startDate = new Date(endDate.getTime() - CONFIG.TOTAL_DAYS * 24 * 60 * 60 * 1000);
    
    console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}\n`);
    
    const startTime = Date.now();
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 10;
    
    // Generate frames
    for (let i = manifest.stats.completedFrames; i < CONFIG.TOTAL_FRAMES; i++) {
        const frameNumber = i + 1;
        
        // Calculate frame timestamp (oldest to newest for correct playback)
        const minutesFromStart = i * CONFIG.INTERVAL_MINUTES;
        const frameDate = new Date(startDate.getTime() + minutesFromStart * 60 * 1000);
        
        // Check if frame already completed
        if (manifest.completed.includes(frameNumber)) {
            console.log(`⏭️  Frame ${frameNumber} already completed, skipping`);
            continue;
        }
        
        // Generate frame
        const success = await createProductionFrame(frameDate, frameNumber);
        
        if (success) {
            consecutiveFailures = 0;
        } else {
            consecutiveFailures++;
            if (consecutiveFailures >= maxConsecutiveFailures) {
                console.error(`\n❌ Too many consecutive failures (${maxConsecutiveFailures}), stopping`);
                await logToMonitor(`Stopping: ${maxConsecutiveFailures} consecutive failures`, 'error');
                break;
            }
        }
        
        // Save manifest every 10 frames
        if (frameNumber % 10 === 0) {
            await saveManifest();
            console.log(`   💾 Manifest saved (${manifest.stats.completedFrames}/${CONFIG.TOTAL_FRAMES})`);
        }
        
        // Progress update
        if (frameNumber % 50 === 0) {
            const elapsed = (Date.now() - startTime) / 1000 / 60;
            const framesPerMinute = frameNumber / elapsed;
            const remaining = (CONFIG.TOTAL_FRAMES - frameNumber) / framesPerMinute;
            
            console.log(`\n📊 Progress Report:`);
            console.log(`   • Completed: ${manifest.stats.completedFrames}/${CONFIG.TOTAL_FRAMES} (${(manifest.stats.completedFrames/CONFIG.TOTAL_FRAMES*100).toFixed(1)}%)`);
            console.log(`   • Failed: ${manifest.stats.failedFrames}`);
            console.log(`   • Fallbacks: ${manifest.stats.fallbacksUsed} frames used fallbacks`);
            console.log(`   • Corona fallbacks: ${manifest.stats.coronaFallbacks}`);
            console.log(`   • Sun disk fallbacks: ${manifest.stats.sunDiskFallbacks}`);
            console.log(`   • Speed: ${framesPerMinute.toFixed(1)} frames/min`);
            console.log(`   • ETA: ${Math.floor(remaining)} minutes\n`);
        }
    }
    
    // Final save
    await saveManifest();
    
    // Final report
    const totalTime = (Date.now() - startTime) / 1000 / 60;
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL PRODUCTION REPORT');
    console.log('='.repeat(60));
    console.log(`✅ Completed: ${manifest.stats.completedFrames}/${CONFIG.TOTAL_FRAMES} frames`);
    console.log(`❌ Failed: ${manifest.stats.failedFrames} frames`);
    console.log(`⏰ Fallbacks used: ${manifest.stats.fallbacksUsed} frames (${(manifest.stats.fallbacksUsed/manifest.stats.completedFrames*100).toFixed(1)}%)`);
    console.log(`   • Corona: ${manifest.stats.coronaFallbacks}`);
    console.log(`   • Sun disk: ${manifest.stats.sunDiskFallbacks}`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes`);
    console.log(`🚀 Average speed: ${(manifest.stats.completedFrames/totalTime).toFixed(1)} frames/minute`);
    
    if (manifest.stats.completedFrames === CONFIG.TOTAL_FRAMES) {
        console.log('\n🎉 PRODUCTION COMPLETE! Ready to generate video.');
        await logToMonitor('Production generation complete!', 'success');
    } else {
        console.log('\n⚠️  Production incomplete. Run again to resume.');
        await logToMonitor(`Production incomplete: ${manifest.stats.completedFrames}/${CONFIG.TOTAL_FRAMES}`, 'warning');
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    generateProduction().catch(console.error);
}

export { generateProduction, manifest };