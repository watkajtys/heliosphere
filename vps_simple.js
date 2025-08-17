#!/usr/bin/env node

/**
 * Heliosphere VPS Simple Server
 * No cloud dependencies - everything runs locally on VPS
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG = {
    PORT: process.env.PORT || 3000,
    
    // Generation settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    
    // Processing settings
    FETCH_CONCURRENCY: 10,  // VPS has amazing network!
    PROCESS_CONCURRENCY: 4,  // 2 CPUs, 4GB RAM
    
    // Use Cloudflare for slight speed boost
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Local storage
    OUTPUT_DIR: '/opt/heliosphere/output',
    TEMP_DIR: '/tmp/heliosphere',
    
    // Frame settings
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40
};

// State tracking
let generationState = {
    status: 'idle',
    startTime: null,
    totalFrames: 0,
    completedFrames: 0,
    failedFrames: 0,
    currentDay: null
};

// Initialize Express
const app = express();
app.use(express.json());

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(path.join(CONFIG.OUTPUT_DIR, 'frames'), { recursive: true });
    await fs.mkdir(path.join(CONFIG.OUTPUT_DIR, 'logs'), { recursive: true });
}

// Log to file
async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    
    const logFile = path.join(CONFIG.OUTPUT_DIR, 'logs', `generation_${new Date().toISOString().split('T')[0]}.log`);
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
}

// Fetch image (direct or via Cloudflare) using takeScreenshot API
async function fetchImage(sourceId, date, component) {
    // Use takeScreenshot API which returns PNG that Sharp can process
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}` +
        `&layers=[${sourceId},1,100]` +
        `&imageScale=${imageScale}` +
        `&width=${width}` +
        `&height=${height}` +
        `&x0=0&y0=0` +
        `&display=true` +
        `&watermark=false`;
    
    const fetchUrl = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/?url=${encodeURIComponent(apiUrl)}`
        : apiUrl;
    
    const startTime = Date.now();
    const outputPath = path.join(CONFIG.TEMP_DIR, `${component}_${Date.now()}.png`);
    
    try {
        await execAsync(`curl -s -o "${outputPath}" "${fetchUrl}"`, { timeout: 30000 });
        const duration = Date.now() - startTime;
        await log(`Fetched ${component} in ${duration}ms`);
        return outputPath;
    } catch (error) {
        await log(`Failed to fetch ${component}: ${error.message}`, 'ERROR');
        throw error;
    }
}

// Process frame with Sharp
async function processFrame(coronaPath, sunPath, frameIndex) {
    const startTime = Date.now();
    
    try {
        // Load images
        const corona = await sharp(coronaPath)
            .resize(CONFIG.FRAME_WIDTH, CONFIG.FRAME_HEIGHT, { fit: 'cover', position: 'center' })
            .toBuffer();
            
        const sunDisk = await sharp(sunPath)
            .resize(820, 820, { fit: 'cover', position: 'center' })
            .toBuffer();
            
        // Create feathered mask
        const mask = await sharp({
            create: {
                width: 820,
                height: 820,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{
            input: Buffer.from(
                `<svg width="820" height="820">
                    <defs>
                        <radialGradient id="fade">
                            <stop offset="70%" stop-color="white" stop-opacity="1"/>
                            <stop offset="100%" stop-color="white" stop-opacity="0"/>
                        </radialGradient>
                    </defs>
                    <circle cx="410" cy="410" r="410" fill="url(#fade)"/>
                </svg>`
            ),
            top: 0,
            left: 0
        }])
        .toBuffer();
        
        // Composite final image
        const finalImage = await sharp(corona)
            .composite([
                {
                    input: await sharp(sunDisk)
                        .composite([{ input: mask, blend: 'dest-in' }])
                        .toBuffer(),
                    top: 190,
                    left: 320,
                    blend: 'over'
                }
            ])
            .jpeg({ quality: 92 })
            .toBuffer();
            
        const duration = Date.now() - startTime;
        await log(`Processed frame ${frameIndex} in ${duration}ms`, 'SUCCESS');
        
        return finalImage;
    } catch (error) {
        await log(`Failed to process frame ${frameIndex}: ${error.message}`, 'ERROR');
        throw error;
    }
}

// Save frame locally
async function saveFrame(buffer, frameIndex) {
    const fileName = `frame_${String(frameIndex).padStart(5, '0')}.jpg`;
    const filePath = path.join(CONFIG.OUTPUT_DIR, 'frames', fileName);
    
    await fs.writeFile(filePath, buffer);
    await log(`Saved frame ${frameIndex} to ${fileName}`);
    
    return filePath;
}

// Process frames with concurrency control
async function processFramesWithConcurrency(frames, dayNumber) {
    const results = [];
    const fetchQueue = [...frames];
    const processQueue = [];
    const pendingFetches = [];
    const pendingProcesses = [];
    
    // Start fetching
    for (let i = 0; i < Math.min(CONFIG.FETCH_CONCURRENCY, fetchQueue.length); i++) {
        const frame = fetchQueue.shift();
        pendingFetches.push(fetchFrame(frame));
    }
    
    async function fetchFrame(frame) {
        try {
            const [coronaPath, sunPath] = await Promise.all([
                fetchImage(4, frame.date, `corona_${frame.index}`),
                fetchImage(10, frame.date, `sun_${frame.index}`)
            ]);
            
            processQueue.push({ ...frame, coronaPath, sunPath });
            
            // Start processing if room
            if (pendingProcesses.length < CONFIG.PROCESS_CONCURRENCY) {
                const toProcess = processQueue.shift();
                if (toProcess) {
                    pendingProcesses.push(processFrameData(toProcess));
                }
            }
            
            // Fetch next if available
            if (fetchQueue.length > 0) {
                const next = fetchQueue.shift();
                return fetchFrame(next);
            }
        } catch (error) {
            await log(`Frame ${frame.index} fetch failed: ${error.message}`, 'ERROR');
            results.push({ frame: frame.index, status: 'failed', error: error.message });
            generationState.failedFrames++;
        }
    }
    
    async function processFrameData(frameData) {
        try {
            const processed = await processFrame(frameData.coronaPath, frameData.sunPath, frameData.index);
            await saveFrame(processed, frameData.index);
            
            // Clean up temp files
            await fs.unlink(frameData.coronaPath).catch(() => {});
            await fs.unlink(frameData.sunPath).catch(() => {});
            
            results.push({ frame: frameData.index, status: 'success' });
            generationState.completedFrames++;
            
            // Update progress
            const progress = (generationState.completedFrames / generationState.totalFrames * 100).toFixed(1);
            if (generationState.completedFrames % 10 === 0) {
                await log(`Progress: ${generationState.completedFrames}/${generationState.totalFrames} (${progress}%)`);
            }
            
            // Process next if available
            if (processQueue.length > 0) {
                const next = processQueue.shift();
                return processFrameData(next);
            }
        } catch (error) {
            await log(`Frame ${frameData.index} processing failed: ${error.message}`, 'ERROR');
            results.push({ frame: frameData.index, status: 'failed', error: error.message });
            generationState.failedFrames++;
        }
    }
    
    // Wait for all operations to complete
    await Promise.all([...pendingFetches, ...pendingProcesses]);
    
    return results;
}

// Generate frames for a day
async function generateDay(dayOffset = 0) {
    const baseDate = new Date('2024-01-01T00:00:00Z');
    baseDate.setDate(baseDate.getDate() + dayOffset);
    
    const frames = [];
    for (let i = 0; i < CONFIG.FRAMES_PER_DAY; i++) {
        const frameDate = new Date(baseDate.getTime() + i * CONFIG.INTERVAL_MINUTES * 60000);
        frames.push({
            index: dayOffset * CONFIG.FRAMES_PER_DAY + i,
            date: frameDate.toISOString(),
            dayOffset,
            frameInDay: i
        });
    }
    
    await log(`Starting Day ${dayOffset + 1} (${baseDate.toISOString().split('T')[0]}) - ${CONFIG.FRAMES_PER_DAY} frames`);
    const startTime = Date.now();
    
    const results = await processFramesWithConcurrency(frames, dayOffset + 1);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    const successful = results.filter(r => r.status === 'success').length;
    
    await log(`Day ${dayOffset + 1} completed: ${successful}/${CONFIG.FRAMES_PER_DAY} frames in ${duration}s`);
    
    return { dayOffset, successful, failed: CONFIG.FRAMES_PER_DAY - successful, duration };
}

// API endpoint to start generation
app.post('/generate', async (req, res) => {
    if (generationState.status === 'running') {
        return res.status(400).json({ error: 'Generation already in progress' });
    }
    
    const { days = 1 } = req.body;
    
    generationState = {
        status: 'running',
        startTime: Date.now(),
        totalFrames: days * CONFIG.FRAMES_PER_DAY,
        completedFrames: 0,
        failedFrames: 0,
        currentDay: 0
    };
    
    await log(`Starting generation: ${days} days, ${generationState.totalFrames} frames`);
    
    res.json({ 
        message: 'Generation started',
        days,
        totalFrames: generationState.totalFrames,
        estimatedTime: `${Math.round(generationState.totalFrames * 4.5 / 60)} minutes`
    });
    
    // Process in background
    (async () => {
        const results = [];
        
        for (let day = 0; day < days; day++) {
            generationState.currentDay = day + 1;
            const dayResult = await generateDay(day);
            results.push(dayResult);
        }
        
        generationState.status = 'completed';
        const totalDuration = Math.round((Date.now() - generationState.startTime) / 1000);
        
        await log(`Generation completed: ${generationState.completedFrames}/${generationState.totalFrames} frames in ${totalDuration}s`);
        
        // Save summary
        const summary = {
            generated: new Date().toISOString(),
            days,
            totalFrames: generationState.totalFrames,
            completedFrames: generationState.completedFrames,
            failedFrames: generationState.failedFrames,
            duration: totalDuration,
            results
        };
        
        await fs.writeFile(
            path.join(CONFIG.OUTPUT_DIR, 'generation_summary.json'),
            JSON.stringify(summary, null, 2)
        );
    })().catch(async (error) => {
        generationState.status = 'error';
        await log(`Generation failed: ${error.message}`, 'ERROR');
    });
});

// Status endpoint
app.get('/status', (req, res) => {
    const runtime = generationState.startTime 
        ? Math.round((Date.now() - generationState.startTime) / 1000)
        : 0;
    
    res.json({
        ...generationState,
        runtime,
        progress: generationState.totalFrames > 0 
            ? (generationState.completedFrames / generationState.totalFrames * 100).toFixed(1) + '%'
            : '0%'
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// List generated frames
app.get('/frames', async (req, res) => {
    try {
        const framesDir = path.join(CONFIG.OUTPUT_DIR, 'frames');
        const files = await fs.readdir(framesDir);
        const frames = files.filter(f => f.endsWith('.jpg')).sort();
        
        res.json({
            count: frames.length,
            frames: frames.slice(0, 100), // First 100
            outputDir: CONFIG.OUTPUT_DIR
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
async function start() {
    await ensureDirectories();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Heliosphere VPS Server               ║');
        console.log(`║   Port: ${CONFIG.PORT}                           ║`);
        console.log('║   Ready for generation!                ║');
        console.log('╚════════════════════════════════════════╝');
        console.log(`\nOutput directory: ${CONFIG.OUTPUT_DIR}`);
        console.log(`Using Cloudflare: ${CONFIG.USE_CLOUDFLARE}`);
        console.log(`\nTo generate 1 day: curl -X POST http://localhost:${CONFIG.PORT}/generate -H "Content-Type: application/json" -d '{"days": 1}'`);
    });
}

start().catch(console.error);