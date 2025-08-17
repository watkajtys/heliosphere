#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

async function renumberFrames(sourceDir = 'video_10sec_optimized', targetDir = 'video_frames_sequential') {
    console.log('🔢 Frame Renumbering Tool');
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
        
        console.log(`📊 Found ${frameFiles.length} frames`);
        
        // Identify gaps in the sequence
        const gaps = [];
        for (let i = 1; i < frameFiles.length; i++) {
            const currentNum = parseInt(frameFiles[i].match(/frame_(\d+)/)[1]);
            const prevNum = parseInt(frameFiles[i-1].match(/frame_(\d+)/)[1]);
            
            if (currentNum - prevNum > 1) {
                for (let j = prevNum + 1; j < currentNum; j++) {
                    gaps.push(j);
                }
            }
        }
        
        if (gaps.length > 0) {
            console.log(`⚠️  Found ${gaps.length} gaps in sequence: ${gaps.slice(0, 20).join(', ')}${gaps.length > 20 ? '...' : ''}\n`);
        } else {
            console.log(`✅ No gaps found in sequence\n`);
        }
        
        // Copy and renumber sequentially
        console.log('📋 Renumbering frames...');
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
        
        console.log(`\n✅ Successfully renumbered ${frameFiles.length} frames!`);
        console.log(`📁 Output directory: ${targetDir}`);
        
        return {
            totalFrames: frameFiles.length,
            gaps: gaps.length,
            outputDir: targetDir
        };
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        throw error;
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const sourceDir = args[0] || 'video_10sec_optimized';
const targetDir = args[1] || 'video_frames_sequential';

renumberFrames(sourceDir, targetDir).catch(console.error);