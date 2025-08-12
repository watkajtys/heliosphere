import fs from 'fs/promises';
import sharp from 'sharp';
import { GRAY8, intBuffer } from "@thi.ng/pixel";
import { OpticalFlow } from "@thi.ng/pixel-flow";

/**
 * Generates intermediate frames between two images using the @thi.ng/pixel-flow library.
 *
 * @param {string} frameAPath - Path to the first frame.
 * @param {string} frameBPath - Path to the second frame.
 * @param {number} intermediateFrameCount - How many frames to generate between A and B.
 * @param {string} outputDir - Directory to save the interpolated frames.
 * @param {string} baseFrameNum - The base number for the output frames.
 */
export async function interpolateFrames(frameAPath, frameBPath, intermediateFrameCount, outputDir, baseFrameNum) {
    console.log(`Interpolating ${intermediateFrameCount} frames between ${frameAPath} and ${frameBPath} using @thi.ng/pixel-flow.`);

    try {
        // 1. Load images with sharp
        const imageA = sharp(frameAPath);
        const imageB = sharp(frameBPath);

        const { width, height, channels } = await imageA.metadata();

        // 2. Convert to grayscale IntBuffer format for the library
        const grayA_raw = await imageA.grayscale().raw().toBuffer();
        const grayB_raw = await imageB.grayscale().raw().toBuffer();

        const bufferA = intBuffer(width, height, GRAY8);
        bufferA.data.set(grayA_raw);

        const bufferB = intBuffer(width, height, GRAY8);
        bufferB.data.set(grayB_raw);

        // 3. Instantiate OpticalFlow and calculate the flow field
        // These parameters are tuned for quality and performance.
        const flow = new OpticalFlow(bufferA, {
            scale: 0.5, // Process at half resolution for speed
            lambda: 0.05,
            smooth: 1.5,
            threshold: 0.002,
            iter: 4,
        });

        const flowField = flow.update(bufferB);
        const vectors = flowField.data;

        // 4. Warp frame A based on the calculated flow vectors
        console.log('   - Warping frames based on flow field...');
        const { data: sourceData } = await sharp(frameAPath).raw().toBuffer({ resolveWithObject: true });

        for (let i = 1; i <= intermediateFrameCount; i++) {
            const step = i / (intermediateFrameCount + 1);
            const warpedData = Buffer.alloc(sourceData.length);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const vectorIndex = (y * width + x) * 2;
                    const vx = vectors[vectorIndex];
                    const vy = vectors[vectorIndex + 1];

                    const srcX = Math.round(x + vx * step);
                    const srcY = Math.round(y + vy * step);

                    const dstIdx = (y * width + x) * channels;

                    if (srcX >= 0 && srcX < width && srcY >= 0 && srcY < height) {
                        const srcIdx = (srcY * width + srcX) * channels;
                        for (let c = 0; c < channels; c++) {
                            warpedData[dstIdx + c] = sourceData[srcIdx + c];
                        }
                    } else {
                        for (let c = 0; c < channels; c++) {
                            warpedData[dstIdx + c] = sourceData[dstIdx + c];
                        }
                    }
                }
            }

            // 5. Save the new frame
            const outputFilename = `${outputDir}/frame_${baseFrameNum}_interp_${i}.png`;
            await sharp(warpedData, { raw: { width, height, channels } }).toFile(outputFilename);
            console.log(`   ✅ Saved interpolated frame: ${outputFilename}`);
        }

    } catch (error) {
        console.error('❌ Error during frame interpolation:', error);
    }
}
