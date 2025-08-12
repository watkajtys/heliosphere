#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';

// Generate timestamps for testing (same as our video frames)
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

// Download and checksum a component
async function getComponentChecksum(endpoint, timestamp) {
    const url = `http://localhost:3002/${endpoint}?style=ad-astra&date=${encodeURIComponent(timestamp)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const hash = crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex');
        
        return {
            checksum: hash,
            size: buffer.byteLength,
            actualDate: response.headers.get('X-SDO-Date') || response.headers.get('X-LASCO-Date'),
            fallbackUsed: response.headers.get('X-Fallback-Used') === 'true'
        };
    } catch (error) {
        return {
            error: error.message,
            checksum: null,
            size: 0,
            actualDate: null,
            fallbackUsed: false
        };
    }
}

// Main verification function
async function verifyComponentUpdates() {
    console.log('🔍 Component Update Verification Report');
    console.log('==========================================\n');
    
    const timestamps = generateTimestamps();
    const results = {
        sdo: [],
        lasco: [],
        composite: []
    };
    
    console.log('Testing first 10 frames (5 hours of data)...\n');
    
    // Test each timestamp
    for (const {frameNum, timestamp} of timestamps) {
        console.log(`📅 Frame ${frameNum}: ${timestamp}`);
        
        // Get SDO component
        const sdoResult = await getComponentChecksum('sdo-image', timestamp);
        results.sdo.push({frame: frameNum, ...sdoResult});
        
        // Get LASCO component  
        const lascoResult = await getComponentChecksum('lasco-image', timestamp);
        results.lasco.push({frame: frameNum, ...lascoResult});
        
        // Report immediate results
        if (sdoResult.error) {
            console.log(`  ❌ SDO: ${sdoResult.error}`);
        } else {
            console.log(`  ☀️  SDO: ${sdoResult.checksum.substring(0, 8)}... (${(sdoResult.size/1024/1024).toFixed(1)}MB) ${sdoResult.fallbackUsed ? '[FALLBACK]' : ''}`);
        }
        
        if (lascoResult.error) {
            console.log(`  ❌ LASCO: ${lascoResult.error}`);
        } else {
            console.log(`  🌙 LASCO: ${lascoResult.checksum.substring(0, 8)}... (${(lascoResult.size/1024/1024).toFixed(1)}MB) ${lascoResult.fallbackUsed ? '[FALLBACK]' : ''}`);
        }
        
        console.log('');
        
        // Small delay to avoid overwhelming server
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Analysis
    console.log('\n📊 Analysis Results');
    console.log('===================\n');
    
    // SDO Analysis
    const sdoChecksums = results.sdo.filter(r => r.checksum).map(r => r.checksum);
    const uniqueSdoChecksums = new Set(sdoChecksums);
    console.log(`☀️  SDO Components:`);
    console.log(`   Total frames: ${sdoChecksums.length}`);
    console.log(`   Unique checksums: ${uniqueSdoChecksums.size}`);
    console.log(`   Update rate: ${(uniqueSdoChecksums.size / sdoChecksums.length * 100).toFixed(1)}%`);
    
    if (uniqueSdoChecksums.size < sdoChecksums.length) {
        console.log(`   ⚠️  ${sdoChecksums.length - uniqueSdoChecksums.size} duplicate SDO frames detected!`);
    }
    
    // LASCO Analysis
    const lascoChecksums = results.lasco.filter(r => r.checksum).map(r => r.checksum);
    const uniqueLascoChecksums = new Set(lascoChecksums);
    console.log(`\n🌙 LASCO Components:`);
    console.log(`   Total frames: ${lascoChecksums.length}`);
    console.log(`   Unique checksums: ${uniqueLascoChecksums.size}`);
    console.log(`   Update rate: ${(uniqueLascoChecksums.size / lascoChecksums.length * 100).toFixed(1)}%`);
    
    if (uniqueLascoChecksums.size < lascoChecksums.length) {
        console.log(`   ⚠️  ${lascoChecksums.length - uniqueLascoChecksums.size} duplicate LASCO frames detected!`);
    }
    
    // Recommendations
    console.log(`\n💡 Recommendations:`);
    
    if (uniqueSdoChecksums.size === sdoChecksums.length && uniqueLascoChecksums.size === lascoChecksums.length) {
        console.log(`   ✅ Excellent! Both SDO and LASCO are updating every 30 minutes`);
        console.log(`   ✅ Current 30-minute interval is optimal for video generation`);
    } else {
        if (uniqueSdoChecksums.size < sdoChecksums.length) {
            console.log(`   📈 Consider longer intervals for SDO updates (current: 30min)`);
        }
        if (uniqueLascoChecksums.size < lascoChecksums.length) {
            console.log(`   📈 Consider longer intervals for LASCO updates (current: 30min)`);
        }
    }
    
    // Save detailed results
    const report = {
        timestamp: new Date().toISOString(),
        testFrames: timestamps.length,
        sdo: {
            totalFrames: sdoChecksums.length,
            uniqueFrames: uniqueSdoChecksums.size,
            updateRate: uniqueSdoChecksums.size / sdoChecksums.length,
            results: results.sdo
        },
        lasco: {
            totalFrames: lascoChecksums.length,
            uniqueFrames: uniqueLascoChecksums.size,
            updateRate: uniqueLascoChecksums.size / lascoChecksums.length,
            results: results.lasco
        }
    };
    
    fs.writeFileSync('component_verification_report.json', JSON.stringify(report, null, 2));
    console.log(`\n💾 Detailed report saved to: component_verification_report.json`);
}

// Self-executing async function
(async () => {
    try {
        await verifyComponentUpdates();
    } catch (error) {
        console.error('❌ Verification failed:', error.message);
        process.exit(1);
    }
})();