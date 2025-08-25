#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

// Generate timestamps for the past few hours (every 30 minutes)
function generateTimeStamps(hoursBack = 4, intervalMinutes = 30) {
    const timestamps = [];
    const now = new Date();
    
    for (let i = 0; i <= hoursBack * 60; i += intervalMinutes) {
        const timePoint = new Date(now.getTime() - (i * 60 * 1000));
        timestamps.push({
            iso: timePoint.toISOString(),
            label: `${i}min_ago`,
            filename: `frame_${String(timestamps.length).padStart(3, '0')}_${i}min.png`
        });
    }
    
    return timestamps.reverse(); // Chronological order
}

// Fetch image for a specific timestamp
async function fetchImageForTime(timestamp, baseUrl = 'http://localhost:3002') {
    const url = `${baseUrl}/composite-image?compositeRadius=400&featherRadius=40&date=${encodeURIComponent(timestamp.iso)}`;
    
    console.log(`Fetching ${timestamp.label} (${timestamp.iso})...`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const outputPath = path.join(process.cwd(), 'time_series', timestamp.filename);
        
        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, Buffer.from(buffer));
        console.log(`✓ Saved: ${timestamp.filename}`);
        
        return outputPath;
    } catch (error) {
        console.error(`✗ Failed ${timestamp.label}: ${error.message}`);
        return null;
    }
}

// Main execution
async function main() {
    console.log('🌞 Generating solar composite time series...\n');
    
    const timestamps = generateTimeStamps(4, 30); // Past 4 hours, every 30 minutes
    const results = [];
    
    console.log(`Will fetch ${timestamps.length} frames from ${timestamps[0].iso} to ${timestamps[timestamps.length-1].iso}\n`);
    
    // Fetch images sequentially to avoid overwhelming the server
    for (const timestamp of timestamps) {
        const result = await fetchImageForTime(timestamp);
        results.push({ timestamp, path: result, success: result !== null });
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Summary
    const successful = results.filter(r => r.success).length;
    console.log(`\n📊 Summary: ${successful}/${results.length} frames successfully downloaded`);
    console.log(`📁 Saved to: ./time_series/`);
    
    if (successful > 0) {
        console.log(`\n🎬 To create a video with ffmpeg:`);
        console.log(`cd time_series && ffmpeg -framerate 2 -pattern_type glob -i "*.png" -c:v libx264 -pix_fmt yuv420p solar_timelapse.mp4`);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}