import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';

async function generateTestFrame() {
    // Use correct date format with T separator
    const date = new Date('2025-08-23T12:00:00Z');
    const formattedDate = date.toISOString();
    
    console.log('Testing frame generation...');
    console.log('Date:', formattedDate);
    
    // Fetch sun disk (SDO/AIA 171)
    const sunUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${formattedDate}&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Fetching sun disk...');
    const sunResponse = await fetch(sunUrl);
    if (!sunResponse.ok) {
        throw new Error(`Sun fetch failed: ${sunResponse.status}`);
    }
    const sunBuffer = Buffer.from(await sunResponse.arrayBuffer());
    console.log('✓ Sun disk fetched:', sunBuffer.length, 'bytes');
    
    // Fetch corona (SOHO/LASCO C2)
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${formattedDate}&layers=[4,1,100]&imageScale=2.42&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Fetching corona...');
    const coronaResponse = await fetch(coronaUrl);
    if (!coronaResponse.ok) {
        throw new Error(`Corona fetch failed: ${coronaResponse.status}`);
    }
    const coronaBuffer = Buffer.from(await coronaResponse.arrayBuffer());
    console.log('✓ Corona fetched:', coronaBuffer.length, 'bytes');
    
    // Process sun disk with feathering
    console.log('Processing sun disk...');
    const processedSun = await sharp(sunBuffer)
        .resize(1435, 1435)
        .toBuffer();
    console.log('✓ Sun processed');
    
    // Create composite
    console.log('Creating composite...');
    const composite = await sharp({
        create: {
            width: 1460,
            height: 1435,
            channels: 3,
            background: { r: 0, g: 0, b: 0 }
        }
    })
    .composite([
        { input: coronaBuffer, gravity: 'center' },
        { input: processedSun, gravity: 'center', blend: 'screen' }
    ])
    .resize(1460, 1200)
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
    
    // Save test frame
    fs.writeFileSync('/opt/heliosphere/test_frame.jpg', composite);
    console.log('✅ Test frame saved to /opt/heliosphere/test_frame.jpg');
    console.log('Frame size:', composite.length, 'bytes');
}

generateTestFrame().catch(console.error);