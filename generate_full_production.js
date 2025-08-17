#!/usr/bin/env node

/**
 * Generate Full 56-Day Heliosphere Production
 * 5,376 frames total (56 days × 96 frames/day)
 * Runs locally for speed, uploads to Cloud Storage
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
    TOTAL_DAYS: 56,
    FRAMES_PER_DAY: 96,
    TOTAL_FRAMES: 5376,
    
    // Process in daily batches
    BATCH_SIZE: 96,  // One day at a time
    
    // Server URL
    SERVER_URL: 'http://localhost:8080',
    
    // Progress tracking
    PROGRESS_FILE: 'generation_progress.json',
    LOG_FILE: 'generation_full.log'
};

// Load or initialize progress
async function loadProgress() {
    try {
        const data = await fs.readFile(CONFIG.PROGRESS_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return {
            startTime: Date.now(),
            completedDays: [],
            completedFrames: 0,
            totalFrames: CONFIG.TOTAL_FRAMES,
            lastUpdate: null,
            status: 'pending'
        };
    }
}

// Save progress
async function saveProgress(progress) {
    await fs.writeFile(CONFIG.PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// Log with timestamp
async function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}`;
    console.log(logEntry);
    
    // Also write to file
    await fs.appendFile(CONFIG.LOG_FILE, logEntry + '\n').catch(() => {});
}

// Check server status
async function checkServerStatus() {
    try {
        const response = await fetch(`${CONFIG.SERVER_URL}/status`);
        const data = await response.json();
        return data;
    } catch (error) {
        return null;
    }
}

// Start generation batch
async function startBatch(frames, dayNumber) {
    try {
        const response = await fetch(`${CONFIG.SERVER_URL}/generate?frames=${frames}`, {
            method: 'POST',
            headers: { 'Content-Length': '0' }
        });
        const data = await response.json();
        await log(`Started generation for Day ${dayNumber} (${frames} frames): ${data.message}`);
        return true;
    } catch (error) {
        await log(`Failed to start batch for Day ${dayNumber}: ${error.message}`, 'ERROR');
        return false;
    }
}

// Wait for batch completion
async function waitForCompletion(expectedFrames, timeoutMinutes = 30) {
    const startTime = Date.now();
    const timeout = timeoutMinutes * 60 * 1000;
    
    while (true) {
        const status = await checkServerStatus();
        
        if (!status) {
            await log('Server not responding', 'WARNING');
            return false;
        }
        
        // Check if completed
        if (status.status === 'completed' && status.completedFrames === expectedFrames) {
            await log(`Batch completed: ${status.completedFrames}/${expectedFrames} frames`);
            return true;
        }
        
        // Check if failed
        if (status.status === 'error' || status.status === 'stopped') {
            await log(`Batch failed with status: ${status.status}`, 'ERROR');
            return false;
        }
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
            await log(`Batch timed out after ${timeoutMinutes} minutes`, 'ERROR');
            return false;
        }
        
        // Progress update
        const runtime = Math.floor((Date.now() - startTime) / 1000);
        const progress = status.completedFrames || 0;
        process.stdout.write(`\rDay progress: ${progress}/${expectedFrames} frames (${runtime}s)`);
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
}

// Main generation function
async function generateFullProduction() {
    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║   Heliosphere Full Production Generation          ║');
    console.log('║   56 Days × 96 Frames = 5,376 Total Frames        ║');
    console.log('╚════════════════════════════════════════════════════╝\n');
    
    // Load progress
    const progress = await loadProgress();
    await log('Starting full production generation');
    await log(`Progress: ${progress.completedFrames}/${CONFIG.TOTAL_FRAMES} frames completed`);
    
    // Check if server is running
    const serverStatus = await checkServerStatus();
    if (!serverStatus) {
        await log('Server not running! Start with: node cloud_server.js', 'ERROR');
        console.log('\n❌ Please start the server first:');
        console.log('   node cloud_server.js');
        return;
    }
    
    if (serverStatus.status === 'running') {
        await log('Server has a generation in progress. Waiting for completion...', 'WARNING');
        // Wait for current generation to complete
        await waitForCompletion(serverStatus.totalFrames);
    }
    
    // Calculate starting point
    const startDay = progress.completedDays.length + 1;
    const startFrame = progress.completedFrames + 1;
    
    await log(`Starting from Day ${startDay}, Frame ${startFrame}`);
    
    // Process each day
    for (let day = startDay; day <= CONFIG.TOTAL_DAYS; day++) {
        console.log(`\n${'═'.repeat(50)}`);
        console.log(`Day ${day} of ${CONFIG.TOTAL_DAYS}`);
        console.log(`${'═'.repeat(50)}`);
        
        const dayStartTime = Date.now();
        
        // Start batch for this day
        const started = await startBatch(CONFIG.FRAMES_PER_DAY, day);
        if (!started) {
            await log(`Failed to start Day ${day}, retrying in 10 seconds...`, 'ERROR');
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
        }
        
        // Wait for completion
        const completed = await waitForCompletion(CONFIG.FRAMES_PER_DAY);
        
        if (completed) {
            // Update progress
            progress.completedDays.push(day);
            progress.completedFrames += CONFIG.FRAMES_PER_DAY;
            progress.lastUpdate = Date.now();
            await saveProgress(progress);
            
            const dayTime = Math.floor((Date.now() - dayStartTime) / 1000);
            await log(`✅ Day ${day} completed in ${dayTime} seconds`);
            
            // Calculate ETA
            const avgTimePerDay = (Date.now() - progress.startTime) / progress.completedDays.length;
            const remainingDays = CONFIG.TOTAL_DAYS - day;
            const eta = new Date(Date.now() + avgTimePerDay * remainingDays);
            
            console.log(`\nProgress: ${progress.completedFrames}/${CONFIG.TOTAL_FRAMES} frames`);
            console.log(`Days completed: ${day}/${CONFIG.TOTAL_DAYS}`);
            console.log(`ETA: ${eta.toLocaleString()}`);
            
        } else {
            await log(`❌ Day ${day} failed! Check logs and retry.`, 'ERROR');
            console.log('\n⚠️  Generation failed. You can resume by running this script again.');
            return;
        }
        
        // Small delay between days
        if (day < CONFIG.TOTAL_DAYS) {
            console.log('\nWaiting 5 seconds before next day...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    // All complete!
    progress.status = 'completed';
    await saveProgress(progress);
    
    const totalTime = Math.floor((Date.now() - progress.startTime) / 1000);
    const hours = Math.floor(totalTime / 3600);
    const minutes = Math.floor((totalTime % 3600) / 60);
    
    console.log('\n' + '🎉'.repeat(20));
    console.log(`\n✅ FULL PRODUCTION COMPLETE!`);
    console.log(`   Total frames: ${CONFIG.TOTAL_FRAMES}`);
    console.log(`   Total time: ${hours}h ${minutes}m`);
    console.log(`   All frames uploaded to Cloud Storage`);
    console.log('\nNext step: Compile video with /compile-video endpoint');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Generation interrupted. Progress has been saved.');
    console.log('Run this script again to resume from where you left off.');
    process.exit(0);
});

// Run the generation
generateFullProduction().catch(async (error) => {
    await log(`Fatal error: ${error.message}`, 'ERROR');
    console.error(error);
    process.exit(1);
});