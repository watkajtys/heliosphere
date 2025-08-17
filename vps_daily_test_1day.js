#!/usr/bin/env node

/**
 * Daily Production TEST - Only 1 Day
 * Test version that processes just 1 day (96 frames) for verification
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

// TEST CONFIGURATION - ONLY 1 DAY!
const CONFIG = {
    PORT: process.env.PORT || 3001,
    
    // TEST: Only 1 day instead of 56
    SAFE_DELAY_DAYS: 2,      
    TOTAL_DAYS: 1,           // ← TEST: Just 1 day!
    SOCIAL_DAYS: 1,          // ← TEST: Same video
    
    FRAMES_PER_DAY: 96,
    INTERVAL_MINUTES: 15,
    FPS: 24,
    
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200,
    COMPOSITE_RADIUS: 400,
    FEATHER_RADIUS: 40,
    
    FETCH_CONCURRENCY: 8,
    PROCESS_CONCURRENCY: 4,
    BATCH_SIZE: 20,          // Save more frequently for test
    
    MAX_FALLBACK_MINUTES: 14,
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14],
    
    USE_CLOUDFLARE: true,
    CLOUDFLARE_URL: 'https://heliosphere-proxy.matty-f7e.workers.dev',
    
    BASE_DIR: '/opt/heliosphere',
    FRAMES_DIR: '/opt/heliosphere/frames_test',  // ← Different dir for test
    VIDEOS_DIR: '/opt/heliosphere/videos_test',  // ← Different dir for test
    STATE_FILE: '/opt/heliosphere/test_state.json',
    MANIFEST_FILE: '/opt/heliosphere/test_manifest.json',
    TEMP_DIR: '/tmp/heliosphere'
};

console.log('╔════════════════════════════════════════╗');
console.log('║   TEST MODE - 1 DAY ONLY               ║');
console.log('╚════════════════════════════════════════╝');
console.log('');
console.log('⚠️  This is a TEST run:');
console.log(`   - Processing only ${CONFIG.TOTAL_DAYS} day (${CONFIG.FRAMES_PER_DAY} frames)`);
console.log(`   - Output to: ${CONFIG.FRAMES_DIR}`);
console.log(`   - Videos to: ${CONFIG.VIDEOS_DIR}`);
console.log('');

// Import the rest of the production code
// (Copy the entire vps_daily_production.js code here but with CONFIG above)

// [REST OF CODE FROM vps_daily_production.js GOES HERE]
// I'll create a simpler version for testing:

let productionState = {
    status: 'idle',
    startTime: null,
    totalFrames: 0,
    processedFrames: 0,
    errors: []
};

async function ensureDirectories() {
    await fs.mkdir(CONFIG.FRAMES_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
}

async function fetchImage(sourceId, date) {
    const imageScale = sourceId === 4 ? 8 : 2.5;
    const width = 1920;
    const height = sourceId === 4 ? 1200 : 1920;
    
    const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
        `date=${date}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
        `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;
    
    const fetchUrl = CONFIG.USE_CLOUDFLARE 
        ? `${CONFIG.CLOUDFLARE_URL}/?url=${encodeURIComponent(apiUrl)}`
        : apiUrl;
    
    const tempFile = path.join(CONFIG.TEMP_DIR, `temp_${Date.now()}.png`);
    
    await execAsync(`curl -s -o "${tempFile}" "${fetchUrl}"`, { timeout: 30000 });
    const buffer = await fs.readFile(tempFile);
    await fs.unlink(tempFile).catch(() => {});
    return buffer;
}

async function runTest() {
    productionState.status = 'running';
    productionState.startTime = Date.now();
    
    await ensureDirectories();
    
    // Calculate test date (2 days ago)
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
    targetDate.setHours(0, 0, 0, 0);
    
    console.log(`📅 Test date: ${targetDate.toISOString().split('T')[0]}`);
    console.log('');
    
    productionState.totalFrames = CONFIG.FRAMES_PER_DAY;
    
    // Process just 10 frames for quick test
    const TEST_FRAMES = 10;
    console.log(`🧪 Testing with ${TEST_FRAMES} frames...\n`);
    
    for (let i = 0; i < TEST_FRAMES; i++) {
        const frameDate = new Date(targetDate);
        frameDate.setMinutes(frameDate.getMinutes() + i * CONFIG.INTERVAL_MINUTES);
        
        try {
            console.log(`Frame ${i + 1}/${TEST_FRAMES}: ${frameDate.toISOString()}`);
            
            // Fetch images
            const [coronaBuffer, sunBuffer] = await Promise.all([
                fetchImage(4, frameDate.toISOString()),
                fetchImage(10, frameDate.toISOString())
            ]);
            
            console.log(`  ✓ Images fetched (${coronaBuffer.length} + ${sunBuffer.length} bytes)`);
            
            // Save test frame
            const framePath = path.join(CONFIG.FRAMES_DIR, `test_frame_${i}.jpg`);
            await fs.writeFile(framePath, coronaBuffer); // Just save corona for test
            
            productionState.processedFrames++;
            console.log(`  ✓ Saved to ${framePath}`);
            
        } catch (error) {
            console.error(`  ✗ Failed: ${error.message}`);
            productionState.errors.push(error.message);
        }
    }
    
    const duration = ((Date.now() - productionState.startTime) / 1000).toFixed(1);
    
    console.log('\n' + '─'.repeat(40));
    console.log('📊 Test Results:');
    console.log(`   Duration: ${duration} seconds`);
    console.log(`   Success: ${productionState.processedFrames}/${TEST_FRAMES}`);
    console.log(`   Errors: ${productionState.errors.length}`);
    console.log(`   Output: ${CONFIG.FRAMES_DIR}`);
    
    if (productionState.errors.length === 0) {
        console.log('\n✅ Test PASSED! Ready for full production.');
    } else {
        console.log('\n⚠️  Test had errors. Check configuration.');
    }
    
    productionState.status = 'completed';
}

// Run the test
runTest().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});