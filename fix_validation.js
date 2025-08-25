const fs = require('fs');

// Read the file
let content = fs.readFileSync('/opt/heliosphere/vps_daily_cron.js', 'utf8');

// Find and replace the validation section
const oldValidation = `        if (!response.ok) {
            throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        
        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer);`;

const newValidation = `        if (!response.ok) {
            throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        
        // Validate content type
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('image')) {
            throw new Error(\`Invalid content type: \${contentType}\`);
        }
        
        const buffer = await response.arrayBuffer();
        const bufferData = Buffer.from(buffer);
        
        // Validate image magic bytes
        if (bufferData.length < 8) {
            throw new Error('Response too small to be an image');
        }
        
        // Check for PNG or JPEG magic bytes
        const isPNG = bufferData[0] === 0x89 && bufferData[1] === 0x50;
        const isJPEG = bufferData[0] === 0xFF && bufferData[1] === 0xD8;
        
        if (!isPNG && !isJPEG) {
            throw new Error('Response is not a valid PNG or JPEG image');
        }
        
        return bufferData;`;

content = content.replace(oldValidation, newValidation);

// Write the fixed file
fs.writeFileSync('/opt/heliosphere/vps_daily_cron.js', content);
console.log('Added content validation to fetchImage');