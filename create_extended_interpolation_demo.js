#!/usr/bin/env node

import { interpolateFrames } from './frame-interpolation/index.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Creates an extended demonstration with multiple interpolated frame pairs
 */
async function createExtendedDemo() {
    console.log('🎬 Creating Extended Frame Interpolation Demonstration...\n');

    const framesDir = 'frames';
    const extendedOutputDir = 'extended_interpolation_demo';
    const sequenceDir = 'extended_sequence';
    
    try {
        // Create output directories
        await fs.mkdir(extendedOutputDir, { recursive: true });
        await fs.mkdir(sequenceDir, { recursive: true });

        // Get first 10 frames for a longer demo
        const originalFrames = await fs.readdir(framesDir);
        const pngFrames = originalFrames.filter(f => f.endsWith('.png')).sort().slice(0, 10);
        
        console.log(`📁 Using ${pngFrames.length} original frames for extended demo`);

        // Generate interpolated frames between every consecutive pair
        console.log('\n🔄 Generating interpolated frames between multiple pairs...');
        
        const interpolatedFrameCount = 4; // More interpolated frames for smoother motion
        const framePairs = [];
        
        for (let i = 0; i < pngFrames.length - 1; i++) {
            const frameA = pngFrames[i];
            const frameB = pngFrames[i + 1];
            
            console.log(`   Interpolating between ${frameA} and ${frameB}...`);
            
            const frameAPath = path.join(framesDir, frameA);
            const frameBPath = path.join(framesDir, frameB);
            const baseFrameNum = (i + 1).toString().padStart(3, '0');
            
            const startTime = Date.now();
            
            await interpolateFrames(
                frameAPath,
                frameBPath,
                interpolatedFrameCount,
                extendedOutputDir,
                baseFrameNum
            );
            
            const processingTime = Date.now() - startTime;
            console.log(`     ✅ Completed in ${processingTime}ms`);
            
            framePairs.push({
                frameA,
                frameB,
                baseFrameNum,
                processingTime
            });
        }

        console.log(`\n✅ Generated interpolation for ${framePairs.length} frame pairs`);

        // Create sequences
        console.log('\n📋 Creating video sequences...');

        // Original sequence (every frame)
        let originalIndex = 1;
        for (const frame of pngFrames) {
            const src = path.join(framesDir, frame);
            const dst = path.join(sequenceDir, `original_${originalIndex.toString().padStart(4, '0')}.png`);
            await fs.copyFile(src, dst);
            originalIndex++;
        }
        console.log(`   ✅ Original sequence: ${originalIndex - 1} frames`);

        // Interpolated sequence (frame + interpolated + frame + interpolated + ...)
        let interpIndex = 1;
        for (let i = 0; i < pngFrames.length - 1; i++) {
            // Add original frame
            const src = path.join(framesDir, pngFrames[i]);
            const dst = path.join(sequenceDir, `interpolated_${interpIndex.toString().padStart(4, '0')}.png`);
            await fs.copyFile(src, dst);
            interpIndex++;

            // Add interpolated frames
            const baseFrameNum = (i + 1).toString().padStart(3, '0');
            for (let j = 1; j <= interpolatedFrameCount; j++) {
                const interpSrc = path.join(extendedOutputDir, `frame_${baseFrameNum}_interp_${j}.png`);
                const interpDst = path.join(sequenceDir, `interpolated_${interpIndex.toString().padStart(4, '0')}.png`);
                await fs.copyFile(interpSrc, interpDst);
                interpIndex++;
            }
        }
        
        // Add final frame
        const finalSrc = path.join(framesDir, pngFrames[pngFrames.length - 1]);
        const finalDst = path.join(sequenceDir, `interpolated_${interpIndex.toString().padStart(4, '0')}.png`);
        await fs.copyFile(finalSrc, finalDst);
        interpIndex++;

        console.log(`   ✅ Interpolated sequence: ${interpIndex - 1} frames`);

        // Create videos with different frame rates for better comparison
        console.log('\n🎥 Creating demonstration videos...');

        // High quality 30 FPS for smooth playback
        const highFpsVideoCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/original_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 extended_demo_original_30fps.mp4`;
        console.log('   🔄 Creating smooth original video (30 FPS)...');
        await execAsync(highFpsVideoCmd);

        const highFpsInterpCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/interpolated_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 extended_demo_interpolated_30fps.mp4`;
        console.log('   🔄 Creating smooth interpolated video (30 FPS)...');
        await execAsync(highFpsInterpCmd);

        // Alternative 24 FPS (cinema standard)
        const cinemaVideoCmd = `ffmpeg -y -framerate 24 -i "${sequenceDir}/original_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 extended_demo_original_24fps.mp4`;
        console.log('   🔄 Creating cinema quality original video (24 FPS)...');
        await execAsync(cinemaVideoCmd);

        const cinemaInterpCmd = `ffmpeg -y -framerate 24 -i "${sequenceDir}/interpolated_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 extended_demo_interpolated_24fps.mp4`;
        console.log('   🔄 Creating medium speed interpolated video (3 FPS)...');
        await execAsync(mediumInterpCmd);

        // Side-by-side comparison at medium speed
        const comparisonCmd = `ffmpeg -y -i extended_demo_original_medium.mp4 -i extended_demo_interpolated_medium.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2[v];[v]drawtext=text='Original':x=50:y=50:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5[v1];[v1]drawtext=text='Interpolated':x=770:y=50:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5[v2]" -map "[v2]" -c:v libx264 -pix_fmt yuv420p -crf 18 extended_interpolation_comparison.mp4`;
        console.log('   🔄 Creating labeled side-by-side comparison...');
        await execAsync(comparisonCmd);

        // Calculate total processing time
        const totalProcessingTime = framePairs.reduce((sum, pair) => sum + pair.processingTime, 0);
        const avgTimePerPair = totalProcessingTime / framePairs.length;

        // Clean up temporary directories
        await fs.rm(sequenceDir, { recursive: true });

        console.log('\n✅ Extended Demonstration Complete!');
        console.log('=====================================');
        console.log(`📊 Processing Statistics:`);
        console.log(`   - Frame pairs processed: ${framePairs.length}`);
        console.log(`   - Total interpolated frames: ${framePairs.length * interpolatedFrameCount}`);
        console.log(`   - Total processing time: ${(totalProcessingTime / 1000).toFixed(1)}s`);
        console.log(`   - Average time per pair: ${avgTimePerPair.toFixed(0)}ms`);
        console.log('');
        console.log('📹 Generated videos:');
        console.log('   - extended_demo_original_slow.mp4 (1 FPS - very slow)');
        console.log('   - extended_demo_interpolated_slow.mp4 (1 FPS - very slow)');
        console.log('   - extended_demo_original_medium.mp4 (3 FPS - normal speed)');
        console.log('   - extended_demo_interpolated_medium.mp4 (3 FPS - normal speed)');
        console.log('   - extended_interpolation_comparison.mp4 (side-by-side with labels)');
        console.log('');
        console.log('🎯 The interpolated videos should show much smoother motion');
        console.log('   with natural transitions between all consecutive frames.');
        console.log('   The effect should be clearly visible in the longer sequence!');

    } catch (error) {
        console.error('❌ Error creating extended demo:', error);
    }
}

// Run the extended demo creation
createExtendedDemo().catch(console.error);