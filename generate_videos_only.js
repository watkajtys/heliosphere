#\!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const CONFIG = {
    FRAMES_DIR: '/opt/heliosphere/frames',
    VIDEOS_DIR: '/opt/heliosphere/videos',
    TEMP_DIR: '/opt/heliosphere/temp',
    FPS: 24,
    TOTAL_DAYS: 56,
    SOCIAL_DAYS: 30
};

async function generateVideo(frameList, outputName) {
    console.log(`\n🎬 Generating ${outputName}...`);
    
    const frameListPath = path.join(CONFIG.TEMP_DIR, `${outputName}_frames.txt`);
    await fs.writeFile(frameListPath, frameList.join('\n'));
    
    const outputPath = path.join(CONFIG.VIDEOS_DIR, `${outputName}_${new Date().toISOString().split('T')[0]}.mov`);
    
    const ffmpegCommand = `ffmpeg -threads 2 -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${frameListPath}" ` +
        `-c:v mjpeg -q:v 1 -pix_fmt yuvj420p "${outputPath}"`;
    
    console.log('Running:', ffmpegCommand);
    
    try {
        const startTime = Date.now();
        await execAsync(ffmpegCommand, { timeout: 600000 });
        const elapsed = (Date.now() - startTime) / 1000;
        
        const stats = await fs.stat(outputPath);
        console.log(`✓ Video generated: ${outputPath}`);
        console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Frames: ${frameList.length}`);
        console.log(`  Duration: ${(frameList.length / CONFIG.FPS).toFixed(1)} seconds`);
        console.log(`  Generation time: ${elapsed.toFixed(1)} seconds`);
        
        return outputPath;
    } catch (error) {
        console.error(`❌ Failed to generate ${outputName}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🎥 Video Generation from Existing Frames');
    console.log('=========================================');
    
    // Ensure directories exist
    await fs.mkdir(CONFIG.TEMP_DIR, { recursive: true });
    await fs.mkdir(CONFIG.VIDEOS_DIR, { recursive: true });
    
    // Get all frame files
    const frameDirs = await fs.readdir(CONFIG.FRAMES_DIR);
    frameDirs.sort();
    
    const allFrames = [];
    
    for (const dir of frameDirs) {
        const dirPath = path.join(CONFIG.FRAMES_DIR, dir);
        const stat = await fs.stat(dirPath);
        
        if (stat.isDirectory()) {
            const files = await fs.readdir(dirPath);
            const jpgFiles = files.filter(f => f.endsWith('.jpg')).sort();
            
            for (const file of jpgFiles) {
                allFrames.push(`file '${path.join(dirPath, file)}'`);
            }
        }
    }
    
    console.log(`📊 Found ${allFrames.length} total frames`);
    
    if (allFrames.length === 0) {
        console.error('❌ No frames found\!');
        return;
    }
    
    // Generate full video (all frames)
    console.log('\n1️⃣ Generating FULL video (56 days)...');
    await generateVideo(allFrames, 'heliosphere_full');
    
    // Generate social video (last 30 days)
    const socialFrames = allFrames.slice(-(CONFIG.SOCIAL_DAYS * 96));
    console.log(`\n2️⃣ Generating SOCIAL video (30 days, ${socialFrames.length} frames)...`);
    
    // For social, we need to crop to square
    const socialFrameListPath = path.join(CONFIG.TEMP_DIR, 'heliosphere_social_frames.txt');
    await fs.writeFile(socialFrameListPath, socialFrames.join('\n'));
    
    const socialOutputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_social_${new Date().toISOString().split('T')[0]}.mov`);
    const socialCommand = `ffmpeg -threads 2 -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${socialFrameListPath}" ` +
        `-vf "crop=1200:1200:130:0" ` +
        `-c:v mjpeg -q:v 1 -pix_fmt yuvj420p "${socialOutputPath}"`;
    
    console.log('Running:', socialCommand);
    const socialStart = Date.now();
    await execAsync(socialCommand, { timeout: 600000 });
    const socialStats = await fs.stat(socialOutputPath);
    console.log(`✓ Social video generated: ${socialOutputPath}`);
    console.log(`  Size: ${(socialStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Time: ${((Date.now() - socialStart) / 1000).toFixed(1)} seconds`);
    
    // Generate portrait video (all frames, cropped)
    console.log(`\n3️⃣ Generating PORTRAIT video (56 days)...`);
    
    const portraitFrameListPath = path.join(CONFIG.TEMP_DIR, 'heliosphere_portrait_frames.txt');
    await fs.writeFile(portraitFrameListPath, allFrames.join('\n'));
    
    const portraitOutputPath = path.join(CONFIG.VIDEOS_DIR, `heliosphere_portrait_${new Date().toISOString().split('T')[0]}.mov`);
    const portraitCommand = `ffmpeg -threads 2 -y -r ${CONFIG.FPS} -f concat -safe 0 -i "${portraitFrameListPath}" ` +
        `-vf "crop=900:1200:280:0" ` +
        `-c:v mjpeg -q:v 1 -pix_fmt yuvj420p "${portraitOutputPath}"`;
    
    console.log('Running:', portraitCommand);
    const portraitStart = Date.now();
    await execAsync(portraitCommand, { timeout: 600000 });
    const portraitStats = await fs.stat(portraitOutputPath);
    console.log(`✓ Portrait video generated: ${portraitOutputPath}`);
    console.log(`  Size: ${(portraitStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Time: ${((Date.now() - portraitStart) / 1000).toFixed(1)} seconds`);
    
    console.log('\n✅ All videos generated successfully\!');
    
    // Now upload to Cloudflare
    console.log('\n☁️ Uploading to Cloudflare Stream...');
    
    const uploads = [
        { file: path.join(CONFIG.VIDEOS_DIR, `heliosphere_full_${new Date().toISOString().split('T')[0]}.mov`), type: 'full' },
        { file: socialOutputPath, type: 'social' },
        { file: portraitOutputPath, type: 'portrait' }
    ];
    
    for (const upload of uploads) {
        console.log(`\nUploading ${upload.type} video...`);
        try {
            const uploadCommand = `cd /opt/heliosphere && node cloudflare_tus_upload.js "${upload.file}" ${upload.type}`;
            const result = await execAsync(uploadCommand, { timeout: 600000 });
            console.log(result.stdout);
        } catch (error) {
            console.error(`Failed to upload ${upload.type}:`, error.message);
        }
    }
    
    // Deploy to Cloudflare Pages
    console.log('\n📄 Deploying to Cloudflare Pages...');
    try {
        const deployCommand = `cd /opt/heliosphere && node deploy_to_pages.js`;
        const deployResult = await execAsync(deployCommand, { timeout: 120000 });
        console.log(deployResult.stdout);
    } catch (error) {
        console.error('Failed to deploy to Pages:', error.message);
    }
    
    // Post to Twitter
    console.log('\n🐦 Posting to Twitter...');
    try {
        const twitterCommand = `cd /opt/heliosphere && node post_twitter_auto.js`;
        const twitterResult = await execAsync(twitterCommand, { timeout: 600000 }); // 10 minute timeout
        console.log(twitterResult.stdout);
    } catch (error) {
        console.error('Failed to post to Twitter:', error.message);
        // Don't fail the whole pipeline if Twitter posting fails
    }
    
    console.log('\n🎉 Complete\!');
}

main().catch(console.error);
