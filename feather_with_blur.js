// Feathering using Sharp's native blur instead of SVG filters
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
    
    // Create a hard-edged square mask (no SVG filter)
    const hardMaskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <rect x="${squareLeft}" y="${squareTop}" 
                  width="${squareSize}" height="${squareSize}" 
                  fill="white"/>
        </svg>
    `;
    
    // Convert SVG to buffer, then apply blur using Sharp's native blur
    const mask = await sharp(Buffer.from(hardMaskSvg))
        .resize(finalSize, finalSize)
        .blur(featherRadius / 3)  // Apply gaussian blur directly
        .toBuffer();
    
    // Apply the blurred mask to create feathered edges
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}