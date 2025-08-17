import fs from 'fs';
import { execSync } from 'child_process';

// Circular feathering that was working before
const circularFeatherFunction = `
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    // Resize the image first
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    // Create circular mask with feathering
    const maskSize = finalSize;
    const center = maskSize / 2;
    const radius = compositeRadius;
    
    // Create mask SVG with radial gradient for smooth feathering
    const maskSvg = \`
        <svg width="\${maskSize}" height="\${maskSize}">
            <defs>
                <radialGradient id="fade">
                    <stop offset="\${(radius - featherRadius) / radius * 100}%" stop-color="white" stop-opacity="1" />
                    <stop offset="100%" stop-color="white" stop-opacity="0" />
                </radialGradient>
            </defs>
            <circle cx="\${center}" cy="\${center}" r="\${radius}" fill="url(#fade)" />
        </svg>
    \`;

    const maskBuffer = await sharp(Buffer.from(maskSvg))
        .png()
        .toBuffer();

    // Apply mask to image
    return await sharp(resizedImage)
        .composite([{
            input: maskBuffer,
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

content = content.substring(0, functionStart) + circularFeatherFunction.trim() + content.substring(functionEnd);

// Write updated
fs.writeFileSync('./vps_updated.js', content);

// Upload back
console.log('Uploading circular feather version...');
execSync('scp ./vps_updated.js vps:/opt/heliosphere/vps_daily_production.js');

// Clean up
fs.unlinkSync('./vps_current.js');
fs.unlinkSync('./vps_updated.js');

console.log('✅ Restored circular feathering!');