#!/usr/bin/env node

import { interpolateFrames } from './frame-interpolation/index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Test script for frame interpolation
 */
async function testInterpolation() {
    console.log('🎬 Testing Frame Interpolation...\n');

    // Configuration
    const framesDir = 'frames';
    const outputDir = 'interpolated_test';
    const intermediateFrameCount = 3; // Generate 3 intermediate frames

    try {
        // Create output directory
        await fs.mkdir(outputDir, { recursive: true });

        // Get first few frames for testing
        const frameFiles = await fs.readdir(framesDir);
        const pngFrames = frameFiles.filter(f => f.endsWith('.png')).sort();
        
        if (pngFrames.length < 2) {
            console.error('❌ Need at least 2 frames for interpolation test');
            return;
        }

        console.log(`📁 Found ${pngFrames.length} frames in ${framesDir}`);
        console.log(`🔍 Testing interpolation between first two frames:`);
        console.log(`   - Frame A: ${pngFrames[0]}`);
        console.log(`   - Frame B: ${pngFrames[1]}`);
        console.log(`   - Generating ${intermediateFrameCount} intermediate frames\n`);

        // Run interpolation
        const frameAPath = path.join(framesDir, pngFrames[0]);
        const frameBPath = path.join(framesDir, pngFrames[1]);
        const baseFrameNum = '001'; // Base frame number for naming

        const startTime = Date.now();
        
        await interpolateFrames(
            frameAPath,
            frameBPath,
            intermediateFrameCount,
            outputDir,
            baseFrameNum
        );

        const processingTime = Date.now() - startTime;

        // Verify output
        const outputFiles = await fs.readdir(outputDir);
        const interpolatedFiles = outputFiles.filter(f => f.includes('_interp_'));

        console.log('\n✅ Interpolation Complete!');
        console.log('==========================');
        console.log(`⏱️ Total processing time: ${processingTime}ms`);
        console.log(`📊 Generated ${interpolatedFiles.length} interpolated frames:`);
        
        interpolatedFiles.forEach(file => {
            console.log(`   - ${file}`);
        });

        console.log(`\n📁 Output saved to: ${outputDir}/`);
        console.log('\n🔍 To validate quality, you can:');
        console.log('   1. Visually inspect the generated frames');
        console.log('   2. Run: node validate_interpolation.js');
        console.log('   3. Check processing performance metrics');

    } catch (error) {
        console.error('❌ Error during interpolation test:', error);
    }
}

// Run the test
testInterpolation().catch(console.error);