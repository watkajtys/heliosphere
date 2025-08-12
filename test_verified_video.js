#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';

// Generate timestamps for video frames (30-minute intervals, same as before)
function generateTimestamps() {
    const now = new Date();
    const startTime = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48hrs ago
    const timestamps = [];
    
    for (let i = 0; i < 10; i++) { // Test first 10 frames
        const frameTime = new Date(startTime.getTime() - (i * 30 * 60 * 1000));
        timestamps.push({
            frameNum: String(i + 1).padStart(3, '0'),
            timestamp: frameTime.toISOString()
        });
    }
    
    return timestamps;
}

// Generate verified composite with component uniqueness checking
async function generateVerifiedFrame(timestamp, frameNum, previousSdo = null, previousLasco = null) {
    const baseUrl = 'http://localhost:3003/verified-composite';
    const params = new URLSearchParams({
        date: timestamp,
        style: 'ad-astra',
        cropWidth: '1440',
        cropHeight: '1200',
        compositeRadius: '400', 
        featherRadius: '40'
    });
    
    // Add previous checksums if available
    if (previousSdo) params.set('previousSdoChecksum', previousSdo);
    if (previousLasco) params.set('previousLascoChecksum', previousLasco);
    
    const url = `${baseUrl}?${params.toString()}`;
    
    try {
        console.log(`🎬 Generating verified frame ${frameNum}: ${timestamp}`);
        if (previousSdo) {
            console.log(`   Previous SDO: ${previousSdo.substring(0, 8)}...`);
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(buffer);
        
        // Save the frame
        const filename = `verified_frames/frame_${frameNum}.png`;
        fs.writeFileSync(filename, imageBuffer);
        
        // Extract metadata from headers
        const metadata = {
            frameNum,
            targetTimestamp: timestamp,
            sdoDate: response.headers.get('X-SDO-Date'),
            lascoDate: response.headers.get('X-LASCO-Date'),
            sdoChecksum: response.headers.get('X-SDO-Checksum'),
            lascoChecksum: response.headers.get('X-LASCO-Checksum'),
            sdoUnique: response.headers.get('X-SDO-Unique') === 'true',
            lascoUnique: response.headers.get('X-LASCO-Unique') === 'true',
            fallbackUsed: response.headers.get('X-Fallback-Used') === 'true',
            qualityScore: parseFloat(response.headers.get('X-Quality-Score') || '1.0'),
            fileSize: imageBuffer.length,
            compositeChecksum: crypto.createHash('md5').update(imageBuffer).digest('hex')
        };
        
        // Log results
        console.log(`   ✅ Frame saved: ${filename} (${(metadata.fileSize / 1024 / 1024).toFixed(2)}MB)`);
        console.log(`   🌅 SDO: ${metadata.sdoDate} → ${metadata.sdoChecksum.substring(0, 8)}... ${metadata.sdoUnique ? '✅ UNIQUE' : '⚠️ DUPLICATE'}`);
        console.log(`   🌙 LASCO: ${metadata.lascoDate} → ${metadata.lascoChecksum.substring(0, 8)}... ${metadata.lascoUnique ? '✅ UNIQUE' : '⚠️ DUPLICATE'}`);
        console.log(`   📈 Quality Score: ${metadata.qualityScore} ${metadata.qualityScore === 1.0 ? '🎯 PERFECT' : '⚠️ CONTAINS DUPLICATES'}`);
        console.log('');
        
        return metadata;
        
    } catch (error) {
        console.error(`❌ Failed to generate frame ${frameNum}:`, error.message);
        return null;
    }
}

// Main verification function
async function generateVerifiedVideoFrames() {
    console.log('🎬 Verified Video Generation Test');
    console.log('==================================\n');
    
    // Ensure output directory exists
    if (!fs.existsSync('verified_frames')) {
        fs.mkdirSync('verified_frames');
    }
    
    const timestamps = generateTimestamps();
    const results = [];
    let previousSdoChecksum = null;
    let previousLascoChecksum = null;
    
    console.log('Generating frames with component uniqueness verification...\n');
    
    // Generate each frame with uniqueness checking
    for (const {frameNum, timestamp} of timestamps) {
        const result = await generateVerifiedFrame(
            timestamp, 
            frameNum, 
            previousSdoChecksum, 
            previousLascoChecksum
        );
        
        if (result) {
            results.push(result);
            previousSdoChecksum = result.sdoChecksum;
            previousLascoChecksum = result.lascoChecksum;
        }
        
        // Small delay to avoid overwhelming server
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Analysis
    console.log('📊 Verified Generation Results');
    console.log('==============================\n');
    
    const successfulFrames = results.filter(r => r !== null);
    const uniqueSDO = successfulFrames.filter(r => r.sdoUnique).length;
    const uniqueLASCO = successfulFrames.filter(r => r.lascoUnique).length;
    const perfectQuality = successfulFrames.filter(r => r.qualityScore === 1.0).length;
    
    console.log(`📈 Frame Generation:`);
    console.log(`   Total requested: ${timestamps.length}`);
    console.log(`   Successfully generated: ${successfulFrames.length}`);
    console.log(`   Success rate: ${(successfulFrames.length / timestamps.length * 100).toFixed(1)}%`);
    
    console.log(`\n🌅 SDO Component Quality:`);
    console.log(`   Unique frames: ${uniqueSDO}/${successfulFrames.length}`);
    console.log(`   Update rate: ${(uniqueSDO / successfulFrames.length * 100).toFixed(1)}%`);
    
    console.log(`\n🌙 LASCO Component Quality:`);
    console.log(`   Unique frames: ${uniqueLASCO}/${successfulFrames.length}`);
    console.log(`   Update rate: ${(uniqueLASCO / successfulFrames.length * 100).toFixed(1)}%`);
    
    console.log(`\n🎯 Overall Quality:`);
    console.log(`   Perfect quality frames (both components unique): ${perfectQuality}/${successfulFrames.length}`);
    console.log(`   Perfect quality rate: ${(perfectQuality / successfulFrames.length * 100).toFixed(1)}%`);
    
    // Identify any duplicates
    const sdoDuplicates = [];
    const lascoDuplicates = [];
    
    for (let i = 1; i < successfulFrames.length; i++) {
        const current = successfulFrames[i];
        const previous = successfulFrames[i-1];
        
        if (current.sdoChecksum === previous.sdoChecksum) {
            sdoDuplicates.push(`Frame ${current.frameNum} (${current.sdoChecksum.substring(0, 8)}...)`);
        }
        if (current.lascoChecksum === previous.lascoChecksum) {
            lascoDuplicates.push(`Frame ${current.frameNum} (${current.lascoChecksum.substring(0, 8)}...)`);
        }
    }
    
    if (sdoDuplicates.length > 0) {
        console.log(`\n⚠️  SDO Duplicates Found:`);
        sdoDuplicates.forEach(dup => console.log(`   ${dup}`));
    }
    
    if (lascoDuplicates.length > 0) {
        console.log(`\n⚠️  LASCO Duplicates Found:`);
        lascoDuplicates.forEach(dup => console.log(`   ${dup}`));
    }
    
    if (sdoDuplicates.length === 0 && lascoDuplicates.length === 0) {
        console.log(`\n🎉 SUCCESS: No component duplicates detected!`);
        console.log(`✨ All frames have unique SDO and LASCO components`);
        console.log(`🎬 Video will have smooth temporal progression`);
    }
    
    // Save detailed report
    const report = {
        timestamp: new Date().toISOString(),
        testType: 'verified_composite',
        totalRequested: timestamps.length,
        successfulFrames: successfulFrames.length,
        successRate: successfulFrames.length / timestamps.length,
        sdoUniqueRate: uniqueSDO / successfulFrames.length,
        lascoUniqueRate: uniqueLASCO / successfulFrames.length,
        perfectQualityRate: perfectQuality / successfulFrames.length,
        sdoDuplicates: sdoDuplicates.length,
        lascoDuplicates: lascoDuplicates.length,
        frames: successfulFrames
    };
    
    fs.writeFileSync('verified_video_report.json', JSON.stringify(report, null, 2));
    console.log(`\n💾 Detailed report saved: verified_video_report.json`);
    
    // Performance vs previous system
    console.log(`\n📈 Improvement Over Previous System:`);
    console.log(`   Previous SDO update rate: 90% (had duplicates)`);
    console.log(`   New SDO update rate: ${(uniqueSDO / successfulFrames.length * 100).toFixed(1)}% ${uniqueSDO === successfulFrames.length ? '🎯 PERFECT!' : ''}`);
    console.log(`   Previous LASCO update rate: 100%`);
    console.log(`   New LASCO update rate: ${(uniqueLASCO / successfulFrames.length * 100).toFixed(1)}% ${uniqueLASCO === successfulFrames.length ? '🎯 MAINTAINED!' : ''}`);
}

// Self-executing async function
(async () => {
    try {
        await generateVerifiedVideoFrames();
    } catch (error) {
        console.error('❌ Verified video generation failed:', error.message);
        process.exit(1);
    }
})();