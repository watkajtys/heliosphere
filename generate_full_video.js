#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Comprehensive Solar Time-lapse Video Generator
 * Generates full 24-hour video with detailed logging of smart fallback system
 */

import { blendFrames } from './frame-interpolation/index.js';

// Configuration - Optimized 12-minute intervals (2.5 minute video)
const CONFIG = {
    frameCount: 3600,            // 30 days at 12-minute intervals (2.5 min video at 24fps)
    intervalMinutes: 12,         // 12 minutes between frames (matches LASCO cadence)
    hoursBack: 744,             // Start 31 days ago (744 hours for stable data)
    baseUrl: 'http://localhost:3004/verified-composite',
    outputDir: 'optimized_12min_frames',
    interpolatedOutputDir: 'interpolated_frames', // Directory for final, interpolated frames
    interpolationFactor: 2,      // 2x interpolation (1 intermediate frame)
    style: 'ad-astra',
    cropWidth: 1440,
    cropHeight: 1200,
    concurrency: 3,             // Max parallel frame generations
    retryAttempts: 2,           // Retry failed frames
    // Enhanced logging for multi-day test
    logFallbacks: true,         // Detailed fallback activation logging
    logSearchSteps: true        // Log every search step attempt
};

// Global logging state
const LOG = {
    startTime: new Date().toISOString(),
    frames: [],
    summary: {
        totalApiCalls: 0,
        totalProcessingTime: 0,
        smartSearchesTriggered: 0,
        exactMatches: 0,
        fallbacksUsed: 0,
        uniquenessFailures: 0,
        retries: 0
    }
};

// Progress state for real-time monitoring
const PROGRESS = {
    status: 'starting',
    progress: { current: 0, total: CONFIG.frameCount },
    performance: { avgTime: 0, totalTime: 0 },
    fallbacks: { count: 0, rate: 0, details: [] },
    log: [],
    lastUpdate: new Date().toISOString()
};

// Update shared progress file for monitoring dashboard
function updateProgressFile() {
    try {
        fs.writeFileSync('video_progress.json', JSON.stringify(PROGRESS, null, 2));
    } catch (error) {
        console.error('Failed to write progress file:', error.message);
    }
}

// Add log entry to both console and progress tracking
function logProgress(message, type = 'info') {
    const timestamp = new Date().toISOString().substring(11, 19);
    const logEntry = `[${timestamp}] ${message}`;
    
    console.log(message);
    PROGRESS.log.push(logEntry);
    
    // Keep only last 100 log entries
    if (PROGRESS.log.length > 100) {
        PROGRESS.log = PROGRESS.log.slice(-100);
    }
    
    PROGRESS.lastUpdate = new Date().toISOString();
    updateProgressFile();
}

// Generate timestamps for video frames (chronologically forward)
function generateFrameTimestamps() {
    const now = new Date();
    const startTime = new Date(now.getTime() - CONFIG.hoursBack * 60 * 60 * 1000);
    const timestamps = [];
    
    for (let i = 0; i < CONFIG.frameCount; i++) {
        // Fixed: Add intervals going FORWARD in time for proper chronological sequence
        const frameTime = new Date(startTime.getTime() + (i * CONFIG.intervalMinutes * 60 * 1000));
        timestamps.push({
            frameNum: String(i + 1).padStart(3, '0'),
            timestamp: frameTime.toISOString()
        });
    }
    
    // No reverse needed - already in chronological order (oldest to newest)
    return timestamps;
}

// Enhanced frame generation with detailed logging and full history
async function generateFrameWithLogging(frameData, checksumHistories = { sdo: [], lasco: [] }, attempt = 1) {
    const { frameNum, timestamp } = frameData;
    const frameStartTime = Date.now();
    
    logProgress(`🎬 Frame ${frameNum}/${CONFIG.frameCount}: ${timestamp} ${attempt > 1 ? `(Retry ${attempt})` : ''}`);
    
    // Build request parameters
    const params = new URLSearchParams({
        date: timestamp,
        style: CONFIG.style,
        cropWidth: CONFIG.cropWidth.toString(),
        cropHeight: CONFIG.cropHeight.toString(),
        compositeRadius: '400',
        featherRadius: '40'
    });
    
    // Add checksum histories if they are not empty
    if (checksumHistories.sdo && checksumHistories.sdo.length > 0) {
        params.set('usedSdoChecksums', checksumHistories.sdo.join(','));
        logProgress(`   🔍 Avoiding ${checksumHistories.sdo.length} SDO checksums.`);
    }
    if (checksumHistories.lasco && checksumHistories.lasco.length > 0) {
        params.set('usedLascoChecksums', checksumHistories.lasco.join(','));
    }
    
    const url = `${CONFIG.baseUrl}?${params.toString()}`;
    const apiStartTime = Date.now();
    
    try {
        // Make API request
        const response = await fetch(url);
        const apiDuration = Date.now() - apiStartTime;
        LOG.summary.totalApiCalls++;
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
            console.log(`   📝 Error: ${errorText}`);
            
            // Log smart search rejection (when system refuses duplicates)
            if (errorText.includes('No unique') && errorText.includes('data available')) {
                LOG.summary.smartSearchesTriggered++;
                console.log(`   🧠 Smart search triggered but no unique data found within search window`);
            }
            
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        // Download frame data
        const buffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(buffer);
        
        // Save frame
        const filename = `${CONFIG.outputDir}/frame_${frameNum}.png`;
        fs.writeFileSync(filename, imageBuffer);
        
        // Extract comprehensive metadata
        const frameEndTime = Date.now();
        const processingTime = (frameEndTime - frameStartTime) / 1000;
        LOG.summary.totalProcessingTime += processingTime;
        
        const frameMetadata = {
            frameNum,
            targetTimestamp: timestamp,
            
            // SDO Component Analysis
            sdo: {
                actualDate: response.headers.get('X-SDO-Date'),
                checksum: response.headers.get('X-SDO-Checksum'),
                unique: response.headers.get('X-SDO-Unique') === 'true',
                searchType: response.headers.get('X-SDO-Date') === timestamp ? 'exact_match' : 'smart_fallback'
            },
            
            // LASCO Component Analysis  
            lasco: {
                actualDate: response.headers.get('X-LASCO-Date'),
                checksum: response.headers.get('X-LASCO-Checksum'),
                unique: response.headers.get('X-LASCO-Unique') === 'true',
                searchType: response.headers.get('X-LASCO-Date') === timestamp ? 'exact_match' : 'smart_fallback'
            },
            
            // Overall Quality Metrics
            quality: {
                score: parseFloat(response.headers.get('X-Quality-Score') || '1.0'),
                bothUnique: response.headers.get('X-SDO-Unique') === 'true' && response.headers.get('X-LASCO-Unique') === 'true',
                fallbackUsed: response.headers.get('X-Fallback-Used') === 'true'
            },
            
            // Performance Metrics
            performance: {
                apiResponseTime: apiDuration,
                totalProcessingTime: processingTime,
                fileSize: imageBuffer.length,
                retryAttempt: attempt
            },
            
            // Technical Details
            technical: {
                filename: filename,
                compositeChecksum: crypto.createHash('md5').update(imageBuffer).digest('hex'),
                url: url,
                requestTime: new Date(apiStartTime).toISOString()
            }
        };
        
        // Update summary statistics
        if (frameMetadata.sdo.searchType === 'exact_match' && frameMetadata.lasco.searchType === 'exact_match') {
            LOG.summary.exactMatches++;
        }
        
        if (frameMetadata.quality.fallbackUsed) {
            LOG.summary.fallbacksUsed++;
        }
        
        // Detailed fallback logging
        const sdoFallback = frameMetadata.sdo.searchType === 'smart_fallback';
        const lascoFallback = frameMetadata.lasco.searchType === 'smart_fallback';
        
        if (sdoFallback || lascoFallback) {
            const fallbackDetail = {
                frameNum: frameNum,
                targetTimestamp: timestamp,
                sdoFallback: sdoFallback ? {
                    requestedTime: timestamp,
                    actualTime: frameMetadata.sdo.actualDate,
                    timeDelta: Math.abs(new Date(timestamp) - new Date(frameMetadata.sdo.actualDate)) / (1000 * 60), // minutes
                    unique: frameMetadata.sdo.unique
                } : null,
                lascoFallback: lascoFallback ? {
                    requestedTime: timestamp,
                    actualTime: frameMetadata.lasco.actualDate,
                    timeDelta: Math.abs(new Date(timestamp) - new Date(frameMetadata.lasco.actualDate)) / (1000 * 60), // minutes
                    unique: frameMetadata.lasco.unique
                } : null,
                fallbackResolved: frameMetadata.quality.bothUnique
            };
            
            PROGRESS.fallbacks.details.push(fallbackDetail);
            
            // Enhanced logging for fallback detection
            logProgress(`⚠️  FALLBACK DETECTED - Frame ${frameNum}:`);
            if (sdoFallback) {
                logProgress(`   🌅 SDO: Requested ${timestamp} → Found ${frameMetadata.sdo.actualDate} (Δ${fallbackDetail.sdoFallback.timeDelta.toFixed(1)}min) ${frameMetadata.sdo.unique ? '✅' : '❌'}`);
            }
            if (lascoFallback) {
                logProgress(`   🌙 LASCO: Requested ${timestamp} → Found ${frameMetadata.lasco.actualDate} (Δ${fallbackDetail.lascoFallback.timeDelta.toFixed(1)}min) ${frameMetadata.lasco.unique ? '✅' : '❌'}`);
            }
            logProgress(`   🎯 Resolution: ${fallbackDetail.fallbackResolved ? 'SUCCESS - Both components unique' : 'PARTIAL - Quality may be affected'}`);
        }
        
        if (!frameMetadata.quality.bothUnique) {
            LOG.summary.uniquenessFailures++;
        }
        
        if (attempt > 1) {
            LOG.summary.retries++;
        }
        
        // Log frame results  
        logProgress(`   ✅ Saved: ${filename} (${(frameMetadata.performance.fileSize / 1024 / 1024).toFixed(2)}MB)`);
        logProgress(`   🌅 SDO: ${frameMetadata.sdo.actualDate} → ${(frameMetadata.sdo.checksum || 'N/A').substring(0, 8)}... ${frameMetadata.sdo.unique ? '✅' : '⚠️'} (${frameMetadata.sdo.searchType})`);
        logProgress(`   🌙 LASCO: ${frameMetadata.lasco.actualDate} → ${(frameMetadata.lasco.checksum || 'N/A').substring(0, 8)}... ${frameMetadata.lasco.unique ? '✅' : '⚠️'} (${frameMetadata.lasco.searchType})`);
        logProgress(`   📈 Quality: ${frameMetadata.quality.score} | Processing: ${processingTime.toFixed(1)}s | API: ${apiDuration}ms`);
        
        // Update progress tracking
        PROGRESS.progress.current = parseInt(frameNum);
        PROGRESS.performance.totalTime = LOG.summary.totalProcessingTime;
        PROGRESS.performance.avgTime = LOG.summary.totalProcessingTime / PROGRESS.progress.current;
        PROGRESS.fallbacks.count = LOG.summary.fallbacksUsed;
        PROGRESS.fallbacks.rate = LOG.summary.fallbacksUsed / PROGRESS.progress.current;
        PROGRESS.status = 'running';
        updateProgressFile();
        
        return frameMetadata;
        
    } catch (error) {
        const processingTime = (Date.now() - frameStartTime) / 1000;
        console.log(`   ❌ Failed after ${processingTime.toFixed(1)}s: ${error.message}`);
        
        // Retry logic
        if (attempt < CONFIG.retryAttempts) {
            console.log(`   🔄 Retrying in 2 seconds... (${attempt}/${CONFIG.retryAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            return generateFrameWithLogging(frameData, checksumHistories, attempt + 1);
        }
        
        console.log(`   💀 Frame ${frameNum} failed after ${CONFIG.retryAttempts} attempts`);
        console.log('');
        return null;
    }
}


// New: Stage for handling frame interpolation
async function runInterpolationStage(baseFrames, logData) {
    logProgress('🎬 Starting Frame Interpolation Stage');
    logProgress('====================================');

    if (!CONFIG.interpolationFactor || CONFIG.interpolationFactor <= 1) {
        logProgress('   ⏩ Interpolation factor is <= 1, skipping this stage.');
        return baseFrames.map(f => path.join(CONFIG.outputDir, f.technical.filename));
    }

    const outputDir = CONFIG.interpolatedOutputDir;
    if (fs.existsSync(outputDir)) {
        logProgress(`   🗑️ Clearing existing interpolated frames directory: ${outputDir}`);
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });
    logProgress(`   📁 Created new output directory: ${outputDir}`);

    const finalFrames = [];
    let finalFrameCounter = 1;

    for (let i = 0; i < baseFrames.length; i++) {
        const currentFrameInfo = baseFrames[i];
        const currentFramePath = currentFrameInfo.technical.filename;

        // 1. Copy the base frame to the new directory
        const newBasePath = path.join(outputDir, `frame_${String(finalFrameCounter++).padStart(4, '0')}.png`);
        fs.copyFileSync(currentFramePath, newBasePath);
        finalFrames.push(newBasePath);
        logProgress(`   ➡️ Copied base frame ${path.basename(currentFramePath)} to ${path.basename(newBasePath)}`);

        // 2. Interpolate if there is a next frame
        if (i < baseFrames.length - 1) {
            const nextFrameInfo = baseFrames[i + 1];
            const nextFramePath = nextFrameInfo.technical.filename;

            logProgress(`   🔄 Interpolating between ${path.basename(currentFramePath)} and ${path.basename(nextFramePath)}`);

            // Solar-Physics-Aware Logic: Check for fallbacks before interpolating
            const fallbackUsed = currentFrameInfo.quality.fallbackUsed || nextFrameInfo.quality.fallbackUsed;

            if (fallbackUsed) {
                logProgress(`   ⚠️  Skipping interpolation between ${path.basename(currentFramePath)} and ${path.basename(nextFramePath)} due to fallback data usage.`);
            } else {
                try {
                    const interpolatedPaths = await blendFrames(currentFramePath, nextFramePath, CONFIG.interpolationFactor, outputDir);

                    // Rename and move interpolated frames to their final sequential position
                    for (const interpPath of interpolatedPaths) {
                        const finalInterpPath = path.join(outputDir, `frame_${String(finalFrameCounter++).padStart(4, '0')}.png`);
                        fs.renameSync(interpPath, finalInterpPath);
                        finalFrames.push(finalInterpPath);
                        logProgress(`      ✨ Generated and saved interpolated frame: ${path.basename(finalInterpPath)}`);
                    }
                } catch (error) {
                    logProgress(`      ❌ Error interpolating frames: ${error.message}. Skipping pair.`);
                }
            }
        }
    }

    logProgress(`\n✅ Interpolation complete. Total frames: ${finalFrames.length}`);
    return finalFrames;
}


// Main video generation function
async function generateFullVideo() {
    // Initialize progress tracking
    PROGRESS.status = 'starting';
    PROGRESS.progress.total = CONFIG.frameCount;
    logProgress('🎬 Full Solar Time-lapse Video Generation');
    logProgress('=========================================');
    
    logProgress(`📊 Configuration:`);
    logProgress(`   Frames: ${CONFIG.frameCount}`);
    logProgress(`   Interval: ${CONFIG.intervalMinutes} minutes`);
    logProgress(`   Style: ${CONFIG.style}`);
    logProgress(`   Resolution: ${CONFIG.cropWidth}×${CONFIG.cropHeight}`);
    logProgress(`   Concurrency: 1 (Sequential processing for checksum history)`);
    
    // Ensure output directory exists
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir);
        logProgress(`📁 Created output directory: ${CONFIG.outputDir}`);
    }
    
    // Generate frame timestamps
    const frameTimestamps = generateFrameTimestamps();
    logProgress(`🕐 Generated ${frameTimestamps.length} frame timestamps.`);
    logProgress(`   First: ${frameTimestamps[0].timestamp}`);
    logProgress(`   Last: ${frameTimestamps[frameTimestamps.length - 1].timestamp}`);
    console.log('');
    
    // Process frames sequentially to build checksum history
    logProgress('🚀 Starting sequential frame generation...\n');
    
    const allResults = [];
    const sdoChecksumHistory = [];
    const lascoChecksumHistory = [];
    
    for (const frameData of frameTimestamps) {
        const checksumHistories = {
            sdo: sdoChecksumHistory,
            lasco: lascoChecksumHistory
        };
        
        const result = await generateFrameWithLogging(frameData, checksumHistories);
        
        if (result) {
            allResults.push(result);
            // Add the new, unique checksums to the history for the next frame
            if (result.sdo && result.sdo.checksum) sdoChecksumHistory.push(result.sdo.checksum);
            if (result.lasco && result.lasco.checksum) lascoChecksumHistory.push(result.lasco.checksum);
        }
        
        const progress = (allResults.length / frameTimestamps.length * 100).toFixed(1);
        const eta = allResults.length > 0 ? ((Date.now() - new Date(LOG.startTime).getTime()) / allResults.length) * (frameTimestamps.length - allResults.length) : 0;
        logProgress(`📈 Progress: ${progress}% | ETA: ${(eta / 60000).toFixed(1)}min | Success: ${allResults.length}/${frameTimestamps.length}`);
        console.log('');
    }
    
    // Generate comprehensive report
    const endTime = new Date().toISOString();
    const totalDuration = (new Date(endTime) - new Date(LOG.startTime)) / 1000;
    
    LOG.frames = allResults;
    LOG.endTime = endTime;
    LOG.summary.totalFrames = frameTimestamps.length;
    LOG.summary.successfulFrames = allResults.length;
    LOG.summary.successRate = allResults.length / frameTimestamps.length;
    LOG.summary.totalDuration = totalDuration;
    LOG.summary.avgProcessingTime = LOG.summary.totalProcessingTime / allResults.length;
    
    // Save detailed log
    fs.writeFileSync('video_generation_log.json', JSON.stringify(LOG, null, 2));
    
    // Final results
    console.log('🎯 Video Generation Complete!');
    console.log('============================\n');
    
    console.log(`📊 Results Summary:`);
    console.log(`   Requested frames: ${LOG.summary.totalFrames}`);
    console.log(`   Generated frames: ${LOG.summary.successfulFrames}`);
    console.log(`   Success rate: ${(LOG.summary.successRate * 100).toFixed(1)}%`);
    console.log(`   Total duration: ${(totalDuration / 60).toFixed(1)} minutes`);
    console.log('');
    
    console.log(`🔍 Smart Search Analysis:`);
    console.log(`   Exact matches: ${LOG.summary.exactMatches}/${LOG.summary.successfulFrames} (${(LOG.summary.exactMatches / LOG.summary.successfulFrames * 100).toFixed(1)}%)`);
    console.log(`   Smart fallbacks used: ${LOG.summary.fallbacksUsed}/${LOG.summary.successfulFrames} (${(LOG.summary.fallbacksUsed / LOG.summary.successfulFrames * 100).toFixed(1)}%)`);
    console.log(`   Smart searches triggered: ${LOG.summary.smartSearchesTriggered}`);
    console.log(`   Uniqueness failures: ${LOG.summary.uniquenessFailures}`);
    console.log(`   Retries required: ${LOG.summary.retries}`);
    console.log('');
    
    // New: Run the interpolation stage
    const finalFrameFiles = await runInterpolationStage(allResults, LOG);


    // Video encoding instructions
    if (finalFrameFiles.length > 0) {
        const finalOutputDir = CONFIG.interpolationFactor > 1 ? CONFIG.interpolatedOutputDir : CONFIG.outputDir;
        // Base framerate is 24, multiplied by interpolation factor.
        // If factor is 2, we get 1 intermediate frame, so we have 2x the frames, needing 2x the framerate.
        const finalFrameRate = 24 * CONFIG.interpolationFactor;

        console.log(`🎬 Ready for Video Encoding!`);
        console.log(`   Recommended FFmpeg command:`);
        // Use a 4-digit padded number for the frame sequence to support >999 frames
        console.log(`   ffmpeg -framerate ${finalFrameRate} -i ${finalOutputDir}/frame_%04d.png -c:v libx264 -pix_fmt yuv420p -y solar_timelapse_final.mp4`);
        console.log('');
        
        const videoDuration = finalFrameFiles.length / finalFrameRate;
        console.log(`📹 Expected video duration: ${videoDuration.toFixed(1)} seconds`);
        console.log(`   Covering ${(LOG.summary.successfulFrames * CONFIG.intervalMinutes / 60).toFixed(1)} hours of solar activity`);

    } else {
        console.log(`⚠️  Not enough frames generated to create a video.`);
    }

    return LOG;
}


// Self-executing async function
(async () => {
    try {
        await generateFullVideo();
    } catch (error) {
        console.error('❌ Video generation failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();