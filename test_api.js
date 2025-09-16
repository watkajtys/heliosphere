const https = require('https');

const CONFIG = {
    FRAME_WIDTH: 1460,
    FRAME_HEIGHT: 1200
};

function testFetch(sourceId, date) {
    const imageScale = sourceId === 10 ? 1.87 : 2.5;
    
    // Build URL with string concatenation to avoid encoding brackets
    const apiParams = 
        `date=${date}` +
        `&imageScale=${imageScale}` +
        `&layers=[${sourceId},1,100]` +
        `&width=${CONFIG.FRAME_WIDTH}` +
        `&height=${CONFIG.FRAME_HEIGHT}` +
        `&x0=0&y0=0` +
        `&display=true&watermark=false`;
    
    const url = `https://api.helioviewer.org/v2/takeScreenshot/?${apiParams}`;
    
    console.log(`Testing ${sourceId === 4 ? 'corona' : 'sun'} with URL:`);
    console.log(url);
    
    https.get(url, (res) => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Content-Type: ${res.headers['content-type']}`);
        
        if (res.statusCode === 200 && res.headers['content-type'].includes('image')) {
            console.log('✅ Success!\n');
        } else {
            console.log('❌ Failed!\n');
            
            // Read response body for error
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                console.log('Response preview:', body.substring(0, 200));
            });
        }
    }).on('error', (err) => {
        console.error('Error:', err.message);
    });
}

// Test both
const testDate = '2025-07-08T00:00:00.000Z';
testFetch(4, testDate);   // Corona
testFetch(10, testDate);  // Sun