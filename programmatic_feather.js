#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// Create feather mask programmatically without SVG
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
    
    // Step 1: Create a white square on black background (no SVG)
    const hardMask = await sharp({
        create: {
            width: finalSize,
            height: finalSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 255 }
        }
    })
    .composite([{
        input: await sharp({
            create: {
                width: squareSize,
                height: squareSize,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 255 }
            }
        }).png().toBuffer(),
        gravity: 'center'
    }])
    .png()
    .toBuffer();
    
    // Step 2: Apply blur to create feathering
    const blurredMask = await sharp(hardMask)
        .blur(featherRadius / 2)
        .toBuffer();
    
    // Save masks for debugging
    await fs.writeFile(`mask_hard.png`, hardMask);
    await fs.writeFile(`mask_blurred_${featherRadius}.png`, blurredMask);
    
    // Step 3: Apply the blurred mask
    return await sharp(resizedImage)
        .composite([{
            input: blurredMask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

async function test() {
    console.log('🔧 Testing programmatic feathering (no SVG)...\n');
    
    // Create test sun
    const testSun = await sharp({
        create: {
            width: 1435,
            height: 1435,
            channels: 4,
            background: { r: 255, g: 200, b: 50, alpha: 255 }
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
    
    const tests = [0, 20, 40, 80];
    
    for (const radius of tests) {
        console.log(`Testing ${radius}px feather...`);
        
        try {
            const feathered = await applySquareFeather(testSun, 1435, 400, radius);
            
            // Save feathered image
            await fs.writeFile(`programmatic_${radius}.png`, feathered);
            
            // Create composite on background
            const composite = await sharp({
                create: {
                    width: 1460,
                    height: 1200,
                    channels: 4,
                    background: { r: 60, g: 65, b: 70, alpha: 255 }
                }
            })
            .composite([{
                input: await sharp(feathered)
                    .resize(1200, 1200, { fit: 'inside' })
                    .toBuffer(),
                gravity: 'center',
                blend: 'over'
            }])
            .jpeg({ quality: 95 })
            .toBuffer();
            
            await fs.writeFile(`programmatic_composite_${radius}.jpg`, composite);
            console.log(`  ✅ Saved programmatic_composite_${radius}.jpg\n`);
        } catch (error) {
            console.error(`  ❌ Error: ${error.message}\n`);
        }
    }
    
    console.log('✨ Test complete! Check the generated images.');
}

test().catch(console.error);