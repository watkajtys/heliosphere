#!/usr/bin/env node

/**
 * Heliosphere Chunked Production Pipeline
 * Handles full 56-day production with memory-optimized chunking
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import crypto from 'crypto';
import express from 'express';
import { fileURLToPath } from 'url';

// Import modules
import CONFIG from './config/production.config.js';
import MemoryManager from './lib/memory_manager.js';
import ChunkProcessor from './lib/chunk_processor.js';
import VideoEncoder from './lib/video_encoder.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Production state
const productionState = {
    status: 'idle',
    phase: null,
    startTime: null,
    totalFrames: CONFIG.TIME.TOTAL_FRAMES,
    processedFrames: 0,
    duplicatesDetected: 0,
    errors: [],
    checksums: new Map(),
    videos: {
        full: null,
        social: null,
        desktop: null,
        mobile: null
    }
};

// Initialize modules
const memoryManager = new MemoryManager({
    maxHeapUsage: CONFIG.PERFORMANCE.MAX_HEAP_USAGE,
    gcThreshold: CONFIG.PERFORMANCE.GC_THRESHOLD,
    checkInterval: CONFIG.PERFORMANCE.MEMORY_CHECK_INTERVAL
});

const chunkProcessor = new ChunkProcessor({
    chunkSize: CONFIG.PERFORMANCE.CHUNK_SIZE,
    framesDir: CONFIG.PATHS.FRAMES_DIR,
    tempDir: CONFIG.PATHS.CHUNK_TEMP,
    stateFile: CONFIG.PATHS.CHUNK_STATE
});

const videoEncoder = new VideoEncoder({
    framesDir: CONFIG.PATHS.FRAMES_DIR,
    outputDir: CONFIG.PATHS.VIDEOS_DIR,
    tempDir: CONFIG.PATHS.ENCODE_TEMP,
    fps: CONFIG.VIDEO.FPS,
    crf: CONFIG.VIDEO.CRF,
    preset: CONFIG.VIDEO.PRESET,
    maxChunkFrames: CONFIG.VIDEO.ENCODING.CHUNK_FRAMES
});

/**
 * Initialize production environment
 */
async function initialize() {
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   HELIOSPHERE CHUNKED PRODUCTION SYSTEM    ║');
    console.log('╚════════════════════════════════════════════╝\n');
    
    // Show configuration
    console.log('📋 Configuration:');
    console.log(`   Environment: ${CONFIG.ENV}`);
    console.log(`   Days: ${CONFIG.TIME.TOTAL_DAYS}`);
    console.log(`   Frames: ${CONFIG.TIME.TOTAL_FRAMES}`);
    console.log(`   Chunk size: ${CONFIG.PERFORMANCE.CHUNK_SIZE} frames`);
    console.log(`   Video chunks: ${CONFIG.VIDEO.ENCODING.CHUNK_FRAMES} frames`);
    console.log(`   Memory limit: ${CONFIG.PERFORMANCE.MAX_HEAP_USAGE * 100}%`);
    
    // Create directories
    await fs.mkdir(CONFIG.PATHS.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.PATHS.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.PATHS.TEMP_DIR, { recursive: true });
    await fs.mkdir(CONFIG.PATHS.LOG_DIR, { recursive: true });
    
    // Initialize modules
    await chunkProcessor.initialize();
    await videoEncoder.initialize();
    memoryManager.startMonitoring();
    
    // Check existing state
    const hasState = await loadProductionState();
    if (hasState) {
        console.log('\n📂 Resuming from previous state:');
        console.log(`   Processed frames: ${productionState.processedFrames}`);
        console.log(`   Status: ${productionState.status}`);
    }
    
    console.log('\n✅ System initialized and ready\n');
}

/**
 * Generate frame list for production
 */
function generateFrameList() {
    const frames = [];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - CONFIG.TIME.SAFE_DELAY_DAYS);
    endDate.setHours(0, 0, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - CONFIG.TIME.TOTAL_DAYS);
    
    for (let i = 0; i < CONFIG.TIME.TOTAL_FRAMES; i++) {
        const frameDate = new Date(startDate);
        frameDate.setMinutes(frameDate.getMinutes() + i * CONFIG.TIME.INTERVAL_MINUTES);
        frames.push({
            number: i,
            date: frameDate,
            dateString: frameDate.toISOString()
        });
    }
    
    console.log(`📅 Production range:`);
    console.log(`   Start: ${frames[0].date.toISOString().split('T')[0]}`);
    console.log(`   End: ${frames[frames.length - 1].date.toISOString().split('T')[0]}`);
    console.log(`   Total: ${frames.length} frames\n`);
    
    return frames;
}

/**
 * Fetch image from Helioviewer API
 */
async function fetchImage(date, sourceConfig, fallbackSteps) {
    const baseUrl = `${CONFIG.API.HELIOVIEWER_BASE}/takeScreenshot`;
    
    for (const fallback of fallbackSteps) {
        const adjustedDate = new Date(date);
        adjustedDate.setMinutes(adjustedDate.getMinutes() + fallback);
        
        const params = new URLSearchParams({
            date: adjustedDate.toISOString(),
            imageScale: sourceConfig.scale,
            layers: `%5B${sourceConfig.name},1,100%5D`,
            x0: sourceConfig.x0,
            y0: sourceConfig.y0,
            x1: sourceConfig.x1,
            y1: sourceConfig.y1,
            display: true,
            watermark: false
        });
        
        try {
            const response = await fetch(`${baseUrl}?${params}`, {
                signal: AbortSignal.timeout(CONFIG.API.TIMEOUT)
            });
            
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                return {
                    buffer: Buffer.from(buffer),
                    fallback: fallback,
                    date: adjustedDate
                };
            }
        } catch (error) {
            if (fallback === fallbackSteps[fallbackSteps.length - 1]) {
                throw new Error(`Failed to fetch after all fallbacks: ${error.message}`);
            }
        }
    }
    
    throw new Error('All fetch attempts failed');
}

/**
 * Process a single frame
 */
async function processFrame(frame, frameIndex) {
    try {
        // Fetch corona and sun disk
        const [corona, sunDisk] = await Promise.all([
            fetchImage(frame.date, CONFIG.API.SOURCES.CORONA, CONFIG.API.FALLBACK.STEPS_SOHO),
            fetchImage(frame.date, CONFIG.API.SOURCES.SUN_DISK, CONFIG.API.FALLBACK.STEPS_SDO)
        ]);
        
        // Check for duplicates
        const coronaChecksum = crypto.createHash('md5').update(corona.buffer).digest('hex');
        const sunChecksum = crypto.createHash('md5').update(sunDisk.buffer).digest('hex');
        
        if (productionState.checksums.has(coronaChecksum) || productionState.checksums.has(sunChecksum)) {
            productionState.duplicatesDetected++;
            console.log(`⚠️ Duplicate detected at frame ${frameIndex}`);
        }
        
        productionState.checksums.set(coronaChecksum, frameIndex);
        productionState.checksums.set(sunChecksum, frameIndex);
        
        // Apply color grading
        const gradedCorona = await gradeCorona(corona.buffer);
        const gradedSunDisk = await gradeSunDisk(sunDisk.buffer);
        
        // Apply feathering and composite
        const featheredSunDisk = await applyCircularFeather(gradedSunDisk);
        const composite = await createComposite(gradedCorona, featheredSunDisk);
        
        // Save frame
        const framePath = path.join(
            CONFIG.PATHS.FRAMES_DIR, 
            `frame_${String(frameIndex).padStart(5, '0')}.jpg`
        );
        await fs.writeFile(framePath, composite);
        
        productionState.processedFrames++;
        
        return {
            frameNumber: frameIndex,
            success: true,
            path: framePath,
            size: composite.length
        };
        
    } catch (error) {
        console.error(`❌ Frame ${frameIndex} failed:`, error.message);
        productionState.errors.push({
            frame: frameIndex,
            error: error.message,
            timestamp: Date.now()
        });
        return {
            frameNumber: frameIndex,
            success: false,
            error: error.message
        };
    }
}

/**
 * Color grading functions
 */
async function gradeCorona(buffer) {
    const config = CONFIG.IMAGE.GRADING.CORONA;
    return await sharp(buffer)
        .modulate({
            saturation: config.saturation,
            brightness: config.brightness,
            hue: config.hue
        })
        .tint(config.tint)
        .linear(config.linear.a, config.linear.b)
        .gamma(config.gamma)
        .toBuffer();
}

async function gradeSunDisk(buffer) {
    const config = CONFIG.IMAGE.GRADING.SUN_DISK;
    return await sharp(buffer)
        .modulate({
            saturation: config.saturation,
            brightness: config.brightness,
            hue: config.hue
        })
        .tint(config.tint)
        .linear(config.linear.a, config.linear.b)
        .gamma(config.gamma)
        .toBuffer();
}

/**
 * Apply circular feathering
 */
async function applyCircularFeather(buffer) {
    const finalSize = CONFIG.API.SOURCES.SUN_DISK.size;
    const featherRadius = CONFIG.IMAGE.COMPOSITE.FEATHER_RADIUS;
    
    // Create circular mask with feathering
    const mask = await sharp({
        create: {
            width: finalSize,
            height: finalSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([{
        input: Buffer.from(
            `<svg width="${finalSize}" height="${finalSize}">
                <defs>
                    <radialGradient id="feather">
                        <stop offset="${((finalSize/2 - featherRadius) / (finalSize/2) * 100)}%" stop-color="white" stop-opacity="1"/>
                        <stop offset="100%" stop-color="white" stop-opacity="0"/>
                    </radialGradient>
                </defs>
                <circle cx="${finalSize/2}" cy="${finalSize/2}" r="${finalSize/2}" fill="url(#feather)"/>
            </svg>`
        ),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Apply mask to sun disk
    return await sharp(buffer)
        .resize(finalSize, finalSize, { kernel: 'lanczos3' })
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

/**
 * Create composite
 */
async function createComposite(coronaBuffer, sunDiskBuffer) {
    const config = CONFIG.IMAGE.COMPOSITE;
    
    // Create composite
    const compositeImage = await sharp({
        create: {
            width: config.CANVAS_WIDTH,
            height: config.CANVAS_HEIGHT,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: coronaBuffer, gravity: 'center' },
        { input: sunDiskBuffer, gravity: 'center', blend: 'screen' }
    ])
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer();
    
    // Extract final frame
    const finalImage = await sharp(compositeImage)
        .extract(config.EXTRACT)
        .jpeg({ 
            quality: config.JPEG_QUALITY, 
            mozjpeg: config.USE_MOZJPEG 
        })
        .toBuffer();
    
    return finalImage;
}

/**
 * Main production pipeline
 */
async function runProduction() {
    productionState.status = 'running';
    productionState.startTime = Date.now();
    productionState.phase = 'frame_generation';
    
    try {
        // Generate frame list
        const frames = generateFrameList();
        
        // Process frames in chunks
        console.log('\n🎬 PHASE 1: Frame Generation\n');
        const results = await chunkProcessor.processFramesInChunks(frames, processFrame);
        
        console.log(`\n✅ Frame generation complete!`);
        console.log(`   Processed: ${results.length}/${frames.length} frames`);
        console.log(`   Duplicates: ${productionState.duplicatesDetected}`);
        console.log(`   Errors: ${productionState.errors.length}`);
        
        // Save state before video generation
        await saveProductionState();
        
        // Generate videos
        console.log('\n🎬 PHASE 2: Video Generation\n');
        productionState.phase = 'video_generation';
        
        // Full production video (56 days)
        console.log('📹 Generating full production video...');
        productionState.videos.full = await videoEncoder.generateChunkedVideo(
            productionState.processedFrames,
            'heliosphere_56days',
            { width: CONFIG.IMAGE.COMPOSITE.WIDTH, height: CONFIG.IMAGE.COMPOSITE.HEIGHT }
        );
        
        // Social media video (30 days)
        if (productionState.processedFrames >= CONFIG.TIME.SOCIAL_FRAMES) {
            console.log('\n📹 Generating social media video...');
            productionState.videos.social = await videoEncoder.generateChunkedVideo(
                CONFIG.TIME.SOCIAL_FRAMES,
                'heliosphere_30days_social',
                { width: CONFIG.IMAGE.COMPOSITE.WIDTH, height: CONFIG.IMAGE.COMPOSITE.HEIGHT }
            );
        }
        
        // Dual format videos
        console.log('\n📹 Generating dual format videos...');
        const dualResults = await videoEncoder.generateDualFormat(
            productionState.processedFrames,
            'heliosphere_production'
        );
        productionState.videos.desktop = dualResults.desktop;
        productionState.videos.mobile = dualResults.mobile;
        
        // Final report
        productionState.status = 'completed';
        productionState.phase = 'completed';
        const totalTime = (Date.now() - productionState.startTime) / 1000 / 60;
        
        console.log('\n' + '═'.repeat(60));
        console.log('✨ PRODUCTION COMPLETE!');
        console.log('═'.repeat(60));
        console.log(`Total time: ${totalTime.toFixed(1)} minutes`);
        console.log(`Frames processed: ${productionState.processedFrames}/${CONFIG.TIME.TOTAL_FRAMES}`);
        console.log(`Processing rate: ${(productionState.processedFrames / totalTime).toFixed(1)} frames/min`);
        console.log('\nVideos generated:');
        if (productionState.videos.full) {
            console.log(`  Full (56 days): ${(productionState.videos.full.size / 1024 / 1024).toFixed(2)} MB`);
        }
        if (productionState.videos.social) {
            console.log(`  Social (30 days): ${(productionState.videos.social.size / 1024 / 1024).toFixed(2)} MB`);
        }
        console.log(`  Desktop: ${(productionState.videos.desktop.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Mobile: ${(productionState.videos.mobile.size / 1024 / 1024).toFixed(2)} MB`);
        
        // Memory report
        console.log('\n📊 Memory Report:');
        const memReport = memoryManager.getReport();
        console.log(`  Peak heap: ${memReport.stats.peakHeapUsed}`);
        console.log(`  GC runs: ${memReport.stats.gcCount}`);
        console.log(`  Warnings: ${memReport.stats.warnings}`);
        
        // Save final state
        await saveProductionState();
        
        // Upload to Cloudflare if configured
        if (CONFIG.CLOUDFLARE.UPLOAD.AUTO_UPLOAD && CONFIG.CLOUDFLARE.STREAM_TOKEN) {
            console.log('\n☁️ Uploading to Cloudflare Stream...');
            // TODO: Implement Cloudflare upload
        }
        
    } catch (error) {
        console.error('\n❌ Production failed:', error.message);
        productionState.status = 'error';
        productionState.errors.push({
            phase: productionState.phase,
            error: error.message,
            stack: error.stack,
            timestamp: Date.now()
        });
        await saveProductionState();
        throw error;
        
    } finally {
        // Cleanup
        await cleanup();
    }
}

/**
 * Save production state
 */
async function saveProductionState() {
    const stateToSave = {
        ...productionState,
        checksums: Array.from(productionState.checksums.entries()).slice(-1000),
        savedAt: new Date().toISOString()
    };
    
    await fs.writeFile(CONFIG.PATHS.STATE_FILE, JSON.stringify(stateToSave, null, 2));
    console.log('💾 State saved');
}

/**
 * Load production state
 */
async function loadProductionState() {
    try {
        const data = await fs.readFile(CONFIG.PATHS.STATE_FILE, 'utf8');
        const loaded = JSON.parse(data);
        
        // Restore state
        Object.assign(productionState, loaded);
        
        // Restore checksums map
        if (loaded.checksums) {
            productionState.checksums = new Map(loaded.checksums);
        }
        
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Cleanup
 */
async function cleanup() {
    console.log('\n🧹 Cleaning up...');
    
    memoryManager.stopMonitoring();
    await chunkProcessor.cleanup();
    await videoEncoder.cleanup();
    
    // Clean temp directories
    try {
        await fs.rm(CONFIG.PATHS.TEMP_DIR, { recursive: true, force: true });
    } catch (error) {
        // Ignore cleanup errors
    }
    
    console.log('✅ Cleanup complete');
}

/**
 * Web monitoring server
 */
function startMonitoringServer() {
    const app = express();
    
    app.get('/status', (req, res) => {
        res.json({
            ...productionState,
            memory: memoryManager.getMemoryStats().formatted,
            chunkProcessor: chunkProcessor.getStatistics(),
            videoEncoder: videoEncoder.getEncodingState()
        });
    });
    
    app.get('/monitor', (req, res) => {
        res.sendFile(path.join(__dirname, 'monitor_optimized.html'));
    });
    
    const port = CONFIG.MONITORING.WEB_PORT;
    app.listen(port, '0.0.0.0', () => {
        console.log(`📡 Monitoring server: http://0.0.0.0:${port}/monitor`);
        console.log(`📊 Status API: http://0.0.0.0:${port}/status\n`);
    });
}

/**
 * Main entry point
 */
async function main() {
    try {
        await initialize();
        
        if (CONFIG.MONITORING.ENABLE_WEB_UI) {
            startMonitoringServer();
        }
        
        await runProduction();
        
        console.log('\n🎉 Heliosphere production completed successfully!');
        process.exit(0);
        
    } catch (error) {
        console.error('\n💥 Fatal error:', error);
        process.exit(1);
    }
}

// Handle process signals
process.on('SIGINT', async () => {
    console.log('\n⚠️ Received SIGINT, saving state...');
    productionState.status = 'interrupted';
    await saveProductionState();
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️ Received SIGTERM, saving state...');
    productionState.status = 'interrupted';
    await saveProductionState();
    await cleanup();
    process.exit(0);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { runProduction, productionState };