import sharp from 'sharp';
import path from 'path';

/**
 * Generates intermediate frames between two images using frame blending.
 *
 * @param {string} frameAPath - The file path to the first frame (e.g., 'frame_001.png').
 * @param {string} frameBPath - The file path to the second frame (e.g., 'frame_002.png').
 * @param {number} interpolationFactor - The number of frames to generate between A and B (e.g., a factor of 2 means 1 intermediate frame).
 * @param {string} outputDir - The directory to save the interpolated frames in.
 * @returns {Promise<string[]>} A promise that resolves with an array of file paths for the newly created frames.
 */
export async function blendFrames(frameAPath, frameBPath, interpolationFactor, outputDir) {
    try {
        const newFramePaths = [];
        if (interpolationFactor <= 1) {
            return newFramePaths;
        }

        const imageA = sharp(frameAPath);
        const imageB = sharp(frameBPath);

        const [metadataA, metadataB] = await Promise.all([
            imageA.metadata(),
            imageB.metadata()
        ]);

        if (metadataA.width !== metadataB.width || metadataA.height !== metadataB.height || metadataA.channels !== metadataB.channels) {
            throw new Error('Images must have the same dimensions and channels.');
        }

        const [bufferA, bufferB] = await Promise.all([
            imageA.raw().toBuffer(),
            imageB.raw().toBuffer()
        ]);

        // The number of intermediate frames to generate is factor - 1
        const intermediateFrameCount = interpolationFactor - 1;

        for (let i = 1; i <= intermediateFrameCount; i++) {
            const weightB = i / interpolationFactor;
            const weightA = 1 - weightB;

            const blendedBuffer = Buffer.alloc(bufferA.length);

            for (let j = 0; j < bufferA.length; j++) {
                blendedBuffer[j] = Math.round((bufferA[j] * weightA) + (bufferB[j] * weightB));
            }

            const frameAName = path.basename(frameAPath, path.extname(frameAPath));
            const frameBName = path.basename(frameBPath, path.extname(frameBPath));

            // A more descriptive name for the interpolated frame
            const newFrameName = `${frameAName}_interp_${i}_of_${intermediateFrameCount}.png`;
            const outputPath = path.join(outputDir, newFrameName);

            await sharp(blendedBuffer, {
                raw: {
                    width: metadataA.width,
                    height: metadataA.height,
                    channels: metadataA.channels,
                },
            })
            .toFile(outputPath);

            newFramePaths.push(outputPath);
        }

        return newFramePaths;

    } catch (error) {
        console.error(`Error during frame blending between ${frameAPath} and ${frameBPath}:`, error);
        throw error;
    }
}
