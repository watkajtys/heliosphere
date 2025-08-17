#!/usr/bin/env node

/**
 * Chunked Frame Processor for Large Video Generation
 * Processes frames in manageable chunks to avoid memory issues
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getMemoryManager } from './memory_manager.js';

class ChunkProcessor {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 500;  // Frames per chunk
        this.framesDir = options.framesDir || '/opt/heliosphere/frames';
        this.tempDir = options.tempDir || '/tmp/heliosphere_chunks';
        this.stateFile = options.stateFile || '/opt/heliosphere/chunk_state.json';
        
        this.memoryManager = getMemoryManager();
        this.state = {
            totalFrames: 0,
            processedChunks: [],
            currentChunk: null,
            checksums: new Map(),
            startTime: null,
            errors: []
        };
    }

    /**
     * Initialize chunk processor
     */
    async initialize() {
        // Create directories
        await fs.mkdir(this.tempDir, { recursive: true });
        await fs.mkdir(this.framesDir, { recursive: true });
        
        // Load existing state if available
        await this.loadState();
        
        // Start memory monitoring
        this.memoryManager.startMonitoring();
        
        console.log('📦 Chunk processor initialized');
        console.log(`   Chunk size: ${this.chunkSize} frames`);
        console.log(`   Frames dir: ${this.framesDir}`);
    }

    /**
     * Split frames into chunks
     */
    createChunks(totalFrames) {
        const chunks = [];
        const numChunks = Math.ceil(totalFrames / this.chunkSize);
        
        for (let i = 0; i < numChunks; i++) {
            const start = i * this.chunkSize;
            const end = Math.min(start + this.chunkSize, totalFrames);
            
            chunks.push({
                id: i,
                start,
                end,
                size: end - start,
                status: 'pending',
                attempts: 0,
                errors: []
            });
        }
        
        console.log(`📊 Created ${chunks.length} chunks for ${totalFrames} frames`);
        return chunks;
    }

    /**
     * Process frames in chunks
     */
    async processFramesInChunks(frames, processFunction) {
        this.state.totalFrames = frames.length;
        this.state.startTime = Date.now();
        
        const chunks = this.createChunks(frames.length);
        const results = [];
        
        console.log(`\n🎬 Processing ${frames.length} frames in ${chunks.length} chunks\n`);
        
        for (const chunk of chunks) {
            // Check if chunk was already processed
            if (this.isChunkProcessed(chunk.id)) {
                console.log(`✓ Chunk ${chunk.id} already processed, skipping...`);
                results.push(...this.getChunkResults(chunk.id));
                continue;
            }
            
            // Wait for memory if needed
            const estimatedMemoryMB = chunk.size * 2; // ~2MB per frame
            await this.memoryManager.waitForMemory(estimatedMemoryMB);
            
            // Process chunk
            try {
                console.log(`\n📦 Processing chunk ${chunk.id + 1}/${chunks.length}`);
                console.log(`   Frames: ${chunk.start}-${chunk.end} (${chunk.size} frames)`);
                
                this.state.currentChunk = chunk.id;
                const chunkFrames = frames.slice(chunk.start, chunk.end);
                const chunkResults = await this.processChunk(chunkFrames, processFunction, chunk);
                
                results.push(...chunkResults);
                
                // Mark chunk as completed
                chunk.status = 'completed';
                this.state.processedChunks.push({
                    id: chunk.id,
                    start: chunk.start,
                    end: chunk.end,
                    results: chunkResults.length,
                    timestamp: Date.now()
                });
                
                // Save state after each chunk
                await this.saveState();
                
                // Memory cleanup
                await this.cleanupChunk(chunk);
                
                // Progress report
                this.reportProgress(chunk.id + 1, chunks.length);
                
            } catch (error) {
                console.error(`❌ Chunk ${chunk.id} failed:`, error.message);
                chunk.status = 'failed';
                chunk.errors.push(error.message);
                chunk.attempts++;
                
                // Retry logic
                if (chunk.attempts < 3) {
                    console.log(`🔄 Retrying chunk ${chunk.id} (attempt ${chunk.attempts}/3)...`);
                    chunks.push(chunk); // Re-add to queue
                } else {
                    this.state.errors.push({
                        chunk: chunk.id,
                        error: error.message,
                        frames: `${chunk.start}-${chunk.end}`
                    });
                }
            }
        }
        
        // Final cleanup
        this.state.currentChunk = null;
        await this.saveState();
        
        console.log(`\n✅ Chunk processing complete!`);
        console.log(`   Total frames: ${results.length}/${frames.length}`);
        console.log(`   Time: ${this.getElapsedTime()}`);
        
        return results;
    }

    /**
     * Process a single chunk
     */
    async processChunk(frames, processFunction, chunkInfo) {
        const results = [];
        const batchSize = 10; // Process 10 frames at a time within chunk
        
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, Math.min(i + batchSize, frames.length));
            
            // Process batch in parallel
            const batchPromises = batch.map(async (frame, index) => {
                try {
                    const globalIndex = chunkInfo.start + i + index;
                    const result = await processFunction(frame, globalIndex);
                    
                    // Calculate checksum if buffer returned
                    if (result.buffer) {
                        const checksum = this.calculateChecksum(result.buffer);
                        this.state.checksums.set(globalIndex, checksum);
                    }
                    
                    return result;
                } catch (error) {
                    console.error(`  Frame ${chunkInfo.start + i + index} failed:`, error.message);
                    return { error: error.message, frameNumber: chunkInfo.start + i + index };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(r => !r.error));
            
            // Progress within chunk
            if ((i + batchSize) % 50 === 0 || i + batchSize >= frames.length) {
                const chunkProgress = ((i + batchSize) / frames.length * 100).toFixed(1);
                console.log(`  Chunk ${chunkInfo.id}: ${chunkProgress}% (${i + batchSize}/${frames.length} frames)`);
            }
        }
        
        return results;
    }

    /**
     * Check for duplicate frames in chunk
     */
    detectDuplicates(chunk) {
        const duplicates = [];
        const checksums = new Map();
        
        for (let i = chunk.start; i < chunk.end; i++) {
            const checksum = this.state.checksums.get(i);
            if (checksum) {
                if (checksums.has(checksum)) {
                    duplicates.push({
                        frame: i,
                        duplicateOf: checksums.get(checksum)
                    });
                } else {
                    checksums.set(checksum, i);
                }
            }
        }
        
        if (duplicates.length > 0) {
            console.log(`⚠️ Found ${duplicates.length} duplicate frames in chunk ${chunk.id}`);
        }
        
        return duplicates;
    }

    /**
     * Clean up after chunk processing
     */
    async cleanupChunk(chunk) {
        // Clear chunk-specific temp files
        const chunkTempDir = path.join(this.tempDir, `chunk_${chunk.id}`);
        try {
            await fs.rm(chunkTempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
        
        // Force garbage collection
        this.memoryManager.forceGarbageCollection();
        
        // Clear old checksums to save memory (keep last 1000)
        if (this.state.checksums.size > 1000) {
            const keysToDelete = Array.from(this.state.checksums.keys())
                .filter(k => k < chunk.start - 1000);
            keysToDelete.forEach(k => this.state.checksums.delete(k));
        }
    }

    /**
     * Verify chunk integrity
     */
    async verifyChunk(chunkId, startFrame, endFrame) {
        const missing = [];
        const corrupt = [];
        
        for (let i = startFrame; i < endFrame; i++) {
            const framePath = path.join(this.framesDir, `frame_${String(i).padStart(5, '0')}.jpg`);
            
            try {
                const stats = await fs.stat(framePath);
                if (stats.size < 10000) { // Less than 10KB is suspicious
                    corrupt.push(i);
                }
            } catch (error) {
                missing.push(i);
            }
        }
        
        if (missing.length > 0 || corrupt.length > 0) {
            console.warn(`⚠️ Chunk ${chunkId} verification issues:`);
            if (missing.length > 0) console.warn(`   Missing: ${missing.length} frames`);
            if (corrupt.length > 0) console.warn(`   Corrupt: ${corrupt.length} frames`);
            return false;
        }
        
        return true;
    }

    /**
     * Merge chunk results
     */
    async mergeChunks(outputPath) {
        console.log('\n🔗 Merging chunks...');
        
        const chunks = this.state.processedChunks.sort((a, b) => a.start - b.start);
        
        // Verify all chunks are present
        let expectedStart = 0;
        for (const chunk of chunks) {
            if (chunk.start !== expectedStart) {
                throw new Error(`Missing frames ${expectedStart}-${chunk.start}`);
            }
            expectedStart = chunk.end;
        }
        
        console.log(`✅ All ${chunks.length} chunks verified and ready for encoding`);
        return true;
    }

    /**
     * Get chunk results
     */
    getChunkResults(chunkId) {
        const chunk = this.state.processedChunks.find(c => c.id === chunkId);
        return chunk ? chunk.results : [];
    }

    /**
     * Check if chunk was processed
     */
    isChunkProcessed(chunkId) {
        return this.state.processedChunks.some(c => c.id === chunkId);
    }

    /**
     * Report progress
     */
    reportProgress(current, total) {
        const elapsed = Date.now() - this.state.startTime;
        const rate = current / (elapsed / 1000 / 60); // chunks per minute
        const remaining = (total - current) / rate;
        
        console.log(`\n📊 Progress: ${current}/${total} chunks (${(current/total*100).toFixed(1)}%)`);
        console.log(`   Rate: ${rate.toFixed(2)} chunks/min`);
        console.log(`   ETA: ${remaining.toFixed(1)} minutes`);
        
        const memStats = this.memoryManager.getMemoryStats();
        console.log(`   Memory: ${memStats.formatted.heapUsagePercent} heap used`);
    }

    /**
     * Calculate checksum
     */
    calculateChecksum(buffer) {
        return crypto.createHash('md5').update(buffer).digest('hex');
    }

    /**
     * Get elapsed time
     */
    getElapsedTime() {
        const elapsed = Date.now() - this.state.startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        return `${minutes}m ${seconds}s`;
    }

    /**
     * Save state to disk
     */
    async saveState() {
        const stateToSave = {
            ...this.state,
            checksums: Array.from(this.state.checksums.entries()).slice(-1000), // Keep last 1000
            savedAt: new Date().toISOString()
        };
        
        await fs.writeFile(this.stateFile, JSON.stringify(stateToSave, null, 2));
    }

    /**
     * Load state from disk
     */
    async loadState() {
        try {
            const data = await fs.readFile(this.stateFile, 'utf8');
            const loaded = JSON.parse(data);
            
            // Restore state
            this.state.processedChunks = loaded.processedChunks || [];
            this.state.errors = loaded.errors || [];
            
            // Restore checksums
            if (loaded.checksums) {
                this.state.checksums = new Map(loaded.checksums);
            }
            
            console.log(`📂 Loaded state: ${this.state.processedChunks.length} chunks processed`);
            return true;
        } catch (error) {
            // No state file, starting fresh
            return false;
        }
    }

    /**
     * Reset state
     */
    async resetState() {
        this.state = {
            totalFrames: 0,
            processedChunks: [],
            currentChunk: null,
            checksums: new Map(),
            startTime: null,
            errors: []
        };
        
        try {
            await fs.unlink(this.stateFile);
        } catch (error) {
            // Ignore if file doesn't exist
        }
        
        console.log('🔄 State reset');
    }

    /**
     * Get processing statistics
     */
    getStatistics() {
        return {
            totalFrames: this.state.totalFrames,
            processedChunks: this.state.processedChunks.length,
            currentChunk: this.state.currentChunk,
            errors: this.state.errors.length,
            duplicates: this.countDuplicates(),
            elapsedTime: this.state.startTime ? this.getElapsedTime() : 'Not started',
            memoryReport: this.memoryManager.getReport()
        };
    }

    /**
     * Count duplicate frames
     */
    countDuplicates() {
        const seen = new Set();
        let duplicates = 0;
        
        for (const checksum of this.state.checksums.values()) {
            if (seen.has(checksum)) {
                duplicates++;
            } else {
                seen.add(checksum);
            }
        }
        
        return duplicates;
    }

    /**
     * Cleanup
     */
    async cleanup() {
        this.memoryManager.stopMonitoring();
        await fs.rm(this.tempDir, { recursive: true, force: true });
        console.log('🧹 Chunk processor cleaned up');
    }
}

export { ChunkProcessor };
export default ChunkProcessor;

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const processor = new ChunkProcessor({
        chunkSize: 100,
        framesDir: './test_frames'
    });
    
    await processor.initialize();
    
    // Create test frames
    const testFrames = Array.from({ length: 500 }, (_, i) => ({
        number: i,
        date: new Date(Date.now() + i * 15 * 60 * 1000)
    }));
    
    // Process function
    const processFrame = async (frame, index) => {
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        
        return {
            frameNumber: index,
            success: true,
            buffer: Buffer.from(`Frame ${index}`)
        };
    };
    
    // Process in chunks
    const results = await processor.processFramesInChunks(testFrames, processFrame);
    
    // Show statistics
    console.log('\n📈 Final Statistics:');
    console.log(processor.getStatistics());
    
    await processor.cleanup();
}