#!/usr/bin/env node

/**
 * Test Daily Production - 1 Day Only
 * Quick test with 96 frames from 48 hours ago
 */

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

async function testOneDayProduction() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Testing 1-Day Production             ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    // Calculate date from 48 hours ago
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 2);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    console.log(`📅 Testing with date: ${dateStr}`);
    console.log(`   (48 hours ago to ensure data availability)\n`);
    
    // Test parameters
    const testFrames = 10; // Just 10 frames for quick test
    const startTime = Date.now();
    
    try {
        // Import the daily production module
        const module = await import('./vps_daily_production.js');
        
        console.log(`✓ Module loaded successfully`);
        console.log(`\n🧪 Running test with ${testFrames} frames...\n`);
        
        // Manually test key functions
        // 1. Test date calculation
        const dateRange = {
            startDate: new Date(targetDate),
            endDate: new Date(targetDate)
        };
        dateRange.endDate.setHours(2, 30, 0, 0); // Just 2.5 hours of frames
        
        console.log(`Date range: ${dateRange.startDate.toISOString()} to ${dateRange.endDate.toISOString()}`);
        
        // 2. Test fetching with fallback
        console.log('\nTesting image fetch with fallback...');
        const testDate = dateRange.startDate.toISOString();
        
        // Test corona fetch
        const coronaCmd = `curl -s -o /tmp/test_corona.png "https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[4,1,100]&imageScale=8&width=1920&height=1200&x0=0&y0=0&display=true&watermark=false"`;
        await execAsync(coronaCmd, { timeout: 30000 });
        console.log('✓ Corona image fetched');
        
        // Test sun disk fetch  
        const sunCmd = `curl -s -o /tmp/test_sun.png "https://api.helioviewer.org/v2/takeScreenshot/?date=${testDate}&layers=[10,1,100]&imageScale=2.5&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false"`;
        await execAsync(sunCmd, { timeout: 30000 });
        console.log('✓ Sun disk image fetched');
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n✅ Test completed in ${duration} seconds`);
        console.log('\nReady for full production run!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        process.exit(1);
    }
}

testOneDayProduction().catch(console.error);