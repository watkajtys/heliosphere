// Fixed square feathering implementation
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
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
    
    // Create a proper square feather mask with radial gradient at corners
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <mask id="squareFeather">
                    <rect width="${finalSize}" height="${finalSize}" fill="black"/>
                    
                    <!-- Main square area (fully visible) -->
                    <rect x="${squareLeft + featherRadius}" 
                          y="${squareTop + featherRadius}" 
                          width="${squareSize - featherRadius * 2}" 
                          height="${squareSize - featherRadius * 2}" 
                          fill="white"/>
                    
                    <!-- Top edge feather -->
                    <linearGradient id="topGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="black" stop-opacity="1"/>
                        <stop offset="100%" stop-color="white" stop-opacity="1"/>
                    </linearGradient>
                    <rect x="${squareLeft + featherRadius}" 
                          y="${squareTop}" 
                          width="${squareSize - featherRadius * 2}" 
                          height="${featherRadius}" 
                          fill="url(#topGrad)"/>
                    
                    <!-- Bottom edge feather -->
                    <linearGradient id="bottomGrad" x1="0" y1="1" x2="0" y2="0">
                        <stop offset="0%" stop-color="black" stop-opacity="1"/>
                        <stop offset="100%" stop-color="white" stop-opacity="1"/>
                    </linearGradient>
                    <rect x="${squareLeft + featherRadius}" 
                          y="${squareTop + squareSize - featherRadius}" 
                          width="${squareSize - featherRadius * 2}" 
                          height="${featherRadius}" 
                          fill="url(#bottomGrad)"/>
                    
                    <!-- Left edge feather -->
                    <linearGradient id="leftGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stop-color="black" stop-opacity="1"/>
                        <stop offset="100%" stop-color="white" stop-opacity="1"/>
                    </linearGradient>
                    <rect x="${squareLeft}" 
                          y="${squareTop + featherRadius}" 
                          width="${featherRadius}" 
                          height="${squareSize - featherRadius * 2}" 
                          fill="url(#leftGrad)"/>
                    
                    <!-- Right edge feather -->
                    <linearGradient id="rightGrad" x1="1" y1="0" x2="0" y2="0">
                        <stop offset="0%" stop-color="black" stop-opacity="1"/>
                        <stop offset="100%" stop-color="white" stop-opacity="1"/>
                    </linearGradient>
                    <rect x="${squareLeft + squareSize - featherRadius}" 
                          y="${squareTop + featherRadius}" 
                          width="${featherRadius}" 
                          height="${squareSize - featherRadius * 2}" 
                          fill="url(#rightGrad)"/>
                    
                    <!-- Corner feathers (radial gradients) -->
                    <radialGradient id="cornerGrad">
                        <stop offset="0%" stop-color="white" stop-opacity="1"/>
                        <stop offset="100%" stop-color="black" stop-opacity="1"/>
                    </radialGradient>
                    
                    <!-- Top-left corner -->
                    <circle cx="${squareLeft + featherRadius}" 
                            cy="${squareTop + featherRadius}" 
                            r="${featherRadius}" 
                            fill="url(#cornerGrad)"/>
                    
                    <!-- Top-right corner -->
                    <circle cx="${squareLeft + squareSize - featherRadius}" 
                            cy="${squareTop + featherRadius}" 
                            r="${featherRadius}" 
                            fill="url(#cornerGrad)"/>
                    
                    <!-- Bottom-left corner -->
                    <circle cx="${squareLeft + featherRadius}" 
                            cy="${squareTop + squareSize - featherRadius}" 
                            r="${featherRadius}" 
                            fill="url(#cornerGrad)"/>
                    
                    <!-- Bottom-right corner -->
                    <circle cx="${squareLeft + squareSize - featherRadius}" 
                            cy="${squareTop + squareSize - featherRadius}" 
                            r="${featherRadius}" 
                            fill="url(#cornerGrad)"/>
                </mask>
            </defs>
            
            <rect width="${finalSize}" height="${finalSize}" fill="white" mask="url(#squareFeather)"/>
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask))
        .ensureAlpha()
        .extractChannel('alpha')
        .toBuffer();
        
    return await sharp(resizedImage)
        .ensureAlpha()
        .joinChannel(mask)
        .png()
        .toBuffer();
}