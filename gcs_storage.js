#!/usr/bin/env node

import { Storage } from '@google-cloud/storage';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

/**
 * Google Cloud Storage integration for Heliosphere
 */
class GCSStorage {
    constructor(config = {}) {
        this.projectId = config.projectId || 'heliosphere-solar';
        this.bucketNames = {
            frames: config.framesBucket || 'heliosphere-frames',
            videos: config.videosBucket || 'heliosphere-videos',
            manifests: config.manifestsBucket || 'heliosphere-manifests'
        };
        
        // Initialize Storage client
        this.storage = new Storage({
            projectId: this.projectId,
            keyFilename: config.keyFile // Optional: path to service account key
        });
        
        this.buckets = {};
    }
    
    /**
     * Initialize buckets (create if they don't exist)
     */
    async initialize() {
        console.log('🌐 Initializing Google Cloud Storage...');
        
        for (const [type, bucketName] of Object.entries(this.bucketNames)) {
            try {
                const [bucket] = await this.storage.bucket(bucketName).get();
                this.buckets[type] = bucket;
                console.log(`   ✅ Bucket ${bucketName} exists`);
            } catch (error) {
                if (error.code === 404) {
                    console.log(`   📦 Creating bucket ${bucketName}...`);
                    const [bucket] = await this.storage.createBucket(bucketName, {
                        location: 'US-CENTRAL1',
                        storageClass: 'STANDARD',
                        lifecycle: type === 'frames' ? {
                            rule: [{
                                action: { type: 'Delete' },
                                condition: { age: 60 } // Delete frames older than 60 days
                            }]
                        } : undefined
                    });
                    this.buckets[type] = bucket;
                    console.log(`   ✅ Created bucket ${bucketName}`);
                } else {
                    throw error;
                }
            }
        }
        
        return true;
    }
    
    /**
     * Upload a frame to Cloud Storage
     */
    async uploadFrame(frameNumber, framePath, metadata = {}) {
        const frameFile = this.buckets.frames.file(`frames/frame_${frameNumber.toString().padStart(4, '0')}.png`);
        
        try {
            // Read frame data
            const frameData = await fs.readFile(framePath);
            
            // Calculate checksum
            const checksum = crypto.createHash('md5').update(frameData).digest('base64');
            
            // Upload with metadata
            await frameFile.save(frameData, {
                metadata: {
                    contentType: 'image/png',
                    cacheControl: 'public, max-age=3600',
                    metadata: {
                        frameNumber: frameNumber.toString(),
                        checksum,
                        uploadTime: new Date().toISOString(),
                        ...metadata
                    }
                },
                validation: 'md5'
            });
            
            console.log(`   ☁️  Uploaded frame ${frameNumber} to GCS`);
            return {
                success: true,
                url: `gs://${this.bucketNames.frames}/frames/frame_${frameNumber.toString().padStart(4, '0')}.png`,
                checksum
            };
            
        } catch (error) {
            console.error(`   ❌ Failed to upload frame ${frameNumber}: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Download a frame from Cloud Storage
     */
    async downloadFrame(frameNumber, destinationPath) {
        const frameFile = this.buckets.frames.file(`frames/frame_${frameNumber.toString().padStart(4, '0')}.png`);
        
        try {
            await frameFile.download({ destination: destinationPath });
            console.log(`   ⬇️  Downloaded frame ${frameNumber} from GCS`);
            return true;
        } catch (error) {
            console.error(`   ❌ Failed to download frame ${frameNumber}: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Upload manifest to Cloud Storage
     */
    async uploadManifest(manifest, filename = 'manifest.json') {
        const manifestFile = this.buckets.manifests.file(filename);
        
        try {
            const manifestData = JSON.stringify(manifest, null, 2);
            
            await manifestFile.save(manifestData, {
                metadata: {
                    contentType: 'application/json',
                    cacheControl: 'no-cache',
                    metadata: {
                        version: manifest.version || '1.0',
                        frames: manifest.stats?.completedFrames || 0,
                        uploadTime: new Date().toISOString()
                    }
                }
            });
            
            console.log(`   ☁️  Uploaded manifest to GCS`);
            return true;
            
        } catch (error) {
            console.error(`   ❌ Failed to upload manifest: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Download manifest from Cloud Storage
     */
    async downloadManifest(filename = 'manifest.json') {
        const manifestFile = this.buckets.manifests.file(filename);
        
        try {
            const [contents] = await manifestFile.download();
            const manifest = JSON.parse(contents.toString());
            console.log(`   ⬇️  Downloaded manifest from GCS`);
            return manifest;
        } catch (error) {
            if (error.code === 404) {
                console.log(`   📝 No existing manifest found in GCS`);
                return null;
            }
            console.error(`   ❌ Failed to download manifest: ${error.message}`);
            return null;
        }
    }
    
    /**
     * List all frames in bucket
     */
    async listFrames() {
        try {
            const [files] = await this.buckets.frames.getFiles({
                prefix: 'frames/',
                maxResults: 10000
            });
            
            const frames = files.map(file => {
                const match = file.name.match(/frame_(\d+)\.png$/);
                return match ? parseInt(match[1]) : null;
            }).filter(n => n !== null).sort((a, b) => a - b);
            
            console.log(`   📋 Found ${frames.length} frames in GCS`);
            return frames;
            
        } catch (error) {
            console.error(`   ❌ Failed to list frames: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Upload video to Cloud Storage
     */
    async uploadVideo(videoPath, videoName) {
        const videoFile = this.buckets.videos.file(videoName);
        
        try {
            const videoData = await fs.readFile(videoPath);
            const checksum = crypto.createHash('md5').update(videoData).digest('base64');
            
            // Use resumable upload for large files
            await videoFile.save(videoData, {
                resumable: true,
                metadata: {
                    contentType: 'video/mp4',
                    cacheControl: 'public, max-age=86400',
                    metadata: {
                        checksum,
                        uploadTime: new Date().toISOString(),
                        size: videoData.length
                    }
                },
                validation: 'md5'
            });
            
            // Make public
            await videoFile.makePublic();
            
            const publicUrl = `https://storage.googleapis.com/${this.bucketNames.videos}/${videoName}`;
            console.log(`   ☁️  Uploaded video to GCS: ${publicUrl}`);
            
            return {
                success: true,
                url: publicUrl,
                gsUrl: `gs://${this.bucketNames.videos}/${videoName}`,
                checksum
            };
            
        } catch (error) {
            console.error(`   ❌ Failed to upload video: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Sync local frames directory with Cloud Storage
     */
    async syncFrames(localDir) {
        console.log('🔄 Syncing frames with Cloud Storage...');
        
        // Get local frames
        const localFiles = await fs.readdir(localDir);
        const localFrames = localFiles
            .filter(f => f.match(/^frame_\d{4}\.png$/))
            .map(f => parseInt(f.match(/\d+/)[0]));
        
        // Get cloud frames
        const cloudFrames = await this.listFrames();
        
        // Find frames to upload (in local but not in cloud)
        const toUpload = localFrames.filter(n => !cloudFrames.includes(n));
        
        console.log(`   📊 Local: ${localFrames.length}, Cloud: ${cloudFrames.length}`);
        console.log(`   📤 Need to upload: ${toUpload.length} frames`);
        
        // Upload missing frames
        let uploaded = 0;
        for (const frameNumber of toUpload) {
            const framePath = path.join(localDir, `frame_${frameNumber.toString().padStart(4, '0')}.png`);
            const result = await this.uploadFrame(frameNumber, framePath);
            if (result.success) uploaded++;
            
            // Progress update
            if (uploaded % 10 === 0) {
                console.log(`   📊 Upload progress: ${uploaded}/${toUpload.length}`);
            }
        }
        
        console.log(`   ✅ Sync complete: ${uploaded} frames uploaded`);
        return {
            localCount: localFrames.length,
            cloudCount: cloudFrames.length + uploaded,
            uploaded
        };
    }
    
    /**
     * Get signed URL for temporary access
     */
    async getSignedUrl(bucketType, fileName, expiresIn = 3600) {
        const file = this.buckets[bucketType].file(fileName);
        
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + expiresIn * 1000
        });
        
        return url;
    }
    
    /**
     * Clean up old frames
     */
    async cleanupOldFrames(daysToKeep = 60) {
        console.log(`🧹 Cleaning up frames older than ${daysToKeep} days...`);
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const [files] = await this.buckets.frames.getFiles({
            prefix: 'frames/'
        });
        
        let deleted = 0;
        for (const file of files) {
            const [metadata] = await file.getMetadata();
            const created = new Date(metadata.timeCreated);
            
            if (created < cutoffDate) {
                await file.delete();
                deleted++;
            }
        }
        
        console.log(`   ✅ Deleted ${deleted} old frames`);
        return deleted;
    }
}

// Export for use in other modules
export default GCSStorage;

// Test function
async function testGCS() {
    const gcs = new GCSStorage();
    
    try {
        await gcs.initialize();
        
        // Test manifest upload/download
        const testManifest = {
            version: '1.0',
            test: true,
            timestamp: new Date().toISOString()
        };
        
        await gcs.uploadManifest(testManifest, 'test-manifest.json');
        const downloaded = await gcs.downloadManifest('test-manifest.json');
        console.log('✅ Manifest test successful:', downloaded);
        
        // List frames
        const frames = await gcs.listFrames();
        console.log(`✅ Found ${frames.length} frames in cloud storage`);
        
    } catch (error) {
        console.error('❌ GCS test failed:', error);
    }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testGCS().catch(console.error);
}