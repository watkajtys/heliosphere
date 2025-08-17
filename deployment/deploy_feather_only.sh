#!/bin/bash

# Deploy ONLY the fixed applySquareFeather function to VPS
# NO dimension changes!

ssh vps "cat > /tmp/update_feather.js << 'EOF'
const fs = require('fs');

// Read the production script
let content = fs.readFileSync('/opt/heliosphere/vps_daily_production.js', 'utf8');

// Find and replace ONLY the applySquareFeather function
const functionStart = content.indexOf('async function applySquareFeather');
const functionEnd = content.indexOf('\\n}\\n', functionStart) + 2;

// The FIXED feathering function with proper SVG
const fixedFunction = \`async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
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
    
    // FIXED: Proper SVG with namespace and correct filter
    const maskSvg = \\\`
        <svg width=\"\\\${finalSize}\" height=\"\\\${finalSize}\" xmlns=\"http://www.w3.org/2000/svg\">
            <defs>
                <filter id=\"feather\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\">
                    <feGaussianBlur in=\"SourceGraphic\" stdDeviation=\"\\\${featherRadius / 3}\" />
                </filter>
            </defs>
            <rect width=\"\\\${finalSize}\" height=\"\\\${finalSize}\" fill=\"black\"/>
            <rect x=\"\\\${squareLeft}\" 
                  y=\"\\\${squareTop}\" 
                  width=\"\\\${squareSize}\" 
                  height=\"\\\${squareSize}\" 
                  fill=\"white\" 
                  filter=\"url(#feather)\" />
        </svg>
    \\\`;
    
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .png()
        .toBuffer();
    
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}\`;

// Replace the function
content = content.substring(0, functionStart) + fixedFunction + content.substring(functionEnd);

// Write the updated file
fs.writeFileSync('/opt/heliosphere/vps_daily_production.js', content);
console.log('Updated feathering function only - no dimension changes');
EOF

node /tmp/update_feather.js"

echo "✅ Deployed fixed feathering - dimensions unchanged"