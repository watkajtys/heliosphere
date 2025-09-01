#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';
import https from 'https';
import { createWriteStream } from 'fs';

// Original grading
async function gradeSunDiskOriginal(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.7, -30)
        .gamma(1.15)
        .toBuffer();
}

// New gentle grading  
async function gradeSunDiskNew(imageBuffer) {
    return await sharp(imageBuffer)
        .modulate({ saturation: 1.25, brightness: 1.2, hue: 15 })
        .tint({ r: 255, g: 200, b: 120 })
        .linear(1.4, -20)
        .gamma(1.05)
        .toBuffer();
}

async function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(filepath);
        https.get(url, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('🔬 Testing sun disk grading adjustments...\n');
    
    // Download a raw SDO frame
    const url = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-20T12:00:00Z&layers=[10,1,100]&imageScale=2.42044088&width=1435&height=1435&x0=0&y0=0&display=true&watermark=false';
    const rawPath = 'test_raw_sdo.jpg';
    
    console.log('📥 Downloading raw SDO frame...');
    await downloadImage(url, rawPath);
    
    const rawBuffer = await fs.readFile(rawPath);
    
    console.log('🎨 Applying original grading...');
    const originalGraded = await gradeSunDiskOriginal(rawBuffer);
    await fs.writeFile('test_graded_original.jpg', originalGraded);
    
    console.log('🎨 Applying new gentle grading...');
    const newGraded = await gradeSunDiskNew(rawBuffer);
    await fs.writeFile('test_graded_new.jpg', newGraded);
    
    // Simulate screen blend with black background
    console.log('🔄 Simulating screen blend composite...');
    
    // Create black background with sun disk in center
    const coronaBackground = await sharp({
        create: {
            width: 1435,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 }
        }
    }).jpeg().toBuffer();
    
    // Composite with screen blend - original
    const compositeOriginal = await sharp(coronaBackground)
        .composite([{
            input: originalGraded,
            blend: 'screen',
            gravity: 'center'
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
    await fs.writeFile('test_composite_original.jpg', compositeOriginal);
    
    // Composite with screen blend - new
    const compositeNew = await sharp(coronaBackground)
        .composite([{
            input: newGraded,
            blend: 'screen', 
            gravity: 'center'
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
    await fs.writeFile('test_composite_new.jpg', compositeNew);
    
    console.log('\n✅ Test complete! Generated files:');
    console.log('  - test_raw_sdo.jpg (original from API)');
    console.log('  - test_graded_original.jpg (old aggressive grading)');
    console.log('  - test_graded_new.jpg (new gentle grading)');
    console.log('  - test_composite_original.jpg (old grading + screen blend)');
    console.log('  - test_composite_new.jpg (new grading + screen blend)');
    console.log('\nCompare test_composite_original.jpg vs test_composite_new.jpg to see the difference!');
}

main().catch(console.error);