#!/usr/bin/env node

// Test script to verify square feathering is working
import sharp from 'sharp';
import fs from 'fs/promises';
import https from 'https';

async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
    });
}

// Test the feathering implementation
async function testSquareFeather() {
    console.log('🧪 Testing square feather implementation...\n');
    
    // Test parameters
    const finalSize = 1435;
    const compositeRadius = 400;
    const featherRadii = [0, 20, 40, 80, 120];
    
    // Download test images
    console.log('📥 Downloading test images...');
    const coronaUrl = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-15T12:00:00&layers=[4,1,100]&imageScale=0.6&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false';
    const sunUrl = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-15T12:00:00&layers=[10,1,100]&imageScale=0.6&width=1435&height=1435&x0=0&y0=0&display=true&watermark=false';
    
    const [coronaBuffer, sunBuffer] = await Promise.all([
        downloadImage(coronaUrl),
        downloadImage(sunUrl)
    ]);
    
    console.log('✅ Images downloaded\n');
    
    // Test each feather radius
    for (const featherRadius of featherRadii) {
        console.log(`🎨 Testing feather radius: ${featherRadius}px`);
        
        // Apply the square feather
        const result = await applySquareFeather(sunBuffer, finalSize, compositeRadius, featherRadius);
        
        // Save the result
        const filename = `test_feather_${featherRadius}.png`;
        await fs.writeFile(filename, result);
        console.log(`   ✅ Saved: ${filename}`);
        
        // Create a composite to visualize
        const composite = await sharp({
            create: {
                width: 1920,
                height: 1435,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 1 }
            }
        })
        .composite([
            { input: await sharp(coronaBuffer).resize(1920, 1435).toBuffer(), gravity: 'center' },
            { input: result, gravity: 'center', blend: 'over' }
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        const compositeFilename = `test_composite_${featherRadius}.jpg`;
        await fs.writeFile(compositeFilename, composite);
        console.log(`   ✅ Saved composite: ${compositeFilename}\n`);
    }
    
    console.log('✨ Test complete! Check the generated images to verify feathering.');
}

// The improved square feather function
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    // Create a feathered square mask using gaussian blur
    const maskSize = finalSize;
    const center = maskSize / 2;
    
    // Create the mask with a white square and gaussian blur for feathering
    const maskSvg = `
        <svg width="${maskSize}" height="${maskSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="feather" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="${featherRadius / 3}" />
                </filter>
            </defs>
            <rect x="${center - compositeRadius}" 
                  y="${center - compositeRadius}" 
                  width="${compositeRadius * 2}" 
                  height="${compositeRadius * 2}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    `;
    
    // Generate the mask
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .greyscale()
        .toBuffer();
    
    // Apply the mask to the image
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

testSquareFeather().catch(console.error);