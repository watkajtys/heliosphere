#!/usr/bin/env node

// Simple composite test using synthetic images
import sharp from 'sharp';
import fs from 'fs/promises';

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

async function testComposite() {
    console.log('🎨 Creating test composite with synthetic images...\n');
    
    // Create synthetic corona (gray/silver background)
    console.log('📸 Creating synthetic corona...');
    const corona = await sharp({
        create: {
            width: 1920,
            height: 1435,
            channels: 4,
            background: { r: 60, g: 65, b: 70, alpha: 1 }
        }
    })
    .composite([{
        input: Buffer.from(`
            <svg width="1920" height="1435">
                <defs>
                    <radialGradient id="coronaGrad">
                        <stop offset="0%" stop-color="#808080" />
                        <stop offset="100%" stop-color="#303030" />
                    </radialGradient>
                </defs>
                <rect width="1920" height="1435" fill="url(#coronaGrad)" />
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .jpeg({ quality: 95 })
    .toBuffer();
    
    // Create synthetic sun disk (golden/yellow)
    console.log('📸 Creating synthetic sun disk...');
    const sunDisk = await sharp({
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
                <defs>
                    <radialGradient id="sunGrad">
                        <stop offset="0%" stop-color="#FFD700" />
                        <stop offset="50%" stop-color="#FFA500" />
                        <stop offset="100%" stop-color="#FF8C00" />
                    </radialGradient>
                </defs>
                <rect width="1435" height="1435" fill="url(#sunGrad)" />
                <text x="50%" y="50%" font-size="200" fill="rgba(255,255,255,0.3)" text-anchor="middle" dy="0.3em">SUN</text>
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Test different feather radii
    const featherRadii = [0, 20, 40, 80, 120];
    
    for (const featherRadius of featherRadii) {
        console.log(`\n🔧 Creating composite with ${featherRadius}px feather...`);
        
        // Apply square feathering to sun disk
        const featheredSunDisk = await applySquareFeather(
            sunDisk, 1435, 400, featherRadius
        );
        
        // Create composite
        const composite = await sharp({
            create: {
                width: 1920,
                height: 1435,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([
            { input: corona, gravity: 'center' },
            { input: featheredSunDisk, gravity: 'center', blend: 'over' }
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        // Save full composite
        const filename = `composite_test_${featherRadius}.jpg`;
        await fs.writeFile(filename, composite);
        console.log(`  ✅ Saved: ${filename}`);
        
        // Also save cropped version (final video dimensions)
        const cropped = await sharp(composite)
            .extract({ left: 230, top: 117, width: 1460, height: 1200 })
            .jpeg({ quality: 95 })
            .toBuffer();
        
        const croppedFilename = `composite_test_${featherRadius}_cropped.jpg`;
        await fs.writeFile(croppedFilename, cropped);
        console.log(`  ✅ Saved: ${croppedFilename}`);
    }
    
    console.log('\n✨ Test complete! Generated files:');
    console.log('  Full composites (1920x1435):');
    console.log('    - composite_test_0.jpg (hard edge)');
    console.log('    - composite_test_20.jpg (subtle feather)');
    console.log('    - composite_test_40.jpg (default feather)');
    console.log('    - composite_test_80.jpg (soft feather)');
    console.log('    - composite_test_120.jpg (very soft feather)');
    console.log('\n  Cropped versions (1460x1200):');
    console.log('    - composite_test_*_cropped.jpg');
}

testComposite().catch(console.error);