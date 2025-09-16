const https = require('https');

function test(dateStr, label) {
    const url = 'https://api.helioviewer.org/v2/takeScreenshot/?' +
        'date=' + dateStr +
        '&imageScale=2.5&layers=[4,1,100]&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false';
    
    console.log(`\nTesting ${label}:`);
    console.log('Date:', dateStr);
    
    https.get(url, (res) => {
        console.log('Status:', res.statusCode);
        console.log('Content-Type:', res.headers['content-type']);
        
        if (res.statusCode !== 200 || !res.headers['content-type'].includes('image')) {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                // Try to find error message
                const titleMatch = body.match(/<title>(.*?)<\/title>/);
                const h1Match = body.match(/<h1>(.*?)<\/h1>/);
                const errorMatch = body.match(/error[^<]*/i);
                
                if (titleMatch) console.log('Title:', titleMatch[1]);
                if (h1Match) console.log('H1:', h1Match[1]);
                if (errorMatch) console.log('Error found:', errorMatch[0].substring(0, 100));
            });
        }
    }).on('error', (err) => {
        console.error('Network error:', err.message);
    });
}

// Test different date formats
test('2025-07-08T00:00:00.000Z', 'with milliseconds');
setTimeout(() => test('2025-07-08T00:00:00Z', 'without milliseconds'), 1000);
setTimeout(() => test('2025-07-08T00:00:00', 'no Z'), 2000);