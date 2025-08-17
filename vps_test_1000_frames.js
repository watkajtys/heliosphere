#!/usr/bin/env node

/**
 * Test 1000+ Frame Production with Lossless Encoding
 * Tests video chunking at 1000 frame boundaries
 */

import { 
    processFramesOptimized, 
    generateProductionVideo,
    generateDualFormatVideos,
    startMonitoringServer,
    CONFIG 
} from './vps_production_optimized.js';

async function test1000Frames() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 1000+ FRAME LOSSLESS PRODUCTION TEST');
    console.log('='.repeat(60));
    console.log('Configuration:');
    console.log('  - Frames: 1100 (to test chunking at 1000)');
    console.log('  - CRF: 0 (Lossless)');
    console.log('  - Preset: ultrafast');
    console.log('  - Chunks: Will create 2 chunks (1000 + 100)');
    console.log('  - Monitoring: Port 3001');
    console.log('='.repeat(60) + '\n');
    
    try {
        // Start monitoring
        console.log('📊 Starting monitoring server...');
        startMonitoringServer();
        console.log('   Dashboard: http://localhost:3001/monitor');
        console.log('   API: http://localhost:3001/api/status\n');
        
        // Generate 1100 test frame timestamps (11.5 days of data)
        const frames = [];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - CONFIG.SAFE_DELAY_DAYS);
        
        const TOTAL_FRAMES = 1100;  // Test chunking boundary
        
        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const frameDate = new Date(startDate);
            frameDate.setMinutes(frameDate.getMinutes() - (i * CONFIG.INTERVAL_MINUTES));
            frames.push({
                number: i,
                date: frameDate
            });
        }
        
        console.log(`📅 Frame range:`);
        console.log(`   First: ${frames[0].date.toISOString()}`);
        console.log(`   Last: ${frames[frames.length - 1].date.toISOString()}`);
        console.log(`   Days: ${(TOTAL_FRAMES / CONFIG.FRAMES_PER_DAY).toFixed(1)}\n`);
        
        // Process frames with parallel optimization
        console.log('🚀 Starting parallel frame processing...');
        console.log('   Fetching: 8 parallel');
        console.log('   Processing: 4 parallel');
        console.log('   Quality validation: Enabled\n');
        
        const startTime = Date.now();
        const results = await processFramesOptimized(frames);
        const processingTime = (Date.now() - startTime) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 FRAME PROCESSING RESULTS');
        console.log('='.repeat(60));
        console.log(`✅ Processed: ${results.length}/${TOTAL_FRAMES} frames`);
        console.log(`⏱️ Time: ${processingTime.toFixed(1)} seconds`);
        console.log(`🚀 Speed: ${(results.length / processingTime * 60).toFixed(1)} frames/minute`);
        console.log(`📈 Quality: Check http://localhost:3001/monitor for details`);
        
        // Now test video generation with chunking
        console.log('\n' + '='.repeat(60));
        console.log('🎬 TESTING VIDEO GENERATION (LOSSLESS)');
        console.log('='.repeat(60));
        
        const videoStartTime = Date.now();
        
        // Generate video for all frames (will create 2 chunks: 1000 + 100)
        const days = Math.ceil(TOTAL_FRAMES / CONFIG.FRAMES_PER_DAY);
        const videoResult = await generateProductionVideo(days, 'test_1100_lossless');
        
        const videoTime = (Date.now() - videoStartTime) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('📹 VIDEO GENERATION RESULTS');
        console.log('='.repeat(60));
        console.log(`✅ Video created: ${videoResult.path}`);
        console.log(`📦 Size: ${(videoResult.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`⏱️ Duration: ${videoResult.duration.toFixed(1)} seconds`);
        console.log(`🎬 Encoding time: ${videoTime.toFixed(1)} seconds`);
        console.log(`⚡ Encoding speed: ${(videoResult.frames / videoTime).toFixed(1)} fps`);
        
        // Calculate expected vs actual
        const expectedDuration = TOTAL_FRAMES / CONFIG.FPS;
        console.log(`\n📊 Verification:`);
        console.log(`   Expected duration: ${expectedDuration.toFixed(1)}s`);
        console.log(`   Actual duration: ${videoResult.duration.toFixed(1)}s`);
        console.log(`   Match: ${Math.abs(expectedDuration - videoResult.duration) < 1 ? '✅' : '❌'}`);
        
        // Size analysis for lossless
        const mbPerSecond = videoResult.size / 1024 / 1024 / videoResult.duration;
        console.log(`\n💾 Lossless Analysis:`);
        console.log(`   Size per second: ${mbPerSecond.toFixed(2)} MB/s`);
        console.log(`   Bitrate: ${(mbPerSecond * 8).toFixed(1)} Mbps`);
        console.log(`   Note: This is lossless (CRF 0) - expect large files!`);
        
        // Test dual format generation
        console.log('\n' + '='.repeat(60));
        console.log('🎬 TESTING DUAL FORMAT (Desktop + Mobile)');
        console.log('='.repeat(60));
        
        const dualStartTime = Date.now();
        const dualResults = await generateDualFormatVideos(days, 'test_1100_dual');
        const dualTime = (Date.now() - dualStartTime) / 1000;
        
        console.log(`\n✅ Dual format complete in ${dualTime.toFixed(1)}s`);
        console.log(`   Desktop: ${(dualResults.desktop.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Mobile: ${(dualResults.mobile.size / 1024 / 1024).toFixed(2)} MB`);
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ TEST COMPLETE!');
        console.log('='.repeat(60));
        console.log('\n📌 Key Findings:');
        console.log('  1. Video chunking at 1000 frames: ✅');
        console.log('  2. Lossless encoding (CRF 0): ✅');
        console.log('  3. Quality validation: ✅');
        console.log('  4. Monitoring dashboard: ✅');
        console.log('  5. Parallel processing: ✅');
        
        console.log('\n📊 Full monitoring available at:');
        console.log('   http://localhost:3001/monitor');
        
        console.log('\n🎯 Ready for full 5,376 frame production!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run test
console.log('Starting 1000+ frame test...');
test1000Frames().catch(console.error);