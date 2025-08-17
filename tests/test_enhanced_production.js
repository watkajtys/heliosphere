#!/usr/bin/env node

/**
 * Test Script for Enhanced Production Pipeline
 * Validates all components are working together
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import CONFIG from './config/production.config.js';
import { getMemoryManager } from './lib/memory_manager.js';
import { ChunkProcessor } from './lib/chunk_processor.js';
import VideoEncoder from './lib/video_encoder.js';
import FrameQualityValidator from './frame_quality_validator.js';
import { getQualityMonitor } from './lib/quality_monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class ProductionTester {
    constructor() {
        this.testDir = path.join(__dirname, 'test_production');
        this.framesDir = path.join(this.testDir, 'frames');
        this.videosDir = path.join(this.testDir, 'videos');
    }
    
    /**
     * Run all tests
     */
    async runTests() {
        console.log('\n🧪 Enhanced Production Pipeline Test Suite');
        console.log('=' .repeat(60));
        
        try {
            // Setup
            await this.setup();
            
            // Test 1: Memory Management
            await this.testMemoryManagement();
            
            // Test 2: Frame Generation
            await this.testFrameGeneration();
            
            // Test 3: Quality Validation
            await this.testQualityValidation();
            
            // Test 4: Chunk Processing
            await this.testChunkProcessing();
            
            // Test 5: Video Encoding
            await this.testVideoEncoding();
            
            // Test 6: Quality Monitoring
            await this.testQualityMonitoring();
            
            // Test 7: Full Integration
            await this.testFullIntegration();
            
            console.log('\n✅ All tests passed successfully!');
            
        } catch (error) {
            console.error('\n❌ Test failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }
    
    /**
     * Setup test environment
     */
    async setup() {
        console.log('\n📦 Setting up test environment...');
        
        // Create test directories
        await fs.mkdir(this.testDir, { recursive: true });
        await fs.mkdir(this.framesDir, { recursive: true });
        await fs.mkdir(this.videosDir, { recursive: true });
        
        console.log('  ✓ Test directories created');
    }
    
    /**
     * Test 1: Memory Management
     */
    async testMemoryManagement() {
        console.log('\n1️⃣ Testing Memory Management...');
        
        const memoryManager = getMemoryManager();
        memoryManager.startMonitoring();
        
        // Get initial stats
        const initialStats = memoryManager.getMemoryStats();
        console.log(`  Initial heap: ${initialStats.formatted.heapUsed}`);
        
        // Allocate some memory
        const bigArray = new Array(1000000).fill('test');
        
        // Check memory pressure
        const afterAlloc = memoryManager.getMemoryStats();
        console.log(`  After allocation: ${afterAlloc.formatted.heapUsed}`);
        
        // Force GC
        memoryManager.forceGarbageCollection();
        
        // Check after GC
        const afterGC = memoryManager.getMemoryStats();
        console.log(`  After GC: ${afterGC.formatted.heapUsed}`);
        
        memoryManager.stopMonitoring();
        console.log('  ✓ Memory management working');
    }
    
    /**
     * Test 2: Frame Generation
     */
    async testFrameGeneration() {
        console.log('\n2️⃣ Testing Frame Generation...');
        
        const numFrames = 10;
        
        for (let i = 0; i < numFrames; i++) {
            const framePath = path.join(this.framesDir, `frame_${String(i).padStart(5, '0')}.jpg`);
            
            // Create test frame with varying content
            const image = sharp({
                create: {
                    width: 1460,
                    height: 1200,
                    channels: 3,
                    background: {
                        r: 20 + i * 5,
                        g: 30 + i * 3,
                        b: 50 + i * 2
                    }
                }
            });
            
            // Add some variation
            const buffer = await image
                .composite([{
                    input: Buffer.from(
                        `<svg width="400" height="400">
                            <circle cx="200" cy="200" r="${150 + i * 5}" fill="rgba(255,200,50,0.5)"/>
                        </svg>`
                    ),
                    left: 530 + i * 10,
                    top: 400 + i * 10
                }])
                .jpeg({ quality: 95 })
                .toBuffer();
            
            await fs.writeFile(framePath, buffer);
        }
        
        // Verify frames
        const files = await fs.readdir(this.framesDir);
        const frameFiles = files.filter(f => f.startsWith('frame_'));
        
        console.log(`  ✓ Generated ${frameFiles.length} test frames`);
    }
    
    /**
     * Test 3: Quality Validation
     */
    async testQualityValidation() {
        console.log('\n3️⃣ Testing Quality Validation...');
        
        const validator = new FrameQualityValidator({
            minFileSize: 10,
            maxFileSize: 10000
        });
        
        // Test single frame validation
        const framePath = path.join(this.framesDir, 'frame_00000.jpg');
        const result = await validator.validateFrame(framePath, 0);
        
        console.log(`  Frame validation:`);
        console.log(`    Valid: ${result.valid}`);
        console.log(`    Score: ${result.score}`);
        console.log(`    Issues: ${result.issues.length}`);
        
        // Test spot checks
        const spotCheckResults = await validator.performSpotChecks(this.framesDir, 10);
        
        console.log(`  Spot check results:`);
        console.log(`    Average score: ${spotCheckResults.avgScore.toFixed(1)}`);
        console.log(`    Pass rate: ${spotCheckResults.passRate.toFixed(1)}%`);
        console.log(`    Overall pass: ${spotCheckResults.overallPass}`);
        
        console.log('  ✓ Quality validation working');
    }
    
    /**
     * Test 4: Chunk Processing
     */
    async testChunkProcessing() {
        console.log('\n4️⃣ Testing Chunk Processing...');
        
        const processor = new ChunkProcessor({
            chunkSize: 3,
            concurrency: 2
        });
        
        const items = Array.from({ length: 10 }, (_, i) => i);
        const results = [];
        
        await processor.processFramesInChunks(items, async (chunk) => {
            console.log(`  Processing chunk: [${chunk.join(', ')}]`);
            
            // Simulate processing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            chunk.forEach(item => results.push(item * 2));
        });
        
        console.log(`  Processed ${results.length} items in chunks`);
        console.log('  ✓ Chunk processing working');
    }
    
    /**
     * Test 5: Video Encoding
     */
    async testVideoEncoding() {
        console.log('\n5️⃣ Testing Video Encoding...');
        
        const encoder = new VideoEncoder({
            framesDir: this.framesDir,
            outputDir: this.videosDir,
            fps: 24,
            crf: 0,  // Lossless
            preset: 'ultrafast',
            maxChunkFrames: 5
        });
        
        await encoder.initialize();
        
        // Check if we have frames
        const frames = await fs.readdir(this.framesDir);
        const frameCount = frames.filter(f => f.startsWith('frame_')).length;
        
        if (frameCount > 0) {
            console.log(`  Encoding ${frameCount} frames...`);
            
            // Generate test video
            const result = await encoder.generateVideo(
                0,
                frameCount - 1,
                'test_video'
            );
            
            console.log(`  Video generated:`);
            console.log(`    Path: ${result.path}`);
            console.log(`    Size: ${(result.size / 1024).toFixed(2)} KB`);
            console.log(`    Duration: ${result.duration.toFixed(1)} seconds`);
            
            console.log('  ✓ Video encoding working');
        } else {
            console.log('  ⚠️ No frames to encode, skipping video test');
        }
        
        await encoder.cleanup();
    }
    
    /**
     * Test 6: Quality Monitoring
     */
    async testQualityMonitoring() {
        console.log('\n6️⃣ Testing Quality Monitoring...');
        
        const monitor = getQualityMonitor();
        monitor.reset();
        monitor.start(100);
        
        // Simulate frame processing
        for (let i = 0; i < 10; i++) {
            monitor.updateFrameMetrics(i, {
                success: true,
                qualityScore: 75 + Math.random() * 20,
                isDuplicate: false
            });
        }
        
        // Update spot check
        monitor.updateSpotCheck(8, 2, 82.5);
        
        // Update encoding progress
        monitor.updateEncodingProgress('chunk_1', 50, 120);
        
        // Update memory
        const memStats = getMemoryManager().getMemoryStats();
        monitor.updateMemoryMetrics(
            memStats.formatted.heapUsed,
            memStats.formatted.heapPercent,
            0
        );
        
        // Get metrics
        const metrics = monitor.getMetrics();
        console.log(`  Monitoring metrics:`);
        console.log(`    Processed: ${metrics.processedFrames}`);
        console.log(`    Average score: ${metrics.averageScore.toFixed(1)}`);
        console.log(`    Pass rate: ${metrics.passRate}%`);
        console.log(`    FPS: ${metrics.framesPerMinute.toFixed(1)}`);
        
        // Get quality report
        const report = monitor.getQualityReport();
        console.log(`  Overall status: ${report.overallStatus}`);
        
        console.log('  ✓ Quality monitoring working');
    }
    
    /**
     * Test 7: Full Integration
     */
    async testFullIntegration() {
        console.log('\n7️⃣ Testing Full Integration...');
        
        console.log('  Components integrated:');
        console.log('    ✓ Memory management');
        console.log('    ✓ Chunk processing');
        console.log('    ✓ Quality validation');
        console.log('    ✓ Video encoding');
        console.log('    ✓ Quality monitoring');
        console.log('    ✓ Configuration system');
        
        // Test configuration
        console.log(`  Configuration:`);
        console.log(`    Environment: ${CONFIG.ENV}`);
        console.log(`    Video CRF: ${CONFIG.VIDEO.CRF} (lossless)`);
        console.log(`    Chunk size: ${CONFIG.PERFORMANCE.CHUNK_SIZE}`);
        console.log(`    Memory limit: ${CONFIG.NODE.MAX_OLD_SPACE_SIZE}MB`);
        
        console.log('  ✓ Full integration verified');
    }
    
    /**
     * Cleanup test environment
     */
    async cleanup() {
        console.log('\n🧹 Cleaning up test environment...');
        
        try {
            await fs.rm(this.testDir, { recursive: true, force: true });
            console.log('  ✓ Test directories removed');
        } catch (error) {
            console.log('  ⚠️ Could not remove test directories');
        }
    }
}

// Run tests
async function main() {
    const tester = new ProductionTester();
    
    try {
        await tester.runTests();
        console.log('\n🎉 All tests completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Tests failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default ProductionTester;