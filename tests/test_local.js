#!/usr/bin/env node

/**
 * Local test script for Heliosphere Cloud Run server
 * Tests connection to Google Cloud Storage before deployment
 */

import { Storage } from '@google-cloud/storage';

async function testCloudStorage() {
    console.log('🧪 Testing Google Cloud Storage Connection...\n');
    
    try {
        const storage = new Storage({
            projectId: 'heliosphere-solar'
        });
        
        // Test listing buckets
        console.log('📦 Listing buckets in heliosphere-solar:');
        const [buckets] = await storage.getBuckets();
        buckets.forEach(bucket => {
            console.log(`   • ${bucket.name}`);
        });
        
        // Test writing to manifest bucket
        console.log('\n📝 Testing write to manifest bucket...');
        const testData = {
            test: true,
            timestamp: new Date().toISOString(),
            message: 'Local test successful'
        };
        
        const manifestBucket = storage.bucket('heliosphere-manifests');
        const testFile = manifestBucket.file('test-local.json');
        
        await testFile.save(JSON.stringify(testData, null, 2), {
            metadata: {
                contentType: 'application/json',
                cacheControl: 'no-cache'
            }
        });
        console.log('   ✅ Write successful');
        
        // Test reading back
        console.log('\n📖 Testing read from manifest bucket...');
        const [contents] = await testFile.download();
        const readData = JSON.parse(contents.toString());
        console.log('   ✅ Read successful:', readData);
        
        // Clean up test file
        await testFile.delete();
        console.log('   🧹 Test file cleaned up');
        
        console.log('\n✅ All Cloud Storage tests passed!');
        console.log('\n📋 Next steps:');
        console.log('   1. Set NASA_API_KEY environment variable');
        console.log('   2. Run: NASA_API_KEY=your_key node cloud_server.js');
        console.log('   3. Open: http://localhost:8080/monitor');
        console.log('   4. Click "Test (10 frames)" to test generation');
        
    } catch (error) {
        console.error('\n❌ Cloud Storage test failed:', error.message);
        console.error('\n📋 Troubleshooting:');
        console.error('   1. Make sure you are authenticated:');
        console.error('      gcloud auth application-default login');
        console.error('   2. Verify project is set correctly:');
        console.error('      gcloud config set project heliosphere-solar');
        console.error('   3. Check that APIs are enabled:');
        console.error('      gcloud services list --enabled');
    }
}

// Run test
testCloudStorage().catch(console.error);