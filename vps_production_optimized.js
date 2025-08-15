#!/usr/bin/env node

/**
 * Optimized Production System with Smart Concurrency
 * Handles duplicate detection across parallel fetches
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    // Concurrency settings
    FETCH_CONCURRENCY: 8,     // Parallel image fetches
    PROCESS_CONCURRENCY: 4,   // Parallel frame processing
    BATCH_SIZE: 100,          // Save state every N frames
    
    // DUPLICATE DETECTION STRATEGY
    // When parallel fetching, we need a two-phase approach:
    // 1. Fetch Phase: Collect all images with checksums
    // 2. Validation Phase: Check for duplicates and retry with fallbacks
    DUPLICATE_CHECK_BATCH: 20, // Check duplicates every N frames
    
    // Time windows
    SAFE_DELAY_DAYS: 2,
    TOTAL_DAYS: 56,
    SOCIAL_DAYS: 30,
    
    // Frame settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    FPS: 24,
    
    // Fallback limits
    MAX_FALLBACK_MINUTES: 14,
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    // Storage
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    STATE_FILE: '/opt/heliosphere/production_state.json',
    TEMP_DIR: '/tmp/heliosphere'
};

// Global state with duplicate tracking
let productionState = {
    status: 'idle',
    startTime: null,
    totalFrames: 0,
    processedFrames: 0,
    duplicateRetries: 0,
    checksumCache: {
        // Track ALL checksums ever seen
        corona: new Map(), // checksum -> [frameNumbers]
        sunDisk: new Map() // checksum -> [frameNumbers]
    },
    pendingFrames: [], // Frames being fetched in parallel
    frameQueue: [],    // Frames ready for processing
};

/**
 * DUPLICATE DETECTION STRATEGY
 * 
 * Problem: When fetching 8 frames in parallel, we might fetch 8 identical
 * images before realizing they're duplicates.
 * 
 * Solution:
 * 1. Fetch in batches with checksum calculation
 * 2. After each batch, check for duplicates
 * 3. Retry duplicates with fallbacks sequentially
 * 4. Use a global checksum cache across all frames
 */

// Calculate checksum for image buffer
function calculateChecksum(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

// Track checksum and detect duplicates
function isDuplicate(checksum, sourceType, frameNumber) {
    const cache = sourceType === 'corona' 
        ? productionState.checksumCache.corona
        : productionState.checksumCache.sunDisk;
    
    if (cache.has(checksum)) {
        const existingFrames = cache.get(checksum);
        // It's a duplicate if this checksum was seen in a different frame
        const isDupe = existingFrames.some(f => Math.abs(f - frameNumber) > 1);
        if (isDupe) {
            console.log(`⚠️ Duplicate ${sourceType} detected! Frame ${frameNumber} matches frames ${existingFrames.join(', ')}`);
            return true;
        }
    }
    
    // Add to cache
    if (!cache.has(checksum)) {
        cache.set(checksum, []);
    }
    cache.get(checksum).push(frameNumber);
    
    return false;
}

// Fetch single image
async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
        `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;
    
    const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}_${Math.random()}.png`);
    
    await execAsync(`curl -s -o "${tempFile}" "${apiUrl}"`, { timeout: 30000 });
    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});
    
    return {
        buffer,
        checksum: calculateChecksum(buffer)
    };
}

// Fetch with fallback and duplicate detection
async function fetchImageWithFallback(targetDate, sourceId, sourceType, frameNumber) {
    const fallbackSteps = sourceType === 'SOHO' 
        ? CONFIG.FALLBACK_STEPS_SOHO 
        : CONFIG.FALLBACK_STEPS_SDO;
    
    for (const minuteOffset of fallbackSteps) {
        const tryDate = new Date(targetDate.getTime() + minuteOffset * 60 * 1000);
        
        try {
            const result = await fetchImage(sourceId, tryDate.toISOString());
            
            // Check if this is a duplicate
            if (isDuplicate(result.checksum, sourceType.toLowerCase(), frameNumber)) {
                if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                    // Last fallback, have to use it even if duplicate
                    console.log(`  ⚠️ Using duplicate for frame ${frameNumber} (no alternatives)`);
                    return {
                        ...result,
                        fallbackMinutes: minuteOffset,
                        isDuplicate: true
                    };
                }
                // Try next fallback
                continue;
            }
            
            // Not a duplicate, use it
            if (minuteOffset !== 0) {
                console.log(`  ✓ Used ${minuteOffset}min fallback for ${sourceType} frame ${frameNumber}`);
            }
            
            return {
                ...result,
                fallbackMinutes: minuteOffset,
                isDuplicate: false
            };
            
        } catch (error) {
            if (minuteOffset === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`All fallbacks failed: ${error.message}`);
            }
        }
    }
}

// Process frames with parallel fetching and duplicate detection
async function processFramesOptimized(frames) {
    console.log(`\n📊 Processing ${frames.length} frames with optimized concurrency`);
    console.log(`   Fetch concurrency: ${CONFIG.FETCH_CONCURRENCY}`);
    console.log(`   Process concurrency: ${CONFIG.PROCESS_CONCURRENCY}`);
    
    const results = [];
    let frameIndex = 0;
    
    // Phase 1: Parallel fetching with batched duplicate detection
    const fetchQueue = [...frames];
    const processingQueue = [];
    const activeFetches = new Set();
    const activeProcesses = new Set();
    
    async function fetchNextBatch() {
        const batch = [];
        
        // Start parallel fetches
        while (activeFetches.size < CONFIG.FETCH_CONCURRENCY && fetchQueue.length > 0) {
            const frame = fetchQueue.shift();
            const fetchPromise = fetchFrameWithDuplicateHandling(frame);
            activeFetches.add(fetchPromise);
            batch.push(fetchPromise);
            
            fetchPromise.then(result => {
                activeFetches.delete(fetchPromise);
                if (result) {
                    processingQueue.push(result);
                    processNextFrame();
                }
            }).catch(err => {
                activeFetches.delete(fetchPromise);
                console.error(`Fetch failed for frame ${frame.number}:`, err.message);
            });
        }
        
        return batch;
    }
    
    async function fetchFrameWithDuplicateHandling(frame) {
        const { number, date } = frame;
        
        try {
            // First attempt - fetch both images
            const [coronaResult, sunDiskResult] = await Promise.all([
                fetchImage(4, date.toISOString()),
                fetchImage(10, date.toISOString())
            ]);
            
            // Check for duplicates
            const coronaDupe = isDuplicate(coronaResult.checksum, 'corona', number);
            const sunDiskDupe = isDuplicate(sunDiskResult.checksum, 'sunDisk', number);
            
            let finalCorona = coronaResult;
            let finalSunDisk = sunDiskResult;
            
            // If duplicates found, try fallbacks sequentially
            if (coronaDupe) {
                console.log(`🔄 Frame ${number}: Corona duplicate, trying fallbacks...`);
                productionState.duplicateRetries++;
                finalCorona = await fetchImageWithFallback(date, 4, 'SOHO', number);
            }
            
            if (sunDiskDupe) {
                console.log(`🔄 Frame ${number}: Sun disk duplicate, trying fallbacks...`);
                productionState.duplicateRetries++;
                finalSunDisk = await fetchImageWithFallback(date, 10, 'SDO', number);
            }
            
            return {
                frameNumber: number,
                frameDate: date,
                corona: finalCorona,
                sunDisk: finalSunDisk
            };
            
        } catch (error) {
            console.error(`❌ Frame ${number} fetch failed:`, error.message);
            return null;
        }
    }
    
    async function processNextFrame() {
        if (activeProcesses.size >= CONFIG.PROCESS_CONCURRENCY || processingQueue.length === 0) {
            return;
        }
        
        const frameData = processingQueue.shift();
        const processPromise = processFrame(frameData);
        activeProcesses.add(processPromise);
        
        processPromise.then(result => {
            activeProcesses.delete(processPromise);
            results.push(result);
            productionState.processedFrames++;
            
            // Progress update
            if (productionState.processedFrames % 10 === 0) {
                const progress = (productionState.processedFrames / frames.length * 100).toFixed(1);
                console.log(`Progress: ${progress}% (${productionState.processedFrames}/${frames.length})`);
                console.log(`  Duplicate retries: ${productionState.duplicateRetries}`);
            }
            
            // Try to process next frame
            processNextFrame();
        }).catch(err => {
            activeProcesses.delete(processPromise);
            console.error(`Process failed:`, err.message);
        });
    }
    
    async function processFrame(frameData) {
        // Apply color grading and compositing
        const [gradedCorona, gradedSunDisk] = await Promise.all([
            gradeCorona(frameData.corona.buffer),
            gradeSunDisk(frameData.sunDisk.buffer)
        ]);
        
        // Apply feathering and composite
        const featheredSunDisk = await applyCircularFeather(gradedSunDisk);
        const composite = await createComposite(gradedCorona, featheredSunDisk);
        
        // Save frame
        const framePath = path.join(CONFIG.FRAMES_DIR, `frame_${String(frameData.frameNumber).padStart(5, '0')}.jpg`);
        await fs.writeFile(framePath, composite);
        
        return {
            frameNumber: frameData.frameNumber,
            success: true,
            path: framePath
        };
    }
    
    // Start the pipeline
    console.log('\n🚀 Starting optimized pipeline...\n');
    
    // Keep fetching and processing until done
    while (fetchQueue.length > 0 || activeFetches.size > 0 || processingQueue.length > 0 || activeProcesses.size > 0) {
        // Start more fetches
        if (fetchQueue.length > 0) {
            await fetchNextBatch();
        }
        
        // Wait a bit for things to progress
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Save state periodically
        if (productionState.processedFrames % CONFIG.BATCH_SIZE === 0 && productionState.processedFrames > 0) {
            await saveState();
        }
    }
    
    console.log(`\n✅ Pipeline complete!`);
    console.log(`   Processed: ${results.length}/${frames.length} frames`);
    console.log(`   Duplicate retries: ${productionState.duplicateRetries}`);
    console.log(`   Unique corona images: ${productionState.checksumCache.corona.size}`);
    console.log(`   Unique sun disk images: ${productionState.checksumCache.sunDisk.size}`);
    
    return results;
}

// Color grading functions
async function gradeCorona(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
        .tint({ r: 220, g: 230, b: 240 })
        .linear(1.2, -12)
        .gamma(1.2)
        .toBuffer();
}

async function gradeSunDisk(buffer) {
    return await sharp(buffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

async function applyCircularFeather(buffer) {
    // Implementation here
    return buffer;
}

async function createComposite(corona, sunDisk) {
    // Implementation here
    return corona;
}

async function saveState() {
    // Convert Maps to arrays for JSON serialization
    const stateToSave = {
        ...productionState,
        checksumCache: {
            corona: Array.from(productionState.checksumCache.corona.entries()),
            sunDisk: Array.from(productionState.checksumCache.sunDisk.entries())
        }
    };
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(stateToSave, null, 2));
}

// Example usage
async function main() {
    console.log('🌞 Optimized Production System');
    console.log('================================\n');
    
    // Generate test frames
    const frames = [];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 2); // 48-hour delay
    
    for (let i = 0; i < 100; i++) { // Test with 100 frames
        const frameDate = new Date(startDate);
        frameDate.setMinutes(frameDate.getMinutes() + i * 15);
        frames.push({
            number: i,
            date: frameDate
        });
    }
    
    productionState.totalFrames = frames.length;
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    const results = await processFramesOptimized(frames);
    
    const duration = (Date.now() - productionState.startTime) / 1000;
    console.log(`\nCompleted in ${duration.toFixed(1)} seconds`);
    console.log(`Rate: ${(frames.length / duration * 60).toFixed(1)} frames per minute`);
}

// Export for use in production
export { processFramesOptimized, CONFIG };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}