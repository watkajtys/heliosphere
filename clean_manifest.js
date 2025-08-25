const fs = require('fs');

// Read manifest
const manifest = JSON.parse(fs.readFileSync('/opt/heliosphere/frame_manifest.json', 'utf8'));

// Count before
const totalBefore = Object.keys(manifest).length;
const failedBefore = Object.values(manifest).filter(e => e.status === 'failed').length;

// Remove all failed entries
for (const key in manifest) {
    if (manifest[key].status === 'failed') {
        delete manifest[key];
    }
}

// Count after
const totalAfter = Object.keys(manifest).length;

console.log('Cleaned manifest:');
console.log(`  Before: ${totalBefore} total, ${failedBefore} failed`);
console.log(`  After: ${totalAfter} total (removed ${failedBefore} failed entries)`);

// Write cleaned manifest
fs.writeFileSync('/opt/heliosphere/frame_manifest.json', JSON.stringify(manifest, null, 2));