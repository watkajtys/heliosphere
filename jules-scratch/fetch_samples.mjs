import fs from 'fs/promises';

/**
 * Fetches an image from the Helioviewer API for a single data source.
 * @param isoDate The date of the image to fetch in ISO format.
 * @param apiKey The NASA API key to use for the request.
 * @param sourceId The ID of the data source to fetch the image from.
 * @param imageScale The scale of the image in arcseconds per pixel.
 * @param width The width of the image in pixels.
 * @param height The height of the image in pixels.
 * @returns A promise that resolves to the image data as an ArrayBuffer.
 */
async function fetchHelioviewerImage(
	isoDate,
	apiKey,
	sourceId,
	imageScale,
	width,
	height,
    filename
) {
	const apiUrl = new URL('https://api.helioviewer.org/v2/takeScreenshot/');
	apiUrl.searchParams.set('date', isoDate);
	apiUrl.searchParams.set('layers', `[${sourceId},1,100]`);
	apiUrl.searchParams.set('imageScale', imageScale.toString());
	apiUrl.searchParams.set('width', width.toString());
	apiUrl.searchParams.set('height', height.toString());
	apiUrl.searchParams.set('x0', '0');
	apiUrl.searchParams.set('y0', '0');
	apiUrl.searchParams.set('display', 'true');
	apiUrl.searchParams.set('watermark', 'false');

	console.log(`Fetching Helioviewer image from: ${apiUrl.toString()}`);

	const response = await fetch(apiUrl.toString(), {
		headers: {
			'X-API-Key': apiKey,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Helioviewer API request failed with status ${response.status}: ${errorText}`);
	}

	const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
	await fs.writeFile(filename, buffer);
    console.log(`Image saved to ${filename}`);
}

const isoDate = '2023-01-01T00:00:00Z';
const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
const width = 1920;
const height = 1200;

// Fetch Corona Image (SOHO/LASCO C2)
const coronaImageScale = 8;
await fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height, 'jules-scratch/corona_sample.png');

// Fetch Sun Disk Image (SDO/AIA 171)
const sunDiskImageScale = 2.5;
// Fetch a square image for the sun disk
await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width, 'jules-scratch/sundisk_sample.png');
