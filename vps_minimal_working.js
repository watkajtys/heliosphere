#!/usr/bin/env node
import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';
import { execSync } from 'child_process';

// Configuration
const DAYS = 2; // Test with 2 days
const DATA_DELAY_DAYS = 2;
const FRAME_INTERVAL = 15 * 60 * 1000; // 15 minutes
const OUTPUT_DIR = '/opt/heliosphere/minimal_frames';
const VIDEO_DIR = '/opt/heliosphere/minimal_videos';

// Ensure directories exist
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

// Clear old frames
execSync(`rm -f ${OUTPUT_DIR}/*.jpg`);

async function fetchAndProcessFrame(date, frameIndex) {
    const formattedDate = date.toISOString();
    
    try {
        // Fetch sun disk (SDO/AIA 171)
        const sunUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${formattedDate}&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
        
        const sunResponse = await fetch(sunUrl);
        if (!sunResponse.ok) {
            throw new Error(`Sun fetch failed: ${sunResponse.status}`);
        }
        const sunBuffer = Buffer.from(await sunResponse.arrayBuffer());
        
        // Fetch corona (SOHO/LASCO C2)
        const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${formattedDate}&layers=[4,1,100]&imageScale=2.42&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
        
        const coronaResponse = await fetch(coronaUrl);
        if (!coronaResponse.ok) {
            throw new Error(`Corona fetch failed: ${coronaResponse.status}`);
        }
        const coronaBuffer = Buffer.from(await coronaResponse.arrayBuffer());
        
        // Simple resize for sun
        const processedSun = await sharp(sunBuffer)
            .resize(700, 700) // Smaller to fit in corona occluding disk
            .toBuffer();
        
        // Simple composite
        const composite = await sharp(coronaBuffer)
            .composite([
                { input: processedSun, gravity: 'center', blend: 'screen' }
            ])
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        // Save frame
        const framePath = `${OUTPUT_DIR}/frame_${String(frameIndex).padStart(5, '0')}.jpg`;
        fs.writeFileSync(framePath, composite);
        
        return true;
    } catch (error) {
        console.error(`Frame ${frameIndex} error:`, error.message);
        return false;
    }
}

async function main() {
    console.log('Starting minimal production test...');
    console.log(`Processing ${DAYS} days of data`);
    
    // Calculate date range
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - DATA_DELAY_DAYS);
    endDate.setUTCHours(23, 45, 0, 0);
    
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - DAYS + 1);
    startDate.setUTCHours(0, 0, 0, 0);
    
    console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Generate frame dates
    const frameDates = [];
    const current = new Date(startDate);
    while (current <= endDate) {
        frameDates.push(new Date(current));
        current.setTime(current.getTime() + FRAME_INTERVAL);
    }
    
    console.log(`Total frames: ${frameDates.length}`);
    
    // Process frames sequentially
    let successCount = 0;
    for (let i = 0; i < frameDates.length; i++) {
        process.stdout.write(`\rProcessing frame ${i + 1}/${frameDates.length}...`);
        const success = await fetchAndProcessFrame(frameDates[i], i);
        if (success) successCount++;
    }
    
    console.log(`\n✅ Processed ${successCount}/${frameDates.length} frames`);
    
    // Generate video if we have frames
    if (successCount > 0) {
        console.log('Generating video...');
        const videoPath = `${VIDEO_DIR}/minimal_test_${new Date().toISOString().split('T')[0]}.mp4`;
        
        try {
            execSync(
                `ffmpeg -y -framerate 24 -pattern_type glob -i "${OUTPUT_DIR}/*.jpg" ` +
                `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart "${videoPath}"`,
                { stdio: 'inherit' }
            );
            console.log(`✅ Video saved to ${videoPath}`);
        } catch (error) {
            console.error('Video generation failed:', error.message);
        }
    }
}

main().catch(console.error);