#!/usr/bin/env node

// Process the real frame we downloaded with different feather settings
import sharp from 'sharp';
import fs from 'fs/promises';

async function processRealFrame() {
    console.log('🛰️ Processing real satellite frame with different feather settings...\n');
    
    // Read the real frame we downloaded from VPS
    const originalFrame = await fs.readFile('test_frame.jpg');
    
    // Get metadata
    const metadata = await sharp(originalFrame).metadata();
    console.log(`📸 Original frame: ${metadata.width}x${metadata.height}\n`);
    
    // Test different feather settings
    const tests = [
        { radius: 0, description: 'No feather (hard edge)' },
        { radius: 20, description: 'Subtle feather' },
        { radius: 40, description: 'Default feather' },
        { radius: 80, description: 'Soft feather' },
        { radius: 120, description: 'Very soft feather' }
    ];
    
    for (const test of tests) {
        console.log(`🔧 Processing: ${test.description} (${test.radius}px)`);
        
        // Since this is already a composite, let's enhance it to show the feather effect
        // We'll extract just the center square and re-apply feathering
        
        // Extract approximate sun disk area (center square)
        const sunDiskSize = 800;
        const centerX = Math.floor((metadata.width - sunDiskSize) / 2);
        const centerY = Math.floor((metadata.height - sunDiskSize) / 2);
        
        // Extract the sun disk
        const sunDisk = await sharp(originalFrame)
            .extract({
                left: centerX,
                top: centerY,
                width: sunDiskSize,
                height: sunDiskSize
            })
            .toBuffer();
        
        // Create a gray background (simulating corona)
        const background = await sharp({
            create: {
                width: 1460,
                height: 1200,
                channels: 4,
                background: { r: 60, g: 65, b: 70, alpha: 1 }
            }
        }).jpeg().toBuffer();
        
        // Resize sun disk to fit
        const resizedSun = await sharp(sunDisk)
            .resize(800, 800)
            .toBuffer();
        
        // Apply feathering
        let featheredSun;
        if (test.radius === 0) {
            featheredSun = resizedSun;
        } else {
            // Create feather mask
            const maskSvg = `
                <svg width="800" height="800" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                        <filter id="feather" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur in="SourceGraphic" stdDeviation="${test.radius / 3}" />
                        </filter>
                    </defs>
                    <rect x="${test.radius}" 
                          y="${test.radius}" 
                          width="${800 - test.radius * 2}" 
                          height="${800 - test.radius * 2}" 
                          fill="white" 
                          filter="url(#feather)" />
                </svg>
            `;
            
            const mask = await sharp(Buffer.from(maskSvg))
                .resize(800, 800)
                .greyscale()
                .toBuffer();
            
            featheredSun = await sharp(resizedSun)
                .composite([{
                    input: mask,
                    blend: 'dest-in'
                }])
                .png()
                .toBuffer();
        }
        
        // Create final composite
        const composite = await sharp(background)
            .composite([{
                input: featheredSun,
                gravity: 'center',
                blend: 'over'
            }])
            .jpeg({ quality: 95 })
            .toBuffer();
        
        const filename = `real_frame_feather_${test.radius}.jpg`;
        await fs.writeFile(filename, composite);
        console.log(`  ✅ Saved: ${filename}`);
    }
    
    console.log('\n✨ Processing complete! Check these files:');
    tests.forEach(test => {
        console.log(`  - real_frame_feather_${test.radius}.jpg (${test.description})`);
    });
}

processRealFrame().catch(console.error);