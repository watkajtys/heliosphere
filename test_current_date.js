import fs from 'fs/promises';

async function testAPI() {
    // Test with 48-hour delay from today
    const now = new Date();
    now.setDate(now.getDate() - 2);
    const date = now.toISOString();
    
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[4,1,100]&imageScale=4.8&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Testing with date:', date);
    console.log('URL:', coronaUrl);
    
    try {
        const response = await fetch(coronaUrl);
        console.log('Response status:', response.status);
        console.log('Content-Type:', response.headers.get('content-type'));
        
        const buffer = await response.arrayBuffer();
        console.log('Size:', buffer.byteLength, 'bytes');
        
        // Test sharp processing
        const sharp = (await import('sharp')).default;
        const processed = await sharp(Buffer.from(buffer))
            .resize(1435, 1435)
            .jpeg({ quality: 95, mozjpeg: true })
            .toBuffer();
        
        console.log('Processed size:', processed.byteLength, 'bytes');
        console.log('✅ Success - Sharp can process this image');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testAPI();