#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// FIXED Square Feathering Function
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
    
    // FIXED: Proper SVG with namespace and correct filter bounds
    const maskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="feather" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="${featherRadius / 3}" />
                </filter>
            </defs>
            <rect x="${squareLeft}" 
                  y="${squareTop}" 
                  width="${squareSize}" 
                  height="${squareSize}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    `;
    
    // Generate the mask and extract alpha channel properly
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .ensureAlpha()
        .extractChannel('alpha')
        .toBuffer();
    
    // Apply the mask to create feathered edges
    return await sharp(resizedImage)
        .ensureAlpha()
        .joinChannel(mask)
        .png()
        .toBuffer();
}

async function testFixed() {
    console.log('🔧 Testing FIXED feather implementation...\n');
    
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
                <text x="717" y="717" font-size="200" fill="white" text-anchor="middle">SUN</text>
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Test with different feather radii
    const tests = [0, 40, 80];
    
    for (const radius of tests) {
        console.log(`Testing ${radius}px feather...`);
        
        // Apply feathering
        const feathered = await applySquareFeather(testSun, 1435, 400, radius);
        
        // Create composite on gray background
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
        
        await fs.writeFile(`test_fixed_${radius}.jpg`, composite);
        console.log(`  ✅ Saved: test_fixed_${radius}.jpg`);
    }
    
    console.log('\n✨ Test complete! Check the images to verify feathering.');
}

testFixed().catch(console.error);