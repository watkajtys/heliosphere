#!/bin/bash

# Deploy blur-based feathering to VPS

ssh vps 'cat > /opt/heliosphere/apply_square_feather.js << "EOF"
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const sharp = require("sharp");
    
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const squareLeft = center - compositeRadius;
    const squareTop = center - compositeRadius;

    if (featherRadius <= 0) return resizedImage;
    
    // Create a hard-edged square mask
    const hardMaskSvg = `
        <svg width="${finalSize}" height="${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${finalSize}" height="${finalSize}" fill="black"/>
            <rect x="${squareLeft}" y="${squareTop}" 
                  width="${squareSize}" height="${squareSize}" 
                  fill="white"/>
        </svg>
    `;
    
    // Apply blur using Sharp native blur to create feathering
    const mask = await sharp(Buffer.from(hardMaskSvg))
        .resize(finalSize, finalSize)
        .blur(featherRadius / 3)
        .toBuffer();
    
    // Apply the blurred mask
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: "dest-in"
        }])
        .png()
        .toBuffer();
}

module.exports = applySquareFeather;
EOF'

# Now update the production script to use this function
ssh vps 'node -e "
const fs = require(\"fs\");
let content = fs.readFileSync(\"/opt/heliosphere/vps_daily_production.js\", \"utf8\");

// Find the function
const start = content.indexOf(\"async function applySquareFeather\");
const end = content.indexOf(\"\\n}\\n\", start) + 2;

// Read the new function
const newFunc = fs.readFileSync(\"/opt/heliosphere/apply_square_feather.js\", \"utf8\");

// Replace
content = content.substring(0, start) + newFunc.replace(\"module.exports = applySquareFeather;\", \"\") + content.substring(end);

fs.writeFileSync(\"/opt/heliosphere/vps_daily_production.js\", content);
console.log(\"Deployed blur-based feathering\");
"'

echo "✅ Deployed"