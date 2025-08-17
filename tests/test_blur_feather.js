#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// Feathering using Sharp's native blur
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    
    if (featherRadius <= 0) {
        // For no feathering, still apply hard mask
        const hardMaskSvg = `
            <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
                <rect width="${finalSize}" height="${finalSize}" fill="black"/>
                <rect x="${squareLeft}" y="${center - compositeRadius}" 
                      width="${squareSize}" height="${squareSize}" 
                      fill="white"/>
            </svg>
        `;
        const mask = await sharp(Buffer.from(hardMaskSvg))
            .resize(finalSize, finalSize)
            .toBuffer();
        return await sharp(resizedImage)
            .composite([{ input: mask, blend: 'dest-in' }])
            .png()
            .toBuffer();
    }
    const squareTop = center - compositeRadius;
    
    // Create a hard-edged square mask (no SVG filter)
    const hardMaskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <rect x="${squareLeft}" y="${squareTop}" 
                  width="${squareSize}" height="${squareSize}" 
                  fill="white"/>
        </svg>
    `;
    
    // Convert SVG to buffer, then apply blur using Sharp's native blur
    const mask = await sharp(Buffer.from(hardMaskSvg))
        .resize(finalSize, finalSize)
        .blur(featherRadius / 3)  // Apply gaussian blur directly
        .toBuffer();
    
    // Save the mask to see what it looks like
    await fs.writeFile(`mask_blur_${featherRadius}.png`, mask);
    console.log(`  Saved mask: mask_blur_${featherRadius}.png`);
    
    // Apply the blurred mask to create feathered edges
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

async function test() {
    console.log('🧪 Testing feathering with Sharp blur...\n');
    
    // Create a test sun image
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
                <circle cx="717" cy="717" r="600" fill="#FFA500"/>
                <text x="717" y="717" font-size="200" fill="white" text-anchor="middle">SUN</text>
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Test different feather radii
    const tests = [0, 40, 80];
    
    for (const radius of tests) {
        console.log(`Testing ${radius}px feather...`);
        
        const feathered = await applySquareFeather(testSun, 1435, 400, radius);
        
        // Check the size
        const meta = await sharp(feathered).metadata();
        console.log(`  Feathered size: ${meta.width}x${meta.height}`);
        
        // Resize if needed
        const resizedFeathered = await sharp(feathered)
            .resize(1435, 1435, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .toBuffer();
        
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
            input: resizedFeathered,
            gravity: 'center',
            blend: 'over'
        }])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        await fs.writeFile(`blur_feather_${radius}.jpg`, composite);
        console.log(`  ✅ Saved: blur_feather_${radius}.jpg\n`);
    }
    
    console.log('✨ Test complete! Check the images and masks.');
}

test().catch(console.error);