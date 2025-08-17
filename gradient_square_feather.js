#!/usr/bin/env node

// Square feathering using gradients (like the working circular version)
// This adapts the proven radialGradient approach to work with squares

async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const sharp = require('sharp');
    
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    const squareTop = center - compositeRadius;
    
    // Calculate where the feather starts (as a percentage)
    const featherStart = ((compositeRadius - featherRadius) / compositeRadius) * 100;
    
    // Create a square mask with gradient edges (similar to the radial gradient that worked)
    // Using a radial gradient but clipped to a square shape
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="${(compositeRadius + featherRadius) / center * 50}%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${featherStart}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
                <mask id="squareMask">
                    <rect width="${finalSize}" height="${finalSize}" fill="black"/>
                    <rect x="${squareLeft - featherRadius}" 
                          y="${squareTop - featherRadius}" 
                          width="${squareSize + featherRadius * 2}" 
                          height="${squareSize + featherRadius * 2}" 
                          fill="url(#feather)"/>
                </mask>
            </defs>
            <rect width="${finalSize}" height="${finalSize}" fill="white" mask="url(#squareMask)"/>
        </svg>
    `;
    
    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    
    // Apply the mask using the same method that worked for circles
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

module.exports = applySquareFeather;