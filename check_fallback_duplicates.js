#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs';

/**
 * Check for fallback-induced duplicates in high-resolution frames
 */

async function getFrameChecksum(frameNum) {
    const filename = `hires_15min_frames/frame_${String(frameNum).padStart(3, '0')}.png`;
    if (!fs.existsSync(filename)) {
        return null;
    }
    
    const buffer = fs.readFileSync(filename);
    const checksum = crypto.createHash('md5').update(buffer).digest('hex');
    return { frameNum, filename, checksum, size: buffer.length };
}

async function checkFallbackDuplicates() {
    console.log('🔍 Checking for Fallback-Induced Duplicates\n');
    
    // Check frames around the known fallbacks (now including the 3rd one)
    const fallbackFrames = [16, 61, 112]; // From the progress data
    
    for (const fallbackFrame of fallbackFrames) {
        console.log(`⚠️  Analyzing Fallback Frame ${fallbackFrame}:`);
        
        const frame1 = await getFrameChecksum(fallbackFrame);     // Fallback frame
        const frame2 = await getFrameChecksum(fallbackFrame + 1); // Next frame
        
        if (!frame1 || !frame2) {
            console.log(`   ❌ Missing frame files for ${fallbackFrame} or ${fallbackFrame + 1}`);
            continue;
        }
        
        console.log(`   Frame ${fallbackFrame}: ${frame1.checksum.substring(0, 12)}... (${(frame1.size/1024/1024).toFixed(2)}MB)`);
        console.log(`   Frame ${fallbackFrame + 1}: ${frame2.checksum.substring(0, 12)}... (${(frame2.size/1024/1024).toFixed(2)}MB)`);
        
        if (frame1.checksum === frame2.checksum) {
            console.log(`   🚨 DUPLICATE DETECTED! Frames ${fallbackFrame} and ${fallbackFrame + 1} are identical!`);
        } else {
            console.log(`   ✅ No duplicate - frames are different`);
        }
        console.log('');
    }
    
    // Also check a few random consecutive frames for comparison
    console.log('📊 Random Consecutive Frame Check (for baseline):');
    for (let i = 20; i <= 22; i++) {
        const frame1 = await getFrameChecksum(i);
        const frame2 = await getFrameChecksum(i + 1);
        
        if (frame1 && frame2) {
            const isDuplicate = frame1.checksum === frame2.checksum;
            console.log(`   Frames ${i}-${i+1}: ${isDuplicate ? '🚨 DUPLICATE' : '✅ Different'} (${frame1.checksum.substring(0, 8)} vs ${frame2.checksum.substring(0, 8)})`);
        }
    }
}

checkFallbackDuplicates().catch(console.error);