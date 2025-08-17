import fs from 'fs';
import { execSync } from 'child_process';

// The working programmatic feathering function
const newFunction = `
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    // Create mask programmatically without SVG
    const squareSize = compositeRadius * 2;
    
    // Step 1: Create a white square on black background
    const hardMask = await sharp({
        create: {
            width: finalSize,
            height: finalSize,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 255 }
        }
    })
    .composite([{
        input: await sharp({
            create: {
                width: squareSize,
                height: squareSize,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 255 }
            }
        }).png().toBuffer(),
        gravity: 'center'
    }])
    .png()
    .toBuffer();
    
    // Step 2: Apply blur to create feathering
    const blurredMask = await sharp(hardMask)
        .blur(featherRadius / 2)
        .toBuffer();
    
    // Step 3: Apply the blurred mask
    return await sharp(resizedImage)
        .composite([{
            input: blurredMask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}`;

// Download current script
console.log('Downloading current production script...');
execSync('scp vps:/opt/heliosphere/vps_daily_production.js ./vps_current.js');

// Read and update
let content = fs.readFileSync('./vps_current.js', 'utf8');
const functionStart = content.indexOf('async function applySquareFeather');
const functionEnd = content.indexOf('\n}\n', functionStart) + 2;

content = content.substring(0, functionStart) + newFunction.trim() + content.substring(functionEnd);

// Write updated
fs.writeFileSync('./vps_updated.js', content);

// Upload back
console.log('Uploading updated script...');
execSync('scp ./vps_updated.js vps:/opt/heliosphere/vps_daily_production.js');

// Clean up
fs.unlinkSync('./vps_current.js');
fs.unlinkSync('./vps_updated.js');

console.log('✅ Deployed programmatic feathering to VPS!');