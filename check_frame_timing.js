#!/usr/bin/env node

/**
 * Check frame timing consistency
 * Verifies that frames are spaced exactly 15 minutes apart
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const EXPECTED_INTERVAL = 15; // minutes
const TOLERANCE = 0; // No tolerance - should be exact

async function checkFrameTiming() {
    console.log('⏱️  Checking Frame Timing Consistency\n');
    console.log('Expected interval: 15 minutes between frames');
    console.log('========================================\n');
    
    try {
        // Get all frame files sorted
        console.log('Fetching frame list from VPS...');
        const { stdout } = await execAsync(
            'ssh vps "cd /opt/heliosphere/frames && find . -name \'*.jpg\' | sort"',
            { maxBuffer: 50 * 1024 * 1024 }
        );
        
        const frames = stdout.trim().split('\n').filter(Boolean);
        console.log(`Total frames found: ${frames.length}\n`);
        
        // Parse frames into timestamps
        const timestamps = [];
        const frameData = [];
        
        frames.forEach(frame => {
            // Parse ./2025-07-03/frame_0000.jpg
            const match = frame.match(/\.\/(\d{4}-\d{2}-\d{2})\/frame_(\d{2})(\d{2})\.jpg/);
            if (match) {
                const [fullPath, date, hour, minute] = match;
                const timestamp = new Date(`${date}T${hour}:${minute}:00Z`);
                timestamps.push(timestamp);
                frameData.push({
                    path: fullPath,
                    date,
                    time: `${hour}:${minute}`,
                    timestamp
                });
            }
        });
        
        console.log(`Parsed ${timestamps.length} valid timestamps\n`);
        
        // Check intervals
        let correctIntervals = 0;
        let wrongIntervals = [];
        let gaps = [];
        let duplicates = [];
        
        for (let i = 1; i < timestamps.length; i++) {
            const diff = (timestamps[i] - timestamps[i-1]) / (1000 * 60); // minutes
            
            if (diff === EXPECTED_INTERVAL) {
                correctIntervals++;
            } else if (diff === 0) {
                duplicates.push({
                    frame: frameData[i].path,
                    timestamp: frameData[i].timestamp
                });
            } else if (diff > EXPECTED_INTERVAL) {
                // There's a gap
                const missingCount = Math.floor(diff / EXPECTED_INTERVAL) - 1;
                gaps.push({
                    before: frameData[i-1],
                    after: frameData[i],
                    gap: diff,
                    missingFrames: missingCount
                });
            } else if (diff < 0) {
                // Frames out of order!
                wrongIntervals.push({
                    frame1: frameData[i-1],
                    frame2: frameData[i],
                    interval: diff
                });
            } else {
                // Wrong interval (not 15 min)
                wrongIntervals.push({
                    frame1: frameData[i-1],
                    frame2: frameData[i],
                    interval: diff
                });
            }
        }
        
        // Day boundary check (special case)
        let dayBoundaries = 0;
        for (let i = 1; i < frameData.length; i++) {
            if (frameData[i].date !== frameData[i-1].date) {
                dayBoundaries++;
                const diff = (timestamps[i] - timestamps[i-1]) / (1000 * 60);
                if (diff === EXPECTED_INTERVAL) {
                    // Perfect day transition
                } else if (frameData[i].time === '00:00' && frameData[i-1].time === '23:45') {
                    // Expected day boundary
                } else {
                    console.log(`⚠️  Day boundary issue between ${frameData[i-1].date} and ${frameData[i].date}`);
                    console.log(`   Last frame: ${frameData[i-1].time}, First frame: ${frameData[i].time}`);
                }
            }
        }
        
        // Report results
        console.log('📊 Timing Analysis Results:');
        console.log('═══════════════════════════\n');
        
        const totalIntervals = timestamps.length - 1;
        const correctPercent = (correctIntervals / totalIntervals * 100).toFixed(2);
        
        console.log(`✅ Correct intervals (15 min): ${correctIntervals}/${totalIntervals} (${correctPercent}%)`);
        console.log(`📅 Day boundaries crossed: ${dayBoundaries}`);
        
        if (gaps.length > 0) {
            console.log(`\n⚠️  Gaps found: ${gaps.length}`);
            gaps.slice(0, 5).forEach(gap => {
                console.log(`   ${gap.before.date} ${gap.before.time} → ${gap.after.date} ${gap.after.time}`);
                console.log(`   Gap: ${gap.gap} minutes (${gap.missingFrames} frames missing)`);
            });
            if (gaps.length > 5) {
                console.log(`   ... and ${gaps.length - 5} more gaps`);
            }
        }
        
        if (wrongIntervals.length > 0) {
            console.log(`\n❌ Wrong intervals: ${wrongIntervals.length}`);
            wrongIntervals.slice(0, 5).forEach(w => {
                console.log(`   ${w.frame1.date} ${w.frame1.time} → ${w.frame2.date} ${w.frame2.time}: ${w.interval} min`);
            });
        }
        
        if (duplicates.length > 0) {
            console.log(`\n⚠️  Duplicate timestamps: ${duplicates.length}`);
        }
        
        // Check for complete coverage
        console.log('\n📈 Coverage Analysis:');
        const firstFrame = frameData[0];
        const lastFrame = frameData[frameData.length - 1];
        const totalDays = Math.ceil((timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60 * 24));
        const expectedFrames = totalDays * 96; // 96 frames per day
        const coverage = (frameData.length / expectedFrames * 100).toFixed(2);
        
        console.log(`   First frame: ${firstFrame.date} ${firstFrame.time}`);
        console.log(`   Last frame: ${lastFrame.date} ${lastFrame.time}`);
        console.log(`   Total days: ${totalDays}`);
        console.log(`   Expected frames: ${expectedFrames}`);
        console.log(`   Actual frames: ${frameData.length}`);
        console.log(`   Coverage: ${coverage}%`);
        
        // Verify sequential timing
        console.log('\n🔍 Sequential Timing Check:');
        const sampleSize = 100;
        let perfectSequence = true;
        
        for (let i = 0; i < Math.min(sampleSize, frameData.length - 1); i++) {
            const expectedTime = new Date(timestamps[0]);
            expectedTime.setMinutes(expectedTime.getMinutes() + (i * EXPECTED_INTERVAL));
            
            if (timestamps[i].getTime() !== expectedTime.getTime()) {
                perfectSequence = false;
                console.log(`   Frame ${i}: Expected ${expectedTime.toISOString()}, Got ${timestamps[i].toISOString()}`);
            }
        }
        
        if (perfectSequence) {
            console.log(`   ✅ First ${sampleSize} frames are perfectly sequential!`);
        } else {
            console.log(`   ⚠️  Timing inconsistencies found in first ${sampleSize} frames`);
        }
        
        // Summary
        console.log('\n════════════════════════════');
        if (correctPercent > 99) {
            console.log('✅ Frame timing is EXCELLENT (>99% correct)');
        } else if (correctPercent > 95) {
            console.log('👍 Frame timing is GOOD (>95% correct)');
        } else if (correctPercent > 90) {
            console.log('⚠️  Frame timing is FAIR (>90% correct)');
        } else {
            console.log('❌ Frame timing needs attention (<90% correct)');
        }
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Run the check
checkFrameTiming().catch(console.error);