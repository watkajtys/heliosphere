#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * Calculates SHA-256 checksum for duplicate detection
 */
function calculateChecksum(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

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

    console.log(`   📡 Fetching from Helioviewer: ${isoDate}`);

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
 * Includes duplicate detection to avoid using identical fallback images
 * Checks against previous frame to ensure temporal progression
 */
async function fetchImageWithFallback(targetDate, apiKey, sourceId, imageScale, width, height, sourceType, previousChecksums = new Set(), previousFrameData = null) {
    // Smart fallback ordering based on empirical data
    // SOHO: -3 and -7 work most often, but limit to ±7min to prevent cascading
    // SDO: rarely needs fallback, keep standard order
    const fallbackSteps = sourceType.includes('SOHO') 
        ? [0, -3, -7, -1, 1, 3, -5, 5, 7] // Optimized order for SOHO, limited to ±7min
        : [0, 1, -1, 3, -3, 5, -5, 7, -7]; // Original for SDO
    const attemptedChecksums = new Set();
    
    for (const step of fallbackSteps) {
        try {
            const adjustedDate = new Date(targetDate.getTime() + step * 60 * 1000);
            const isoDate = adjustedDate.toISOString();
            
            const imageBuffer = await fetchHelioviewerImage(
                isoDate, apiKey, sourceId, imageScale, width, height
            );
            
            // Calculate checksum for duplicate detection
            const checksum = calculateChecksum(imageBuffer);
            
            // Check if this exact image was already used
            if (previousChecksums.has(checksum) || attemptedChecksums.has(checksum)) {
                console.log(`   ⚠️ ${sourceType} fallback ${step}min returned duplicate (${checksum.substring(0, 8)}...), trying next`);
                attemptedChecksums.add(checksum);
                continue; // Try next fallback step
            }
            
            // Check if this matches the previous frame's checksum
            if (previousFrameData && previousFrameData.checksum === checksum) {
                console.log(`   ⚠️ ${sourceType} fallback ${step}min matches previous frame, trying next`);
                attemptedChecksums.add(checksum);
                continue;
            }
            
            if (step !== 0) {
                console.log(`   ⏰ ${sourceType} fallback: ${step > 0 ? '+' : ''}${step} minutes`);
            }
            
            return { 
                imageBuffer, 
                actualDate: adjustedDate, 
                fallbackMinutes: step,
                fallbackUsed: step !== 0,
                checksum: checksum
            };
        } catch (error) {
            if (step === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallback attempts failed for ${sourceType} at ${targetDate.toISOString()}: ${error.message}`);
            }
            continue;
        }
    }
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
 * Applies the Ad Astra color grade to the sun disk
 * This creates the signature golden sun effect
 */
async function gradeSunDisk(imageBuffer) {
    console.log('   🎨 Applying Ad Astra grade to sun disk...');
    const gradedImage = await sharp(imageBuffer)
        .modulate({ 
            saturation: 1.2, 
            brightness: 1.4, 
            hue: 15 
        })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
    return gradedImage;
}

/**
 * Applies the Ad Astra white/cool grade to the corona
 */
async function gradeCorona(imageBuffer) {
    console.log('   🎨 Applying Ad Astra grade to corona...');
    const gradedImage = await sharp(imageBuffer)
        .modulate({ 
            saturation: 0.3, 
            brightness: 1.0, 
            hue: -5 
        })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
    return gradedImage;
}

/**
 * Creates composite image with feathered sun disk and color grading
 */
async function createTunedCompositeImage(isoDate, apiKey, compositeRadius = 400, featherRadius = 40, componentChecksums = { corona: new Set(), sunDisk: new Set() }, previousFrameData = null) {
    const width = 1920;
    const height = 1200;

    // Fetch corona image (SOHO/LASCO C2) with fallback and duplicate detection
    const coronaResult = await fetchImageWithFallback(
        new Date(isoDate), apiKey, 4, 8, width, height, 'SOHO/LASCO', 
        componentChecksums.corona,
        previousFrameData ? previousFrameData.corona : null
    );

    // Fetch sun disk image (SDO/AIA 171) with fallback and duplicate detection
    const sunDiskResult = await fetchImageWithFallback(
        new Date(isoDate), apiKey, 10, 2.5, width, width, 'SDO/AIA', 
        componentChecksums.sunDisk,
        previousFrameData ? previousFrameData.sunDisk : null
    );

    // Apply Ad Astra color grade to corona BEFORE compositing
    const gradedCorona = await gradeCorona(coronaResult.imageBuffer);
    
    // Apply Ad Astra color grade to sun disk BEFORE feathering
    const gradedSunDisk = await gradeSunDisk(sunDiskResult.imageBuffer);

    // Fixed SDO size at 1435px
    const sdoSize = 1435;
    
    // Apply feathering to the graded sun disk
    const featheredSunDisk = await applyCircularFeather(
        gradedSunDisk, sdoSize, compositeRadius, featherRadius
    );

    // Determine the final canvas size (keeping 1920x1435 to preserve composition)
    const finalWidth = Math.max(width, sdoSize);
    const finalHeight = Math.max(height, sdoSize);

    const compositeImage = await sharp({
        create: {
            width: finalWidth,
            height: finalHeight,
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

    // Crop to final dimensions - trimming dead zones from all sides
    // The composite is 1920x1435
    // Final output: 1460x1200 (removing dead zones)
    // Top: 117px, Bottom: 118px, Left: 230px, Right: 230px
    const croppedImage = await sharp(compositeImage)
        .extract({
            left: 230,    // Remove 230px from left
            top: 117,     // Remove 117px from top
            width: 1460,  // Final width: 1920 - 230 - 230 = 1460
            height: 1200  // Final height: 1435 - 117 - 118 = 1200
        })
        .png()
        .toBuffer();

    return {
        imageBuffer: croppedImage,
        fallbackInfo: {
            corona: coronaResult.fallbackMinutes,
            sunDisk: sunDiskResult.fallbackMinutes,
            totalFallbacks: (coronaResult.fallbackUsed ? 1 : 0) + (sunDiskResult.fallbackUsed ? 1 : 0)
        },
        componentChecksums: {
            corona: coronaResult.checksum,
            sunDisk: sunDiskResult.checksum
        },
        actualDates: {
            corona: coronaResult.actualDate,
            sunDisk: sunDiskResult.actualDate
        }
    };
}

/**
 * Updates progress file for monitor
 */
async function updateProgress(current, total, startTime, fallbackCount, logMessages = []) {
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
        log: logMessages.slice(-50), // Keep last 50 log entries
        lastUpdate: new Date().toISOString()
    };

    await fs.writeFile('progress.json', JSON.stringify(progress, null, 2));
}

/**
 * Main function to generate optimized video
 */
async function generateOptimizedVideo(duration = 30, fps = 30) {
    console.log(`🎬 Generating ${duration}-second Solar Video at ${fps} FPS`);
    console.log('✨ Features: Color grading, 1920x1200 crop, duplicate prevention');
    console.log('📊 Configuration: 15-minute intervals, ±1,3,5,7 min fallback\n');

    const totalFrames = duration * fps; // e.g., 30 seconds × 30 FPS = 900 frames
    const intervalMinutes = 15; // 15-minute intervals
    const framesDir = `video_${duration}sec_optimized`;
    const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
    
    // Create frames directory
    await fs.mkdir(framesDir, { recursive: true });
    
    // Calculate time span
    const totalMinutes = totalFrames * intervalMinutes;
    const totalDays = totalMinutes / 60 / 24;
    console.log(`📅 Time span: ${totalFrames} frames × ${intervalMinutes} min = ${totalDays.toFixed(1)} days\n`);
    
    const startTime = Date.now();
    let fallbackCount = 0;
    let duplicateCount = 0;
    let componentDuplicates = 0;
    let adjacentDuplicates = 0;
    const frameChecksums = new Set();
    const componentChecksums = { 
        corona: new Set(), 
        sunDisk: new Set() 
    };
    const frameTimestamps = []; // Track actual timestamps used for each frame
    const logMessages = [];
    
    // Enhanced fallback tracking
    const fallbackStats = {
        corona: { total: 0, byOffset: {} },
        sunDisk: { total: 0, byOffset: {} }
    };
    
    // Start from current time minus 2 days (for data availability) and go backwards
    const endDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    
    // Adaptive interval tracking
    let consecutiveFailures = 0;
    let adaptiveIntervalMinutes = intervalMinutes;
    
    for (let i = 0; i < totalFrames; i++) {
        const frameNumber = i + 1;
        console.log(`\n🖼️  Processing frame ${frameNumber}/${totalFrames}...`);
        
        // Calculate timestamp with adaptive interval (going forward in time)
        // Start from oldest and move forward so video plays chronologically
        const minutesBack = (totalFrames - 1 - i) * adaptiveIntervalMinutes;
        const frameDate = new Date(endDate.getTime() - minutesBack * 60 * 1000);
        
        console.log(`   📅 Target time: ${frameDate.toISOString()}`);
        logMessages.push(`Frame ${frameNumber}: ${frameDate.toISOString()}`);
        
        // Get previous frame data for temporal checking
        const previousFrameData = frameNumber > 1 ? frameTimestamps[frameNumber - 2] : null;
        
        try {
            const result = await createTunedCompositeImage(
                frameDate.toISOString(), 
                apiKey,
                400,  // compositeRadius (updated from 600)
                40,   // featherRadius
                componentChecksums,  // Pass checksums for duplicate detection
                previousFrameData ? {
                    corona: {
                        actualDate: new Date(previousFrameData.actualCorona),
                        checksum: previousFrameData.coronaChecksum
                    },
                    sunDisk: {
                        actualDate: new Date(previousFrameData.actualSunDisk),
                        checksum: previousFrameData.sunDiskChecksum
                    }
                } : null
            );
            
            // Store frame timestamp data
            frameTimestamps[frameNumber - 1] = {
                frameNumber: frameNumber,
                requested: frameDate.toISOString(),
                actualCorona: result.actualDates.corona.toISOString(),  // Store actual corona timestamp
                actualSunDisk: result.actualDates.sunDisk.toISOString(), // Store actual sun disk timestamp
                coronaChecksum: result.componentChecksums.corona,
                sunDiskChecksum: result.componentChecksums.sunDisk,
                compositeChecksum: calculateChecksum(result.imageBuffer)
            };
            
            // Add component checksums to tracking sets
            componentChecksums.corona.add(result.componentChecksums.corona);
            componentChecksums.sunDisk.add(result.componentChecksums.sunDisk);
            
            // Check for adjacent frame duplicates
            if (previousFrameData) {
                if (previousFrameData.coronaChecksum === result.componentChecksums.corona) {
                    adjacentDuplicates++;
                    console.log(`   🔴 WARNING: Corona matches previous frame!`);
                    logMessages.push(`   🔴 Frame ${frameNumber}: Corona duplicate with frame ${frameNumber-1}`);
                }
                if (previousFrameData.sunDiskChecksum === result.componentChecksums.sunDisk) {
                    adjacentDuplicates++;
                    console.log(`   🔴 WARNING: Sun disk matches previous frame!`);
                    logMessages.push(`   🔴 Frame ${frameNumber}: Sun disk duplicate with frame ${frameNumber-1}`);
                }
            }
            
            // Check for duplicates using checksum
            const checksum = calculateChecksum(result.imageBuffer);
            if (frameChecksums.has(checksum)) {
                duplicateCount++;
                console.log(`   ⚠️  Duplicate detected (checksum: ${checksum.substring(0, 8)}...)`);
                logMessages.push(`   ⚠️ Frame ${frameNumber}: Duplicate detected`);
            }
            frameChecksums.add(checksum);
            
            // Track fallbacks with detailed statistics
            if (result.fallbackInfo.totalFallbacks > 0) {
                fallbackCount += result.fallbackInfo.totalFallbacks;
                
                // Track corona fallback
                if (result.fallbackInfo.corona !== 0) {
                    fallbackStats.corona.total++;
                    const offset = result.fallbackInfo.corona;
                    fallbackStats.corona.byOffset[offset] = (fallbackStats.corona.byOffset[offset] || 0) + 1;
                }
                
                // Track sun disk fallback
                if (result.fallbackInfo.sunDisk !== 0) {
                    fallbackStats.sunDisk.total++;
                    const offset = result.fallbackInfo.sunDisk;
                    fallbackStats.sunDisk.byOffset[offset] = (fallbackStats.sunDisk.byOffset[offset] || 0) + 1;
                }
                
                const fallbackMsg = `   🔄 Fallbacks: Corona ${result.fallbackInfo.corona}min, Sun ${result.fallbackInfo.sunDisk}min`;
                console.log(fallbackMsg);
                logMessages.push(fallbackMsg);
            }
            
            // Save frame with proper padding for FFmpeg
            const framePath = path.join(framesDir, `frame_${frameNumber.toString().padStart(4, '0')}.png`);
            await fs.writeFile(framePath, result.imageBuffer);
            
            console.log(`   ✅ Saved: ${framePath} (1920x1200, color graded)`);
            logMessages.push(`   ✅ Frame ${frameNumber}: Saved successfully`);
            
            // Update progress for monitor
            await updateProgress(frameNumber, totalFrames, startTime, fallbackCount, logMessages);
            
            // Reset consecutive failures on success
            consecutiveFailures = 0;
            
        } catch (error) {
            console.error(`   ❌ Failed to process frame ${frameNumber}: ${error.message}`);
            logMessages.push(`   ❌ Frame ${frameNumber}: ${error.message}`);
            
            // Track consecutive failures for adaptive intervals
            consecutiveFailures++;
            
            // Adapt interval if too many consecutive failures
            if (consecutiveFailures >= 3 && adaptiveIntervalMinutes === 15) {
                console.log(`   🔄 Switching to 12-minute intervals due to data availability issues`);
                adaptiveIntervalMinutes = 12; // Switch to match SOHO cadence
                consecutiveFailures = 0;
            } else if (consecutiveFailures >= 3 && adaptiveIntervalMinutes === 12) {
                console.log(`   🔄 Switching to 24-minute intervals for better data availability`);
                adaptiveIntervalMinutes = 24; // Double the cadence
                consecutiveFailures = 0;
            }
            
            // Continue with next frame rather than failing completely
        }
        
        // Progress indicator
        const percent = ((frameNumber / totalFrames) * 100).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        const avgTime = elapsed / frameNumber;
        const eta = (totalFrames - frameNumber) * avgTime;
        
        console.log(`   📊 Progress: ${percent}% | Avg: ${avgTime.toFixed(1)}s/frame | ETA: ${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`);
    }
    
    // Post-generation validation pass
    console.log('\n🔍 Running post-generation validation...');
    let sequenceDuplicates = 0;
    const allChecksums = new Map();
    
    for (let i = 0; i < frameTimestamps.length; i++) {
        const frame = frameTimestamps[i];
        
        // Check for any duplicates across entire sequence
        if (allChecksums.has(frame.compositeChecksum)) {
            const originalFrame = allChecksums.get(frame.compositeChecksum);
            console.log(`   ⚠️ Frame ${frame.frameNumber} duplicates frame ${originalFrame}`);
            sequenceDuplicates++;
        } else {
            allChecksums.set(frame.compositeChecksum, frame.frameNumber);
        }
        
        // Check temporal spacing
        if (i > 0) {
            const prevFrame = frameTimestamps[i - 1];
            const coronaDiff = Math.abs(new Date(frame.actualCorona) - new Date(prevFrame.actualCorona)) / (60 * 1000);
            const sunDiskDiff = Math.abs(new Date(frame.actualSunDisk) - new Date(prevFrame.actualSunDisk)) / (60 * 1000);
            
            if (coronaDiff < 5 || sunDiskDiff < 5) {
                console.log(`   ⏰ Frame ${frame.frameNumber}: Temporal spacing issue (Corona: ${coronaDiff.toFixed(1)}min, Sun: ${sunDiskDiff.toFixed(1)}min)`);
            }
        }
    }
    
    // Generate final video with correct chronological order (oldest to newest)
    console.log(`\n🎥 Creating ${duration}-second video at ${fps} FPS...`);
    
    const outputFile = `solar_${duration}sec_${fps}fps_optimized.mp4`;
    const videoCmd = `ffmpeg -y -framerate ${fps} -i "${framesDir}/frame_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 "${outputFile}"`;
    
    console.log('   🔄 Running FFmpeg...');
    logMessages.push('Creating final video with FFmpeg...');
    await updateProgress(totalFrames, totalFrames, startTime, fallbackCount, logMessages);
    
    try {
        const { stdout, stderr } = await execAsync(videoCmd);
        if (stderr && !stderr.includes('frame=')) {
            console.log('   ⚠️ FFmpeg warnings:', stderr);
        }
    } catch (error) {
        console.error('   ❌ FFmpeg error:', error.message);
        throw error;
    }
    
    console.log(`\n✅ Video Generation Complete!`);
    console.log(`📁 Output: ${outputFile}`);
    console.log(`📊 Statistics:`);
    console.log(`   • Frames: ${totalFrames}`);
    console.log(`   • Fallbacks: ${fallbackCount} (${(fallbackCount/totalFrames*100).toFixed(1)}% rate)`);
    console.log(`   • Composite duplicates: ${duplicateCount} (${(duplicateCount/totalFrames*100).toFixed(1)}% rate)`);
    console.log(`   • Adjacent duplicates: ${adjacentDuplicates} components`);
    console.log(`   • Sequence duplicates: ${sequenceDuplicates} frames`);
    console.log(`   • Resolution: 1460x1200 (73:60 aspect ratio)`);
    console.log(`   • Interval: ${adaptiveIntervalMinutes} minutes${adaptiveIntervalMinutes !== intervalMinutes ? ' (adapted from ' + intervalMinutes + ')' : ''}`);
    console.log(`   • Features: Color grading, feathering, dead zone removal`);
    
    // Detailed fallback analysis
    console.log(`\n📈 Fallback Analysis:`);
    console.log(`   Corona (SOHO/LASCO):`);
    console.log(`     • Total: ${fallbackStats.corona.total} fallbacks`);
    if (fallbackStats.corona.total > 0) {
        const sorted = Object.entries(fallbackStats.corona.byOffset).sort((a,b) => b[1] - a[1]);
        sorted.forEach(([offset, count]) => {
            console.log(`     • ${offset}min: ${count} times (${(count/fallbackStats.corona.total*100).toFixed(0)}%)`);
        });
    }
    console.log(`   Sun Disk (SDO/AIA):`);
    console.log(`     • Total: ${fallbackStats.sunDisk.total} fallbacks`);
    if (fallbackStats.sunDisk.total > 0) {
        const sorted = Object.entries(fallbackStats.sunDisk.byOffset).sort((a,b) => b[1] - a[1]);
        sorted.forEach(([offset, count]) => {
            console.log(`     • ${offset}min: ${count} times (${(count/fallbackStats.sunDisk.total*100).toFixed(0)}%)`);
        });
    }
    
    console.log(`\n⏱️  Total time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
    
    // Final progress update
    logMessages.push('✅ Video generation complete!');
    await updateProgress(totalFrames, totalFrames, startTime, fallbackCount, logMessages);
}

// Parse command line arguments
const args = process.argv.slice(2);
const duration = parseInt(args[0]) || 30; // Default 30 seconds
const fps = parseInt(args[1]) || 30;       // Default 30 FPS

// Run the generator
generateOptimizedVideo(duration, fps).catch(console.error);