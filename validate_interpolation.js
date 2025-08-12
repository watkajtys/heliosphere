#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ssim } from 'ssim.js';
import { exec } from 'child_process';

// --- Configuration ---
const FRAMES_DIR = 'optimized_12min_frames';
const LOG_FILE = 'video_generation_log.json';
const API_BASE_URL = 'http://localhost:3004/verified-composite';

/**
 * Calculates the Structural Similarity (SSIM) between two images.
 * @param {string} imagePath1 - Path to the first image.
 * @param {string} imagePath2 - Path to the second image.
 * @returns {Promise<{mssim: number, performance: number}>} - The SSIM score and performance time.
 */
async function compareImages(imagePath1, imagePath2) {
    const startTime = Date.now();
    const { data: data1, info: info1 } = await sharp(imagePath1).raw().toBuffer({ resolveWithObject: true });
    const { data: data2, info: info2 } = await sharp(imagePath2).raw().toBuffer({ resolveWithObject: true });

    if (info1.width !== info2.width || info1.height !== info2.height) {
        throw new Error('Images must have the same dimensions for SSIM comparison.');
    }

    const image1 = { data: new Uint8ClampedArray(data1), width: info1.width, height: info1.height, channels: info1.channels };
    const image2 = { data: new Uint8ClampedArray(data2), width: info2.width, height: info2.height, channels: info2.channels };

    // ssim.js requires RGBA, let's ensure it is
    if (image1.channels === 3) {
        image1.data = await sharp(image1.data, {raw: {width: image1.width, height: image1.height, channels: 3}}).ensureAlpha().raw().toBuffer();
    }
     if (image2.channels === 3) {
        image2.data = await sharp(image2.data, {raw: {width: image2.width, height: image2.height, channels: 3}}).ensureAlpha().raw().toBuffer();
    }

    const result = ssim(image1, image2, { k1: 0.01, k2: 0.03, windowSize: 8 });
    const performance = Date.now() - startTime;

    return { ...result, performance };
}

/**
 * Main validation function.
 */
async function validateInterpolation() {
    console.log('🎬 Starting Interpolation Validation...');

    // 1. Find a random interpolated frame
    const allFiles = await fs.readdir(FRAMES_DIR);
    const interpolatedFiles = allFiles.filter(f => f.includes('_interp_'));

    if (interpolatedFiles.length === 0) {
        console.log('❌ No interpolated frames found to validate.');
        return;
    }

    const randomFrame = interpolatedFiles[Math.floor(Math.random() * interpolatedFiles.length)];
    const interpolatedPath = path.join(FRAMES_DIR, randomFrame);
    console.log(`\n🔎 Validating random frame: ${randomFrame}`);

    // 2. Parse the filename
    const match = randomFrame.match(/frame_(\d+)_interp_(\d+)\.png/);
    if (!match) {
        console.error(`❌ Could not parse filename: ${randomFrame}`);
        return;
    }
    const baseFrameNum = parseInt(match[1], 10);
    const interpStep = parseInt(match[2], 10);

    // 3. Read the generation log to find timestamps
    const logData = JSON.parse(await fs.readFile(LOG_FILE, 'utf-8'));
    const { frames, summary } = logData;
    const interpolationFactor = summary.interpolationFactor || 4; // Get from summary or use default

    const frameA_info = frames.find(f => f.frameNum === String(baseFrameNum).padStart(3, '0'));
    const frameB_info = frames.find(f => f.frameNum === String(baseFrameNum + 1).padStart(3, '0'));

    if (!frameA_info || !frameB_info) {
        console.error(`❌ Could not find source frames ${baseFrameNum} and ${baseFrameNum + 1} in log file.`);
        return;
    }

    const timeA = new Date(frameA_info.targetTimestamp).getTime();
    const timeB = new Date(frameB_info.targetTimestamp).getTime();

    // 4. Calculate the interpolated timestamp
    const stepRatio = interpStep / interpolationFactor;
    const interpolatedTime = new Date(timeA + (timeB - timeA) * stepRatio);
    const isoTimestamp = interpolatedTime.toISOString();
    console.log(`   - Source A time:      ${frameA_info.targetTimestamp}`);
    console.log(`   - Source B time:      ${frameB_info.targetTimestamp}`);
    console.log(`   - Interpolated time:  ${isoTimestamp} (Step ${interpStep}/${interpolationFactor})`);

    // 5. Fetch the ground-truth frame from the API
    const groundTruthFilename = `ground_truth_${baseFrameNum}_${interpStep}.png`;
    const groundTruthPath = path.join(FRAMES_DIR, groundTruthFilename);
    const url = `${API_BASE_URL}?date=${isoTimestamp}&style=ad-astra&cropWidth=1440&cropHeight=1200`;

    console.log('   - Fetching ground-truth frame from API...');

    // Using curl via exec as fetch might not be available in all node versions without a library
    await new Promise((resolve, reject) => {
        exec(`curl -s -o "${groundTruthPath}" "${url}"`, (error) => {
            if (error) {
                console.error('❌ Failed to download ground-truth frame.');
                reject(error);
            } else {
                console.log(`   - Saved ground-truth frame to: ${groundTruthPath}`);
                resolve();
            }
        });
    });

    // 6. Compare the images
    console.log('\n⚖️  Comparing images using SSIM...');
    try {
        const { mssim, performance } = await compareImages(interpolatedPath, groundTruthPath);
        console.log('\n✅ Validation Complete!');
        console.log('=======================');
        console.log(`   - Interpolated Frame: ${randomFrame}`);
        console.log(`   - Ground-Truth Frame: ${groundTruthFilename}`);
        console.log(`   - 📈 SSIM Score: ${mssim.toFixed(4)}`);
        console.log(`   - ⏱️ Comparison Time: ${performance}ms`);
        console.log('=======================');
        console.log('(Note: A higher SSIM score is better. 1.0 is a perfect match.)');

    } catch (error) {
        console.error('❌ Failed during image comparison:', error.message);
    } finally {
        // 7. Clean up the downloaded ground-truth frame
        await fs.unlink(groundTruthPath);
        console.log(`\n🧹 Cleaned up temporary file: ${groundTruthPath}`);
    }
}

// Execute the validation
validateInterpolation().catch(err => {
    console.error('An unexpected error occurred:', err);
});
