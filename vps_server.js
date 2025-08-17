#!/usr/bin/env node

/**
 * Heliosphere VPS Server
 * Optimized for Hetzner VPS deployment
 */

import express from 'express';
import { Storage } from '@google-cloud/storage';
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
    PROJECT_ID: process.env.GOOGLE_CLOUD_PROJECT || 'heliosphere-solar',
    PORT: process.env.PORT || 3000,
    
    // Generation settings
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    
    // Processing settings
    FETCH_CONCURRENCY: 8,  // VPS has good network
    PROCESS_CONCURRENCY: 4, // 2 CPUs, 4GB RAM
    
    // Cloudflare proxy
    USE_CLOUDFLARE_PROXY: true,
    CLOUDFLARE_WORKER_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    // Cloud Storage
    FRAMES_BUCKET: 'heliosphere-frames',
    MANIFESTS_BUCKET: 'heliosphere-manifests',
    
    // Local cache
    CACHE_DIR: '/opt/heliosphere/cache',
    TEMP_DIR: '/tmp/heliosphere'
};

// Initialize Express
const app = express();
app.use(express.json());

// Initialize Cloud Storage
const storage = new Storage({
    projectId: CONFIG.PROJECT_ID
});

// Ensure directories exist
async function ensureDirectories() {
    await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

// Fetch image via Cloudflare proxy using takeScreenshot API
async function fetchImage(sourceId, date, component) {
    // Use takeScreenshot API which returns PNG that Sharp can process
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = sourceId === 4 ? 1920 : 1920;
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
    
    const proxyUrl = `${CONFIG.CLOUDFLARE_WORKER_URL}/?url=${encodeURIComponent(apiUrl)}`;
    
    const startTime = Date.now();
    const outputPath = path.join(CONFIG.TEMP_DIR, `${component}_${Date.now()}.png`);
    
    try {
        await execAsync(`curl -s -o "${outputPath}" "${proxyUrl}"`, { timeout: 30000 });
        const duration = Date.now() - startTime;
        console.log(`[INFO] Fetched ${component} in ${duration}ms`);
        return outputPath;
    } catch (error) {
        console.error(`[ERROR] Failed to fetch ${component}:`, error.message);
        throw error;
    }
}

// Process frame with Sharp
async function processFrame(coronaPath, sunPath, frameIndex) {
    const startTime = Date.now();
    
    try {
        // Load and process images
        const corona = await sharp(coronaPath)
            .resize(1460, 1200, { fit: 'cover', position: 'center' })
            .toBuffer();
            
        const sunDisk = await sharp(sunPath)
            .resize(820, 820, { fit: 'cover', position: 'center' })
            .toBuffer();
            
        // Create mask for sun disk
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
            .jpeg({ quality: 90 })
            .toBuffer();
            
        const duration = Date.now() - startTime;
        console.log(`[SUCCESS] Frame ${frameIndex} processed in ${duration}ms`);
        
        return finalImage;
    } catch (error) {
        console.error(`[ERROR] Failed to process frame ${frameIndex}:`, error.message);
        throw error;
    }
}

// Upload to Cloud Storage
async function uploadToCloudStorage(buffer, frameIndex) {
    const fileName = `frame_${String(frameIndex).padStart(5, '0')}.jpg`;
    const file = storage.bucket(CONFIG.FRAMES_BUCKET).file(fileName);
    
    await file.save(buffer, {
        metadata: {
            contentType: 'image/jpeg',
            cacheControl: 'public, max-age=31536000'
        }
    });
    
    console.log(`[INFO] Uploaded frame ${frameIndex} to Cloud Storage`);
    return fileName;
}

// Generate frames for a date range
async function generateFrames(req, res) {
    const { frames = CONFIG.FRAMES_PER_DAY } = req.query;
    
    console.log(`\n[INFO] Starting generation of ${frames} frames`);
    const startTime = Date.now();
    
    res.json({ 
        message: 'Generation started',
        frames: parseInt(frames),
        status: `/status`
    });
    
    // Process in background
    (async () => {
        const results = [];
        const baseDate = new Date('2024-01-01T00:00:00Z');
        
        for (let i = 0; i < frames; i++) {
            const frameDate = new Date(baseDate.getTime() + i * CONFIG.INTERVAL_MINUTES * 60000);
            const dateStr = frameDate.toISOString();
            
            try {
                // Fetch images
                const [coronaPath, sunPath] = await Promise.all([
                    fetchImage(4, dateStr, 'corona'),
                    fetchImage(10, dateStr, 'sun')
                ]);
                
                // Process frame
                const processedFrame = await processFrame(coronaPath, sunPath, i);
                
                // Upload to Cloud Storage
                await uploadToCloudStorage(processedFrame, i);
                
                // Clean up temp files
                await fs.unlink(coronaPath).catch(() => {});
                await fs.unlink(sunPath).catch(() => {});
                
                results.push({ frame: i, status: 'success' });
            } catch (error) {
                console.error(`[ERROR] Frame ${i} failed:`, error.message);
                results.push({ frame: i, status: 'failed', error: error.message });
            }
        }
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        const successful = results.filter(r => r.status === 'success').length;
        
        console.log(`\n[SUCCESS] Generation completed: ${successful}/${frames} frames in ${duration}s`);
        
        // Save manifest
        const manifest = {
            generated: new Date().toISOString(),
            frames: successful,
            duration: duration,
            results: results
        };
        
        await storage.bucket(CONFIG.MANIFESTS_BUCKET)
            .file(`manifest_${Date.now()}.json`)
            .save(JSON.stringify(manifest, null, 2));
    })();
}

// Status endpoint
app.get('/status', async (req, res) => {
    const status = {
        server: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        config: {
            project: CONFIG.PROJECT_ID,
            cloudflare: CONFIG.USE_CLOUDFLARE_PROXY
        }
    };
    res.json(status);
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Generate endpoint
app.post('/generate', generateFrames);

// Start server
async function start() {
    await ensureDirectories();
    
    app.listen(CONFIG.PORT, '0.0.0.0', () => {
        console.log('╔════════════════════════════════════════╗');
        console.log('║   Heliosphere VPS Server               ║');
        console.log(`║   Port: ${CONFIG.PORT}                           ║`);
        console.log('║   Ready for generation!                ║');
        console.log('╚════════════════════════════════════════╝');
    });
}

start().catch(console.error);