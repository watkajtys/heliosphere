#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

async function fixFrameOrder(sourceDir = 'video_frames_chronological', targetDir = 'video_frames_correct') {
    console.log('🔄 Fixing Frame Order for Correct Playback');
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
                return numB - numA; // Sort in DESCENDING order
            });
        
        console.log(`📊 Found ${frameFiles.length} frames`);
        console.log('🔧 Re-ordering frames for correct chronological playback\n');
        
        // Copy files with correct numbering
        console.log('📋 Processing frames...');
        for (let i = 0; i < frameFiles.length; i++) {
            const sourceFile = frameFiles[i];
            const newNumber = (i + 1).toString().padStart(4, '0');
            const targetFile = `frame_${newNumber}.png`;
            
            const sourcePath = path.join(sourceDir, sourceFile);
            const targetPath = path.join(targetDir, targetFile);
            
            await fs.copyFile(sourcePath, targetPath);
            
            if ((i + 1) % 50 === 0 || i === frameFiles.length - 1) {
                const percent = (((i + 1) / frameFiles.length) * 100).toFixed(1);
                console.log(`   📊 Progress: ${i + 1}/${frameFiles.length} (${percent}%)`);
            }
        }
        
        console.log(`\n✅ Frame order fixed!`);
        console.log(`📁 Correctly ordered frames saved to: ${targetDir}`);
        console.log('🎬 Frames now play from oldest to newest');
        
        return {
            totalFrames: frameFiles.length,
            outputDir: targetDir
        };
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        throw error;
    }
}

// Run the fix
fixFrameOrder().catch(console.error);