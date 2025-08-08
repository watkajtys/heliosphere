import Vips from '@carlsverre/wasm-vips';

/**
 * Creates a composite image from SDO and SOHO image buffers.
 * @param {ArrayBuffer} sdoBuffer - The raw buffer for the SDO image.
 * @param {ArrayBuffer} sohoBuffer - The raw buffer for the SOHO image.
 * @returns {Promise<ArrayBuffer>} A JPEG buffer of the final composite image.
 */
export async function createCompositeImage(sdoBuffer, sohoBuffer) {
  const vips = await Vips();

  const sdoImage = vips.Image.newFromBuffer(sdoBuffer);
  const sohoImage = vips.Image.newFromBuffer(sohoBuffer);

  const resizedSdoImage = sdoImage.resize(512 / sdoImage.width);

  const x_pos = (sohoImage.width - resizedSdoImage.width) / 2;
  const y_pos = (sohoImage.height - resizedSdoImage.height) / 2;

  const finalImage = sohoImage.composite([resizedSdoImage], 'over', {
    x: [x_pos],
    y: [y_pos]
  });

  const finalBuffer = finalImage.writeToBuffer('.jpg');

  return finalBuffer;
}
