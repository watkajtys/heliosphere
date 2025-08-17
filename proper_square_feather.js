#!/usr/bin/env node

// Proper square feathering using the approach that worked for circles
// Creates a white square with feathered edges using gradients

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
    const innerSize = compositeRadius * 2;
    const outerSize = (compositeRadius + featherRadius) * 2;
    const innerLeft = center - compositeRadius;
    const innerTop = center - compositeRadius;
    const outerLeft = center - compositeRadius - featherRadius;
    const outerTop = center - compositeRadius - featherRadius;
    
    // Create paths for the feathered square
    // Inner square is fully opaque, outer square fades to transparent
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <!-- Define the gradient that goes from opaque to transparent -->
                <linearGradient id="fadeOut">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
            </defs>
            
            <!-- Black background (transparent) -->
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            
            <!-- White inner square (fully opaque) -->
            <rect x="${innerLeft}" y="${innerTop}" 
                  width="${innerSize}" height="${innerSize}" 
                  fill="white"/>
            
            <!-- Top feather -->
            <rect x="${innerLeft}" y="${outerTop}" 
                  width="${innerSize}" height="${featherRadius}" 
                  fill="white" opacity="${0.5}"/>
            
            <!-- Bottom feather -->
            <rect x="${innerLeft}" y="${innerTop + innerSize}" 
                  width="${innerSize}" height="${featherRadius}" 
                  fill="white" opacity="${0.5}"/>
            
            <!-- Left feather -->
            <rect x="${outerLeft}" y="${innerTop}" 
                  width="${featherRadius}" height="${innerSize}" 
                  fill="white" opacity="${0.5}"/>
            
            <!-- Right feather -->
            <rect x="${innerLeft + innerSize}" y="${innerTop}" 
                  width="${featherRadius}" height="${innerSize}" 
                  fill="white" opacity="${0.5}"/>
            
            <!-- Corner feathers (quarter circles for smooth corners) -->
            <!-- Top-left -->
            <circle cx="${innerLeft}" cy="${innerTop}" r="${featherRadius}" 
                    fill="white" opacity="${0.25}"/>
            <!-- Top-right -->
            <circle cx="${innerLeft + innerSize}" cy="${innerTop}" r="${featherRadius}" 
                    fill="white" opacity="${0.25}"/>
            <!-- Bottom-left -->
            <circle cx="${innerLeft}" cy="${innerTop + innerSize}" r="${featherRadius}" 
                    fill="white" opacity="${0.25}"/>
            <!-- Bottom-right -->
            <circle cx="${innerLeft + innerSize}" cy="${innerTop + innerSize}" r="${featherRadius}" 
                    fill="white" opacity="${0.25}"/>
        </svg>
    `;
    
    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}

module.exports = applySquareFeather;