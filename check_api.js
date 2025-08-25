import fetch from 'node-fetch';
import fs from 'fs';

async function checkAPI() {
    const date = '2025-08-23T12:00:00.000Z';
    
    // Test corona URL
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[4,1,100]&imageScale=2.42&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Corona URL:', coronaUrl);
    
    const response = await fetch(coronaUrl);
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers.get('content-type'));
    
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log('Size:', buffer.length);
    
    // Check if it's an error message
    if (buffer.length < 1000) {
        console.log('Content:', buffer.toString());
    }
    
    // Save for inspection
    fs.writeFileSync('/opt/heliosphere/corona_test.dat', buffer);
}

checkAPI().catch(console.error);