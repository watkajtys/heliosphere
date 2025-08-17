#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

async function reverseFrames(sourceDir = 'video_frames_sequential', targetDir = 'video_frames_chronological') {
    console.log('🔄 Frame Reversal Tool');
    console.log('📝 Reversing frame order for chronological playback');
    console.log(`📂 Source: ${sourceDir}`);
    console.log(`📂 Target: ${targetDir}\n`);
    
    try {
        // Create target directory
        await fs.mkdir(targetDir, { recursive: true });
        
        // Get all frame files
        const files = await fs.readdir(sourceDir);
        const frameFiles = files
            .filter(f => f.startsWith('frame_') && f.endsWith('.png'))
            .sort((a, b) => {
                const numA = parseInt(a.match(/frame_(\d+)/)[1]);
                const numB = parseInt(b.match(/frame_(\d+)/)[1]);
                return numA - numB;
            });
        
        console.log(`📊 Found ${frameFiles.length} frames to reverse`);
        console.log('⏳ Frames were generated newest-to-oldest');
        console.log('✨ Reversing to oldest-to-newest for correct playback\n');
        
        // Copy files in reverse order
        console.log('📋 Reversing frames...');
        for (let i = 0; i < frameFiles.length; i++) {
            const sourceFile = frameFiles[i];
            
            // Calculate reversed frame number
            const targetNum = frameFiles.length - i;
            const targetFile = `frame_${targetNum.toString().padStart(4, '0')}.png`;
            
            const sourcePath = path.join(sourceDir, sourceFile);
            const targetPath = path.join(targetDir, targetFile);
            
            await fs.copyFile(sourcePath, targetPath);
            
            if ((i + 1) % 50 === 0 || i === frameFiles.length - 1) {
                const percent = (((i + 1) / frameFiles.length) * 100).toFixed(1);
                console.log(`   📊 Progress: ${i + 1}/${frameFiles.length} (${percent}%)`);
            }
        }
        
        console.log(`\n✅ Frame reversal complete!`);
        console.log(`📁 Chronological frames saved to: ${targetDir}`);
        console.log('🎬 Ready for video generation with correct time flow');
        
        return {
            totalFrames: frameFiles.length,
            outputDir: targetDir
        };
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        throw error;
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const sourceDir = args[0] || 'video_frames_sequential';
const targetDir = args[1] || 'video_frames_chronological';

reverseFrames(sourceDir, targetDir).catch(console.error);