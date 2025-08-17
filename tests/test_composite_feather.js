#!/usr/bin/env node

// Test composite frame with feathering
import sharp from 'sharp';
import fs from 'fs/promises';
import https from 'https';
import crypto from 'crypto';

// Download image from URL
async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                https.get(response.headers.location, (redirectResponse) => {
                    const chunks = [];
                    redirectResponse.on('data', (chunk) => chunks.push(chunk));
                    redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
                    redirectResponse.on('error', reject);
                });
            } else {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            }
        });
    });
}

// Apply color grading to corona
async function gradeCorona(buffer) {
    return await sharp(buffer)
        .resize(1920, 1435, { kernel: sharp.kernel.lanczos3 })
        .modulate({ saturation: 0.2, brightness: 1.0 })
        .linear(1.0, 0)
        .gamma(1.2)
        .toBuffer();
}

// Apply color grading to sun disk
async function gradeSunDisk(buffer) {
    return await sharp(buffer)
        .resize(1435, 1435, { kernel: sharp.kernel.lanczos3 })
        .modulate({ saturation: 1.8, brightness: 1.0 })
        .linear(1.0, 0)
        .gamma(1.15)
        .toBuffer();
}

// Apply square feathering
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

// Create composite
async function createComposite(coronaBuffer, sunDiskBuffer, featherRadius) {
    console.log(`  📷 Creating composite with ${featherRadius}px feather...`);
    
    // Apply color grading
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCorona(coronaBuffer),
        gradeSunDisk(sunDiskBuffer)
    ]);
    
    // Apply square feathering to sun disk
    const featheredSunDisk = await applySquareFeather(
        gradedSunDisk, 1435, 400, featherRadius
    );
    
    // Create composite
    const compositeImage = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: gradedCorona, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'over' }
    ])
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
    
    // Crop to final dimensions
    return await sharp(compositeImage)
        .extract({ left: 230, top: 117, width: 1460, height: 1200 })
        .jpeg({ quality: 95, mozjpeg: true })
        .toBuffer();
}

async function testCompositeFeather() {
    console.log('🎨 Testing composite with feathering...\n');
    
    // Test date
    const testDate = '2025-08-15T12:00:00';
    
    console.log('📥 Downloading test images...');
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[4,1,100]&imageScale=0.6&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false`;
    const sunUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[10,1,100]&imageScale=0.6&width=1435&height=1435&x0=0&y0=0&display=true&watermark=false`;
    
    const [coronaBuffer, sunBuffer] = await Promise.all([
        downloadImage(coronaUrl),
        downloadImage(sunUrl)
    ]);
    
    // Verify we got images
    const coronaInfo = await sharp(coronaBuffer).metadata();
    const sunInfo = await sharp(sunBuffer).metadata();
    console.log(`  ✅ Corona: ${coronaInfo.width}x${coronaInfo.height}`);
    console.log(`  ✅ Sun: ${sunInfo.width}x${sunInfo.height}\n`);
    
    // Test different feather radii
    const featherRadii = [0, 20, 40, 80];
    
    for (const featherRadius of featherRadii) {
        console.log(`🔧 Testing feather radius: ${featherRadius}px`);
        
        const composite = await createComposite(coronaBuffer, sunBuffer, featherRadius);
        
        const filename = `composite_feather_${featherRadius}.jpg`;
        await fs.writeFile(filename, composite);
        console.log(`  ✅ Saved: ${filename}\n`);
    }
    
    console.log('✨ Composite test complete! Check the generated images:');
    console.log('  - composite_feather_0.jpg (hard edge)');
    console.log('  - composite_feather_20.jpg (subtle)');
    console.log('  - composite_feather_40.jpg (default)');
    console.log('  - composite_feather_80.jpg (soft)');
}

testCompositeFeather().catch(console.error);