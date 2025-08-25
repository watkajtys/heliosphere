import fs from 'fs/promises';

// Test fetching a single frame
async function testAPI() {
    const date = '2025-08-20T12:00:00.000Z';
    const coronaUrl = `https://api.helioviewer.org/v2/takeScreenshot/?date=${date}&layers=[4,1,100]&imageScale=4.8&width=1920&height=1920&x0=0&y0=0&display=true&watermark=false`;
    
    console.log('Testing API with URL:', coronaUrl);
    
    try {
        const response = await fetch(coronaUrl);
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers.get('content-type'));
        
        if (!response.ok) {
            const text = await response.text();
            console.log('Error response:', text);
            return;
        }
        
        const buffer = await response.arrayBuffer();
        console.log('Response size:', buffer.byteLength, 'bytes');
        
        // Save to file to inspect
        await fs.writeFile('/tmp/test_corona.jpg', Buffer.from(buffer));
        console.log('Saved to /tmp/test_corona.jpg');
        
        // Try to process with sharp
        const sharp = (await import('sharp')).default;
        const metadata = await sharp(Buffer.from(buffer)).metadata();
        console.log('Image metadata:', metadata);
        
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testAPI();