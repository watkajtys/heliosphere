import fetch from 'node-fetch';
import sharp from 'sharp';
import fs from 'fs/promises';

async function testFrame(date) {
    console.log('Testing frame:', date);
    
    // Test SDO sun disk
    const sdoUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    const sohoUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[4,1,100]&imageScale=2.5&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    try {
        // Download SDO
        const sdoResp = await fetch(sdoUrl);
        const sdoBuffer = Buffer.from(await sdoResp.arrayBuffer());
        const sdoMeta = await sharp(sdoBuffer).metadata();
        console.log('  SDO:', sdoMeta.width, 'x', sdoMeta.height, 'format:', sdoMeta.format);
        await fs.writeFile(`/tmp/test_sdo_${date.split('T')[0]}.jpg`, sdoBuffer);
        
        // Download SOHO
        const sohoResp = await fetch(sohoUrl);
        const sohoBuffer = Buffer.from(await sohoResp.arrayBuffer());
        const sohoMeta = await sharp(sohoBuffer).metadata();
        console.log('  SOHO:', sohoMeta.width, 'x', sohoMeta.height, 'format:', sohoMeta.format);
        await fs.writeFile(`/tmp/test_soho_${date.split('T')[0]}.jpg`, sohoBuffer);
        
    } catch (error) {
        console.log('  Error:', error.message);
    }
}

// Test recent dates
const testDates = [
    '2025-08-22T12:00:00.000Z',
    '2025-08-21T12:00:00.000Z', 
    '2025-08-20T12:00:00.000Z',
    '2025-07-01T12:00:00.000Z',
    '2025-06-26T12:00:00.000Z'
];

for (const date of testDates) {
    await testFrame(date);
}