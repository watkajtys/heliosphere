#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';

const execAsync = promisify(exec);

/**
 * Fetches an image from the Helioviewer API for a single data source.
 */
async function fetchHelioviewerImage(isoDate, apiKey, sourceId, imageScale, width, height) {
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

    console.log(`Fetching Helioviewer image from: ${apiUrl.toString()}`);

    const response = await fetch(apiUrl.toString(), {
        headers: {
            'X-API-Key': apiKey,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Helioviewer API request failed with status ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

/**
 * Fetches image with fallback logic using ±1,3,5,7 minute intervals
 */
async function fetchImageWithFallback(targetDate, apiKey, sourceId, imageScale, width, height) {
    const fallbackSteps = [0, 1, -1, 3, -3, 5, -5, 7, -7]; // ±1,3,5,7 minutes
    
    for (const step of fallbackSteps) {
        try {
            const adjustedDate = new Date(targetDate.getTime() + step * 60 * 1000);
            const isoDate = adjustedDate.toISOString();
            
            const imageBuffer = await fetchHelioviewerImage(
                isoDate, apiKey, sourceId, imageScale, width, height
            );
            
            if (step !== 0) {
                console.log(`   ↳ Used fallback: ${step > 0 ? '+' : ''}${step} minutes`);
            }
            
            return { imageBuffer, actualDate: adjustedDate, fallbackUsed: step !== 0 };
        } catch (error) {
            if (step === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallback attempts failed for ${targetDate.toISOString()}: ${error.message}`);
            }
            continue;
        }
    }
}

/**
 * Creates composite image with feathered sun disk
 */
async function createCompositeImage(isoDate, apiKey, compositeRadius = 600, featherRadius = 40) {
    const width = 1920;
    const height = 1200;

    // Fetch corona image (SOHO/LASCO C2)
    const coronaResult = await fetchImageWithFallback(
        new Date(isoDate), apiKey, 4, 8, width, height
    );

    // Fetch sun disk image (SDO/AIA 171)  
    const sunDiskResult = await fetchImageWithFallback(
        new Date(isoDate), apiKey, 10, 2.5, width, width
    );

    // Apply feathering to sun disk
    const sdoSize = 1435;
    const featheredSunDisk = await applyCircularFeather(
        sunDiskResult.imageBuffer, sdoSize, compositeRadius, featherRadius
    );

    // Create composite
    const finalWidth = Math.max(width, sdoSize);
    const finalHeight = Math.max(height, sdoSize);

    const finalImage = await sharp({
        create: {
            width: finalWidth,
            height: finalHeight,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: coronaResult.imageBuffer, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
    ])
    .png()
    .toBuffer();

    return {
        imageBuffer: finalImage,
        fallbacksUsed: coronaResult.fallbackUsed + sunDiskResult.fallbackUsed
    };
}

/**
 * Applies circular feathering to image
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

    const maskedImage = await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();

    return maskedImage;
}

/**
 * Updates progress file for monitor
 */
async function updateProgress(current, total, startTime, fallbackCount) {
    const progress = {
        status: current >= total ? 'completed' : 'running',
        progress: { current, total },
        performance: {
            avgTime: current > 0 ? (Date.now() - startTime) / 1000 / current : 0,
            totalTime: (Date.now() - startTime) / 1000
        },
        fallbacks: {
            count: fallbackCount,
            rate: current > 0 ? (fallbackCount / current) * 100 : 0
        },
        log: [`Frame ${current}/${total} - ${current >= total ? 'Complete!' : 'Processing...'}`],
        lastUpdate: new Date().toISOString()
    };

    await fs.writeFile('progress.json', JSON.stringify(progress, null, 2));
}

/**
 * Main function to generate 30-second video at 30 FPS
 */
async function generate30SecondVideo() {
    console.log('🎬 Generating 30-second Solar Video at 30 FPS');
    console.log('📊 Configuration: 900 frames, 15-minute intervals, ±1,3,5,7 min fallback\n');

    const totalFrames = 900; // 30 seconds × 30 FPS
    const intervalMinutes = 15; // 15-minute intervals
    const framesDir = 'video_30sec_frames';
    const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
    
    // Create frames directory
    await fs.mkdir(framesDir, { recursive: true });
    
    // Calculate time span: 900 frames × 15 minutes = 13,500 minutes = 225 hours = 9.375 days
    console.log(`📅 Time span: ${totalFrames} frames × ${intervalMinutes} min = ${(totalFrames * intervalMinutes / 60 / 24).toFixed(1)} days\n`);
    
    const startTime = Date.now();
    let fallbackCount = 0;
    
    // Start from current time and go backwards
    const endDate = new Date();
    
    for (let i = 0; i < totalFrames; i++) {
        const frameNumber = i + 1;
        console.log(`\n🖼️ Processing frame ${frameNumber}/${totalFrames}...`);
        
        // Calculate timestamp (going backwards in time)
        const minutesBack = i * intervalMinutes;
        const frameDate = new Date(endDate.getTime() - minutesBack * 60 * 1000);
        
        console.log(`   📅 Target time: ${frameDate.toISOString()}`);
        
        try {
            const result = await createCompositeImage(frameDate.toISOString(), apiKey);
            
            if (result.fallbacksUsed > 0) {
                fallbackCount += result.fallbacksUsed;
            }
            
            // Save frame
            const framePath = path.join(framesDir, `frame_${frameNumber.toString().padStart(4, '0')}.png`);
            await fs.writeFile(framePath, result.imageBuffer);
            
            console.log(`   ✅ Saved: ${framePath}`);
            
            // Update progress for monitor
            await updateProgress(frameNumber, totalFrames, startTime, fallbackCount);
            
        } catch (error) {
            console.error(`   ❌ Failed to process frame ${frameNumber}: ${error.message}`);
            // Continue with next frame rather than failing completely
        }
        
        // Progress indicator
        const percent = ((frameNumber / totalFrames) * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTime = elapsed / frameNumber;
        const eta = (totalFrames - frameNumber) * avgTime;
        
        console.log(`   📊 Progress: ${percent}% | ETA: ${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`);
    }
    
    // Generate final video
    console.log(`\n🎥 Creating 30-second video at 30 FPS...`);
    
    const videoCmd = `ffmpeg -y -framerate 30 -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 solar_30sec_30fps.mp4`;
    
    console.log('   🔄 Running FFmpeg...');
    await execAsync(videoCmd);
    
    console.log(`\n✅ Video Generation Complete!`);
    console.log(`📁 Output: solar_30sec_30fps.mp4`);
    console.log(`📊 Stats: ${totalFrames} frames, ${fallbackCount} fallbacks (${(fallbackCount/totalFrames*100).toFixed(1)}% rate)`);
    console.log(`⏱️ Total time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
    
    // Final progress update
    await updateProgress(totalFrames, totalFrames, startTime, fallbackCount);
}

// Run the generator
generate30SecondVideo().catch(console.error);