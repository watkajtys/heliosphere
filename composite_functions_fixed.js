async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    // First, resize the image to the final size.
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize)
        .toBuffer();

    // If feathering is zero, no need to apply a mask.
    if (featherRadius <= 0) {
        return resizedImage;
    }

    // Create an SVG for the feathered mask.
    const imageRadius = finalSize / 2;
    const compositeRatio = compositeRadius / imageRadius;
    const featherStart = Math.max(0, compositeRadius - featherRadius);
    const featherStartRatio = featherStart / imageRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <radialGradient id="feather" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${featherStartRatio * 100}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${compositeRatio * 100}%" style="stop-color:white;stop-opacity:0" />
                </radialGradient>
            </defs>
            <circle cx="50%" cy="50%" r="50%" fill="url(#feather)" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();

    // Apply the mask as an alpha channel to the resized image.
    const maskedImage = await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in' // Use the mask to define the alpha channel.
        }])
        .png()
        .toBuffer();

    return maskedImage;
}

async function createComposite(coronaBuffer, sunDiskBuffer) {
    const width = 1920;
    const height = 1200;
    
    // Apply the feathering to the sun disk image
    const featheredSunDisk = await applyCircularFeather(sunDiskBuffer, 1435, 400, 40);
    
    // Determine the final canvas size
    const finalWidth = Math.max(width, 1435);
    const finalHeight = Math.max(height, 1435);

    // Composite the images
    const finalImage = await sharp({
        create: {
            width: finalWidth,
            height: finalHeight,
            channels: 4, // Use 4 channels for RGBA
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
    })
    .composite([
        { input: coronaBuffer, gravity: 'center' },
        { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
    ])
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();

    return finalImage;
}