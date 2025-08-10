import express from 'express';
import sharp from 'sharp';

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
	apiUrl.search_params.set('width', width.toString());
	apiUrl.search_params.set('height', height.toString());
	apiUrl.search_params.set('x0', '0');
	apiUrl.search_params.set('y0', '0');
	apiUrl.search_params.set('display', 'true');
	apiUrl.search_params.set('watermark', 'false');

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
	return Buffer.from(arrayBuffer);
}

/**
 * Measures the diameter of the occulting disk in a COR2 image.
 * @param imageBuffer The image data as a Buffer.
 * @returns A promise that resolves to the diameter of the disk in pixels.
 */
async function measureOccultingDisk(imageBuffer: Buffer): Promise<number> {
	const { data, info } = await sharp(imageBuffer)
		.raw()
		.toBuffer({ resolveWithObject: true });

	const { width, height, channels } = info;
	const centerX = Math.floor(width / 2);
	const centerY = Math.floor(height / 2);

	let rightEdge = centerX;
	for (let x = centerX; x < width; x++) {
		const idx = (centerY * width + x) * channels;
		// Check if pixel is not black (threshold > 10)
		if (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10) {
			rightEdge = x;
			break;
		}
	}

	let leftEdge = centerX;
	for (let x = centerX; x > 0; x--) {
		const idx = (centerY * width + x) * channels;
		if (data[idx] > 10 || data[idx + 1] > 10 || data[idx + 2] > 10) {
			leftEdge = x;
			break;
		}
	}

	return rightEdge - leftEdge;
}

/**
 * Measures the diameter of the sun's disk in an AIA image using a gradient-based method.
 * @param imageBuffer The image data as a Buffer.
 * @returns A promise that resolves to the diameter of the sun disk in pixels.
 */
async function measureSunDisk(imageBuffer: Buffer): Promise<number> {
	const { data, info } = await sharp(imageBuffer)
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const { width, height } = info;
	const centerY = Math.floor(height / 2);

	const pixels = new Array(width);
	for (let x = 0; x < width; x++) {
		pixels[x] = data[centerY * width + x];
	}

	// Simple gradient calculation
	const gradient = new Array(width - 1);
	for (let i = 0; i < width - 1; i++) {
		gradient[i] = pixels[i + 1] - pixels[i];
	}

	const edge1 = gradient.indexOf(Math.max(...gradient));
	const edge2 = gradient.indexOf(Math.min(...gradient));

	const leftEdge = Math.min(edge1, edge2);
	const rightEdge = Math.max(edge1, edge2);

	return rightEdge - leftEdge;
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

	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	// Dynamically measure the diameters of the occulting disk and the sun disk.
	const [occultingDiskDiameter, sunDiskDiameter] = await Promise.all([
		measureOccultingDisk(coronaImage),
		measureSunDisk(sunDiskImage),
	]);

	console.log(`Measured occulting disk diameter: ${occultingDiskDiameter}px`);
	console.log(`Measured sun disk diameter: ${sunDiskDiameter}px`);

	// The sun disk image needs to be resized so that the sun's diameter
	// matches the occulting disk in the corona image.
	const sunDiskImageWidth = 1920; // The original width of the fetched sun disk image
	const newSunDiskWidth = Math.round(sunDiskImageWidth * (occultingDiskDiameter / sunDiskDiameter));

	console.log(`Resizing sun disk image to: ${newSunDiskWidth}px`);

	const resizedSunDisk = await sharp(sunDiskImage)
		.resize(newSunDiskWidth, newSunDiskWidth)
		.toBuffer();

	const finalImage = await sharp(coronaImage)
		.composite([{ input: resizedSunDisk, gravity: 'center', blend: 'screen' }])
		.png()
		.toBuffer();

	return finalImage;
}

const app = express();
const port = process.env.PORT || 3000;

app.get('/', async (req, res) => {
	// By default, use the current date. Note: The Helioviewer API may sometimes return
	// unexpected or misaligned image data for the latest images. If you experience
	// issues, you can pass a specific date in the query string (e.g., ?date=2023-01-01T00:00:00Z)
	// or hardcode a known good date here for consistency.
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';

	try {
		const imageBuffer = await fetchCompositeImage(isoDate, apiKey);
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
