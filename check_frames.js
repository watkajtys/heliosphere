const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

async function checkFrames() {
    const baseDir = '/opt/heliosphere';
    const framesToCheck = [
        'frames/2025-07-14/frame_0000.jpg',
        'frames/2025-07-14/frame_1200.jpg',
        'frames/2025-07-13/frame_0000.jpg',
        'frames/2025-07-13/frame_1200.jpg',
        'frames/2025-07-12/frame_2300.jpg'
    ];
    
    console.log('Checking newly generated frames...\n');
    
    for (const frame of framesToCheck) {
        const fullPath = path.join(baseDir, frame);
        try {
            const buffer = await fs.readFile(fullPath);
            const metadata = await sharp(buffer).metadata();
            const stats = await fs.stat(fullPath);
            
            console.log(`✅ ${frame}:`);
            console.log(`   Dimensions: ${metadata.width}×${metadata.height}`);
            console.log(`   Format: ${metadata.format}`);
            console.log(`   Size: ${(stats.size / 1024).toFixed(1)}KB`);
            console.log(`   Modified: ${stats.mtime.toISOString()}`);
            
            // Check if dimensions are correct
            if (metadata.width !== 1460 || metadata.height !== 1200) {
                console.log(`   ⚠️ WARNING: Unexpected dimensions!`);
            }
        } catch (err) {
            console.log(`❌ ${frame}: ${err.message}`);
        }
    }
    
    // Count total frames created recently
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
        const { stdout } = await execAsync('find /opt/heliosphere/frames -name "*.jpg" -type f -mmin -10 | wc -l');
        console.log(`\n📊 Frames created in last 10 minutes: ${stdout.trim()}`);
    } catch (err) {
        console.log('Could not count recent frames');
    }
}

checkFrames().catch(console.error);