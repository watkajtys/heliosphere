import fetch from 'node-fetch';
import sharp from 'sharp';

async function tryDate(dateStr) {
    const url = `https://api.helioviewer.org/v2/takeScreenshot/?date=${dateStr}&layers=[4,1,100]&imageScale=2.42&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false`;
    
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    
    // Check if it's a real image (not blank)
    const metadata = await sharp(buffer).metadata();
    const isValid = buffer.length > 50000; // Real corona images are usually >100KB
    
    console.log(`${dateStr}: ${buffer.length} bytes - ${isValid ? '✓ VALID' : '✗ BLANK'}`);
    return isValid;
}

async function findValidDates() {
    console.log('Searching for valid SOHO/LASCO C2 data...\n');
    
    const dates = [
        '2025-08-23T12:00:00.000Z',
        '2025-08-20T12:00:00.000Z',
        '2025-08-15T12:00:00.000Z',
        '2025-08-10T12:00:00.000Z',
        '2025-08-01T12:00:00.000Z',
        '2025-07-15T12:00:00.000Z',
        '2025-07-01T12:00:00.000Z',
        '2025-06-15T12:00:00.000Z',
        '2025-06-01T12:00:00.000Z',
        '2024-08-23T12:00:00.000Z',
        '2024-01-01T12:00:00.000Z',
    ];
    
    for (const date of dates) {
        await tryDate(date);
        await new Promise(r => setTimeout(r, 500)); // Rate limit
    }
}

findValidDates().catch(console.error);