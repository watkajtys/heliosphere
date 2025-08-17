#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Creates a demonstration video showing frame interpolation results
 */
async function createInterpolationVideo() {
    console.log('🎬 Creating Frame Interpolation Demonstration Video...\n');

    const framesDir = 'frames';
    const interpolatedDir = 'interpolated_test';
    const sequenceDir = 'interpolation_sequence';
    
    try {
        // Create sequence directory
        await fs.mkdir(sequenceDir, { recursive: true });

        // Get first few original frames for the demo
        const originalFrames = await fs.readdir(framesDir);
        const pngFrames = originalFrames.filter(f => f.endsWith('.png')).sort().slice(0, 5);
        
        console.log(`📁 Using ${pngFrames.length} original frames for demo`);

        // Get interpolated frames
        const interpolatedFrames = await fs.readdir(interpolatedDir);
        const interpFrames = interpolatedFrames.filter(f => f.includes('_interp_')).sort();
        
        console.log(`🔍 Found ${interpFrames.length} interpolated frames`);

        // Create two sequences:
        // 1. Original sequence (frames 1-5)
        // 2. Interpolated sequence (frame1 + interp + frame2 + frame3 + frame4 + frame5)

        console.log('\n📋 Creating frame sequences...');

        // Copy original frames for comparison
        let frameIndex = 1;
        
        // Original sequence
        for (const frame of pngFrames) {
            const src = path.join(framesDir, frame);
            const dst = path.join(sequenceDir, `original_${frameIndex.toString().padStart(3, '0')}.png`);
            await fs.copyFile(src, dst);
            frameIndex++;
        }

        console.log(`   ✅ Created original sequence: ${frameIndex - 1} frames`);

        // Interpolated sequence - frame1 + interpolated + frame2 + remaining frames
        frameIndex = 1;
        
        // Add frame 1
        await fs.copyFile(
            path.join(framesDir, pngFrames[0]),
            path.join(sequenceDir, `interpolated_${frameIndex.toString().padStart(3, '0')}.png`)
        );
        frameIndex++;

        // Add interpolated frames
        for (const interpFrame of interpFrames) {
            const src = path.join(interpolatedDir, interpFrame);
            const dst = path.join(sequenceDir, `interpolated_${frameIndex.toString().padStart(3, '0')}.png`);
            await fs.copyFile(src, dst);
            frameIndex++;
        }

        // Add remaining original frames
        for (let i = 1; i < pngFrames.length; i++) {
            await fs.copyFile(
                path.join(framesDir, pngFrames[i]),
                path.join(sequenceDir, `interpolated_${frameIndex.toString().padStart(3, '0')}.png`)
            );
            frameIndex++;
        }

        console.log(`   ✅ Created interpolated sequence: ${frameIndex - 1} frames`);

        // Create videos using ffmpeg
        console.log('\n🎥 Generating videos...');

        // Check if ffmpeg is available
        try {
            await execAsync('ffmpeg -version');
        } catch (error) {
            console.log('⚠️ FFmpeg not found in PATH, checking local directory...');
            // Check if we have local ffmpeg
            try {
                await fs.access('ffmpeg-master-latest-win64-gpl');
                console.log('✅ Found local FFmpeg installation');
            } catch {
                console.error('❌ FFmpeg not available. Please install FFmpeg or place it in the project directory.');
                return;
            }
        }

        // Create original frames video (fast playback to show difference)
        const originalVideoCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/original_%03d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 interpolation_demo_original.mp4`;
        console.log('   🔄 Creating original sequence video...');
        await execAsync(originalVideoCmd);
        console.log('   ✅ Original video: interpolation_demo_original.mp4');

        // Create interpolated sequence video
        const interpolatedVideoCmd = `ffmpeg -y -framerate 30 -i "${sequenceDir}/interpolated_%03d.png" -c:v libx264 -pix_fmt yuv420p -crf 18 interpolation_demo_interpolated.mp4`;
        console.log('   🔄 Creating interpolated sequence video...');
        await execAsync(interpolatedVideoCmd);
        console.log('   ✅ Interpolated video: interpolation_demo_interpolated.mp4');

        // Create side-by-side comparison (if we have both videos)
        console.log('   🔄 Creating side-by-side comparison...');
        const comparisonCmd = `ffmpeg -y -i interpolation_demo_original.mp4 -i interpolation_demo_interpolated.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2[v]" -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 18 interpolation_comparison.mp4`;
        await execAsync(comparisonCmd);
        console.log('   ✅ Comparison video: interpolation_comparison.mp4');

        // Clean up temporary sequence directory
        await fs.rm(sequenceDir, { recursive: true });

        console.log('\n✅ Video Creation Complete!');
        console.log('=============================');
        console.log('📹 Generated videos:');
        console.log('   - interpolation_demo_original.mp4 (5 original frames)');
        console.log('   - interpolation_demo_interpolated.mp4 (original + 3 interpolated + remaining)');
        console.log('   - interpolation_comparison.mp4 (side-by-side comparison)');
        console.log('');
        console.log('🎯 The interpolated video should show smoother motion between frames 1 and 2');
        console.log('   compared to the original sequence.');

    } catch (error) {
        console.error('❌ Error creating video:', error);
    }
}

// Run the video creation
createInterpolationVideo().catch(console.error);