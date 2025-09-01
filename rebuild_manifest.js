#!/usr/bin/env node

/**
 * Rebuild frame manifest from existing frame files
 * This scans the frames directory and creates a new manifest with checksums
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    MANIFEST_FILE: '/opt/heliosphere/frame_manifest.json',
    BACKUP_MANIFEST: '/opt/heliosphere/frame_manifest.backup.json',
};

async function getFileChecksum(filePath) {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('md5').update(buffer).digest('hex');
}

async function getImageRegionChecksum(imagePath, region) {
    try {
        const buffer = await sharp(imagePath)
            .extract(region)
            .toBuffer();
        return crypto.createHash('md5').update(buffer).digest('hex');
    } catch (error) {
        console.error(`Error extracting region from ${imagePath}:`, error.message);
        return null;
    }
}

async function processFrame(framePath, frameNumber, date) {
    try {
        // Get file stats
        const stats = await fs.stat(framePath);
        
        // Calculate checksums for corona and sun disk regions
        // Corona region (outer area)
        const coronaChecksum = await getImageRegionChecksum(framePath, {
            left: 0,
            top: 0,
            width: 200,
            height: 200
        });
        
        // Sun disk region (center area)
        const sunDiskChecksum = await getImageRegionChecksum(framePath, {
            left: 630,
            top: 500,
            width: 200,
            height: 200
        });
        
        return {
            path: framePath,
            date: date.toISOString(),
            frameNumber: frameNumber,
            coronaChecksum: coronaChecksum || 'unknown',
            sunDiskChecksum: sunDiskChecksum || 'unknown',
            coronaFallback: 0,
            sunDiskFallback: 0,
            fileSize: stats.size,
            created: stats.birthtime.toISOString()
        };
    } catch (error) {
        console.error(`Error processing frame ${framePath}:`, error.message);
        return null;
    }
}

async function rebuildManifest() {
    console.log('🔧 Starting manifest rebuild...\n');
    
    // Backup existing manifest if it exists
    try {
        await fs.access(CONFIG.MANIFEST_FILE);
        await fs.copyFile(CONFIG.MANIFEST_FILE, CONFIG.BACKUP_MANIFEST);
        console.log(`📦 Backed up existing manifest to ${CONFIG.BACKUP_MANIFEST}`);
    } catch (error) {
        console.log('📦 No existing manifest to backup');
    }
    
    const manifest = {};
    let totalFrames = 0;
    let processedDays = 0;
    
    // Read all date directories
    const dateDirs = await fs.readdir(CONFIG.FRAMES_DIR);
    const sortedDirs = dateDirs.filter(dir => dir.match(/^\d{4}-\d{2}-\d{2}$/)).sort();
    
    console.log(`📅 Found ${sortedDirs.length} date directories\n`);
    
    for (const dateDir of sortedDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dateDir);
        const stats = await fs.stat(dirPath);
        
        if (!stats.isDirectory()) continue;
        
        // Parse date
        const [year, month, day] = dateDir.split('-').map(Number);
        const baseDate = new Date(Date.UTC(year, month - 1, day));
        
        // Read all frame files
        const files = await fs.readdir(dirPath);
        const frameFiles = files.filter(f => f.endsWith('.jpg')).sort();
        
        console.log(`Processing ${dateDir}: ${frameFiles.length} frames`);
        
        let dayFrames = 0;
        for (const frameFile of frameFiles) {
            // Extract time from filename (frame_HHMM.jpg)
            const match = frameFile.match(/frame_(\d{2})(\d{2})\.jpg$/);
            if (!match) continue;
            
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            
            // Create full timestamp
            const frameDate = new Date(baseDate);
            frameDate.setUTCHours(hours, minutes, 0, 0);
            
            // Calculate frame number (0-based index in the full sequence)
            const daysSinceStart = Math.floor((frameDate - new Date('2025-07-03T00:00:00Z')) / (24 * 60 * 60 * 1000));
            const minutesInDay = hours * 60 + minutes;
            const frameInDay = Math.floor(minutesInDay / 15); // One frame every 15 minutes
            const frameNumber = daysSinceStart * 96 + frameInDay;
            
            const framePath = path.join(dirPath, frameFile);
            const frameData = await processFrame(framePath, frameNumber, frameDate);
            
            if (frameData) {
                const frameKey = frameDate.toISOString();
                manifest[frameKey] = frameData;
                dayFrames++;
                totalFrames++;
                
                if (totalFrames % 100 === 0) {
                    process.stdout.write(`\r  Processed ${totalFrames} frames...`);
                }
            }
        }
        
        console.log(`\r  ✓ ${dateDir}: ${dayFrames} frames processed`);
        processedDays++;
    }
    
    // Save new manifest
    await fs.writeFile(
        CONFIG.MANIFEST_FILE,
        JSON.stringify(manifest, null, 2)
    );
    
    console.log('\n📊 Summary:');
    console.log(`   Total frames: ${totalFrames}`);
    console.log(`   Days processed: ${processedDays}`);
    console.log(`   Date range: ${sortedDirs[0]} to ${sortedDirs[sortedDirs.length - 1]}`);
    console.log(`\n✅ Manifest rebuilt successfully: ${CONFIG.MANIFEST_FILE}`);
    
    // Verify manifest
    const savedManifest = JSON.parse(await fs.readFile(CONFIG.MANIFEST_FILE, 'utf-8'));
    console.log(`✅ Verified: ${Object.keys(savedManifest).length} entries in manifest`);
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    rebuildManifest().catch(console.error);
}

export { rebuildManifest };