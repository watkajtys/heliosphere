#!/usr/bin/env node

/**
 * Video Encoder Module with Chunked Encoding Support
 * Handles large-scale video generation with memory optimization
 */

import fs from 'fs/promises';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { getMemoryManager } from './memory_manager.js';

const execAsync = promisify(exec);

class VideoEncoder {
    constructor(options = {}) {
        this.framesDir = options.framesDir || '/opt/heliosphere/frames';
        this.outputDir = options.outputDir || '/opt/heliosphere/videos';
        this.tempDir = options.tempDir || '/tmp/heliosphere_encode';
        this.fps = options.fps || 24;
        this.crf = options.crf || 0;  // LOSSLESS - Cloudflare handles compression
        this.preset = options.preset || 'ultrafast';  // Fast since no compression
        this.maxChunkFrames = options.maxChunkFrames || 1000; // Max frames per video chunk
        this.extraParams = options.extraParams || []
        
        this.memoryManager = getMemoryManager();
        this.encodingState = {
            status: 'idle',
            currentChunk: null,
            progress: 0,
            chunks: [],
            errors: []
        };
    }

    /**
     * Initialize encoder
     */
    async initialize() {
        await fs.mkdir(this.outputDir, { recursive: true });
        await fs.mkdir(this.tempDir, { recursive: true });
        
        // Check FFmpeg availability
        await this.checkFFmpeg();
        
        console.log('🎬 Video encoder initialized');
        console.log(`   FPS: ${this.fps}`);
        console.log(`   CRF: ${this.crf} (quality)`);
        console.log(`   Preset: ${this.preset}`);
    }

    /**
     * Check FFmpeg installation
     */
    async checkFFmpeg() {
        try {
            const { stdout } = await execAsync('ffmpeg -version');
            const version = stdout.split('\n')[0];
            console.log(`   FFmpeg: ${version}`);
            
            // Check for hardware acceleration
            const hwAccel = await this.detectHardwareAcceleration();
            if (hwAccel.length > 0) {
                console.log(`   Hardware acceleration available: ${hwAccel.join(', ')}`);
            }
        } catch (error) {
            throw new Error('FFmpeg not found. Please install FFmpeg.');
        }
    }

    /**
     * Detect available hardware acceleration
     */
    async detectHardwareAcceleration() {
        const available = [];
        
        try {
            // Check for NVIDIA NVENC
            const { stdout: nvenc } = await execAsync('ffmpeg -hide_banner -encoders | grep nvenc', { shell: true });
            if (nvenc.includes('h264_nvenc')) available.push('NVENC');
        } catch {}
        
        try {
            // Check for Intel QuickSync
            const { stdout: qsv } = await execAsync('ffmpeg -hide_banner -encoders | grep qsv', { shell: true });
            if (qsv.includes('h264_qsv')) available.push('QuickSync');
        } catch {}
        
        try {
            // Check for AMD AMF
            const { stdout: amf } = await execAsync('ffmpeg -hide_banner -encoders | grep amf', { shell: true });
            if (amf.includes('h264_amf')) available.push('AMF');
        } catch {}
        
        return available;
    }

    /**
     * Generate video with chunked encoding for large datasets
     */
    async generateChunkedVideo(totalFrames, outputName, options = {}) {
        console.log(`\n🎬 Starting chunked video generation`);
        console.log(`   Total frames: ${totalFrames}`);
        console.log(`   Output: ${outputName}`);
        
        this.encodingState.status = 'encoding';
        const startTime = Date.now();
        
        try {
            // Calculate chunks
            const chunks = this.calculateVideoChunks(totalFrames);
            console.log(`   Chunks: ${chunks.length} (${this.maxChunkFrames} frames each)`);
            
            // Encode each chunk
            const chunkFiles = [];
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`\n📹 Encoding chunk ${i + 1}/${chunks.length}`);
                
                // Wait for memory
                await this.memoryManager.waitForMemory(500); // 500MB safety buffer
                
                // Encode chunk
                const chunkFile = await this.encodeChunk(chunk, i, options);
                chunkFiles.push(chunkFile);
                
                // Update progress
                this.encodingState.currentChunk = i + 1;
                this.encodingState.progress = ((i + 1) / chunks.length * 100).toFixed(1);
                
                // Cleanup memory
                this.memoryManager.forceGarbageCollection();
            }
            
            // Concatenate chunks
            console.log('\n🔗 Concatenating video chunks...');
            const finalPath = await this.concatenateChunks(chunkFiles, outputName);
            
            // Cleanup chunk files
            await this.cleanupChunkFiles(chunkFiles);
            
            // Generate thumbnails
            await this.generateThumbnails(finalPath);
            
            // Get final stats
            const stats = await fs.stat(finalPath);
            const duration = (Date.now() - startTime) / 1000;
            
            console.log(`\n✅ Video generation complete!`);
            console.log(`   File: ${finalPath}`);
            console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   Duration: ${(totalFrames / this.fps).toFixed(1)} seconds`);
            console.log(`   Encoding time: ${duration.toFixed(1)} seconds`);
            console.log(`   Speed: ${(totalFrames / duration).toFixed(1)} fps`);
            
            this.encodingState.status = 'completed';
            
            return {
                path: finalPath,
                size: stats.size,
                frames: totalFrames,
                duration: totalFrames / this.fps,
                encodingTime: duration
            };
            
        } catch (error) {
            this.encodingState.status = 'error';
            this.encodingState.errors.push(error.message);
            throw error;
        }
    }

    /**
     * Generate standard video (non-chunked) for smaller datasets
     */
    async generateVideo(startFrame, endFrame, outputName, options = {}) {
        const totalFrames = endFrame - startFrame + 1;
        
        // Use chunked encoding for large videos
        if (totalFrames > this.maxChunkFrames * 2) {
            return this.generateChunkedVideo(totalFrames, outputName, options);
        }
        
        console.log(`\n🎬 Generating video: ${outputName}`);
        console.log(`   Frames: ${startFrame}-${endFrame} (${totalFrames} total)`);
        
        const outputPath = path.join(this.outputDir, `${outputName}.mp4`);
        
        // Build FFmpeg command
        const ffmpegCmd = this.buildFFmpegCommand(startFrame, totalFrames, outputPath, options);
        
        // Execute with progress tracking
        await this.executeFFmpegWithProgress(ffmpegCmd, totalFrames);
        
        const stats = await fs.stat(outputPath);
        console.log(`✅ Generated: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        return {
            path: outputPath,
            size: stats.size,
            frames: totalFrames,
            duration: totalFrames / this.fps
        };
    }

    /**
     * Calculate video chunks
     */
    calculateVideoChunks(totalFrames) {
        const chunks = [];
        const numChunks = Math.ceil(totalFrames / this.maxChunkFrames);
        
        for (let i = 0; i < numChunks; i++) {
            const start = i * this.maxChunkFrames;
            const end = Math.min(start + this.maxChunkFrames - 1, totalFrames - 1);
            
            chunks.push({
                id: i,
                startFrame: start,
                endFrame: end,
                frames: end - start + 1
            });
        }
        
        return chunks;
    }

    /**
     * Encode a single chunk
     */
    async encodeChunk(chunk, chunkIndex, options = {}) {
        const chunkFile = path.join(this.tempDir, `chunk_${String(chunkIndex).padStart(3, '0')}.mp4`);
        
        console.log(`   Frames: ${chunk.startFrame}-${chunk.endFrame} (${chunk.frames} frames)`);
        
        // Build command for chunk
        const ffmpegCmd = this.buildFFmpegCommand(
            chunk.startFrame,
            chunk.frames,
            chunkFile,
            { ...options, isChunk: true }
        );
        
        // Execute encoding
        await this.executeFFmpegWithProgress(ffmpegCmd, chunk.frames);
        
        // Verify chunk
        const stats = await fs.stat(chunkFile);
        console.log(`   ✓ Chunk ${chunkIndex}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        this.encodingState.chunks.push({
            id: chunkIndex,
            file: chunkFile,
            size: stats.size,
            frames: chunk.frames
        });
        
        return chunkFile;
    }

    /**
     * Build FFmpeg command
     */
    buildFFmpegCommand(startFrame, numFrames, outputPath, options = {}) {
        const inputPattern = path.join(this.framesDir, 'frame_%05d.jpg');
        
        let cmd = [
            'ffmpeg',
            '-y',  // Overwrite output
            '-framerate', this.fps,
            '-start_number', startFrame,
            '-i', `"${inputPattern}"`,
            '-frames:v', numFrames
        ];
        
        // Video codec settings - LOSSLESS for Cloudflare Stream
        cmd.push('-c:v', 'libx264');
        cmd.push('-preset', this.preset);
        cmd.push('-crf', this.crf);  // CRF 0 = lossless
        cmd.push('-profile:v', 'high');
        cmd.push('-level', '5.1');
        
        // Pixel format for compatibility
        cmd.push('-pix_fmt', 'yuv420p');
        
        // Resolution if specified
        if (options.width && options.height) {
            cmd.push('-vf', `scale=${options.width}:${options.height}:flags=lanczos`);
        } else if (options.scale) {
            cmd.push('-vf', `scale=${options.scale}`);
        }
        
        // Two-pass encoding for better quality (non-chunk only)
        if (options.twoPass && !options.isChunk) {
            // This would need to be split into two commands
            cmd.push('-pass', '1');
            cmd.push('-f', 'null');
            cmd.push('/dev/null');
            // Second pass would be a separate command
        }
        
        // Fast start for streaming
        if (!options.isChunk) {
            cmd.push('-movflags', '+faststart');
        }
        
        // Output
        cmd.push(`"${outputPath}"`);
        
        return cmd.join(' ');
    }

    /**
     * Execute FFmpeg with progress tracking
     */
    async executeFFmpegWithProgress(command, totalFrames) {
        return new Promise((resolve, reject) => {
            console.log(`   Executing: ${command.substring(0, 100)}...`);
            
            const process = spawn(command, [], { 
                shell: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            let lastProgress = 0;
            
            // Parse progress from stderr
            process.stderr.on('data', (data) => {
                const output = data.toString();
                
                // Extract frame number
                const frameMatch = output.match(/frame=\s*(\d+)/);
                if (frameMatch) {
                    const currentFrame = parseInt(frameMatch[1]);
                    const progress = (currentFrame / totalFrames * 100).toFixed(1);
                    
                    // Update every 10%
                    if (progress - lastProgress >= 10) {
                        console.log(`   Progress: ${progress}% (${currentFrame}/${totalFrames} frames)`);
                        lastProgress = parseFloat(progress);
                    }
                }
                
                // Check for errors
                if (output.includes('Error') || output.includes('Invalid')) {
                    console.error(`   FFmpeg error: ${output}`);
                }
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });
            
            process.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Concatenate video chunks
     */
    async concatenateChunks(chunkFiles, outputName) {
        const outputPath = path.join(this.outputDir, `${outputName}.mp4`);
        const concatFile = path.join(this.tempDir, 'concat.txt');
        
        // Create concat file
        const concatList = chunkFiles.map(f => `file '${f}'`).join('\n');
        await fs.writeFile(concatFile, concatList);
        
        // Concatenate command
        const ffmpegCmd = [
            'ffmpeg',
            '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', `"${concatFile}"`,
            '-c', 'copy',  // Copy codec, no re-encoding
            '-movflags', '+faststart',
            `"${outputPath}"`
        ].join(' ');
        
        console.log('   Concatenating chunks...');
        await execAsync(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 });
        
        // Cleanup concat file
        await fs.unlink(concatFile);
        
        return outputPath;
    }

    /**
     * Generate dual format videos (desktop and mobile)
     */
    async generateDualFormat(totalFrames, baseName) {
        console.log('\n🎬 Generating dual format videos');
        
        const results = {
            desktop: null,
            mobile: null
        };
        
        // Desktop format (1460x1200)
        console.log('\n📺 Desktop format (1460x1200)...');
        results.desktop = await this.generateChunkedVideo(
            totalFrames,
            `${baseName}_desktop`,
            { width: 1460, height: 1200 }
        );
        
        // Mobile format (1080x1350 - 9:16 portrait)
        console.log('\n📱 Mobile format (1080x1350)...');
        results.mobile = await this.generateChunkedVideo(
            totalFrames,
            `${baseName}_mobile`,
            { 
                width: 1080, 
                height: 1350,
                // Crop to portrait from landscape
                scale: '1460:1200,crop=1080:1350:190:0'
            }
        );
        
        return results;
    }

    /**
     * Generate thumbnails
     */
    async generateThumbnails(videoPath, count = 5) {
        const videoName = path.basename(videoPath, '.mp4');
        const thumbDir = path.join(this.outputDir, 'thumbnails', videoName);
        await fs.mkdir(thumbDir, { recursive: true });
        
        console.log(`📸 Generating ${count} thumbnails...`);
        
        // Get video duration
        const duration = await this.getVideoDuration(videoPath);
        const interval = duration / (count + 1);
        
        const thumbnails = [];
        for (let i = 1; i <= count; i++) {
            const time = interval * i;
            const thumbPath = path.join(thumbDir, `thumb_${i}.jpg`);
            
            const cmd = [
                'ffmpeg',
                '-y',
                '-ss', time.toFixed(2),
                '-i', `"${videoPath}"`,
                '-frames:v', '1',
                '-q:v', '2',
                `"${thumbPath}"`
            ].join(' ');
            
            await execAsync(cmd);
            thumbnails.push(thumbPath);
        }
        
        console.log(`   ✓ Generated ${count} thumbnails`);
        return thumbnails;
    }

    /**
     * Get video duration
     */
    async getVideoDuration(videoPath) {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        const { stdout } = await execAsync(cmd);
        return parseFloat(stdout.trim());
    }

    /**
     * Cleanup chunk files
     */
    async cleanupChunkFiles(chunkFiles) {
        console.log('🧹 Cleaning up chunk files...');
        
        for (const file of chunkFiles) {
            try {
                await fs.unlink(file);
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        
        // Clear temp directory
        try {
            await fs.rm(this.tempDir, { recursive: true, force: true });
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            // Ignore errors
        }
    }

    /**
     * Get encoding state
     */
    getEncodingState() {
        return {
            ...this.encodingState,
            memory: this.memoryManager.getMemoryStats().formatted
        };
    }

    /**
     * Cleanup
     */
    async cleanup() {
        await fs.rm(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Video encoder cleaned up');
    }
}

export default VideoEncoder;

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const encoder = new VideoEncoder({
        fps: 24,
        crf: 15,
        preset: 'medium',
        maxChunkFrames: 500
    });
    
    await encoder.initialize();
    
    // Test with sample generation
    console.log('\n🧪 Testing video encoder...\n');
    
    // Simulate having frames
    const totalFrames = 1000;
    
    try {
        // Generate chunked video
        const result = await encoder.generateChunkedVideo(
            totalFrames,
            'test_chunked_video'
        );
        
        console.log('\n📊 Results:');
        console.log(result);
        
        // Get state
        console.log('\n📈 Encoding State:');
        console.log(encoder.getEncodingState());
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
    
    await encoder.cleanup();
}