#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// PROPERLY FIXED Square Feathering Function
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
    
    // Create proper SVG mask with feathering
    const maskSvg = `<?xml version="1.0" encoding="UTF-8"?>
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="feather">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="${featherRadius / 3}" />
                </filter>
            </defs>
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <rect x="${squareLeft}" 
                  y="${squareTop}" 
                  width="${squareSize}" 
                  height="${squareSize}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    `;
    
    // Generate the mask
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .png()
        .toBuffer();
    
    // Apply mask using composite with dest-in
    return await sharp(resizedImage)
        .ensureAlpha()
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

async function testFixed() {
    console.log('🔧 Testing PROPERLY FIXED feather implementation...\n');
    
    // Create a test sun disk (bright orange/yellow)
    const testSun = await sharp({
        create: {
            width: 1435,
            height: 1435,
            channels: 4,
            background: { r: 255, g: 200, b: 50, alpha: 1 }
        }
    })
    .composite([{
        input: Buffer.from(`
            <svg width="1435" height="1435">
                <circle cx="717" cy="717" r="700" fill="#FFA500" />
                <text x="717" y="717" font-size="200" fill="white" text-anchor="middle">SDO</text>
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Test with different feather radii
    const tests = [
        { radius: 0, desc: 'Hard edge' },
        { radius: 40, desc: 'Default feather' },
        { radius: 80, desc: 'Soft feather' }
    ];
    
    for (const test of tests) {
        console.log(`Testing ${test.radius}px feather (${test.desc})...`);
        
        // Apply feathering
        const feathered = await applySquareFeather(testSun, 1435, 400, test.radius);
        
        // Create composite on gray background (simulating corona)
        const composite = await sharp({
            create: {
                width: 1460,
                height: 1200,
                channels: 4,
                background: { r: 60, g: 65, b: 70, alpha: 1 }
            }
        })
        .composite([{
            input: feathered,
            gravity: 'center',
            blend: 'over'
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        await fs.writeFile(`test_fixed_v2_${test.radius}.jpg`, composite);
        console.log(`  ✅ Saved: test_fixed_v2_${test.radius}.jpg`);
    }
    
    console.log('\n✨ Test complete! Check the images to verify feathering works.');
}

testFixed().catch(console.error);