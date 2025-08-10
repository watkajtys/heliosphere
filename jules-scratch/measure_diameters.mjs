import sharp from 'sharp';

async function measureSunDisk() {
  const image = sharp('jules-scratch/sundisk_sample.png');
  const metadata = await image.metadata();
  const { width, height } = metadata;
  const raw = await image.raw().toBuffer();

  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * metadata.channels;
      // Check if pixel is not black (r=g=b=0)
      if (raw[idx] > 10 || raw[idx + 1] > 10 || raw[idx + 2] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const diameterX = maxX - minX;
  const diameterY = maxY - minY;
  console.log(`Sun disk bounding box: (${minX}, ${minY}) to (${maxX}, ${maxY})`);
  console.log(`Sun disk diameter X: ${diameterX}`);
  console.log(`Sun disk diameter Y: ${diameterY}`);
}

async function measureOccultingDisk() {
  const image = sharp('jules-scratch/corona_sample.png');
  const metadata = await image.metadata();
  const { width, height } = metadata;
  const raw = await image.raw().toBuffer();
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  let rightEdge = centerX;
  while (rightEdge < width) {
    const idx = (centerY * width + rightEdge) * metadata.channels;
    if (raw[idx] > 10 || raw[idx + 1] > 10 || raw[idx + 2] > 10) {
      break;
    }
    rightEdge++;
  }

  let leftEdge = centerX;
  while (leftEdge > 0) {
    const idx = (centerY * width + leftEdge) * metadata.channels;
    if (raw[idx] > 10 || raw[idx + 1] > 10 || raw[idx + 2] > 10) {
      break;
    }
    leftEdge--;
  }

  const diameterX = rightEdge - leftEdge;
  console.log(`Occulting disk center: (${centerX}, ${centerY})`);
  console.log(`Occulting disk left edge: ${leftEdge}, right edge: ${rightEdge}`);
  console.log(`Occulting disk diameter X: ${diameterX}`);
}

async function main() {
  await measureSunDisk();
  console.log('---');
  await measureOccultingDisk();
}

main();
