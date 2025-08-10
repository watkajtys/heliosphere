import express from 'express';
import sharp from 'sharp';
import fetch from 'node-fetch';

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
	isoDate: string,
	apiKey: string,
	sourceId: number,
	imageScale: number,
	width: number,
	height: number,
): Promise<Buffer> {
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

	return response.buffer();
}

/**
 * Fetches a composite image of the sun, with the corona and the solar disk.
 * This function fetches two separate images from the Helioviewer API and composites them together.
 * @param isoDate The date of the image to fetch in ISO format.
 * @param apiKey The NASA API key to use for the request.
 * @returns A promise that resolves to the composited image data as a Buffer.
 */
async function fetchCompositeImage(isoDate: string, apiKey: string): Promise<Buffer> {
	const width = 1920;
	const height = 1200;

	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	const sunDiskImageScale = 1920 / width;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, height);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	const sunDiameterInCoronaImage = Math.round(1920 / coronaImageScale);
	const resizedSunDisk = await sharp(sunDiskImage).resize(sunDiameterInCoronaImage, sunDiameterInCoronaImage).toBuffer();

	const finalImage = await sharp(coronaImage)
		.composite([{ input: resizedSunDisk, gravity: 'center' }])
		.png()
		.toBuffer();

	return finalImage;
}

const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
	const now = '2023-01-01T00:00:00Z';
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';

	try {
		const imageBuffer = await fetchCompositeImage(now, apiKey);
		res.set('Content-Type', 'image/png');
		res.send(imageBuffer);
	} catch (error) {
		console.error('Error fetching composite image:', error);
		res.status(500).send('An error occurred while fetching the composite image.');
	}
});

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
