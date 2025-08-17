// FIXED Square Feathering Function for Production
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
    
    // FIXED: Proper SVG with namespace and correct filter bounds
    const maskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="feather" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="${featherRadius / 3}" />
                </filter>
            </defs>
            <rect x="${squareLeft}" 
                  y="${squareTop}" 
                  width="${squareSize}" 
                  height="${squareSize}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    `;
    
    // Generate the mask and extract alpha channel properly
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .ensureAlpha()
        .extractChannel('alpha')
        .toBuffer();
    
    // Apply the mask to create feathered edges
    return await sharp(resizedImage)
        .ensureAlpha()
        .joinChannel(mask)
        .png()
        .toBuffer();
}