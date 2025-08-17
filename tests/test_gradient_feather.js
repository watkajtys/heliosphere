#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// Simple gradient-based square feathering (based on what worked for circles)
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    const squareTop = center - compositeRadius;
    
    // Use a radial gradient clipped to square (hybrid approach)
    const radiusRatio = compositeRadius / center;
    const featherRatio = (compositeRadius - featherRadius) / compositeRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="${radiusRatio * 70}%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${featherRatio * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
                <clipPath id="squareClip">
                    <rect x="${squareLeft - featherRadius}" y="${squareTop - featherRadius}" 
                          width="${squareSize + featherRadius * 2}" height="${squareSize + featherRadius * 2}"/>
                </clipPath>
            </defs>
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <circle cx="50%" cy="50%" r="${(compositeRadius + featherRadius) / center * 100}%" 
                    fill="url(#feather)" clip-path="url(#squareClip)"/>
        </svg>
    `;
    
    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

async function test() {
    console.log('🎨 Testing gradient-based square feathering...\n');
    
    // Create test sun
    const testSun = await sharp({
        create: {
            width: 1435,
            height: 1435,
            channels: 4,
            background: { r: 255, g: 200, b: 50, alpha: 1 }
        }
    }).png().toBuffer();
    
    const tests = [0, 20, 40, 80];
    
    for (const radius of tests) {
        console.log(`Testing ${radius}px feather...`);
        
        const feathered = await applySquareFeather(testSun, 1435, 400, radius);
        
        // Save just the feathered image
        await fs.writeFile(`gradient_test_${radius}.png`, feathered);
        
        // Check size
        const meta = await sharp(feathered).metadata();
        console.log(`  Size: ${meta.width}x${meta.height}`);
        
        // Ensure it fits
        const sized = meta.width > 1460 || meta.height > 1200 
            ? await sharp(feathered).resize(1200, 1200, { fit: 'inside' }).toBuffer()
            : feathered;
        
        // Create composite
        const composite = await sharp({
            create: {
                width: 1460,
                height: 1200,
                channels: 4,
                background: { r: 60, g: 65, b: 70, alpha: 1 }
            }
        })
        .composite([{
            input: sized,
            gravity: 'center',
            blend: 'over'
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        await fs.writeFile(`gradient_composite_${radius}.jpg`, composite);
        console.log(`  ✅ Saved gradient_composite_${radius}.jpg\n`);
    }
}

test().catch(console.error);