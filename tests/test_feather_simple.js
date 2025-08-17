#!/usr/bin/env node

// Simple test to generate a feathered square mask
import sharp from 'sharp';
import fs from 'fs/promises';

async function testFeatherMask() {
    console.log('🧪 Testing square feather mask generation...\n');
    
    const finalSize = 1435;
    const compositeRadius = 400;
    const featherRadii = [0, 20, 40, 80, 120];
    
    for (const featherRadius of featherRadii) {
        console.log(`📐 Generating mask with feather radius: ${featherRadius}px`);
        
        if (featherRadius === 0) {
            // No feathering - hard edge
            const mask = await sharp({
                create: {
                    width: finalSize,
                    height: finalSize,
                    channels: 4,
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                }
            })
            .composite([{
                input: Buffer.from(`
                    <svg width="${finalSize}" height="${finalSize}">
                        <rect x="${(finalSize - compositeRadius * 2) / 2}" 
                              y="${(finalSize - compositeRadius * 2) / 2}" 
                              width="${compositeRadius * 2}" 
                              height="${compositeRadius * 2}" 
                              fill="white" />
                    </svg>
                `),
                top: 0,
                left: 0
            }])
            .png()
            .toBuffer();
            
            await fs.writeFile(`mask_feather_${featherRadius}.png`, mask);
        } else {
            // With feathering
            const center = finalSize / 2;
            
            const maskSvg = `
                <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
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
            
            const mask = await sharp(Buffer.from(maskSvg))
                .resize(finalSize, finalSize)
                .png()
                .toBuffer();
            
            await fs.writeFile(`mask_feather_${featherRadius}.png`, mask);
        }
        
        console.log(`   ✅ Saved: mask_feather_${featherRadius}.png`);
    }
    
    console.log('\n✨ Masks generated! Check the PNG files to see the feathering effect.');
}

testFeatherMask().catch(console.error);