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

/**
 * Detects the occulting disk in a corona image using edge detection
 * @param imageBuffer The corona image buffer
 * @returns Promise resolving to {centerX, centerY, radius} or null if not found
 */
async function detectOccultingDisk(imageBuffer: Buffer): Promise<{centerX: number, centerY: number, radius: number} | null> {
	try {
		// Convert to grayscale and apply edge detection
		const { data, info } = await sharp(imageBuffer)
			.grayscale()
			.normalise()
			.toBuffer({ resolveWithObject: true });
		
		const width = info.width;
		const height = info.height;
		
		// Simple circle detection approach: find the strongest circular edge
		// Look for the dark circular region in the center (occulting disk)
		let bestCircle = null;
		let maxScore = 0;
		
		// Search in the center region
		const centerX = Math.floor(width / 2);
		const centerY = Math.floor(height / 2);
		
		// Try different radii around expected occulting disk size
		for (let radius = 250; radius <= 350; radius += 5) {
			let score = 0;
			let samples = 0;
			
			// Sample points around the circle
			for (let angle = 0; angle < 360; angle += 10) {
				const x = Math.floor(centerX + radius * Math.cos(angle * Math.PI / 180));
				const y = Math.floor(centerY + radius * Math.sin(angle * Math.PI / 180));
				
				if (x >= 0 && x < width && y >= 0 && y < height) {
					const pixelIndex = (y * width + x);
					const intensity = data[pixelIndex];
					
					// Look for sharp intensity changes (edges)
					const innerX = Math.floor(centerX + (radius - 10) * Math.cos(angle * Math.PI / 180));
					const innerY = Math.floor(centerY + (radius - 10) * Math.sin(angle * Math.PI / 180));
					
					if (innerX >= 0 && innerX < width && innerY >= 0 && innerY < height) {
						const innerIndex = (innerY * width + innerX);
						const innerIntensity = data[innerIndex];
						
						// Score based on intensity difference (edge strength)
						score += Math.abs(intensity - innerIntensity);
						samples++;
					}
				}
			}
			
			if (samples > 0) {
				score = score / samples;
				if (score > maxScore) {
					maxScore = score;
					bestCircle = { centerX, centerY, radius };
				}
			}
		}
		
		console.log(`Detected occulting disk: center(${bestCircle?.centerX}, ${bestCircle?.centerY}), radius=${bestCircle?.radius}, score=${maxScore}`);
		return bestCircle;
	} catch (error) {
		console.error('Error detecting occulting disk:', error);
		return null;
	}
}

/**
 * Estimates the sun disk radius using edge detection
 * @param imageBuffer The sun disk image buffer
 * @returns Promise resolving to estimated radius or null if not found
 */
async function detectSunDiskRadius(imageBuffer: Buffer): Promise<number | null> {
	try {
		const { data, info } = await sharp(imageBuffer)
			.grayscale()
			.normalise()
			.toBuffer({ resolveWithObject: true });
		
		const width = info.width;
		const height = info.height;
		const centerX = Math.floor(width / 2);
		const centerY = Math.floor(height / 2);
		
		// Sample multiple radial directions to find sun edge
		const detectedRadii: number[] = [];
		
		for (let angle = 0; angle < 360; angle += 15) {
			let maxGradient = 0;
			let edgeRadius = 0;
			
			// Walk from center outward
			for (let r = 200; r < Math.min(width, height) / 2 - 50; r += 2) {
				const x = Math.floor(centerX + r * Math.cos(angle * Math.PI / 180));
				const y = Math.floor(centerY + r * Math.sin(angle * Math.PI / 180));
				
				if (x >= 1 && x < width - 1 && y >= 1 && y < height - 1) {
					// Calculate gradient
					const current = data[y * width + x];
					const next = data[y * width + (x + 1)];
					const prev = data[y * width + (x - 1)];
					
					const gradient = Math.abs(next - prev) / 2;
					
					if (gradient > maxGradient && current > 50) { // Avoid too-dark regions (prominences)
						maxGradient = gradient;
						edgeRadius = r;
					}
				}
			}
			
			if (edgeRadius > 0 && maxGradient > 10) { // Threshold for significant edge
				detectedRadii.push(edgeRadius);
			}
		}
		
		if (detectedRadii.length < 8) { // Need enough samples
			console.log('Not enough reliable edge detections for sun disk');
			return null;
		}
		
		// Remove outliers and average
		detectedRadii.sort((a, b) => a - b);
		const q1 = detectedRadii[Math.floor(detectedRadii.length * 0.25)];
		const q3 = detectedRadii[Math.floor(detectedRadii.length * 0.75)];
		const filteredRadii = detectedRadii.filter(r => r >= q1 && r <= q3);
		
		const avgRadius = filteredRadii.reduce((sum, r) => sum + r, 0) / filteredRadii.length;
		
		console.log(`Detected sun disk radius: ${avgRadius} (from ${filteredRadii.length} samples)`);
		return avgRadius;
	} catch (error) {
		console.error('Error detecting sun disk radius:', error);
		return null;
	}
}

/**
 * Creates a circular mask with feathered edges for smooth compositing
 * @param size The diameter of the mask
 * @param featherRadius The number of pixels for the feather/fade effect
 * @returns Promise resolving to a mask buffer
 */
async function createCircularMask(size: number, featherRadius: number = 30): Promise<Buffer> {
	// Create a circular gradient mask using SVG
	const centerX = size / 2;
	const centerY = size / 2;
	const outerRadius = size / 2;
	const innerRadius = outerRadius - featherRadius;

	const svgMask = `
		<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<radialGradient id="circularGradient" cx="50%" cy="50%" r="50%">
					<stop offset="${(innerRadius / outerRadius * 100)}%" style="stop-color:white;stop-opacity:1" />
					<stop offset="100%" style="stop-color:white;stop-opacity:0" />
				</radialGradient>
			</defs>
			<circle cx="${centerX}" cy="${centerY}" r="${outerRadius}" fill="url(#circularGradient)" />
		</svg>
	`;

	const maskBuffer = await sharp(Buffer.from(svgMask))
		.resize(size, size)
		.greyscale()
		.toBuffer();

	return maskBuffer;
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

	// Fetch corona image (SOHO/LASCO C2)
	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	// Fetch sun disk image (SDO/AIA 171)
	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	// Resize SDO to known good size
	const sunDiskSize = 1435;
	const resizedSunDisk = await sharp(sunDiskImage)
		.resize(sunDiskSize, sunDiskSize)
		.toBuffer();

	// Create composite - expand canvas if needed
	const finalWidth = Math.max(width, sunDiskSize);
	const finalHeight = Math.max(height, sunDiskSize);
	
	const finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 3,
			background: { r: 0, g: 0, b: 0 }
		}
	})
	.composite([
		{ input: coronaImage, gravity: 'center' },
		{ input: resizedSunDisk, gravity: 'center', blend: 'screen' }
	])
	.png()
	.toBuffer();

	return finalImage;
}

/**
 * Original circular mask function for backward compatibility
 * @param imageBuffer The image to mask
 * @param size The target size (diameter) of the circular mask
 * @param featherRadius The feather/fade distance in pixels
 * @returns Promise resolving to the masked image buffer
 */
async function applyCircularMask(imageBuffer: Buffer, size: number, featherRadius: number = 30): Promise<Buffer> {
	// Resize the image to the target size first
	const resizedImage = await sharp(imageBuffer)
		.resize(size, size)
		.toBuffer();

	// If no feathering requested, return the resized image as-is
	if (featherRadius <= 0) {
		return resizedImage;
	}

	// Create circular mask with feathering
	const centerX = Math.floor(size / 2);
	const centerY = Math.floor(size / 2);
	const radius = Math.floor(size / 2);
	
	// Create a more aggressive feather effect
	const featherStart = Math.max(0, radius - featherRadius);
	
	const svgMask = `
		<svg width="${size}" height="${size}">
			<defs>
				<radialGradient id="fade" cx="50%" cy="50%" r="50%">
					<stop offset="0%" style="stop-color:white;stop-opacity:1" />
					<stop offset="${(featherStart / radius * 100)}%" style="stop-color:white;stop-opacity:1" />
					<stop offset="100%" style="stop-color:white;stop-opacity:0" />
				</radialGradient>
			</defs>
			<rect width="${size}" height="${size}" fill="black" />
			<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="url(#fade)" />
		</svg>
	`;

	console.log(`Creating circular mask: size=${size}, featherRadius=${featherRadius}, featherStart=${featherStart}`);

	const mask = await sharp(Buffer.from(svgMask))
		.png()
		.toBuffer();

	// Apply mask using joinChannel to add as alpha
	const { data, info } = await sharp(resizedImage).raw().toBuffer({ resolveWithObject: true });
	const { data: maskData } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });

	// Create RGBA buffer with mask as alpha channel
	const rgbaData = Buffer.alloc(info.width * info.height * 4);
	
	for (let i = 0; i < info.width * info.height; i++) {
		const srcOffset = i * 3;
		const dstOffset = i * 4;
		const alpha = maskData[i]; // Use mask as alpha
		
		rgbaData[dstOffset] = data[srcOffset];     // R
		rgbaData[dstOffset + 1] = data[srcOffset + 1]; // G  
		rgbaData[dstOffset + 2] = data[srcOffset + 2]; // B
		rgbaData[dstOffset + 3] = alpha;              // A
	}

	const maskedImage = await sharp(rgbaData, {
		raw: {
			width: info.width,
			height: info.height,
			channels: 4
		}
	})
	.png()
	.toBuffer();

	return maskedImage;
}

/**
 * Applies circular feathering based on the detected solar disk edge
 * This improved version uses Sharp's native operations to preserve image quality
 * @param imageBuffer The sun disk image buffer
 * @param featherRadius The feather distance in pixels (outward from detected edge)
 * @returns Promise resolving to the properly feathered image
 */
async function applyDiskBasedFeathering(imageBuffer: Buffer, featherRadius: number = 40): Promise<Buffer> {
	// First try the enhanced golden solar disk detection
	const goldenDetection = await detectGoldenSolarDisk(imageBuffer);
	
	if (!goldenDetection || goldenDetection.confidence < 0.2) {
		console.log('Golden solar disk detection failed or low confidence, trying fallback method...');
		// Try the original detection method
		const fallbackDetection = await detectSunDiskCenterAndRadius(imageBuffer);
		
		if (!fallbackDetection) {
			console.log('All detection methods failed, using geometric estimation');
			const { width } = await sharp(imageBuffer).metadata();
			const estimatedRadius = Math.floor((width || 1435) * 0.45);
			const centerX = Math.floor((width || 1435) / 2);
			const centerY = Math.floor((width || 1435) / 2);
			return applyDiskBasedFeatheringWithParams(imageBuffer, centerX, centerY, estimatedRadius, featherRadius);
		} else {
			const { centerX, centerY, radius } = fallbackDetection;
			return applyDiskBasedFeatheringWithParams(imageBuffer, centerX, centerY, radius, featherRadius);
		}
	}

	const { centerX, centerY, radius, confidence } = goldenDetection;
	console.log(`Using golden detection with confidence: ${confidence}`);
	
	return applyDiskBasedFeatheringWithParams(imageBuffer, centerX, centerY, radius, featherRadius);
}

/**
 * Apply disk-based feathering with specific parameters
 */
async function applyDiskBasedFeatheringWithParams(
	imageBuffer: Buffer, 
	centerX: number, 
	centerY: number, 
	radius: number, 
	featherRadius: number
): Promise<Buffer> {
	const { width: imgWidth, height: imgHeight } = await sharp(imageBuffer).metadata();
	
	if (!imgWidth || !imgHeight) {
		throw new Error('Could not determine image dimensions');
	}

	console.log(`Applying disk-based feathering: center(${centerX}, ${centerY}), disk radius=${radius}, feather=${featherRadius}`);

	// Create a clean radial mask that preserves the solar disk and fades outward
	const outerRadius = radius + featherRadius;
	
	const svgMask = `
		<svg width="${imgWidth}" height="${imgHeight}">
			<defs>
				<radialGradient id="diskFeather" cx="${centerX}" cy="${centerY}" r="${outerRadius}">
					<stop offset="0%" style="stop-color:white;stop-opacity:1" />
					<stop offset="${(radius / outerRadius * 100)}%" style="stop-color:white;stop-opacity:1" />
					<stop offset="100%" style="stop-color:white;stop-opacity:0" />
				</radialGradient>
			</defs>
			<rect width="${imgWidth}" height="${imgHeight}" fill="url(#diskFeather)" />
		</svg>
	`;

	console.log(`Creating clean disk-based mask: disk=${radius}px, outer=${outerRadius}px, feather=${featherRadius}px`);

	// Create mask using Sharp's native operations
	const mask = await sharp(Buffer.from(svgMask))
		.png()
		.toBuffer();

	// Use proper RGBA composition to preserve colors (joinChannel causes grayscale conversion)
	// Convert image to RGBA first, then apply mask as alpha channel using multiply blend
	const rgbaImage = await sharp(imageBuffer)
		.ensureAlpha()
		.toBuffer();
		
	const maskedImage = await sharp(rgbaImage)
		.composite([
			{
				input: mask,
				blend: 'multiply',  // Multiply with mask to apply transparency while preserving colors
				tile: false
			}
		])
		.png()
		.toBuffer();

	return maskedImage;
}

/**
 * Adds a debug border around an image to visualize its bounds
 * @param imageBuffer The image buffer to add border to
 * @param color The border color (red, green, blue, etc.)
 * @param width The border width in pixels
 * @returns Promise resolving to the image with border
 */
async function addDebugBorder(imageBuffer: Buffer, color: string = 'red', width: number = 5): Promise<Buffer> {
	const { width: imgWidth, height: imgHeight } = await sharp(imageBuffer).metadata();
	
	if (!imgWidth || !imgHeight) {
		throw new Error('Could not determine image dimensions');
	}

	// Create SVG border overlay
	const borderSvg = `
		<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
			<rect x="0" y="0" width="${imgWidth}" height="${imgHeight}" 
				  fill="none" stroke="${color}" stroke-width="${width}" />
		</svg>
	`;

	const borderOverlay = await sharp(Buffer.from(borderSvg))
		.png()
		.toBuffer();

	// Composite border over image
	const imageWithBorder = await sharp(imageBuffer)
		.composite([{ input: borderOverlay, blend: 'over' }])
		.png()
		.toBuffer();

	return imageWithBorder;
}

/**
 * Enhanced golden solar disk detection specifically tuned for SDO imagery
 * Uses multiple detection methods for better accuracy with golden solar disks
 * @param imageBuffer The sun disk image buffer
 * @returns Promise resolving to {centerX, centerY, radius, confidence} or null if not found
 */
async function detectGoldenSolarDisk(imageBuffer: Buffer): Promise<{centerX: number, centerY: number, radius: number, confidence: number} | null> {
	try {
		const { width, height } = await sharp(imageBuffer).metadata();
		if (!width || !height) return null;

		const centerX = Math.floor(width / 2);
		const centerY = Math.floor(height / 2);

		// Method 1: Brightness-based detection for golden solar disk
		const { data: grayData } = await sharp(imageBuffer)
			.grayscale()
			.raw()
			.toBuffer({ resolveWithObject: true });

		// Find the transition from bright solar disk to dark background
		const brightnessSamples: number[] = [];
		
		// Sample radially from center to find brightness transitions
		for (let angle = 0; angle < 360; angle += 12) {
			let maxBrightness = 0;
			let transitionRadius = 0;
			let lastBrightness = 0;
			
			for (let r = 100; r < Math.min(width, height) / 2 - 10; r += 2) {
				const x = Math.floor(centerX + r * Math.cos(angle * Math.PI / 180));
				const y = Math.floor(centerY + r * Math.sin(angle * Math.PI / 180));
				
				if (x >= 0 && x < width && y >= 0 && y < height) {
					const brightness = grayData[y * width + x];
					
					// Look for significant brightness drop (golden disk to black space)
					if (lastBrightness > 100 && brightness < 50 && lastBrightness - brightness > 80) {
						transitionRadius = r - 5; // Back up slightly from the edge
						break;
					}
					
					if (brightness > maxBrightness) {
						maxBrightness = brightness;
					}
					
					lastBrightness = brightness;
				}
			}
			
			if (transitionRadius > 100 && maxBrightness > 150) { // Ensure we found a bright solar disk
				brightnessSamples.push(transitionRadius);
			}
		}

		console.log(`Brightness-based detection found ${brightnessSamples.length} samples:`, brightnessSamples.slice(0, 5));

		if (brightnessSamples.length < 12) { // Need enough samples for reliable detection
			console.log('Not enough brightness transition samples, trying geometric estimation...');
			
			// Fallback: Geometric estimation based on typical solar disk ratios
			// Solar disk typically occupies 40-60% of image width in SDO images
			const estimatedRadius = Math.floor(Math.min(width, height) * 0.45);
			console.log(`Geometric estimation: radius=${estimatedRadius}`);
			
			return { centerX, centerY, radius: estimatedRadius, confidence: 0.3 };
		}

		// Filter outliers and calculate average
		brightnessSamples.sort((a, b) => a - b);
		const q1 = brightnessSamples[Math.floor(brightnessSamples.length * 0.25)];
		const q3 = brightnessSamples[Math.floor(brightnessSamples.length * 0.75)];
		const filteredSamples = brightnessSamples.filter(r => r >= q1 && r <= q3);
		
		const avgRadius = filteredSamples.reduce((sum, r) => sum + r, 0) / filteredSamples.length;
		const confidence = Math.min(filteredSamples.length / 20, 1.0); // Higher confidence with more samples
		
		console.log(`Golden solar disk detected: center(${centerX}, ${centerY}), radius=${avgRadius}, confidence=${confidence} (${filteredSamples.length} samples)`);
		
		return { centerX, centerY, radius: avgRadius, confidence };
		
	} catch (error) {
		console.error('Error in golden solar disk detection:', error);
		return null;
	}
}

/**
 * Enhanced sun disk detection that returns both center and radius
 * @param imageBuffer The sun disk image buffer
 * @returns Promise resolving to {centerX, centerY, radius} or null if not found
 */
async function detectSunDiskCenterAndRadius(imageBuffer: Buffer): Promise<{centerX: number, centerY: number, radius: number} | null> {
	try {
		const { data, info } = await sharp(imageBuffer)
			.grayscale()
			.normalise()
			.toBuffer({ resolveWithObject: true });
		
		const width = info.width;
		const height = info.height;
		
		// Sample multiple radial directions to find sun edge from image center
		const imageCenterX = Math.floor(width / 2);
		const imageCenterY = Math.floor(height / 2);
		const detectedRadii: number[] = [];
		
		for (let angle = 0; angle < 360; angle += 15) {
			let maxGradient = 0;
			let edgeRadius = 0;
			
			// Walk from center outward
			for (let r = 200; r < Math.min(width, height) / 2 - 50; r += 2) {
				const x = Math.floor(imageCenterX + r * Math.cos(angle * Math.PI / 180));
				const y = Math.floor(imageCenterY + r * Math.sin(angle * Math.PI / 180));
				
				if (x >= 1 && x < width - 1 && y >= 1 && y < height - 1) {
					// Calculate gradient
					const current = data[y * width + x];
					const next = data[y * width + (x + 1)];
					const prev = data[y * width + (x - 1)];
					
					const gradient = Math.abs(next - prev) / 2;
					
					if (gradient > maxGradient && current > 50) { // Avoid too-dark regions (prominences)
						maxGradient = gradient;
						edgeRadius = r;
					}
				}
			}
			
			if (edgeRadius > 0 && maxGradient > 10) { // Threshold for significant edge
				detectedRadii.push(edgeRadius);
			}
		}
		
		if (detectedRadii.length < 8) { // Need enough samples
			console.log('Not enough reliable edge detections for sun disk');
			return null;
		}
		
		// Remove outliers and average
		detectedRadii.sort((a, b) => a - b);
		const q1 = detectedRadii[Math.floor(detectedRadii.length * 0.25)];
		const q3 = detectedRadii[Math.floor(detectedRadii.length * 0.75)];
		const filteredRadii = detectedRadii.filter(r => r >= q1 && r <= q3);
		
		const avgRadius = filteredRadii.reduce((sum, r) => sum + r, 0) / filteredRadii.length;
		
		console.log(`Detected sun disk: center(${imageCenterX}, ${imageCenterY}), radius=${avgRadius} (from ${filteredRadii.length} samples)`);
		return { centerX: imageCenterX, centerY: imageCenterY, radius: avgRadius };
	} catch (error) {
		console.error('Error detecting sun disk center and radius:', error);
		return null;
	}
}


/**
 * Creates a composite image with dual feathering options - can feather SDO, SOHO, or both
 */
async function createDualFeatherComposite(
	isoDate: string, 
	apiKey: string, 
	options: {
		featherTarget: 'sdo' | 'soho' | 'both' | 'none';
		sdoFeatherRadius: number;
		sohoFeatherRadius: number;
		blendMode: string;
		sunDiskSize?: number;
	}
): Promise<Buffer> {
	const width = 1920;
	const height = 1200;
	const sunDiskSize = options.sunDiskSize || 1435;

	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	let processedCoronaImage = coronaImage;
	let processedSunDiskImage = sunDiskImage;

	// Just resize images without any feathering for now
	processedSunDiskImage = await sharp(sunDiskImage).resize(sunDiskSize, sunDiskSize).toBuffer();
	processedCoronaImage = coronaImage;

	// Create composite with specified blend mode
	const finalWidth = Math.max(width, sunDiskSize);
	const finalHeight = Math.max(height, sunDiskSize);
	
	const compositeOptions: any[] = [
		{ input: processedCoronaImage, gravity: 'center' }
	];

	// Add sun disk with blend mode
	if (options.blendMode === 'normal') {
		compositeOptions.push({ input: processedSunDiskImage, gravity: 'center' });
	} else {
		compositeOptions.push({ input: processedSunDiskImage, gravity: 'center', blend: options.blendMode as any });
	}

	const finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 3,
			background: { r: 0, g: 0, b: 0 }
		}
	})
	.composite(compositeOptions)
	.png()
	.toBuffer();

	return finalImage;
}

const app = express();
const port = process.env.PORT || 3002;

app.get('/', async (req, res) => {
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

/**
 * Debug endpoint to show SDO image with optional border overlay
 */
app.get('/debug-sdo', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const showBorder = req.query.border === 'true';
	const borderColor = (req.query.color as string) || 'red';
	const borderWidth = parseInt((req.query.width as string) || '5');
	const size = parseInt((req.query.size as string) || '1435');

	try {
		// Fetch raw SDO image
		const width = 1920;
		const sunDiskImageScale = 2.5;
		let sdoImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
		
		// Resize if requested
		if (size !== width) {
			sdoImage = await sharp(sdoImage).resize(size, size).toBuffer();
		}

		// Add border if requested
		if (showBorder) {
			const imageWithBorder = await addDebugBorder(sdoImage, borderColor, borderWidth);
			res.set('Content-Type', 'image/png');
			res.send(imageWithBorder);
		} else {
			res.set('Content-Type', 'image/png');
			res.send(sdoImage);
		}
	} catch (error) {
		console.error('Error fetching debug SDO image:', error);
		res.status(500).send('An error occurred while fetching the debug SDO image.');
	}
});

/**
 * Enhanced debug endpoint that shows SDO disk detection
 */
app.get('/debug-sdo-detection', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const size = parseInt((req.query.size as string) || '1435');

	try {
		// Fetch and resize SDO image
		const width = 1920;
		const sunDiskImageScale = 2.5;
		let sdoImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
		
		if (size !== width) {
			sdoImage = await sharp(sdoImage).resize(size, size).toBuffer();
		}

		// Detect solar disk
		const detection = await detectSunDiskCenterAndRadius(sdoImage);
		
		if (detection) {
			const { centerX, centerY, radius } = detection;
			
			// Create overlay with detected circle and image border
			const { width: imgWidth, height: imgHeight } = await sharp(sdoImage).metadata();
			const overlayRadius = Math.round(radius);
			
			const overlaySvg = `
				<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
					<!-- Image border -->
					<rect x="0" y="0" width="${imgWidth}" height="${imgHeight}" 
						  fill="none" stroke="red" stroke-width="5" />
					<!-- Detected solar disk -->
					<circle cx="${centerX}" cy="${centerY}" r="${overlayRadius}" 
						   fill="none" stroke="lime" stroke-width="3" />
					<!-- Center point -->
					<circle cx="${centerX}" cy="${centerY}" r="5" fill="lime" />
					<!-- Labels -->
					<text x="10" y="30" fill="red" font-size="20" font-family="Arial">Image Bounds</text>
					<text x="10" y="60" fill="lime" font-size="20" font-family="Arial">Solar Disk (r=${overlayRadius}px)</text>
				</svg>
			`;

			const overlayBuffer = await sharp(Buffer.from(overlaySvg)).png().toBuffer();
			const finalImage = await sharp(sdoImage)
				.composite([{ input: overlayBuffer, blend: 'over' }])
				.png()
				.toBuffer();

			res.set('Content-Type', 'image/png');
			res.send(finalImage);
		} else {
			// Just show image with border if detection failed
			const imageWithBorder = await addDebugBorder(sdoImage, 'red', 5);
			res.set('Content-Type', 'image/png');
			res.send(imageWithBorder);
		}
	} catch (error) {
		console.error('Error in debug SDO detection:', error);
		res.status(500).send('An error occurred while processing debug SDO detection.');
	}
});

/**
 * Comparison endpoint to test old vs new feathering approaches
 */
app.get('/debug-feather-comparison', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const featherRadius = parseInt((req.query.feather as string) || '40');
	const size = parseInt((req.query.size as string) || '1435');
	const method = req.query.method as string || 'new'; // 'old', 'new', or 'both'

	try {
		// Fetch and resize SDO image
		const width = 1920;
		const sunDiskImageScale = 2.5;
		let sdoImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
		
		if (size !== width) {
			sdoImage = await sharp(sdoImage).resize(size, size).toBuffer();
		}

		if (method === 'both') {
			// Create side-by-side comparison
			const oldFeathered = await applyCircularMask(sdoImage, size, featherRadius);
			const newFeathered = await applyDiskBasedFeathering(sdoImage, featherRadius);
			
			// Get dimensions
			const { width: imgWidth, height: imgHeight } = await sharp(sdoImage).metadata();
			if (!imgWidth || !imgHeight) throw new Error('Could not get image dimensions');
			
			// Create comparison image with labels
			const comparisonWidth = imgWidth * 2 + 20; // 20px gap
			const comparisonHeight = imgHeight + 40; // 40px for labels
			
			// Create labeled images
			const oldLabelSvg = `
				<svg width="${imgWidth}" height="40">
					<rect width="${imgWidth}" height="40" fill="black" />
					<text x="${imgWidth/2}" y="25" text-anchor="middle" fill="white" font-size="16" font-family="Arial">OLD METHOD (Image-based feather)</text>
				</svg>
			`;
			
			const newLabelSvg = `
				<svg width="${imgWidth}" height="40">
					<rect width="${imgWidth}" height="40" fill="black" />
					<text x="${imgWidth/2}" y="25" text-anchor="middle" fill="lime" font-size="16" font-family="Arial">NEW METHOD (Disk-based feather)</text>
				</svg>
			`;
			
			const oldLabel = await sharp(Buffer.from(oldLabelSvg)).png().toBuffer();
			const newLabel = await sharp(Buffer.from(newLabelSvg)).png().toBuffer();
			
			const oldWithLabel = await sharp({
				create: { width: imgWidth, height: imgHeight + 40, channels: 3, background: { r: 0, g: 0, b: 0 } }
			})
			.composite([
				{ input: oldLabel, top: 0, left: 0 },
				{ input: oldFeathered, top: 40, left: 0 }
			])
			.png()
			.toBuffer();
			
			const newWithLabel = await sharp({
				create: { width: imgWidth, height: imgHeight + 40, channels: 3, background: { r: 0, g: 0, b: 0 } }
			})
			.composite([
				{ input: newLabel, top: 0, left: 0 },
				{ input: newFeathered, top: 40, left: 0 }
			])
			.png()
			.toBuffer();
			
			// Combine side by side
			const comparison = await sharp({
				create: { width: comparisonWidth, height: comparisonHeight, channels: 3, background: { r: 0, g: 0, b: 0 } }
			})
			.composite([
				{ input: oldWithLabel, top: 0, left: 0 },
				{ input: newWithLabel, top: 0, left: imgWidth + 20 }
			])
			.png()
			.toBuffer();
			
			res.set('Content-Type', 'image/png');
			res.send(comparison);
			
		} else if (method === 'old') {
			const feathered = await applyCircularMask(sdoImage, size, featherRadius);
			res.set('Content-Type', 'image/png');
			res.send(feathered);
		} else { // method === 'new'
			const feathered = await applyDiskBasedFeathering(sdoImage, featherRadius);
			res.set('Content-Type', 'image/png');
			res.send(feathered);
		}
		
	} catch (error) {
		console.error('Error in feather comparison:', error);
		res.status(500).send('An error occurred while processing feather comparison.');
	}
});

/**
 * Debug endpoint that saves feathered images locally for inspection
 */
app.get('/save-feather-debug', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const featherRadius = parseInt((req.query.feather as string) || '40');
	const size = parseInt((req.query.size as string) || '1435');

	try {
		// Fetch and resize SDO image
		const width = 1920;
		const sunDiskImageScale = 2.5;
		let sdoImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
		
		if (size !== width) {
			sdoImage = await sharp(sdoImage).resize(size, size).toBuffer();
		}

		const fs = await import('fs/promises');
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

		// Save original SDO image
		await fs.writeFile(`sdo_original_${timestamp}.png`, sdoImage);
		console.log(`✅ Saved: sdo_original_${timestamp}.png`);

		// Save SDO with border for reference
		const sdoWithBorder = await addDebugBorder(sdoImage, 'red', 5);
		await fs.writeFile(`sdo_with_border_${timestamp}.png`, sdoWithBorder);
		console.log(`✅ Saved: sdo_with_border_${timestamp}.png`);

		// Save SDO with enhanced golden disk detection overlay
		const goldenDetection = await detectGoldenSolarDisk(sdoImage);
		const fallbackDetection = !goldenDetection ? await detectSunDiskCenterAndRadius(sdoImage) : null;
		const bestDetection = goldenDetection || fallbackDetection;
		
		if (bestDetection) {
			const { centerX, centerY, radius } = bestDetection;
			const confidence = 'confidence' in bestDetection ? (bestDetection.confidence as number) : 0.5;
			const { width: imgWidth, height: imgHeight } = await sharp(sdoImage).metadata();
			
			const methodUsed = goldenDetection ? 'Golden Detection' : 'Fallback Detection';
			const detectionOverlaySvg = `
				<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
					<!-- Image border -->
					<rect x="0" y="0" width="${imgWidth}" height="${imgHeight}" 
						  fill="none" stroke="red" stroke-width="5" />
					<!-- Detected solar disk -->
					<circle cx="${centerX}" cy="${centerY}" r="${Math.round(radius)}" 
						   fill="none" stroke="lime" stroke-width="3" />
					<!-- Center point -->
					<circle cx="${centerX}" cy="${centerY}" r="5" fill="lime" />
					<!-- Feather preview (if any) -->
					<circle cx="${centerX}" cy="${centerY}" r="${Math.round(radius + 40)}" 
						   fill="none" stroke="yellow" stroke-width="2" stroke-dasharray="5,5" />
					<!-- Labels -->
					<text x="10" y="30" fill="red" font-size="20" font-family="Arial">Image Bounds (${imgWidth}x${imgHeight})</text>
					<text x="10" y="60" fill="lime" font-size="20" font-family="Arial">${methodUsed}</text>
					<text x="10" y="90" fill="lime" font-size="18" font-family="Arial">Solar Disk: r=${Math.round(radius)}px</text>
					<text x="10" y="120" fill="lime" font-size="16" font-family="Arial">Confidence: ${(confidence * 100).toFixed(1)}%</text>
					<text x="10" y="150" fill="yellow" font-size="16" font-family="Arial">Feather Zone: ${Math.round(radius)}px → ${Math.round(radius + 40)}px</text>
				</svg>
			`;

			const detectionOverlay = await sharp(Buffer.from(detectionOverlaySvg)).png().toBuffer();
			const sdoWithDetection = await sharp(sdoImage)
				.composite([{ input: detectionOverlay, blend: 'over' }])
				.png()
				.toBuffer();
			
			await fs.writeFile(`sdo_detection_${timestamp}.png`, sdoWithDetection);
			console.log(`✅ Saved: sdo_detection_${timestamp}.png (radius: ${radius})`);
		}

		// Save old feathering method result
		const oldFeathered = await applyCircularMask(sdoImage, size, featherRadius);
		await fs.writeFile(`sdo_old_feather_${featherRadius}px_${timestamp}.png`, oldFeathered);
		console.log(`✅ Saved: sdo_old_feather_${featherRadius}px_${timestamp}.png`);

		// Save new feathering method result
		const newFeathered = await applyDiskBasedFeathering(sdoImage, featherRadius);
		await fs.writeFile(`sdo_new_feather_${featherRadius}px_${timestamp}.png`, newFeathered);
		console.log(`✅ Saved: sdo_new_feather_${featherRadius}px_${timestamp}.png`);

		// Create and save side-by-side comparison
		const { width: imgWidth, height: imgHeight } = await sharp(sdoImage).metadata();
		if (!imgWidth || !imgHeight) throw new Error('Could not get image dimensions');
		
		const comparisonWidth = imgWidth * 2 + 20;
		const comparisonHeight = imgHeight + 40;
		
		const oldLabelSvg = `
			<svg width="${imgWidth}" height="40">
				<rect width="${imgWidth}" height="40" fill="black" />
				<text x="${imgWidth/2}" y="25" text-anchor="middle" fill="white" font-size="16" font-family="Arial">OLD METHOD (${featherRadius}px feather)</text>
			</svg>
		`;
		
		const newLabelSvg = `
			<svg width="${imgWidth}" height="40">
				<rect width="${imgWidth}" height="40" fill="black" />
				<text x="${imgWidth/2}" y="25" text-anchor="middle" fill="lime" font-size="16" font-family="Arial">NEW METHOD (${featherRadius}px feather)</text>
			</svg>
		`;
		
		const oldLabel = await sharp(Buffer.from(oldLabelSvg)).png().toBuffer();
		const newLabel = await sharp(Buffer.from(newLabelSvg)).png().toBuffer();
		
		const oldWithLabel = await sharp({
			create: { width: imgWidth, height: imgHeight + 40, channels: 3, background: { r: 0, g: 0, b: 0 } }
		})
		.composite([
			{ input: oldLabel, top: 0, left: 0 },
			{ input: oldFeathered, top: 40, left: 0 }
		])
		.png()
		.toBuffer();
		
		const newWithLabel = await sharp({
			create: { width: imgWidth, height: imgHeight + 40, channels: 3, background: { r: 0, g: 0, b: 0 } }
		})
		.composite([
			{ input: newLabel, top: 0, left: 0 },
			{ input: newFeathered, top: 40, left: 0 }
		])
		.png()
		.toBuffer();
		
		const comparison = await sharp({
			create: { width: comparisonWidth, height: comparisonHeight, channels: 3, background: { r: 0, g: 0, b: 0 } }
		})
		.composite([
			{ input: oldWithLabel, top: 0, left: 0 },
			{ input: newWithLabel, top: 0, left: imgWidth + 20 }
		])
		.png()
		.toBuffer();
		
		await fs.writeFile(`feather_comparison_${featherRadius}px_${timestamp}.png`, comparison);
		console.log(`✅ Saved: feather_comparison_${featherRadius}px_${timestamp}.png`);

		res.json({
			success: true,
			message: `Debug images saved with timestamp: ${timestamp}`,
			files: [
				`sdo_original_${timestamp}.png`,
				`sdo_with_border_${timestamp}.png`,
				`sdo_detection_${timestamp}.png`,
				`sdo_old_feather_${featherRadius}px_${timestamp}.png`,
				`sdo_new_feather_${featherRadius}px_${timestamp}.png`,
				`feather_comparison_${featherRadius}px_${timestamp}.png`
			],
			detectedRadius: bestDetection?.radius || null,
			detectionMethod: goldenDetection ? 'golden' : (fallbackDetection ? 'fallback' : 'none'),
			detectionConfidence: goldenDetection?.confidence || (fallbackDetection ? 0.5 : 0),
			featherRadius: featherRadius,
			imageSize: size
		});

	} catch (error) {
		console.error('Error saving feather debug images:', error);
		res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
	}
});

/**
 * Interactive feathering tuning interface with real-time previews
 */
app.get('/feather-tuner', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const featherRadius = parseInt((req.query.feather as string) || '40');
	const size = parseInt((req.query.size as string) || '1435');
	const diskRadius = parseInt((req.query.diskRadius as string) || '645');
	const centerX = parseInt((req.query.centerX as string) || Math.floor(size / 2).toString());
	const centerY = parseInt((req.query.centerY as string) || Math.floor(size / 2).toString());
	const showDetection = req.query.detection === 'true';

	if (req.query.image) {
		const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
		
		try {
			// Fetch and resize SDO image
			const width = 1920;
			const sunDiskImageScale = 2.5;
			let sdoImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
			
			if (size !== width) {
				sdoImage = await sharp(sdoImage).resize(size, size).toBuffer();
			}

			if (req.query.image === 'original') {
				res.set('Content-Type', 'image/png');
				res.send(sdoImage);
				return;
			}

			if (req.query.image === 'detection') {
				const { width: imgWidth, height: imgHeight } = await sharp(sdoImage).metadata();
				
				// Also get automatic detection for reference
				const goldenDetection = await detectGoldenSolarDisk(sdoImage);
				const fallbackDetection = !goldenDetection ? await detectSunDiskCenterAndRadius(sdoImage) : null;
				const autoDetection = goldenDetection || fallbackDetection;
				
				// Always create the detection overlay (with or without auto-detection)
				const detectionOverlaySvg = `
					<svg width="${imgWidth}" height="${imgHeight}" xmlns="http://www.w3.org/2000/svg">
						<!-- Image border -->
						<rect x="0" y="0" width="${imgWidth}" height="${imgHeight}" 
							  fill="none" stroke="red" stroke-width="3" />
						
						<!-- Auto-detected solar disk (for reference) -->
						${autoDetection ? `<circle cx="${autoDetection.centerX}" cy="${autoDetection.centerY}" r="${Math.round(autoDetection.radius)}" 
							   fill="none" stroke="gray" stroke-width="1" stroke-dasharray="2,2" />` : ''}
						
						<!-- Manual solar disk -->
						<circle cx="${centerX}" cy="${centerY}" r="${diskRadius}" 
							   fill="none" stroke="lime" stroke-width="3" />
						
						<!-- Feather preview -->
						<circle cx="${centerX}" cy="${centerY}" r="${diskRadius + featherRadius}" 
							   fill="none" stroke="yellow" stroke-width="2" stroke-dasharray="3,3" />
						
						<!-- Center crosshair -->
						<line x1="${centerX - 10}" y1="${centerY}" x2="${centerX + 10}" y2="${centerY}" 
							  stroke="lime" stroke-width="2" />
						<line x1="${centerX}" y1="${centerY - 10}" x2="${centerX}" y2="${centerY + 10}" 
							  stroke="lime" stroke-width="2" />
						
						<!-- Labels -->
						<text x="10" y="25" fill="red" font-size="16" font-family="Arial">Image: ${imgWidth}x${imgHeight}</text>
						<text x="10" y="45" fill="lime" font-size="16" font-family="Arial">Manual: Center(${centerX}, ${centerY}) R=${diskRadius}px</text>
						<text x="10" y="65" fill="yellow" font-size="16" font-family="Arial">Feather Zone: ${diskRadius}px → ${diskRadius + featherRadius}px</text>
						${autoDetection ? `<text x="10" y="85" fill="gray" font-size="14" font-family="Arial">Auto-detected: R=${Math.round(autoDetection.radius)}px (gray dashed)</text>` : ''}
					</svg>
				`;

					const detectionOverlay = await sharp(Buffer.from(detectionOverlaySvg)).png().toBuffer();
					const imageWithDetection = await sharp(sdoImage)
						.composite([{ input: detectionOverlay, blend: 'over' }])
						.png()
						.toBuffer();
					
					res.set('Content-Type', 'image/png');
					res.send(imageWithDetection);
				return;
			}

			if (req.query.image === 'feathered') {
				const feathered = await applyDiskBasedFeatheringWithParams(sdoImage, centerX, centerY, diskRadius, featherRadius);
				res.set('Content-Type', 'image/png');
				res.send(feathered);
				return;
			}

		} catch (error) {
			console.error('Error in feather tuner image endpoint:', error);
			res.status(500).send('Error processing image');
			return;
		}
	}

	// Return the interactive tuning interface HTML
	res.set('Content-Type', 'text/html');
	res.send(`
<!DOCTYPE html>
<html>
<head>
	<title>🌞 Interactive Solar Feather Tuner</title>
	<style>
		body { 
			font-family: Arial, sans-serif; 
			margin: 0; 
			padding: 20px; 
			background: #000; 
			color: #fff; 
		}
		.container { 
			max-width: 1600px; 
			margin: 0 auto; 
		}
		.header {
			text-align: center;
			margin-bottom: 30px;
		}
		.header h1 {
			color: #FFD700;
			font-size: 32px;
			margin: 0;
		}
		.controls { 
			background: #222; 
			padding: 25px; 
			border-radius: 10px; 
			margin-bottom: 30px;
			border: 2px solid #444;
		}
		.control-row { 
			display: flex; 
			gap: 30px; 
			align-items: center; 
			margin: 15px 0; 
			flex-wrap: wrap; 
		}
		.parameter-display { 
			font-size: 20px; 
			font-weight: bold; 
			color: #4CAF50; 
			min-width: 200px;
		}
		.slider { 
			width: 300px; 
			margin: 0 15px; 
			accent-color: #4CAF50;
		}
		input[type="number"] {
			width: 80px; 
			padding: 8px; 
			margin: 0 10px; 
			background: #333;
			color: white;
			border: 1px solid #666;
			border-radius: 4px;
		}
		.update-btn { 
			padding: 12px 20px; 
			background: #4CAF50; 
			border: none; 
			color: white; 
			border-radius: 6px; 
			cursor: pointer; 
			font-size: 16px;
			font-weight: bold;
		}
		.update-btn:hover { 
			background: #45a049; 
		}
		.images { 
			display: grid; 
			grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); 
			gap: 25px; 
		}
		.image-container { 
			text-align: center; 
			background: #111; 
			padding: 20px; 
			border-radius: 10px;
			border: 2px solid #333;
		}
		.image-container h3 { 
			margin: 0 0 15px 0; 
			color: #4CAF50;
			font-size: 18px;
		}
		.image-container img { 
			max-width: 100%; 
			border: 2px solid #666; 
			border-radius: 6px; 
			background: #000;
		}
		.main-composite { 
			border: 3px solid #FFD700 !important; 
		}
		.detection-info {
			background: #333;
			padding: 15px;
			border-radius: 6px;
			margin-top: 20px;
			font-size: 14px;
		}
		.status {
			color: #4CAF50;
			font-weight: bold;
			margin: 10px 0;
		}
		.loading {
			opacity: 0.5;
			pointer-events: none;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>🌞 Interactive Solar Feather Tuner</h1>
			<p style="color: #aaa;">Real-time solar disk detection and feathering adjustment</p>
		</div>
		
		<div class="controls">
			<div class="control-row">
				<div class="parameter-display">Solar Disk Center X: <span id="centerXValue">${centerX}</span>px</div>
				<input type="range" id="centerXSlider" class="slider" min="500" max="900" value="${centerX}" step="5">
				<input type="number" id="centerXInput" value="${centerX}" min="500" max="900" step="1">
			</div>
			
			<div class="control-row">
				<div class="parameter-display">Solar Disk Center Y: <span id="centerYValue">${centerY}</span>px</div>
				<input type="range" id="centerYSlider" class="slider" min="500" max="900" value="${centerY}" step="5">
				<input type="number" id="centerYInput" value="${centerY}" min="500" max="900" step="1">
			</div>
			
			<div class="control-row">
				<div class="parameter-display">Solar Disk Radius: <span id="diskRadiusValue">${diskRadius}</span>px</div>
				<input type="range" id="diskRadiusSlider" class="slider" min="400" max="800" value="${diskRadius}" step="5">
				<input type="number" id="diskRadiusInput" value="${diskRadius}" min="400" max="800" step="1">
			</div>
			
			<div class="control-row">
				<div class="parameter-display">Feather Radius: <span id="featherValue">${featherRadius}</span>px</div>
				<input type="range" id="featherSlider" class="slider" min="0" max="100" value="${featherRadius}" step="5">
				<input type="number" id="featherInput" value="${featherRadius}" min="0" max="100" step="1">
			</div>

			<div class="control-row">
				<button class="update-btn" onclick="updateImages()">🔄 Update All Images</button>
				<label style="margin-left: 20px;">
					<input type="checkbox" id="autoUpdate" checked> Auto-update on change
				</label>
			</div>

			<div class="status" id="status">Ready - Image Size: ${size}x${size}px (fixed)</div>
		</div>

		<div class="images" id="imageContainer">
			<div class="image-container">
				<h3>📸 Original SDO Image</h3>
				<img id="originalImg" src="/feather-tuner?image=original&size=${size}&date=${isoDate}" alt="Original SDO">
			</div>
			
			<div class="image-container">
				<h3>🎯 Manual Disk Position & Circles</h3>
				<img id="detectionImg" src="/feather-tuner?image=detection&feather=${featherRadius}&diskRadius=${diskRadius}&centerX=${centerX}&centerY=${centerY}&size=${size}&date=${isoDate}" alt="Detection">
				<p style="color: #aaa; font-size: 12px; margin-top: 10px;">
					Green = Manual position, Yellow = Feather zone<br>
					Gray dashed = Auto-detection (for reference)
				</p>
			</div>
			
			<div class="image-container">
				<h3>✨ Feathered Result</h3>
				<img id="featheredImg" class="main-composite" src="/feather-tuner?image=feathered&feather=${featherRadius}&diskRadius=${diskRadius}&centerX=${centerX}&centerY=${centerY}&size=${size}&date=${isoDate}" alt="Feathered">
			</div>
		</div>

		<div class="detection-info">
			<h3>🔧 How to Use:</h3>
			<p><strong>Center X/Y:</strong> Move the solar disk circle to match the actual sun center</p>
			<p><strong>Disk Radius:</strong> Resize the green circle to match the edge of the golden solar disk</p>
			<p><strong>Feather Radius:</strong> Distance in pixels to fade from solar disk edge to transparent</p>
			<p><strong>Visual Guide:</strong> Red = image bounds, Green = your manual position, Yellow = feather zone, Gray = auto-detection</p>
			<p><strong>Goal:</strong> Position the green circle exactly on the solar disk edge, then adjust feather for smooth compositing</p>
		</div>
	</div>

	<script>
		// Get all control elements
		const centerXSlider = document.getElementById('centerXSlider');
		const centerXInput = document.getElementById('centerXInput');
		const centerYSlider = document.getElementById('centerYSlider');
		const centerYInput = document.getElementById('centerYInput');
		const diskRadiusSlider = document.getElementById('diskRadiusSlider');
		const diskRadiusInput = document.getElementById('diskRadiusInput');
		const featherSlider = document.getElementById('featherSlider');
		const featherInput = document.getElementById('featherInput');
		
		const centerXValue = document.getElementById('centerXValue');
		const centerYValue = document.getElementById('centerYValue');
		const diskRadiusValue = document.getElementById('diskRadiusValue');
		const featherValue = document.getElementById('featherValue');
		
		const autoUpdate = document.getElementById('autoUpdate');
		const status = document.getElementById('status');
		
		const originalImg = document.getElementById('originalImg');
		const detectionImg = document.getElementById('detectionImg');
		const featheredImg = document.getElementById('featheredImg');
		const imageContainer = document.getElementById('imageContainer');

		function syncValues() {
			// Sync sliders with inputs
			centerXSlider.value = centerXInput.value;
			centerYSlider.value = centerYInput.value;
			diskRadiusSlider.value = diskRadiusInput.value;
			featherSlider.value = featherInput.value;
			
			// Update display values
			centerXValue.textContent = centerXInput.value;
			centerYValue.textContent = centerYInput.value;
			diskRadiusValue.textContent = diskRadiusInput.value;
			featherValue.textContent = featherInput.value;
		}

		// Sync slider and input values
		centerXSlider.oninput = function() { centerXInput.value = this.value; syncValues(); };
		centerXInput.oninput = function() { centerXSlider.value = this.value; syncValues(); };
		centerYSlider.oninput = function() { centerYInput.value = this.value; syncValues(); };
		centerYInput.oninput = function() { centerYSlider.value = this.value; syncValues(); };
		diskRadiusSlider.oninput = function() { diskRadiusInput.value = this.value; syncValues(); };
		diskRadiusInput.oninput = function() { diskRadiusSlider.value = this.value; syncValues(); };
		featherSlider.oninput = function() { featherInput.value = this.value; syncValues(); };
		featherInput.oninput = function() { featherSlider.value = this.value; syncValues(); };

		function updateImages() {
			const centerX = centerXSlider.value;
			const centerY = centerYSlider.value;
			const diskRadius = diskRadiusSlider.value;
			const feather = featherSlider.value;
			const size = ${size};
			const date = '${isoDate}';
			const timestamp = Date.now();
			
			status.textContent = 'Updating images...';
			imageContainer.classList.add('loading');
			
			const baseParams = \`centerX=\${centerX}&centerY=\${centerY}&diskRadius=\${diskRadius}&feather=\${feather}&size=\${size}&date=\${date}&t=\${timestamp}\`;
			
			// Original image doesn't need parameters
			originalImg.src = \`/feather-tuner?image=original&size=\${size}&date=\${date}&t=\${timestamp}\`;
			detectionImg.src = \`/feather-tuner?image=detection&\${baseParams}\`;
			featheredImg.src = \`/feather-tuner?image=feathered&\${baseParams}\`;
			
			// Remove loading state after images should be loaded
			setTimeout(() => {
				imageContainer.classList.remove('loading');
				status.textContent = \`Updated: center(\${centerX},\${centerY}) radius=\${diskRadius}px feather=\${feather}px\`;
			}, 2000);
		}

		// Auto-update on changes
		function setupAutoUpdate() {
			if (autoUpdate.checked) {
				centerXSlider.onchange = updateImages;
				centerXInput.onchange = updateImages;
				centerYSlider.onchange = updateImages;
				centerYInput.onchange = updateImages;
				diskRadiusSlider.onchange = updateImages;
				diskRadiusInput.onchange = updateImages;
				featherSlider.onchange = updateImages;
				featherInput.onchange = updateImages;
			} else {
				centerXSlider.onchange = null;
				centerXInput.onchange = null;
				centerYSlider.onchange = null;
				centerYInput.onchange = null;
				diskRadiusSlider.onchange = null;
				diskRadiusInput.onchange = null;
				featherSlider.onchange = null;
				featherInput.onchange = null;
			}
		}

		autoUpdate.onchange = setupAutoUpdate;
		setupAutoUpdate(); // Initialize
	</script>
</body>
</html>
	`);
});

/**
 * Creates a composite image with custom blend mode for testing
 */
async function createBlendTestComposite(isoDate: string, apiKey: string, blendMode: string): Promise<Buffer> {
	const width = 1920;
	const height = 1200;
	const sunDiskSize = 1435; // Use our perfect size

	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	// Apply circular mask with feathering for blend mode testing
	const maskedSunDisk = await applyCircularMask(sunDiskImage, sunDiskSize, 40);

	// If sun disk is larger than corona, expand the canvas
	const finalWidth = Math.max(width, sunDiskSize);
	const finalHeight = Math.max(height, sunDiskSize);
	
	const finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 3,
			background: { r: 0, g: 0, b: 0 }
		}
	})
	.composite([
		{ input: coronaImage, gravity: 'center' },
		blendMode === 'normal' ? 
			{ input: maskedSunDisk, gravity: 'center' } :
			{ input: maskedSunDisk, gravity: 'center', blend: blendMode as any }
	])
	.png()
	.toBuffer();

	return finalImage;
}

/**
 * Creates a composite image with custom sun disk size and feathering for tuning
 */
async function createTuningComposite(isoDate: string, apiKey: string, sunDiskSize: number, featherRadius: number = 40): Promise<Buffer> {
	const width = 1920;
	const height = 1200;

	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);

	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);

	const [coronaImage, sunDiskImage] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);

	// Apply circular mask with feathering for tuning interface
	const maskedSunDisk = await applyCircularMask(sunDiskImage, sunDiskSize, featherRadius);

	// If sun disk is larger than corona, we need to expand the canvas
	const finalWidth = Math.max(width, sunDiskSize);
	const finalHeight = Math.max(height, sunDiskSize);
	
	const finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 3,
			background: { r: 0, g: 0, b: 0 }
		}
	})
	.composite([
		{ input: coronaImage, gravity: 'center' },
		{ input: maskedSunDisk, gravity: 'center', blend: 'screen' }
	])
	.png()
	.toBuffer();

	return finalImage;
}

app.get('/tune', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const sunDiskSize = req.query.size ? parseInt(req.query.size as string) : 1154;
	const featherRadius = req.query.feather ? parseInt(req.query.feather as string) : 40;

	if (req.query.image === 'composite') {
		try {
			const imageBuffer = await createTuningComposite(isoDate, apiKey, sunDiskSize, featherRadius);
			res.set('Content-Type', 'image/png');
			res.send(imageBuffer);
		} catch (error) {
			console.error('Error creating tuning composite:', error);
			res.status(500).send('Error creating composite');
		}
		return;
	}

	// Return the tuning interface HTML
	res.set('Content-Type', 'text/html');
	res.send(`
<!DOCTYPE html>
<html>
<head>
	<title>Sun Disk Tuning Interface</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: #000; color: #fff; }
		.container { max-width: 1200px; margin: 0 auto; }
		.controls { background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
		.size-display { font-size: 24px; font-weight: bold; color: #4CAF50; margin: 10px 0; }
		.slider { width: 300px; margin: 10px; }
		.images { display: flex; gap: 20px; flex-wrap: wrap; }
		.image-container { text-align: center; }
		.image-container img { max-width: 100%; border: 2px solid #666; border-radius: 4px; }
		.image-container h3 { margin: 10px 0; }
		#compositeImg { border: 3px solid #4CAF50; }
	</style>
</head>
<body>
	<div class="container">
		<h1>Sun Disk Size & Feathering Tuning</h1>
		
		<div class="controls">
			<h3>Controls</h3>
			<div class="size-display">Current Size: <span id="sizeValue">${sunDiskSize}</span> pixels</div>
			<div class="size-display">Feather Radius: <span id="featherValue">${featherRadius}</span> pixels</div>
			
			<label for="sizeSlider">Adjust Sun Disk Size:</label><br>
			<input type="range" id="sizeSlider" class="slider" min="800" max="1600" value="${sunDiskSize}" step="5">
			<br><br>
			
			<label for="sizeInput">Precise Size:</label>
			<input type="number" id="sizeInput" value="${sunDiskSize}" min="800" max="1600" step="1" style="width: 80px; margin-left: 10px;">
			<br><br>
			
			<label for="featherSlider">Adjust Feather Radius (edge softness):</label><br>
			<input type="range" id="featherSlider" class="slider" min="0" max="100" value="${featherRadius}" step="5">
			<br><br>
			
			<label for="featherInput">Precise Feather:</label>
			<input type="number" id="featherInput" value="${featherRadius}" min="0" max="100" step="1" style="width: 80px; margin-left: 10px;">
			
			<button onclick="updateImages()" style="margin-left: 20px; padding: 8px 16px;">Update Preview</button>
		</div>

		<div class="images">
			<div class="image-container">
				<h3>Composite (Tunable)</h3>
				<img id="compositeImg" src="/tune?image=composite&size=${sunDiskSize}&feather=${featherRadius}&date=${isoDate}" alt="Composite">
			</div>
		</div>

		<div style="background: #333; padding: 15px; border-radius: 8px; margin-top: 20px;">
			<h3>Instructions:</h3>
			<p>1. Use the size sliders to align the sun disk with the corona's inner edge</p>
			<p>2. Use the feather sliders to adjust edge softness (0 = hard edge, 100 = very soft)</p>
			<p>3. Click "Update Preview" to see changes, or use auto-update sliders</p>
			<p>4. <strong>Tell me the optimal size and feather values!</strong></p>
		</div>
	</div>

	<script>
		const sizeSlider = document.getElementById('sizeSlider');
		const sizeInput = document.getElementById('sizeInput');
		const featherSlider = document.getElementById('featherSlider');
		const featherInput = document.getElementById('featherInput');
		const sizeDisplay = document.getElementById('sizeValue');
		const featherDisplay = document.getElementById('featherValue');
		const compositeImg = document.getElementById('compositeImg');

		function syncSizeValues(value) {
			sizeSlider.value = value;
			sizeInput.value = value;
			sizeDisplay.textContent = value;
		}

		function syncFeatherValues(value) {
			featherSlider.value = value;
			featherInput.value = value;
			featherDisplay.textContent = value;
		}

		sizeSlider.oninput = function() { syncSizeValues(this.value); };
		sizeInput.oninput = function() { syncSizeValues(this.value); };
		featherSlider.oninput = function() { syncFeatherValues(this.value); };
		featherInput.oninput = function() { syncFeatherValues(this.value); };

		function updateImages() {
			const size = sizeSlider.value;
			const feather = featherSlider.value;
			const date = '${isoDate}';
			compositeImg.src = '/tune?image=composite&size=' + size + '&feather=' + feather + '&date=' + date + '&t=' + Date.now();
		}

		// Auto-update on slider change
		sizeSlider.onchange = updateImages;
		sizeInput.onchange = updateImages;
		featherSlider.onchange = updateImages;
		featherInput.onchange = updateImages;
	</script>
</body>
</html>
	`);
});

app.get('/feather', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const featherRadius = req.query.feather ? parseInt(req.query.feather as string) : 40;
	const sunDiskSize = 1435; // Fixed perfect size

	if (req.query.image === 'composite') {
		try {
			const imageBuffer = await createTuningComposite(isoDate, apiKey, sunDiskSize, featherRadius);
			res.set('Content-Type', 'image/png');
			res.send(imageBuffer);
		} catch (error) {
			console.error('Error creating feather test composite:', error);
			res.status(500).send('Error creating composite');
		}
		return;
	}

	// Return the feather-only tuning interface HTML
	res.set('Content-Type', 'text/html');
	res.send(`
<!DOCTYPE html>
<html>
<head>
	<title>Feather Tuning Interface</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: #000; color: #fff; }
		.container { max-width: 1200px; margin: 0 auto; }
		.controls { background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
		.feather-display { font-size: 28px; font-weight: bold; color: #4CAF50; margin: 15px 0; text-align: center; }
		.slider { width: 400px; margin: 10px; }
		.slider-container { text-align: center; margin: 20px 0; }
		.images { display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; }
		.image-container { text-align: center; }
		.image-container img { max-width: 100%; border: 2px solid #666; border-radius: 4px; }
		.image-container h3 { margin: 10px 0; }
		#compositeImg { border: 3px solid #4CAF50; }
		.preset-buttons { display: flex; gap: 10px; justify-content: center; margin: 20px 0; flex-wrap: wrap; }
		.preset-btn { padding: 10px 15px; background: #555; border: none; color: white; border-radius: 4px; cursor: pointer; }
		.preset-btn:hover { background: #666; }
		.preset-btn.active { background: #4CAF50; }
	</style>
</head>
<body>
	<div class="container">
		<h1>🌞 Solar Composite Feather Tuning</h1>
		<p style="text-align: center; color: #aaa;">Perfect size (1435px) • Tune edge softness</p>
		
		<div class="controls">
			<div class="feather-display">Feather Radius: <span id="featherValue">${featherRadius}</span> pixels</div>
			
			<div class="preset-buttons">
				<button class="preset-btn" onclick="setFeather(0)">Sharp (0px)</button>
				<button class="preset-btn" onclick="setFeather(20)">Light (20px)</button>
				<button class="preset-btn" onclick="setFeather(40)">Default (40px)</button>
				<button class="preset-btn" onclick="setFeather(60)">Soft (60px)</button>
				<button class="preset-btn" onclick="setFeather(80)">Very Soft (80px)</button>
			</div>
			
			<div class="slider-container">
				<label for="featherSlider">Fine Tune Edge Softness (0 = hard edge, 100 = very soft):</label><br><br>
				<input type="range" id="featherSlider" class="slider" min="0" max="100" value="${featherRadius}" step="1">
				<br><br>
				<label for="featherInput">Precise Value:</label>
				<input type="number" id="featherInput" value="${featherRadius}" min="0" max="100" step="1" style="width: 80px; margin-left: 10px;">
			</div>
		</div>

		<div class="images">
			<div class="image-container">
				<h3>Solar Composite (Feather Tuning)</h3>
				<img id="compositeImg" src="/feather?image=composite&feather=${featherRadius}&date=${isoDate}" alt="Composite">
			</div>
		</div>

		<div style="background: #333; padding: 15px; border-radius: 8px; margin-top: 20px;">
			<h3>How to Use:</h3>
			<p>• <strong>Quick Presets:</strong> Click preset buttons for common feather amounts</p>
			<p>• <strong>Fine Tuning:</strong> Use the slider for precise control (auto-updates)</p>
			<p>• <strong>Perfect Size:</strong> Sun disk is pre-sized to 1435px for perfect alignment</p>
			<p>• <strong>Find Your Sweet Spot:</strong> Look for the feather value that makes the SDO edge invisible</p>
		</div>
	</div>

	<script>
		const featherSlider = document.getElementById('featherSlider');
		const featherInput = document.getElementById('featherInput');
		const featherDisplay = document.getElementById('featherValue');
		const compositeImg = document.getElementById('compositeImg');
		const presetButtons = document.querySelectorAll('.preset-btn');

		function syncFeatherValues(value) {
			featherSlider.value = value;
			featherInput.value = value;
			featherDisplay.textContent = value;
			updateActivePreset(value);
		}

		function updateActivePreset(value) {
			presetButtons.forEach(btn => {
				const presetValue = btn.onclick.toString().match(/setFeather\\((\\d+)\\)/)?.[1];
				btn.classList.toggle('active', presetValue === value.toString());
			});
		}

		function setFeather(value) {
			syncFeatherValues(value);
			updateImages();
		}

		featherSlider.oninput = function() { syncFeatherValues(this.value); };
		featherInput.oninput = function() { syncFeatherValues(this.value); };

		function updateImages() {
			const feather = featherSlider.value;
			const date = '${isoDate}';
			compositeImg.src = '/feather?image=composite&feather=' + feather + '&date=' + date + '&t=' + Date.now();
		}

		// Auto-update on slider change
		featherSlider.onchange = updateImages;
		featherInput.onchange = updateImages;

		// Initialize active preset
		updateActivePreset(${featherRadius});
	</script>
</body>
</html>
	`);
});

app.get('/blend-test', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const blendMode = req.query.blend ? (req.query.blend as string) : 'screen';

	if (req.query.image === 'composite') {
		try {
			const imageBuffer = await createBlendTestComposite(isoDate, apiKey, blendMode);
			res.set('Content-Type', 'image/png');
			res.send(imageBuffer);
		} catch (error) {
			console.error('Error creating blend test composite:', error);
			res.status(500).send('Error creating composite');
		}
		return;
	}

	// List of available blend modes in Sharp
	const blendModes = [
		'multiply', 'screen', 'overlay', 'darken', 'lighten',
		'color-dodge', 'color-burn', 'hard-light', 'soft-light',
		'difference', 'exclusion'
	];

	// Return the blend test interface HTML
	res.set('Content-Type', 'text/html');
	res.send(`
<!DOCTYPE html>
<html>
<head>
	<title>Blend Mode Testing Interface</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: #000; color: #fff; }
		.container { max-width: 1200px; margin: 0 auto; }
		.controls { background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
		.blend-display { font-size: 24px; font-weight: bold; color: #4CAF50; margin: 10px 0; }
		.blend-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
		.blend-button { padding: 10px; background: #555; border: none; color: white; border-radius: 4px; cursor: pointer; }
		.blend-button:hover { background: #666; }
		.blend-button.active { background: #4CAF50; }
		.images { display: flex; gap: 20px; flex-wrap: wrap; }
		.image-container { text-align: center; }
		.image-container img { max-width: 100%; border: 2px solid #666; border-radius: 4px; }
		.image-container h3 { margin: 10px 0; }
		#compositeImg { border: 3px solid #4CAF50; }
	</style>
</head>
<body>
	<div class="container">
		<h1>Blend Mode Testing</h1>
		
		<div class="controls">
			<h3>Current Settings</h3>
			<div class="blend-display">Current Blend Mode: <span id="blendValue">${blendMode}</span></div>
			<div style="margin: 10px 0;">Size: 1435px (perfect alignment)</div>
			
			<h4>Select Blend Mode:</h4>
			<div class="blend-grid">
				${blendModes.map(mode => 
					`<button class="blend-button ${mode === blendMode ? 'active' : ''}" data-blend="${mode}">${mode}</button>`
				).join('')}
			</div>
		</div>

		<div class="images">
			<div class="image-container">
				<h3>Composite (Test Blend Modes)</h3>
				<img id="compositeImg" src="/blend-test?image=composite&blend=${blendMode}&date=${isoDate}" alt="Composite">
			</div>
		</div>

		<div style="background: #333; padding: 15px; border-radius: 8px; margin-top: 20px;">
			<h3>Instructions:</h3>
			<p>1. Click different blend mode buttons to test them</p>
			<p>2. Look for the blend mode that makes the SDO image edge invisible</p>
			<p>3. The goal is to eliminate the visible rectangular boundary of the SDO image</p>
			<p>4. <strong>Tell me which blend mode works best!</strong></p>
		</div>
	</div>

	<script>
		const blendDisplay = document.getElementById('blendValue');
		const compositeImg = document.getElementById('compositeImg');
		const blendButtons = document.querySelectorAll('.blend-button');

		function updateBlendMode(blendMode) {
			blendDisplay.textContent = blendMode;
			const date = '${isoDate}';
			compositeImg.src = '/blend-test?image=composite&blend=' + blendMode + '&date=' + date + '&t=' + Date.now();
			
			// Update active button
			blendButtons.forEach(btn => {
				btn.classList.toggle('active', btn.dataset.blend === blendMode);
			});
		}

		// Add click handlers to blend buttons
		blendButtons.forEach(button => {
			button.addEventListener('click', () => {
				updateBlendMode(button.dataset.blend);
			});
		});
	</script>
</body>
</html>
	`);
});

app.get('/feather-dual', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const featherTarget = req.query.target ? (req.query.target as string) : 'sdo';
	const sdoFeatherRadius = req.query.sdo_feather ? parseInt(req.query.sdo_feather as string) : 40;
	const sohoFeatherRadius = req.query.soho_feather ? parseInt(req.query.soho_feather as string) : 50;
	const featherMode = req.query.mode ? (req.query.mode as string) : 'outer';
	const blendMode = req.query.blend ? (req.query.blend as string) : 'screen';
	const sunDiskSize = req.query.size ? parseInt(req.query.size as string) : 1435; // Perfect calibrated size

	if (req.query.image === 'composite') {
		try {
			const imageBuffer = await createDualFeatherComposite(isoDate, apiKey, {
				featherTarget: featherTarget as any,
				sdoFeatherRadius,
				sohoFeatherRadius,
				blendMode,
				sunDiskSize
			});
			res.set('Content-Type', 'image/png');
			res.send(imageBuffer);
		} catch (error) {
			console.error('Error creating dual feather composite:', error);
			res.status(500).send('Error creating composite');
		}
		return;
	}

	if (req.query.image === 'sdo_only') {
		try {
			const width = 1920;
			const sunDiskImageScale = 2.5;
			const sunDiskImage = await fetchHelioviewerImage(isoDate, apiKey, 10, sunDiskImageScale, width, width);
			let processedImage = sunDiskImage;
			
			// Just resize without feathering
			processedImage = await sharp(sunDiskImage).resize(sunDiskSize, sunDiskSize).toBuffer();
			
			res.set('Content-Type', 'image/png');
			res.send(processedImage);
		} catch (error) {
			console.error('Error creating SDO image:', error);
			res.status(500).send('Error creating SDO image');
		}
		return;
	}

	if (req.query.image === 'soho_only') {
		try {
			const width = 1920;
			const height = 1200;
			const coronaImageScale = 8;
			const coronaImage = await fetchHelioviewerImage(isoDate, apiKey, 4, coronaImageScale, width, height);
			let processedImage = coronaImage;
			
			// No feathering - just return corona image as-is
			
			res.set('Content-Type', 'image/png');
			res.send(processedImage);
		} catch (error) {
			console.error('Error creating SOHO image:', error);
			res.status(500).send('Error creating SOHO image');
		}
		return;
	}

	// Available blend modes
	const blendModes = [
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
		'color-dodge', 'color-burn', 'hard-light', 'soft-light',
		'difference', 'exclusion'
	];

	// Return the dual feathering interface HTML
	res.set('Content-Type', 'text/html');
	res.send(`
<!DOCTYPE html>
<html>
<head>
	<title>Dual Feathering Interface</title>
	<style>
		body { font-family: Arial, sans-serif; margin: 20px; background: #000; color: #fff; }
		.container { max-width: 1400px; margin: 0 auto; }
		.controls { background: #333; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
		.control-section { background: #444; margin: 15px 0; padding: 15px; border-radius: 4px; }
		.control-row { display: flex; gap: 20px; align-items: center; margin: 10px 0; flex-wrap: wrap; }
		.parameter-display { font-size: 18px; font-weight: bold; color: #4CAF50; margin: 5px 0; }
		.slider { width: 200px; margin: 0 10px; }
		.radio-group { display: flex; gap: 15px; flex-wrap: wrap; }
		.radio-group label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
		.select-group { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
		.images { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
		.image-container { text-align: center; background: #222; padding: 15px; border-radius: 8px; }
		.image-container img { max-width: 100%; border: 2px solid #666; border-radius: 4px; }
		.image-container h3 { margin: 10px 0; color: #4CAF50; }
		.main-composite { border: 3px solid #4CAF50 !important; }
		.update-btn { padding: 12px 20px; background: #4CAF50; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 16px; }
		.update-btn:hover { background: #45a049; }
		.instructions { background: #333; padding: 15px; border-radius: 8px; margin-top: 20px; }
		.instructions h3 { color: #4CAF50; }
		input[type="number"] { width: 80px; padding: 5px; margin: 0 5px; }
		select { padding: 5px; margin: 0 5px; }
	</style>
</head>
<body>
	<div class="container">
		<h1>🌞 Dual Feathering Tuning Interface</h1>
		<p style="text-align: center; color: #aaa;">Fine-tune feathering on SDO, SOHO, or both images</p>
		
		<div class="controls">
			<div class="control-section">
				<h3>🎯 Feathering Target</h3>
				<div class="radio-group">
					<label><input type="radio" name="target" value="none" ${featherTarget === 'none' ? 'checked' : ''}> None (No Feathering)</label>
					<label><input type="radio" name="target" value="sdo" ${featherTarget === 'sdo' ? 'checked' : ''}> SDO Only (Sun Disk)</label>
					<label><input type="radio" name="target" value="soho" ${featherTarget === 'soho' ? 'checked' : ''}> SOHO Only (Corona)</label>
					<label><input type="radio" name="target" value="both" ${featherTarget === 'both' ? 'checked' : ''}> Both Images</label>
				</div>
			</div>

			<div class="control-section">
				<h3>⚙️ Feathering Parameters</h3>
				
				<div class="control-row">
					<div class="parameter-display">SDO Feather: <span id="sdoFeatherValue">${sdoFeatherRadius}</span>px</div>
					<input type="range" id="sdoFeatherSlider" class="slider" min="0" max="150" value="${sdoFeatherRadius}" step="5">
					<input type="number" id="sdoFeatherInput" value="${sdoFeatherRadius}" min="0" max="150" step="1">
				</div>
				
				<div class="control-row">
					<div class="parameter-display">SOHO Feather: <span id="sohoFeatherValue">${sohoFeatherRadius}</span>px</div>
					<input type="range" id="sohoFeatherSlider" class="slider" min="0" max="200" value="${sohoFeatherRadius}" step="5">
					<input type="number" id="sohoFeatherInput" value="${sohoFeatherRadius}" min="0" max="200" step="1">
				</div>
				
				<div class="control-row">
					<div class="parameter-display">Sun Disk Size: <span id="sizeValue">${sunDiskSize}</span>px</div>
					<input type="range" id="sizeSlider" class="slider" min="1400" max="1470" value="${sunDiskSize}" step="1">
					<input type="number" id="sizeInput" value="${sunDiskSize}" min="1400" max="1470" step="1">
				</div>
			</div>

			<div class="control-section">
				<h3>🎨 Advanced Options</h3>
				<div class="control-row">
					<div class="select-group">
						<label>Feather Mode:</label>
						<select id="featherModeSelect">
							<option value="outer" ${featherMode === 'outer' ? 'selected' : ''}>Outer Edge</option>
							<option value="inner" ${featherMode === 'inner' ? 'selected' : ''}>Inner Edge</option>
							<option value="both" ${featherMode === 'both' ? 'selected' : ''}>Both Edges</option>
						</select>
					</div>
					
					<div class="select-group">
						<label>Blend Mode:</label>
						<select id="blendModeSelect">
							${blendModes.map(mode => 
								`<option value="${mode}" ${mode === blendMode ? 'selected' : ''}>${mode}</option>`
							).join('')}
						</select>
					</div>
				</div>
			</div>

			<div style="text-align: center; margin-top: 20px;">
				<button class="update-btn" onclick="updateImages()">🔄 Update All Images</button>
			</div>
		</div>

		<div class="images">
			<div class="image-container">
				<h3>Final Composite</h3>
				<img id="compositeImg" class="main-composite" src="/feather-dual?image=composite&target=${featherTarget}&sdo_feather=${sdoFeatherRadius}&soho_feather=${sohoFeatherRadius}&mode=${featherMode}&blend=${blendMode}&size=${sunDiskSize}&date=${isoDate}" alt="Composite">
			</div>
			
			<div class="image-container">
				<h3>SDO Image (with feathering)</h3>
				<img id="sdoImg" src="/feather-dual?image=sdo_only&target=${featherTarget}&sdo_feather=${sdoFeatherRadius}&mode=${featherMode}&size=${sunDiskSize}&date=${isoDate}" alt="SDO">
			</div>
			
			<div class="image-container">
				<h3>SOHO Image (with feathering)</h3>
				<img id="sohoImg" src="/feather-dual?image=soho_only&target=${featherTarget}&soho_feather=${sohoFeatherRadius}&mode=${featherMode}&date=${isoDate}" alt="SOHO">
			</div>
		</div>

		<div class="instructions">
			<h3>How to Use:</h3>
			<p><strong>🎯 Target Selection:</strong> Choose which image(s) to feather - SDO (sun disk), SOHO (corona), both, or none</p>
			<p><strong>🎛️ Feather Controls:</strong> Adjust feather radius for each image independently</p>
			<p><strong>🎨 Feather Modes:</strong> Outer = fade to transparent at edges, Inner = fade from center, Both = fade at both edges</p>
			<p><strong>🔄 Live Updates:</strong> Use sliders for real-time feedback, or click "Update All Images" for manual refresh</p>
			<p><strong>✨ Goal:</strong> Find the feather settings that eliminate the visible edge between SDO and SOHO images</p>
		</div>
	</div>

	<script>
		const targetRadios = document.querySelectorAll('input[name="target"]');
		const sdoFeatherSlider = document.getElementById('sdoFeatherSlider');
		const sdoFeatherInput = document.getElementById('sdoFeatherInput');
		const sohoFeatherSlider = document.getElementById('sohoFeatherSlider');
		const sohoFeatherInput = document.getElementById('sohoFeatherInput');
		const sizeSlider = document.getElementById('sizeSlider');
		const sizeInput = document.getElementById('sizeInput');
		const featherModeSelect = document.getElementById('featherModeSelect');
		const blendModeSelect = document.getElementById('blendModeSelect');
		
		const sdoFeatherValue = document.getElementById('sdoFeatherValue');
		const sohoFeatherValue = document.getElementById('sohoFeatherValue');
		const sizeValue = document.getElementById('sizeValue');
		
		const compositeImg = document.getElementById('compositeImg');
		const sdoImg = document.getElementById('sdoImg');
		const sohoImg = document.getElementById('sohoImg');

		function syncValues() {
			sdoFeatherSlider.value = sdoFeatherInput.value;
			sohoFeatherSlider.value = sohoFeatherInput.value;
			sizeSlider.value = sizeInput.value;
			
			sdoFeatherValue.textContent = sdoFeatherInput.value;
			sohoFeatherValue.textContent = sohoFeatherInput.value;
			sizeValue.textContent = sizeInput.value;
		}

		// Sync slider and input values
		sdoFeatherSlider.oninput = function() { sdoFeatherInput.value = this.value; syncValues(); };
		sdoFeatherInput.oninput = function() { sdoFeatherSlider.value = this.value; syncValues(); };
		sohoFeatherSlider.oninput = function() { sohoFeatherInput.value = this.value; syncValues(); };
		sohoFeatherInput.oninput = function() { sohoFeatherSlider.value = this.value; syncValues(); };
		sizeSlider.oninput = function() { sizeInput.value = this.value; syncValues(); };
		sizeInput.oninput = function() { sizeSlider.value = this.value; syncValues(); };

		function getSelectedTarget() {
			return document.querySelector('input[name="target"]:checked').value;
		}

		function updateImages() {
			const target = getSelectedTarget();
			const sdoFeather = sdoFeatherSlider.value;
			const sohoFeather = sohoFeatherSlider.value;
			const size = sizeSlider.value;
			const mode = featherModeSelect.value;
			const blend = blendModeSelect.value;
			const date = '${isoDate}';
			const timestamp = Date.now();
			
			const baseParams = \`target=\${target}&sdo_feather=\${sdoFeather}&soho_feather=\${sohoFeather}&mode=\${mode}&size=\${size}&date=\${date}&t=\${timestamp}\`;
			
			compositeImg.src = \`/feather-dual?image=composite&blend=\${blend}&\${baseParams}\`;
			sdoImg.src = \`/feather-dual?image=sdo_only&\${baseParams}\`;
			sohoImg.src = \`/feather-dual?image=soho_only&\${baseParams}\`;
		}

		// Auto-update on changes
		targetRadios.forEach(radio => radio.onchange = updateImages);
		sdoFeatherSlider.onchange = updateImages;
		sdoFeatherInput.onchange = updateImages;
		sohoFeatherSlider.onchange = updateImages;
		sohoFeatherInput.onchange = updateImages;
		sizeSlider.onchange = updateImages;
		sizeInput.onchange = updateImages;
		featherModeSelect.onchange = updateImages;
		blendModeSelect.onchange = updateImages;
	</script>
</body>
</html>
	`);
});


app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
