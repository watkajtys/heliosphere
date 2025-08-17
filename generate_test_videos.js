#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Generates multiple test videos with different settings
 */
async function generateTestVideos(framesDir = 'video_frames_chronological') {
    console.log('🎬 Test Video Generation Suite');
    console.log(`📂 Frames directory: ${framesDir}\n`);
    
    try {
        // Verify frames directory exists
        const files = await fs.readdir(framesDir);
        const frameFiles = files.filter(f => f.startsWith('frame_') && f.endsWith('.png'));
        console.log(`📊 Found ${frameFiles.length} sequential frames\n`);
        
        if (frameFiles.length === 0) {
            throw new Error('No frames found in directory');
        }
        
        // Video configurations
        const videos = [
            {
                name: 'Standard 30 FPS',
                output: 'solar_test_30fps.mp4',
                fps: 30,
                crf: 18,
                preset: 'slow',
                description: 'Standard playback speed, high quality'
            },
            {
                name: '60 FPS Interpolated',
                output: 'solar_test_60fps_interpolated.mp4',
                fps: 60,
                crf: 18,
                preset: 'slow',
                interpolate: true,
                description: 'Smooth motion with frame interpolation'
            },
            {
                name: '15 FPS Slow Motion',
                output: 'solar_test_15fps_slow.mp4',
                fps: 15,
                crf: 18,
                preset: 'slow',
                description: 'Half-speed playback for analysis'
            },
            {
                name: 'High Quality Master',
                output: 'solar_test_master.mp4',
                fps: 30,
                crf: 10,
                preset: 'veryslow',
                description: 'Highest quality master file'
            },
            {
                name: 'Web Optimized',
                output: 'solar_test_web.mp4',
                fps: 30,
                crf: 23,
                preset: 'fast',
                movflags: true,
                description: 'Optimized for web streaming'
            }
        ];
        
        // Generate each video
        for (const video of videos) {
            console.log(`🎥 Generating: ${video.name}`);
            console.log(`   📝 ${video.description}`);
            console.log(`   ⚙️  Settings: ${video.fps} FPS, CRF ${video.crf}, preset ${video.preset}`);
            
            let ffmpegCmd;
            
            if (video.interpolate) {
                // Use minterpolate filter for smooth 60 FPS
                ffmpegCmd = `ffmpeg -y -framerate 30 -i "${framesDir}/frame_%04d.png" ` +
                           `-filter_complex "minterpolate=fps=${video.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" ` +
                           `-c:v libx264 -pix_fmt yuv420p -crf ${video.crf} -preset ${video.preset} ` +
                           `"${video.output}"`;
            } else {
                // Standard video generation
                ffmpegCmd = `ffmpeg -y -framerate ${video.fps} -i "${framesDir}/frame_%04d.png" ` +
                           `-c:v libx264 -pix_fmt yuv420p -crf ${video.crf} -preset ${video.preset} `;
                
                // Add web optimization flags if specified
                if (video.movflags) {
                    ffmpegCmd += `-movflags +faststart `;
                }
                
                ffmpegCmd += `"${video.output}"`;
            }
            
            console.log(`   🔄 Running FFmpeg...`);
            
            try {
                const startTime = Date.now();
                const { stdout, stderr } = await execAsync(ffmpegCmd);
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                
                // Check file size
                const stats = await fs.stat(video.output);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                
                console.log(`   ✅ Generated: ${video.output} (${sizeMB} MB in ${elapsed}s)\n`);
                
            } catch (error) {
                console.error(`   ❌ Failed to generate ${video.name}: ${error.message}\n`);
            }
        }
        
        // Generate video statistics
        console.log('\n📊 Video Statistics:');
        console.log('─'.repeat(60));
        
        for (const video of videos) {
            try {
                const stats = await fs.stat(video.output);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                
                // Get video info using ffprobe
                const probeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration,bit_rate -of csv=p=0 "${video.output}"`;
                const { stdout } = await execAsync(probeCmd);
                const [width, height, duration, bitrate] = stdout.trim().split(',');
                
                console.log(`📁 ${video.output}`);
                console.log(`   • Size: ${sizeMB} MB`);
                console.log(`   • Resolution: ${width}x${height}`);
                console.log(`   • Duration: ${parseFloat(duration).toFixed(1)}s`);
                console.log(`   • Bitrate: ${(parseInt(bitrate) / 1000).toFixed(0)} kbps`);
                console.log(`   • FPS: ${video.fps}`);
                console.log('');
                
            } catch (error) {
                // File might not exist if generation failed
            }
        }
        
        console.log('✅ Test video generation complete!');
        console.log('\n🎯 Next steps:');
        console.log('   1. Review the generated videos');
        console.log('   2. Choose the best settings for production');
        console.log('   3. Test playback on target devices');
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        throw error;
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const framesDir = args[0] || 'video_frames_chronological';

// Run the generator
generateTestVideos(framesDir).catch(console.error);