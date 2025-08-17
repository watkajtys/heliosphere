#!/usr/bin/env node

import { interpolateFrames } from './frame-interpolation/index.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Tests frame interpolation with proper motion sampling - using frames further apart
 */
async function testMotionInterpolation() {
    console.log('🎬 Testing Frame Interpolation with Proper Motion Sampling...\n');

    const framesDir = 'frames';
    const motionOutputDir = 'motion_interpolation_test';
    const sequenceDir = 'motion_sequence';
    
    try {
        // Create output directories
        await fs.mkdir(motionOutputDir, { recursive: true });
        await fs.mkdir(sequenceDir, { recursive: true });

        // Get frames, but skip some to create larger time gaps
        const originalFrames = await fs.readdir(framesDir);
        const pngFrames = originalFrames.filter(f => f.endsWith('.png')).sort();
        
        // Sample every 3rd frame to get 36-minute gaps instead of 12-minute
        // This should show more dramatic solar motion (corona evolution, etc.)
        const sampledFrames = [];
        for (let i = 0; i < Math.min(15, pngFrames.length); i += 3) {
            sampledFrames.push(pngFrames[i]);
        }

        console.log('📅 Time Gap Analysis:');
        console.log(`   - Original frames: 12-minute intervals`);
        console.log(`   - Sampled frames: 36-minute intervals (every 3rd frame)`);
        console.log(`   - Using frames: ${sampledFrames.map(f => f.replace('.png', '')).join(', ')}`);
        console.log(`   - This should show more dramatic solar evolution\n`);

        // Test interpolation between frames with larger time gaps
        console.log('🔄 Generating interpolated frames with better motion capture...');
        
        const interpolatedFrameCount = 6; // More intermediate frames for smoother motion
        const motionPairs = [];
        
        for (let i = 0; i < Math.min(3, sampledFrames.length - 1); i++) {
            const frameA = sampledFrames[i];
            const frameB = sampledFrames[i + 1];
            
            console.log(`   Interpolating between ${frameA} and ${frameB} (36-min gap)...`);
            
            const frameAPath = path.join(framesDir, frameA);
            const frameBPath = path.join(framesDir, frameB);
            const baseFrameNum = (i + 1).toString().padStart(3, '0');
            
            const startTime = Date.now();
            
            await interpolateFrames(
                frameAPath,
                frameBPath,
                interpolatedFrameCount,
                motionOutputDir,
                baseFrameNum
            );
            
            const processingTime = Date.now() - startTime;
            console.log(`     ✅ Completed in ${processingTime}ms`);
            
            motionPairs.push({
                frameA,
                frameB,
                baseFrameNum,
                processingTime,
                timeGap: '36 minutes'
            });
        }

        console.log(`\n✅ Generated motion interpolation for ${motionPairs.length} frame pairs`);

        // Create comparison sequences
        console.log('\n📋 Creating motion demonstration sequences...');

        // Original sequence (sampled frames only)
        let originalIndex = 1;
        for (const frame of sampledFrames.slice(0, 4)) { // Use first 4 sampled frames
            const src = path.join(framesDir, frame);
            const dst = path.join(sequenceDir, `motion_original_${originalIndex.toString().padStart(3, '0')}.png`);
            await fs.copyFile(src, dst);
            originalIndex++;
        }
        console.log(`   ✅ Motion original sequence: ${originalIndex - 1} frames (36-min gaps)`);

        // Interpolated sequence with motion
        let motionIndex = 1;
        for (let i = 0; i < motionPairs.length; i++) {
            // Add original frame
            const src = path.join(framesDir, motionPairs[i].frameA);
            const dst = path.join(sequenceDir, `motion_interpolated_${motionIndex.toString().padStart(3, '0')}.png`);
            await fs.copyFile(src, dst);
            motionIndex++;

            // Add interpolated frames
            const baseFrameNum = motionPairs[i].baseFrameNum;
            for (let j = 1; j <= interpolatedFrameCount; j++) {
                const interpSrc = path.join(motionOutputDir, `frame_${baseFrameNum}_interp_${j}.png`);
                const interpDst = path.join(sequenceDir, `motion_interpolated_${motionIndex.toString().padStart(3, '0')}.png`);
                await fs.copyFile(interpSrc, interpDst);
                motionIndex++;
            }
        }
        
        // Add final frame
        if (motionPairs.length > 0) {
            const finalSrc = path.join(framesDir, motionPairs[motionPairs.length - 1].frameB);
            const finalDst = path.join(sequenceDir, `motion_interpolated_${motionIndex.toString().padStart(3, '0')}.png`);
            await fs.copyFile(finalSrc, finalDst);
            motionIndex++;
        }

        console.log(`   ✅ Motion interpolated sequence: ${motionIndex - 1} frames`);

        // Create videos focused on motion
        console.log('\n🎥 Creating motion demonstration videos...');

        // Smooth 30 FPS playback for professional quality
        const motionOriginalCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/motion_original_%03d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 motion_demo_original.mp4`;
        console.log('   🔄 Creating motion original video (30 FPS)...');
        await execAsync(motionOriginalCmd);

        const motionInterpCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/motion_interpolated_%03d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 motion_demo_interpolated.mp4`;
        console.log('   🔄 Creating motion interpolated video (30 FPS)...');
        await execAsync(motionInterpCmd);

        // Side-by-side comparison focused on motion
        const motionComparisonCmd = `ffmpeg -y -i motion_demo_original.mp4 -i motion_demo_interpolated.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2[v];[v]drawtext=text='Original (36-min jumps)':x=50:y=50:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7[v1];[v1]drawtext=text='Interpolated (smooth motion)':x=770:y=50:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7[v2]" -map "[v2]" -c:v libx264 -pix_fmt yuv420p -crf 18 motion_interpolation_comparison.mp4`;
        console.log('   🔄 Creating motion comparison video...');
        await execAsync(motionComparisonCmd);

        // Also create a 24 FPS version for cinema quality
        const detailedAnalysisCmd = `ffmpeg -y -framerate 24 -i "${sequenceDir}/motion_interpolated_%03d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 motion_detailed_analysis.mp4`;
        console.log('   🔄 Creating cinema quality video (24 FPS)...');
        await execAsync(detailedAnalysisCmd);

        // Calculate statistics
        const totalProcessingTime = motionPairs.reduce((sum, pair) => sum + pair.processingTime, 0);
        const avgTimePerPair = totalProcessingTime / motionPairs.length;

        // Clean up temporary directories
        await fs.rm(sequenceDir, { recursive: true });

        console.log('\n✅ Motion Interpolation Test Complete!');
        console.log('======================================');
        console.log(`📊 Motion Statistics:`);
        console.log(`   - Frame pairs with 36-min gaps: ${motionPairs.length}`);
        console.log(`   - Total interpolated frames: ${motionPairs.length * interpolatedFrameCount}`);
        console.log(`   - Total processing time: ${(totalProcessingTime / 1000).toFixed(1)}s`);
        console.log(`   - Average time per pair: ${avgTimePerPair.toFixed(0)}ms`);
        console.log('');
        console.log('📹 Motion Demonstration Videos:');
        console.log('   - motion_demo_original.mp4 (36-minute jumps)');
        console.log('   - motion_demo_interpolated.mp4 (smooth motion)');
        console.log('   - motion_interpolation_comparison.mp4 (side-by-side)');
        console.log('   - motion_detailed_analysis.mp4 (very slow for analysis)');
        console.log('');
        console.log('🎯 Expected Results:');
        console.log('   - Original: Dramatic jumps in corona structure');
        console.log('   - Interpolated: Smooth evolution of solar features');
        console.log('   - Corona streamers should flow naturally');
        console.log('   - Solar surface features should transition smoothly');

    } catch (error) {
        console.error('❌ Error during motion interpolation test:', error);
    }
}

// Run the motion test
testMotionInterpolation().catch(console.error);