import sharp from 'sharp';
import fetch from 'node-fetch';

async function testSharp() {
    const date = '2025-08-23T12:00:00.000Z';
    const url = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Fetching:', url);
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    const bufferData = Buffer.from(buffer);
    
    console.log('Buffer size:', bufferData.length);
    
    // Test Sharp processing
    const processed = await sharp(bufferData)
        .resize(1435, 1435)
        .toBuffer();
    
    console.log('✅ Sharp processing successful!');
    console.log('Output size:', processed.length);
}

testSharp().catch(console.error);