#!/bin/bash

# Update the applySquareFeather function in production script
cat << 'EOF' > /tmp/update_feather.js
const fs = require('fs');

// Read the production script
let content = fs.readFileSync('/opt/heliosphere/vps_daily_production.js', 'utf8');

// New feathering function
const newFunction = `async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
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
    
    // Create a proper square feather mask with smooth edges
    const svgMask = \`
        <svg width="\${finalSize}" height="\${finalSize}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <mask id="squareFeather">
                    <rect width="\${finalSize}" height="\${finalSize}" fill="black"/>
                    
                    <!-- White square with feathered edges -->
                    <rect x="\${squareLeft}" 
                          y="\${squareTop}" 
                          width="\${squareSize}" 
                          height="\${squareSize}" 
                          fill="white"
                          rx="\${featherRadius}"
                          ry="\${featherRadius}"
                          style="filter: blur(\${featherRadius * 0.5}px)"/>
                </mask>
            </defs>
            
            <rect width="\${finalSize}" height="\${finalSize}" fill="white" mask="url(#squareFeather)"/>
        </svg>
    \`;

    const mask = await sharp(Buffer.from(svgMask))
        .ensureAlpha()
        .extractChannel('alpha')
        .toBuffer();
        
    return await sharp(resizedImage)
        .ensureAlpha()
        .joinChannel(mask)
        .png()
        .toBuffer();
}`;

// Replace the function
const functionStart = content.indexOf('async function applySquareFeather');
const functionEnd = content.indexOf('\n}\n', content.indexOf('async function applySquareFeather')) + 2;
content = content.substring(0, functionStart) + newFunction + content.substring(functionEnd);

// Write the updated file
fs.writeFileSync('/opt/heliosphere/vps_daily_production.js', content);
console.log('Updated feathering function');
EOF

node /tmp/update_feather.js