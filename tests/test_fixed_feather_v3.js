#!/usr/bin/env node

import sharp from 'sharp';
import fs from 'fs/promises';

// FINAL FIXED Square Feathering Function
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .ensureAlpha()
        .toBuffer();

    if (featherRadius <= 0) {
        // For no feathering, just crop to square
        const center = finalSize / 2;
        const squareSize = compositeRadius * 2;
        const squareLeft = center - compositeRadius;
        const squareTop = center - compositeRadius;
        
        // Create hard-edge mask
        const maskSvg = `
            <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
                <rect width="${finalSize}" height="${finalSize}" fill="black"/>
                <rect x="${squareLeft}" y="${squareTop}" 
                      width="${squareSize}" height="${squareSize}" 
                      fill="white"/>
            </svg>
        `;
        
        const mask = await sharp(Buffer.from(maskSvg))
            .resize(finalSize, finalSize)
            .png()
            .toBuffer();
        
        return await sharp(resizedImage)
            .composite([{
                input: mask,
                blend: 'dest-in'
            }])
            .png()
            .toBuffer();
    }

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    const squareTop = center - compositeRadius;
    
    // Create feathered mask
    const maskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="feather" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="${featherRadius / 3}" />
                </filter>
            </defs>
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <rect x="${squareLeft}" y="${squareTop}" 
                  width="${squareSize}" height="${squareSize}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    `;
    
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .png()
        .toBuffer();
    
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

async function testFixed() {
    console.log('🔧 Testing FINAL FIXED feather implementation...\n');
    
    // Create a colorful test sun disk
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
            <svg width="1435" height="1435" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <radialGradient id="sun">
                        <stop offset="0%" stop-color="#FFD700"/>
                        <stop offset="50%" stop-color="#FFA500"/>
                        <stop offset="100%" stop-color="#FF8C00"/>
                    </radialGradient>
                </defs>
                <rect width="1435" height="1435" fill="url(#sun)"/>
                <text x="717" y="717" font-size="200" fill="white" opacity="0.5" text-anchor="middle">SDO</text>
            </svg>
        `),
        top: 0,
        left: 0
    }])
    .png()
    .toBuffer();
    
    // Test with different feather radii
    const tests = [
        { radius: 0, desc: 'Hard edge (no feather)' },
        { radius: 20, desc: 'Subtle feather' },
        { radius: 40, desc: 'Default feather' },
        { radius: 80, desc: 'Soft feather' }
    ];
    
    for (const test of tests) {
        console.log(`📸 Testing ${test.radius}px - ${test.desc}`);
        
        // Apply feathering
        const feathered = await applySquareFeather(testSun, 1435, 400, test.radius);
        
        // Save the feathered image alone (on transparent background)
        await fs.writeFile(`test_feathered_alone_${test.radius}.png`, feathered);
        console.log(`  ✅ Saved: test_feathered_alone_${test.radius}.png (transparent)`);
        
        // Create composite on gray background (simulating corona)
        const composite = await sharp({
            create: {
                width: 1460,
                height: 1200,
                channels: 4,
                background: { r: 60, g: 65, b: 70, alpha: 1 }
            }
        })
        .composite([
            // Add some fake corona rays
            {
                input: Buffer.from(`
                    <svg width="1460" height="1200" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <radialGradient id="corona">
                                <stop offset="0%" stop-color="white" stop-opacity="0"/>
                                <stop offset="50%" stop-color="white" stop-opacity="0.1"/>
                                <stop offset="100%" stop-color="white" stop-opacity="0.3"/>
                            </radialGradient>
                        </defs>
                        <rect width="1460" height="1200" fill="url(#corona)"/>
                        <line x1="0" y1="600" x2="1460" y2="600" stroke="white" stroke-width="2" opacity="0.2"/>
                        <line x1="730" y1="0" x2="730" y2="1200" stroke="white" stroke-width="2" opacity="0.2"/>
                    </svg>
                `),
                top: 0,
                left: 0
            },
            // Add the feathered sun
            {
                input: feathered,
                gravity: 'center',
                blend: 'over'
            }
        ])
        .jpeg({ quality: 95 })
        .toBuffer();
        
        await fs.writeFile(`test_final_composite_${test.radius}.jpg`, composite);
        console.log(`  ✅ Saved: test_final_composite_${test.radius}.jpg (with background)\n`);
    }
    
    console.log('✨ Test complete! Check both PNG (transparent) and JPG (composite) files.');
}

testFixed().catch(console.error);