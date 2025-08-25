import fetch from 'node-fetch';
import fs from 'fs';
import sharp from 'sharp';

async function checkCorona() {
    const date = '2025-08-23T12:00:00.000Z';
    
    // Try corona URL
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[4,1,100]&imageScale=2.42&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Fetching corona...');
    const res = await fetch(coronaUrl);
    const buffer = Buffer.from(await res.arrayBuffer());
    
    console.log('Corona response:');
    console.log('- Status:', res.status);
    console.log('- Size:', buffer.length, 'bytes');
    
    // Save and check dimensions
    fs.writeFileSync('/opt/heliosphere/corona_check.png', buffer);
    
    const metadata = await sharp(buffer).metadata();
    console.log('- Dimensions:', metadata.width, 'x', metadata.height);
    console.log('- Format:', metadata.format);
    
    // If it's small, it might be an error image
    if (buffer.length < 50000) {
        console.log('⚠️ Corona image is suspiciously small!');
        
        // Try saving as text to see if it's an error message
        if (buffer.length < 5000) {
            console.log('Content (if text):', buffer.toString().substring(0, 200));
        }
    }
}

checkCorona().catch(console.error);