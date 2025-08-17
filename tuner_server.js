#!/usr/bin/env node

import express from 'express';
import sharp from 'sharp';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);
const app = express();
const PORT = 3004;

// Serve static files from src directory
app.use(express.static('src'));

// Composite image endpoint with full color grading support
app.get('/composite-image', async (req, res) => {
    try {
        const {
            compositeRadius = 400,
            featherRadius = 40,
            featherShape = 'circle',
            squareWidth = 800,
            squareHeight = 800,
            cornerRadius = 50,
            
            // Corona color grading
            corona_saturation = 0.3,
            corona_brightness = 1.0,
            corona_hue = -5,
            corona_linearMult = 1.05,
            corona_linearOffset = -8,
            corona_gamma = 1.2,
            
            // Sun disk color grading  
            sundisk_saturation = 1.2,
            sundisk_brightness = 1.15,
            sundisk_hue = 15,
            sundisk_linearMult = 1.3,
            sundisk_linearOffset = -20,
            sundisk_gamma = 1.15,
            
            // Quality settings
            quality = 100,
            format = 'png',
            blendMode = 'screen'
        } = req.query;

        console.log('Generating composite with:', {
            featherShape,
            compositeRadius: parseInt(compositeRadius),
            featherRadius: parseInt(featherRadius),
            format,
            quality: parseInt(quality)
        });

        // Fetch corona image (SOHO/LASCO C2)
        const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-15T12:00:00.000Z&layers=%5B4,1,100%5D&imageScale=8&width=1920&height=1200&x0=0&y0=0&display=true&watermark=false`;
        await execAsync(`curl -s "${coronaUrl}" -o /tmp/corona_temp.png`);
        let coronaBuffer = await fs.readFile('/tmp/corona_temp.png');

        // Fetch sun disk image (SDO/AIA 171)
        const sdoUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-15T12:00:00.000Z&layers=%5B10,1,100%5D&imageScale=2.5&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false`;
        await execAsync(`curl -s "${sdoUrl}" -o /tmp/sdo_temp.png`);
        let sdoBuffer = await fs.readFile('/tmp/sdo_temp.png');

        // Apply corona color grading
        coronaBuffer = await sharp(coronaBuffer)
            .modulate({ 
                saturation: parseFloat(corona_saturation), 
                brightness: parseFloat(corona_brightness), 
                hue: parseInt(corona_hue) 
            })
            .tint({ r: 220, g: 230, b: 240 })
            .linear(parseFloat(corona_linearMult), parseInt(corona_linearOffset))
            .gamma(parseFloat(corona_gamma))
            .toBuffer();

        // Apply sun disk color grading
        sdoBuffer = await sharp(sdoBuffer)
            .modulate({ 
                saturation: parseFloat(sundisk_saturation), 
                brightness: parseFloat(sundisk_brightness), 
                hue: parseInt(sundisk_hue) 
            })
            .tint({ r: 255, g: 200, b: 120 })
            .linear(parseFloat(sundisk_linearMult), parseInt(sundisk_linearOffset))
            .gamma(parseFloat(sundisk_gamma))
            .toBuffer();

        // Apply feathering based on shape
        let featheredSunDisk;
        if (featherShape === 'square') {
            featheredSunDisk = await applySquareFeather(sdoBuffer, 1435, parseInt(compositeRadius), parseInt(featherRadius));
        } else {
            featheredSunDisk = await applyCircularFeather(sdoBuffer, 1435, parseInt(compositeRadius), parseInt(featherRadius));
        }

        // Create composite
        const composite = await sharp({
            create: {
                width: 1920,
                height: 1435,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([
            { input: coronaBuffer, gravity: 'center' },
            { input: featheredSunDisk, gravity: 'center', blend: blendMode }
        ]);

        // Output in requested format
        let outputBuffer;
        if (format === 'png') {
            outputBuffer = await composite.png().toBuffer();
            res.set('Content-Type', 'image/png');
        } else {
            outputBuffer = await composite.jpeg({ quality: parseInt(quality), mozjpeg: true }).toBuffer();
            res.set('Content-Type', 'image/jpeg');
        }

        res.send(outputBuffer);

    } catch (error) {
        console.error('Composite generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Circular feathering function
async function applyCircularFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    const resizedImage = await sharp(imageBuffer).resize(finalSize, finalSize).toBuffer();
    
    if (featherRadius <= 0) return resizedImage;
    
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
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

// Square feathering function - same size as circular, just square shape
async function applySquareFeather(imageBuffer, finalSize = 1435, compositeRadius = 400, featherRadius = 40) {
    const resizedImage = await sharp(imageBuffer).resize(finalSize, finalSize).toBuffer();
    
    if (featherRadius <= 0) return resizedImage;
    
    // Create square mask with same dimensions as circular
    const center = finalSize / 2;
    const squareSize = compositeRadius * 2;
    const left = center - compositeRadius;
    const top = center - compositeRadius;
    
    const svgMask = `
        <svg width="${finalSize}" height="${finalSize}">
            <defs>
                <linearGradient id="featherX" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${(100-featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
                <linearGradient id="featherY" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:white;stop-opacity:0" />
                    <stop offset="${(featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="${(100-featherRadius/squareSize*100)}%" style="stop-color:white;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:white;stop-opacity:0" />
                </linearGradient>
            </defs>
            <rect x="${left}" y="${top}" width="${squareSize}" height="${squareSize}" fill="url(#featherX)" />
            <rect x="${left}" y="${top}" width="${squareSize}" height="${squareSize}" fill="url(#featherY)" style="mix-blend-mode: multiply;" />
        </svg>
    `;

    const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();
    return await sharp(resizedImage)
        .composite([{ input: mask, blend: 'dest-in' }])
        .png()
        .toBuffer();
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎨 Tuner server running on http://localhost:${PORT}`);
    console.log(`🎯 Tuner interface: http://localhost:${PORT}/tuner.html`);
    console.log(`🖼️ Composite API: http://localhost:${PORT}/composite-image`);
});