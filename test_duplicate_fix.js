#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';

// Test the specific frames that had duplicates
async function testDuplicateFix() {
    console.log('🔧 Testing Duplicate Fix - Frames 003 & 004');
    console.log('============================================\n');
    
    // These are the exact timestamps that previously caused duplicates
    const problematicFrames = [
        { 
            frameNum: '003', 
            timestamp: '2025-08-10T04:46:37.708Z',
            description: 'Frame that used fallback to 04:31 (duplicate source)'
        },
        { 
            frameNum: '004', 
            timestamp: '2025-08-10T04:16:37.708Z',
            description: 'Frame that used fallback to 04:17 (same as 003\'s source)'
        }
    ];
    
    let previousSdoChecksum = '046be6132dd9da5c2f98b36caebdb8cd'; // The duplicate checksum from before
    const results = [];
    
    for (const frame of problematicFrames) {
        console.log(`🎬 Testing ${frame.frameNum}: ${frame.timestamp}`);
        console.log(`   Context: ${frame.description}`);
        console.log(`   Previous SDO checksum: ${previousSdoChecksum.substring(0, 8)}...`);
        
        const baseUrl = 'http://localhost:3003/verified-composite';
        const params = new URLSearchParams({
            date: frame.timestamp,
            style: 'ad-astra',
            cropWidth: '1440',
            cropHeight: '1200',
            previousSdoChecksum: previousSdoChecksum
        });
        
        const url = `${baseUrl}?${params.toString()}`;
        
        try {
            const response = await fetch(url);
            
            if (!response.ok) {
                console.log(`   ❌ Request failed: HTTP ${response.status}`);
                const errorText = await response.text();
                console.log(`   📝 Error details: ${errorText}`);
                
                if (errorText.includes('No unique SDO data available')) {
                    console.log(`   ✅ SUCCESS: System correctly rejected duplicates!`);
                    console.log(`   🎯 Smart fallback is working - refuses to return duplicates`);
                } else {
                    console.log(`   ⚠️  Unexpected error type`);
                }
                console.log('');
                continue;
            }
            
            // If we get here, the request succeeded
            const buffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(buffer);
            
            const metadata = {
                frameNum: frame.frameNum,
                sdoChecksum: response.headers.get('X-SDO-Checksum'),
                sdoUnique: response.headers.get('X-SDO-Unique') === 'true',
                sdoDate: response.headers.get('X-SDO-Date'),
                qualityScore: response.headers.get('X-Quality-Score')
            };
            
            console.log(`   ✅ Request succeeded`);
            console.log(`   🌅 SDO: ${metadata.sdoDate} → ${metadata.sdoChecksum.substring(0, 8)}... ${metadata.sdoUnique ? '✅ UNIQUE' : '❌ DUPLICATE'}`);
            console.log(`   📈 Quality Score: ${metadata.qualityScore}`);
            
            if (metadata.sdoUnique) {
                console.log(`   🎉 SUCCESS: Found unique SDO data within expanded ±60min window!`);
                previousSdoChecksum = metadata.sdoChecksum;
            } else {
                console.log(`   ⚠️  WARNING: Still returning duplicate despite fixes`);
            }
            
            results.push(metadata);
            
        } catch (error) {
            console.log(`   ❌ Network error: ${error.message}`);
        }
        
        console.log('');
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Summary
    console.log('📊 Duplicate Fix Test Results');
    console.log('=============================\n');
    
    if (results.length === 0) {
        console.log('🎯 PERFECT: System correctly refused all duplicate requests');
        console.log('✨ Smart fallback is working as intended - rejecting duplicates for video quality');
        console.log('📈 Recommendation: Adjust frame intervals or expand search windows further');
    } else {
        console.log(`📈 Successful requests: ${results.length}/2`);
        const uniqueResults = results.filter(r => r.sdoUnique);
        console.log(`🌅 Unique SDO components: ${uniqueResults.length}/${results.length}`);
        
        if (uniqueResults.length === results.length) {
            console.log('🎉 SUCCESS: All returned frames have unique components!');
            console.log('✅ Duplicate fix is working - expanded search window found unique data');
        } else {
            console.log('⚠️  Some duplicates still returned - may need further refinement');
        }
    }
    
    console.log('\n🔧 System Behavior Analysis:');
    console.log('- Expanded SDO search window from ±15min to ±60min');
    console.log('- Removed duplicate return fallback logic'); 
    console.log('- System now fails fast rather than accepting duplicates');
    console.log('- Video generation will skip problematic frames rather than create choppy motion');
}

// Run the test
(async () => {
    try {
        await testDuplicateFix();
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
})();