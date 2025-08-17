#!/usr/bin/env node

/**
 * Run Full Production - 56 Days (5,376 frames) with Lossless Encoding
 */

import { 
    processFramesOptimized, 
    generateProductionVideo,
    generateDualFormatVideos,
    startMonitoringServer,
    CONFIG 
} from './vps_production_optimized.js';

async function runFullProduction() {
    console.log('\n' + '='.repeat(60));
    console.log('🌞 HELIOSPHERE FULL PRODUCTION');
    console.log('='.repeat(60));
    console.log('Configuration:');
    console.log(`  - Days: ${CONFIG.TOTAL_DAYS} (${CONFIG.TOTAL_DAYS * CONFIG.FRAMES_PER_DAY} frames)`);
    console.log('  - Encoding: Lossless (CRF 0)');
    console.log('  - Processing: 8 parallel fetches, 4 parallel processing');
    console.log('  - Video chunks: Every 1000 frames');
    console.log('  - Expected time: ~3.5 hours');
    console.log('='.repeat(60) + '\n');
    
    try {
        // Start monitoring
        console.log('📊 Starting monitoring server...');
        startMonitoringServer();
        console.log('   Dashboard: http://65.109.0.112:3001/monitor');
        console.log('   API: http://65.109.0.112:3001/api/status\n');
        
        // Generate all frame timestamps for 56 days
        const frames = [];
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - CONFIG.SAFE_DELAY_DAYS); // 48-hour delay
        
        const TOTAL_FRAMES = CONFIG.TOTAL_DAYS * CONFIG.FRAMES_PER_DAY; // 5,376 frames
        
        for (let i = 0; i < TOTAL_FRAMES; i++) {
            const frameDate = new Date(endDate);
            frameDate.setMinutes(frameDate.getMinutes() - (i * CONFIG.INTERVAL_MINUTES));
            frames.push({
                number: i,
                date: frameDate
            });
        }
        
        console.log(`📅 Production Range:`);
        console.log(`   Start: ${frames[frames.length - 1].date.toISOString()}`);
        console.log(`   End: ${frames[0].date.toISOString()}`);
        console.log(`   Total: ${TOTAL_FRAMES} frames (${CONFIG.TOTAL_DAYS} days)\n`);
        
        // Process all frames
        console.log('🚀 Starting parallel frame processing...');
        console.log('   This will take approximately 3.5 hours\n');
        
        const startTime = Date.now();
        const results = await processFramesOptimized(frames);
        const processingTime = (Date.now() - startTime) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ FRAME PROCESSING COMPLETE');
        console.log('='.repeat(60));
        console.log(`Processed: ${results.length}/${TOTAL_FRAMES} frames`);
        console.log(`Time: ${(processingTime / 60).toFixed(1)} minutes`);
        console.log(`Speed: ${(results.length / processingTime * 60).toFixed(1)} frames/minute`);
        
        // Generate full production video (56 days)
        console.log('\n🎬 Generating full production video (56 days)...');
        const fullVideo = await generateProductionVideo(CONFIG.TOTAL_DAYS, 'heliosphere_full_56days');
        
        console.log(`✅ Full video: ${fullVideo.path}`);
        console.log(`   Size: ${(fullVideo.size / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   Duration: ${(fullVideo.duration / 60).toFixed(1)} minutes`);
        
        // Generate social video (14 days for 60 seconds)
        console.log('\n🎬 Generating social video (14 days, 60 seconds)...');
        const socialDays = 14; // 14 days = ~56 seconds at 24fps
        const socialVideo = await generateProductionVideo(socialDays, 'heliosphere_social_60s');
        
        console.log(`✅ Social video: ${socialVideo.path}`);
        console.log(`   Size: ${(socialVideo.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   Duration: ${socialVideo.duration.toFixed(1)} seconds`);
        
        // Generate dual format videos
        console.log('\n🎬 Generating dual format videos (desktop + mobile)...');
        const dualResults = await generateDualFormatVideos(CONFIG.TOTAL_DAYS, 'heliosphere_production');
        
        console.log(`✅ Desktop: ${(dualResults.desktop.size / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`✅ Mobile: ${(dualResults.mobile.size / 1024 / 1024 / 1024).toFixed(2)} GB`);
        
        const totalTime = (Date.now() - startTime) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 PRODUCTION COMPLETE!');
        console.log('='.repeat(60));
        console.log(`Total time: ${(totalTime / 3600).toFixed(1)} hours`);
        console.log(`\nVideos generated:`);
        console.log(`  1. heliosphere_full_56days.mp4 (${(fullVideo.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        console.log(`  2. heliosphere_social_60s.mp4 (${(socialVideo.size / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`  3. heliosphere_production_desktop.mp4 (${(dualResults.desktop.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        console.log(`  4. heliosphere_production_mobile.mp4 (${(dualResults.mobile.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        
        console.log('\n📊 Quality report available at:');
        console.log('   http://65.109.0.112:3001/monitor');
        
        console.log('\n🚀 Ready for Cloudflare Stream upload!');
        
    } catch (error) {
        console.error('\n❌ Production failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run production
console.log('Starting Heliosphere Full Production...');
runFullProduction().catch(console.error);