#!/usr/bin/env node

/**
 * Verify frame consistency and temporal progression
 * Checks that frames are in correct chronological order
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

// Configuration
const FRAMES_DIR = 'C:\\Users\\watka\\Projects\\heliosphere\\test_frames'; // Local test directory
const VPS_FRAMES_DIR = '/opt/heliosphere/frames'; // VPS frames directory
const EXPECTED_FRAMES_PER_DAY = 96;
const INTERVAL_MINUTES = 15;

async function analyzeLocalFrames() {
    console.log('📊 Analyzing Local Frame Consistency\n');
    
    try {
        // Get all date directories
        const dirs = await fs.readdir(FRAMES_DIR);
        const dateDirs = dirs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
        
        if (dateDirs.length === 0) {
            console.log('❌ No frame directories found locally');
            return;
        }
        
        console.log(`Found ${dateDirs.length} days of frames`);
        console.log(`Date range: ${dateDirs[0]} to ${dateDirs[dateDirs.length - 1]}\n`);
        
        let totalFrames = 0;
        let missingFrames = [];
        let duplicateFrames = [];
        let outOfOrderFrames = [];
        
        // Analyze each day
        for (const dateDir of dateDirs) {
            const dirPath = path.join(FRAMES_DIR, dateDir);
            const files = await fs.readdir(dirPath);
            const frameFiles = files.filter(f => f.endsWith('.jpg')).sort();
            
            totalFrames += frameFiles.length;
            
            // Check for missing frames
            if (frameFiles.length < EXPECTED_FRAMES_PER_DAY) {
                console.log(`⚠️  ${dateDir}: ${frameFiles.length}/${EXPECTED_FRAMES_PER_DAY} frames`);
                
                // Find which times are missing
                const expectedTimes = [];
                for (let h = 0; h < 24; h++) {
                    for (let m = 0; m < 60; m += INTERVAL_MINUTES) {
                        expectedTimes.push(`frame_${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}.jpg`);
                    }
                }
                
                const missing = expectedTimes.filter(t => !frameFiles.includes(t));
                missingFrames.push({ date: dateDir, missing });
            } else if (frameFiles.length > EXPECTED_FRAMES_PER_DAY) {
                console.log(`⚠️  ${dateDir}: ${frameFiles.length}/${EXPECTED_FRAMES_PER_DAY} frames (extras!)`);
                duplicateFrames.push({ date: dateDir, count: frameFiles.length });
            } else {
                console.log(`✅ ${dateDir}: ${frameFiles.length}/${EXPECTED_FRAMES_PER_DAY} frames`);
            }
        }
        
        // Summary
        console.log('\n📈 Summary:');
        console.log(`Total frames: ${totalFrames}`);
        console.log(`Expected: ${dateDirs.length * EXPECTED_FRAMES_PER_DAY}`);
        console.log(`Coverage: ${(totalFrames / (dateDirs.length * EXPECTED_FRAMES_PER_DAY) * 100).toFixed(2)}%`);
        
        if (missingFrames.length > 0) {
            console.log(`\n⚠️  Days with missing frames: ${missingFrames.length}`);
            missingFrames.slice(0, 5).forEach(({ date, missing }) => {
                console.log(`  ${date}: Missing ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`);
            });
        }
        
    } catch (error) {
        console.error('Error analyzing local frames:', error.message);
    }
}

async function analyzeVPSFrames() {
    console.log('\n📊 Analyzing VPS Frame Consistency\n');
    
    try {
        // SSH to VPS and analyze
        const { stdout: dirList } = await execAsync('ssh vps "ls /opt/heliosphere/frames | grep ^2025"');
        const dateDirs = dirList.trim().split('\n').filter(Boolean).sort();
        
        console.log(`Found ${dateDirs.length} days of frames on VPS`);
        console.log(`Date range: ${dateDirs[0]} to ${dateDirs[dateDirs.length - 1]}\n`);
        
        // Count frames per day
        let totalFrames = 0;
        let daysAnalyzed = 0;
        const samples = 10; // Sample first and last N days
        
        // Sample first few days
        for (let i = 0; i < Math.min(samples, dateDirs.length); i++) {
            const { stdout: count } = await execAsync(
                `ssh vps "ls /opt/heliosphere/frames/${dateDirs[i]}/*.jpg 2>/dev/null | wc -l"`
            );
            const frameCount = parseInt(count.trim());
            totalFrames += frameCount;
            daysAnalyzed++;
            
            if (frameCount === EXPECTED_FRAMES_PER_DAY) {
                console.log(`✅ ${dateDirs[i]}: ${frameCount} frames`);
            } else {
                console.log(`⚠️  ${dateDirs[i]}: ${frameCount}/${EXPECTED_FRAMES_PER_DAY} frames`);
            }
        }
        
        console.log('...');
        
        // Sample last few days
        for (let i = Math.max(samples, dateDirs.length - samples); i < dateDirs.length; i++) {
            const { stdout: count } = await execAsync(
                `ssh vps "ls /opt/heliosphere/frames/${dateDirs[i]}/*.jpg 2>/dev/null | wc -l"`
            );
            const frameCount = parseInt(count.trim());
            totalFrames += frameCount;
            daysAnalyzed++;
            
            if (frameCount === EXPECTED_FRAMES_PER_DAY) {
                console.log(`✅ ${dateDirs[i]}: ${frameCount} frames`);
            } else {
                console.log(`⚠️  ${dateDirs[i]}: ${frameCount}/${EXPECTED_FRAMES_PER_DAY} frames`);
            }
        }
        
        // Get total frame count
        const { stdout: totalCount } = await execAsync(
            'ssh vps "find /opt/heliosphere/frames -name \'*.jpg\' | wc -l"'
        );
        
        console.log('\n📈 VPS Summary:');
        console.log(`Total frames: ${totalCount.trim()}`);
        console.log(`Total days: ${dateDirs.length}`);
        console.log(`Expected frames: ${dateDirs.length * EXPECTED_FRAMES_PER_DAY}`);
        console.log(`Average frames/day: ${(parseInt(totalCount) / dateDirs.length).toFixed(1)}`);
        
    } catch (error) {
        console.error('Error analyzing VPS frames:', error.message);
    }
}

async function verifyVideoFrameOrder() {
    console.log('\n🎬 Verifying Video Frame Order\n');
    
    try {
        // Check if we have a frames list file
        const frameListPath = path.join(__dirname, 'test_frame_list.txt');
        
        // Generate a test frame list from VPS
        console.log('Generating frame list from VPS...');
        const { stdout: frameList } = await execAsync(
            'ssh vps "cd /opt/heliosphere/frames && find . -name \'*.jpg\' | sort | head -100"'
        );
        
        const frames = frameList.trim().split('\n').filter(Boolean);
        console.log(`Sample of ${frames.length} frames:`);
        
        // Verify chronological order
        let lastDate = null;
        let lastTime = null;
        let outOfOrder = 0;
        
        frames.forEach((frame, i) => {
            // Parse ./2025-07-03/frame_0000.jpg
            const match = frame.match(/\.\/(\d{4}-\d{2}-\d{2})\/frame_(\d{2})(\d{2})\.jpg/);
            if (match) {
                const [, date, hour, minute] = match;
                const currentDateTime = new Date(`${date}T${hour}:${minute}:00Z`);
                
                if (lastDate) {
                    const lastDateTime = new Date(`${lastDate}T${lastTime}:00Z`);
                    const diff = (currentDateTime - lastDateTime) / (1000 * 60); // minutes
                    
                    if (diff !== INTERVAL_MINUTES && diff !== -(24 * 60 - INTERVAL_MINUTES)) {
                        console.log(`⚠️  Frame ${i}: Time jump of ${diff} minutes (expected ${INTERVAL_MINUTES})`);
                        outOfOrder++;
                    }
                }
                
                lastDate = date;
                lastTime = `${hour}:${minute}`;
            }
        });
        
        if (outOfOrder === 0) {
            console.log('✅ All sampled frames are in correct chronological order');
        } else {
            console.log(`⚠️  Found ${outOfOrder} frames with incorrect time intervals`);
        }
        
    } catch (error) {
        console.error('Error verifying video frames:', error.message);
    }
}

async function compareFrameChecksums() {
    console.log('\n🔍 Checking for Duplicate Frames\n');
    
    try {
        // Sample some frames and check for duplicates
        console.log('Calculating checksums for sample frames...');
        
        const { stdout: checksums } = await execAsync(
            'ssh vps "cd /opt/heliosphere/frames && find . -name \'*.jpg\' | sort | head -20 | xargs -I {} md5sum {}"',
            { maxBuffer: 10 * 1024 * 1024 }
        );
        
        const lines = checksums.trim().split('\n').filter(Boolean);
        const checksumMap = new Map();
        let duplicates = 0;
        
        lines.forEach(line => {
            const [checksum, file] = line.split('  ');
            if (checksumMap.has(checksum)) {
                console.log(`⚠️  Duplicate: ${file} matches ${checksumMap.get(checksum)}`);
                duplicates++;
            } else {
                checksumMap.set(checksum, file);
            }
        });
        
        if (duplicates === 0) {
            console.log(`✅ No duplicates found in ${lines.length} sampled frames`);
        } else {
            console.log(`⚠️  Found ${duplicates} duplicate frames`);
        }
        
    } catch (error) {
        console.error('Error checking checksums:', error.message);
    }
}

async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Frame Consistency Verification       ║');
    console.log('╚════════════════════════════════════════╝');
    
    // Check if we have local frames
    try {
        await fs.access(FRAMES_DIR);
        await analyzeLocalFrames();
    } catch {
        console.log('📁 No local frames directory found, skipping local analysis');
    }
    
    // Analyze VPS frames
    await analyzeVPSFrames();
    
    // Verify video frame order
    await verifyVideoFrameOrder();
    
    // Check for duplicates
    await compareFrameChecksums();
    
    console.log('\n✅ Verification complete!');
}

main().catch(console.error);