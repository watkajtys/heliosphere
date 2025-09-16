#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const FRAMES_DIR = '/opt/heliosphere/frames';

async function analyzeFrame(framePath) {
    try {
        const buffer = await fs.readFile(framePath);
        const { width, height } = await sharp(buffer).metadata();
        
        // Sample the corona region (outer edges)
        const topRegion = await sharp(buffer)
            .extract({ left: 700, top: 50, width: 100, height: 100 })
            .raw()
            .toBuffer();
        
        // Calculate average color of corona
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < topRegion.length; i += 3) {
            r += topRegion[i];
            g += topRegion[i + 1];
            b += topRegion[i + 2];
        }
        const pixels = topRegion.length / 3;
        r = r / pixels;
        g = g / pixels;
        b = b / pixels;
        
        // Determine if corona is red/orange (bad) or white/blue (good)
        // Red/orange has high red, moderate green, low blue
        // White/blue has balanced RGB or higher blue
        const isRed = r > 150 && g > 100 && b < 100 && r > b * 1.5;
        
        return {
            path: framePath,
            avgColor: { r: Math.round(r), g: Math.round(g), b: Math.round(b) },
            isRed,
            size: (await fs.stat(framePath)).size
        };
    } catch (error) {
        return { path: framePath, error: error.message };
    }
}

async function main() {
    console.log('Analyzing frames for color issues...\n');
    
    // Get all dates
    const dates = await fs.readdir(FRAMES_DIR);
    dates.sort();
    
    const badFrames = [];
    const goodFrames = [];
    
    for (const date of dates) {
        if (!date.startsWith('2025-')) continue;
        
        const framePath = path.join(FRAMES_DIR, date, 'frame_1200.jpg');
        try {
            await fs.access(framePath);
            const analysis = await analyzeFrame(framePath);
            
            if (analysis.isRed) {
                badFrames.push(date);
                console.log(`❌ ${date}: RED corona (R:${analysis.avgColor.r} G:${analysis.avgColor.g} B:${analysis.avgColor.b})`);
            } else {
                goodFrames.push(date);
                console.log(`✅ ${date}: White corona (R:${analysis.avgColor.r} G:${analysis.avgColor.g} B:${analysis.avgColor.b})`);
            }
        } catch (error) {
            console.log(`⚠️ ${date}: ${error.message}`);
        }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   Good frames: ${goodFrames.length}`);
    console.log(`   Bad frames: ${badFrames.length}`);
    
    if (badFrames.length > 0) {
        console.log('\n❌ Frames needing regeneration:');
        badFrames.forEach(date => console.log(`   ${date}`));
        
        // Save list for regeneration
        await fs.writeFile('/opt/heliosphere/bad_frames_list.txt', badFrames.join('\n'));
        console.log('\nSaved to bad_frames_list.txt');
    }
}

main().catch(console.error);