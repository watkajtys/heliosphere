#!/usr/bin/env node

/**
 * Test Cloudflare Worker performance vs direct Helioviewer API access
 */

const TEST_RUNS = 3; // Number of test runs per endpoint

// Test parameters for Helioviewer API
const TEST_PARAMS = {
    date: '2025-06-17T12:00:00Z',
    layers: '[10,1,100]',  // SDO/AIA layer
    imageScale: '2.5',
    width: '1920',
    height: '1920',
    x0: '0',
    y0: '0',
    display: 'true',
    watermark: 'false'
};

// Build the Helioviewer API URL
function buildHelioviewerUrl() {
    const url = new URL('https://api.helioviewer.org/v2/takeScreenshot/');
    Object.entries(TEST_PARAMS).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    return url.toString();
}

// Test direct API access
async function testDirect() {
    const url = buildHelioviewerUrl();
    const times = [];
    
    console.log('\n📡 Testing DIRECT Helioviewer API access...');
    console.log(`   URL: ${url.substring(0, 80)}...`);
    
    for (let i = 0; i < TEST_RUNS; i++) {
        const start = Date.now();
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const elapsed = Date.now() - start;
            times.push(elapsed);
            console.log(`   Run ${i + 1}: ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error(`   Run ${i + 1}: FAILED - ${error.message}`);
        }
    }
    
    if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`   ✅ Average: ${avg.toFixed(0)}ms`);
        return avg;
    }
    return null;
}

// Test via local Cloudflare Worker
async function testLocalWorker() {
    const helioviewerUrl = buildHelioviewerUrl();
    const workerUrl = `http://localhost:8787/?url=${encodeURIComponent(helioviewerUrl)}`;
    const times = [];
    
    console.log('\n☁️  Testing via LOCAL Cloudflare Worker...');
    console.log(`   Worker: http://localhost:8787`);
    
    for (let i = 0; i < TEST_RUNS; i++) {
        const start = Date.now();
        try {
            const response = await fetch(workerUrl);
            const buffer = await response.arrayBuffer();
            const elapsed = Date.now() - start;
            times.push(elapsed);
            console.log(`   Run ${i + 1}: ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error(`   Run ${i + 1}: FAILED - ${error.message}`);
        }
    }
    
    if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`   ✅ Average: ${avg.toFixed(0)}ms`);
        return avg;
    }
    return null;
}

// Test via deployed Cloudflare Worker (if URL provided)
async function testDeployedWorker(workerUrl) {
    const helioviewerUrl = buildHelioviewerUrl();
    const url = `${workerUrl}?url=${encodeURIComponent(helioviewerUrl)}`;
    const times = [];
    
    console.log('\n🌍 Testing via DEPLOYED Cloudflare Worker...');
    console.log(`   Worker: ${workerUrl}`);
    
    for (let i = 0; i < TEST_RUNS; i++) {
        const start = Date.now();
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const elapsed = Date.now() - start;
            times.push(elapsed);
            console.log(`   Run ${i + 1}: ${elapsed}ms (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error(`   Run ${i + 1}: FAILED - ${error.message}`);
        }
    }
    
    if (times.length > 0) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        console.log(`   ✅ Average: ${avg.toFixed(0)}ms`);
        return avg;
    }
    return null;
}

// Main test runner
async function runTests() {
    console.log('═══════════════════════════════════════════════════');
    console.log(' Cloudflare Worker Performance Test for Helioviewer');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Test configuration: ${TEST_RUNS} runs per endpoint`);
    console.log(`Image parameters: ${TEST_PARAMS.width}x${TEST_PARAMS.height}, scale ${TEST_PARAMS.imageScale}`);
    
    const results = {};
    
    // Test direct access
    results.direct = await testDirect();
    
    // Test local worker
    results.localWorker = await testLocalWorker();
    
    // Test deployed worker if URL is provided
    const deployedUrl = process.argv[2];
    if (deployedUrl) {
        results.deployedWorker = await testDeployedWorker(deployedUrl);
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════');
    console.log(' SUMMARY');
    console.log('═══════════════════════════════════════════════════');
    
    if (results.direct) {
        console.log(`Direct API:        ${results.direct.toFixed(0)}ms (baseline)`);
    }
    
    if (results.localWorker && results.direct) {
        const overhead = ((results.localWorker / results.direct - 1) * 100).toFixed(0);
        console.log(`Local Worker:      ${results.localWorker.toFixed(0)}ms (${overhead > 0 ? '+' : ''}${overhead}% overhead)`);
    } else if (results.localWorker) {
        console.log(`Local Worker:      ${results.localWorker.toFixed(0)}ms`);
    }
    
    if (results.deployedWorker && results.direct) {
        const overhead = ((results.deployedWorker / results.direct - 1) * 100).toFixed(0);
        const improvement = results.direct / results.deployedWorker;
        console.log(`Deployed Worker:   ${results.deployedWorker.toFixed(0)}ms (${overhead > 0 ? '+' : ''}${overhead}% overhead, ${improvement.toFixed(1)}x speed)`);
    } else if (results.deployedWorker) {
        console.log(`Deployed Worker:   ${results.deployedWorker.toFixed(0)}ms`);
    }
    
    console.log('\nNote: When running from Cloud Run, direct API typically takes ~135,000ms');
    
    if (results.localWorker && results.localWorker < 5000) {
        console.log('\n✅ Local worker test successful! Ready to deploy to Cloudflare.');
        console.log('   Run: npx wrangler deploy cloudflare_worker.js');
    }
}

// Run the tests
runTests().catch(console.error);