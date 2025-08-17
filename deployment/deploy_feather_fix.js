#!/usr/bin/env node

import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function deployFeatherFix() {
    console.log('🔧 Deploying feather fix to VPS...');
    
    // Create the updated feather function
    const fixedFeatherFunction = `
// Apply square feathering with proper smooth edges
async function applySquareFeather(imageBuffer, finalSize, compositeRadius, featherRadius) {
    const resizedImage = await sharp(imageBuffer)
        .resize(finalSize, finalSize, {
            kernel: sharp.kernel.lanczos3,
            withoutEnlargement: false
        })
        .toBuffer();

    if (featherRadius <= 0) return resizedImage;

    // Create a feathered square mask using a simpler approach
    const maskSize = finalSize;
    const center = maskSize / 2;
    
    // Create the mask with a white square and gaussian blur for feathering
    const maskSvg = \`
        <svg width="\${maskSize}" height="\${maskSize}">
            <defs>
                <filter id="feather">
                    <feGaussianBlur stdDeviation="\${featherRadius / 2}" />
                </filter>
            </defs>
            <rect x="\${center - compositeRadius}" 
                  y="\${center - compositeRadius}" 
                  width="\${compositeRadius * 2}" 
                  height="\${compositeRadius * 2}" 
                  fill="white" 
                  filter="url(#feather)" />
        </svg>
    \`;
    
    // Generate the mask
    const mask = await sharp(Buffer.from(maskSvg))
        .resize(finalSize, finalSize)
        .greyscale()
        .toBuffer();
    
    // Apply the mask to the image
    return await sharp(resizedImage)
        .composite([{
            input: mask,
            blend: 'dest-in'
        }])
        .png()
        .toBuffer();
}`;

    // Read current production script
    console.log('📖 Reading production script...');
    const { stdout: currentScript } = await execAsync('ssh vps "cat /opt/heliosphere/vps_daily_production.js"');
    
    // Find and replace the applySquareFeather function
    const functionStart = currentScript.indexOf('async function applySquareFeather');
    const functionEnd = currentScript.indexOf('\n}\n', functionStart) + 2;
    
    if (functionStart === -1) {
        throw new Error('Could not find applySquareFeather function');
    }
    
    const updatedScript = 
        currentScript.substring(0, functionStart) + 
        fixedFeatherFunction.trim() + 
        currentScript.substring(functionEnd);
    
    // Write to temp file and deploy
    console.log('📝 Writing updated script...');
    await fs.writeFile('vps_daily_production_fixed.js', updatedScript);
    
    console.log('🚀 Deploying to VPS...');
    await execAsync('scp vps_daily_production_fixed.js vps:/opt/heliosphere/vps_daily_production.js');
    
    console.log('✅ Feather fix deployed successfully!');
    
    // Clean up
    await fs.unlink('vps_daily_production_fixed.js');
    
    // Start production with the fixed feathering
    console.log('🎬 Starting production with fixed feathering...');
    await execAsync('ssh vps "cd /opt/heliosphere && nohup node vps_daily_production.js --run > production.log 2>&1 &"');
    
    console.log('✨ Production restarted with proper square feathering!');
}

deployFeatherFix().catch(console.error);