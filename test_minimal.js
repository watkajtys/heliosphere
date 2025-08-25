import sharp from 'sharp';

// Test 1: Direct buffer from fetch
async function test1() {
    const url = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-22T22:30:00.000Z&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false';
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    try {
        await sharp(buffer).resize(100, 100).toBuffer();
        console.log('✓ Test 1: Direct fetch works');
    } catch (e) {
        console.log('✗ Test 1 failed:', e.message);
    }
}

// Test 2: Test the exact applyCircularFeather function from script
async function applyCircularFeather(imageBuffer, finalSize = 1435) {
    try {
        const resizedImage = await sharp(imageBuffer)
            .resize(finalSize, finalSize)
            .toBuffer();
        return resizedImage;
    } catch (error) {
        throw error;
    }
}

async function test2() {
    const url = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-22T22:30:00.000Z&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false';
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    try {
        await applyCircularFeather(buffer);
        console.log('✓ Test 2: applyCircularFeather works');
    } catch (e) {
        console.log('✗ Test 2 failed:', e.message);
    }
}

// Test 3: Test with the exact flow from fetchImage
async function fetchImage() {
    const url = 'https://api.helioviewer.org/v2/takeScreenshot/?date=2025-08-22T22:30:00.000Z&layers=[10,1,100]&imageScale=1.87&width=1460&height=1200&x0=0&y0=0&display=true&watermark=false';
    const response = await fetch(url);
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('image')) {
        throw new Error('Invalid content type');
    }
    
    const buffer = await response.arrayBuffer();
    const bufferData = Buffer.from(buffer);
    
    if (bufferData.length < 8) {
        throw new Error('Too small');
    }
    
    const isPNG = bufferData[0] === 0x89 && bufferData[1] === 0x50;
    const isJPEG = bufferData[0] === 0xFF && bufferData[1] === 0xD8;
    
    if (!isPNG && !isJPEG) {
        throw new Error('Not PNG or JPEG');
    }
    
    return bufferData;
}

async function test3() {
    try {
        const buffer = await fetchImage();
        await applyCircularFeather(buffer);
        console.log('✓ Test 3: Full flow works');
    } catch (e) {
        console.log('✗ Test 3 failed:', e.message);
    }
}

await test1();
await test2();
await test3();