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
	return Buffer.from(arrayBuffer);
}


const app = express();
const port = process.env.PORT || 3002;

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resizes image to fixed size with composite radius and optional feather.
 * @param imageBuffer The image to process.
 * @param finalSize The target size for the image (fixed at 1435px).
 * @param compositeRadius The radius of the composite area.
 * @param featherRadius The radius of the feather effect.
 * @returns A promise that resolves to the processed image buffer.
 */
async function applyCircularFeather(imageBuffer: Buffer, finalSize: number, compositeRadius: number, featherRadius: number): Promise<Buffer> {
	// First, resize the image to the final size.
	const resizedImage = await sharp(imageBuffer)
		.resize(finalSize, finalSize)
		.toBuffer();

	// If feathering is zero, no need to apply a mask.
	if (featherRadius <= 0) {
		return resizedImage;
	}

	// Create an SVG for the feathered mask.
	const imageRadius = finalSize / 2;
	const compositeRatio = compositeRadius / imageRadius;
	const featherStart = Math.max(0, compositeRadius - featherRadius);
	const featherStartRatio = featherStart / imageRadius;
	
	const svgMask = `
		<svg width="${finalSize}" height="${finalSize}">
			<defs>
				<radialGradient id="feather" cx="50%" cy="50%" r="50%">
					<stop offset="0%" style="stop-color:white;stop-opacity:1" />
					<stop offset="${featherStartRatio * 100}%" style="stop-color:white;stop-opacity:1" />
					<stop offset="${compositeRatio * 100}%" style="stop-color:white;stop-opacity:0" />
				</radialGradient>
			</defs>
			<circle cx="50%" cy="50%" r="50%" fill="url(#feather)" />
		</svg>
	`;

	const mask = await sharp(Buffer.from(svgMask)).png().toBuffer();

	// Apply the mask as an alpha channel to the resized image.
	const maskedImage = await sharp(resizedImage)
		.composite([{
			input: mask,
			blend: 'dest-in' // Use the mask to define the alpha channel.
		}])
		.png()
		.toBuffer();

	return maskedImage;
}


/**
 * Creates a composite image with a tuned sun disk.
 * @param isoDate The date of the image to fetch.
 * @param apiKey The NASA API key.
 * @param compositeRadius The radius of the composite area.
 * @param featherRadius The radius to feather the sun disk edge.
 * @returns A promise that resolves to the composited image buffer.
 */
async function createTunedCompositeImage(isoDate: string, apiKey: string, compositeRadius: number, featherRadius: number): Promise<Buffer> {
	const width = 1920;
	const height = 1200;

	// Fetch corona image (SOHO/LASCO C2)
	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	// Fetch sun disk image (SDO/AIA 171)
	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	// Fixed SDO size at 1435px
	const sdoSize = 1435;
	
	// Apply the feathering to the sun disk image
	const featheredSunDisk = await applyCircularFeather(sunDiskImage, sdoSize, compositeRadius, featherRadius);

	// Determine the final canvas size
	const finalWidth = Math.max(width, sdoSize);
	const finalHeight = Math.max(height, sdoSize);

	// Composite the images
	const finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 4, // Use 4 channels for RGBA
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
	.composite([
		{ input: coronaImage, gravity: 'center' },
		{ input: featheredSunDisk, gravity: 'center', blend: 'screen' }
	])
	.png()
	.toBuffer();

	return finalImage;
}


// Endpoint to serve the tuning page
app.get('/tune', async (req, res) => {
	try {
		const htmlPath = path.join(__dirname, '../src/tuner.html');
		const htmlContent = await fs.readFile(htmlPath, 'utf-8');
		res.set('Content-Type', 'text/html');
		res.send(htmlContent);
	} catch (error) {
		console.error('Error reading tuner.html:', error);
		res.status(500).send('Error loading the tuning page.');
	}
});

// Endpoint to generate the composite image
app.get('/composite-image', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const compositeRadius = req.query.compositeRadius ? parseInt(req.query.compositeRadius as string) : 600;
	const featherRadius = req.query.featherRadius ? parseInt(req.query.featherRadius as string) : 40;

	try {
		const imageBuffer = await createTunedCompositeImage(isoDate, apiKey, compositeRadius, featherRadius);
		res.set('Content-Type', 'image/png');
		res.send(imageBuffer);
	} catch (error) {
		console.error('Error creating composite image:', error);
		res.status(500).send('An error occurred while creating the composite image.');
	}
});

// Serve the full-screen index page
app.get('/', async (req, res) => {
	try {
		const htmlPath = path.join(__dirname, '../src/index.html');
		const htmlContent = await fs.readFile(htmlPath, 'utf-8');
		res.set('Content-Type', 'text/html');
		res.send(htmlContent);
	} catch (error) {
		console.error('Error reading index.html:', error);
		res.status(500).send('Error loading the index page.');
	}
});



app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
