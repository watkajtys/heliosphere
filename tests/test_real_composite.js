#!/usr/bin/env node

// Test with real SOHO/SDO images
import sharp from 'sharp';
import fs from 'fs/promises';
import https from 'https';
import crypto from 'crypto';

// Configuration
const CONFIG = {
    COMPOSITE_RADIUS: 400,
    CACHE_DIR: './image_cache'
};

// Ensure cache directory exists
async function ensureCacheDir() {
    try {
        await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
    } catch (error) {
        // Directory already exists
    }
}

// Download with caching
async function downloadWithCache(url, cacheKey) {
    await ensureCacheDir();
    const cachePath = `${CONFIG.CACHE_DIR}/${cacheKey}.jpg`;
    
    try {
        // Check if cached
        const cached = await fs.readFile(cachePath);
        console.log(`  📂 Using cached: ${cacheKey}`);
        return cached;
    } catch (error) {
        // Not cached, download
        console.log(`  📥 Downloading: ${cacheKey}`);
        const buffer = await downloadImage(url);
        await fs.writeFile(cachePath, buffer);
        return buffer;
    }
}

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

// Apply square feathering with the FIXED implementation
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

// Process single frame
async function processFrame(coronaData, sunDiskData, featherRadius) {
    // Apply color grading
    const [gradedCorona, gradedSunDisk] = await Promise.all([
        gradeCorona(coronaData),
        gradeSunDisk(sunDiskData)
    ]);
    
    // Apply square feathering to sun disk
    const featheredSunDisk = await applySquareFeather(
        gradedSunDisk, 1435, CONFIG.COMPOSITE_RADIUS, featherRadius
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

async function testRealComposite() {
    console.log('🛰️ Testing composite with real SOHO/SDO images...\n');
    
    // Use a recent date
    const testDate = '2025-08-14T12:00:00';
    
    console.log('📥 Fetching real satellite images...');
    
    // SOHO LASCO C2 Corona (sourceId: 4)
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[4,1,100]&imageScale=0.6&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false`;
    
    // SDO AIA 171 Sun Disk (sourceId: 10)
    const sunUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[10,1,100]&imageScale=0.6&width=1435&height=1435&x0=0&y0=0&display=true&watermark=false`;
    
    // Download with caching
    const [coronaBuffer, sunBuffer] = await Promise.all([
        downloadWithCache(coronaUrl, 'corona_2025-08-14'),
        downloadWithCache(sunUrl, 'sun_2025-08-14')
    ]);
    
    // Verify we got valid images
    try {
        const coronaInfo = await sharp(coronaBuffer).metadata();
        const sunInfo = await sharp(sunBuffer).metadata();
        console.log(`  ✅ Corona: ${coronaInfo.width}x${coronaInfo.height} (SOHO/LASCO C2)`);
        console.log(`  ✅ Sun: ${sunInfo.width}x${sunInfo.height} (SDO/AIA 171)\n`);
    } catch (error) {
        console.error('❌ Failed to get valid images from API');
        console.error('  The API might be down or returning error pages.');
        return;
    }
    
    // Test different feather radii
    const featherRadii = [0, 20, 40, 80, 120];
    
    console.log('🎨 Creating composites with different feather settings...\n');
    
    for (const featherRadius of featherRadii) {
        console.log(`📸 Processing with ${featherRadius}px feather...`);
        
        const composite = await processFrame(coronaBuffer, sunBuffer, featherRadius);
        
        const filename = `real_composite_${featherRadius}.jpg`;
        await fs.writeFile(filename, composite);
        console.log(`  ✅ Saved: ${filename}`);
    }
    
    console.log('\n✨ Test complete! Generated real composites:');
    console.log('  - real_composite_0.jpg (hard edge)');
    console.log('  - real_composite_20.jpg (subtle feather)');
    console.log('  - real_composite_40.jpg (default)');
    console.log('  - real_composite_80.jpg (soft)');
    console.log('  - real_composite_120.jpg (very soft)');
}

testRealComposite().catch(console.error);