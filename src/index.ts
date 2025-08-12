import express from 'express';
import sharp from 'sharp';
import crypto from 'crypto';

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
	apiUrl.searchParams.set('layers', JSON.stringify([sourceId, 1, 100]));
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
 * Fetches an image from the Helioviewer API with fallback logic for missing data.
 * @param isoDate The date of the image to fetch in ISO format.
 * @param apiKey The NASA API key to use for the request.
 * @param sourceId The ID of the data source to fetch the image from.
 * @param imageScale The scale of the image in arcseconds per pixel.
 * @param width The width of the image in pixels.
 * @param height The height of the image in pixels.
 * @param fallbackMinutes The number of minutes to search forward and backward for data.
 * @returns A promise that resolves to the image data and actual timestamp used.
 */
async function fetchHelioviewerImageWithFallback(
	isoDate: string,
	apiKey: string,
	sourceId: number,
	imageScale: number,
	width: number,
	height: number,
	fallbackMinutes: number
): Promise<{buffer: Buffer, actualDate: string}> {
	const baseDate = new Date(isoDate);
	
	// Try exact timestamp first
	try {
		const buffer = await fetchHelioviewerImage(isoDate, apiKey, sourceId, imageScale, width, height);
		return { buffer, actualDate: isoDate };
	} catch (error) {
		console.log(`Exact timestamp failed for sourceId ${sourceId}, trying fallback...`);
	}

	// Generate fallback timestamps
	const fallbackAttempts: string[] = [];
	for (let minutes = 1; minutes <= fallbackMinutes; minutes++) {
		// Add positive offset
		const futureDate = new Date(baseDate.getTime() + (minutes * 60 * 1000));
		fallbackAttempts.push(futureDate.toISOString());
		
		// Add negative offset
		const pastDate = new Date(baseDate.getTime() - (minutes * 60 * 1000));
		fallbackAttempts.push(pastDate.toISOString());
	}

	// Try fallback timestamps
	for (const fallbackDate of fallbackAttempts) {
		try {
			const buffer = await fetchHelioviewerImage(fallbackDate, apiKey, sourceId, imageScale, width, height);
			console.log(`Fallback successful for sourceId ${sourceId}: ${isoDate} -> ${fallbackDate}`);
			return { buffer, actualDate: fallbackDate };
		} catch (error) {
			// Continue to next fallback attempt
		}
	}

	// If all fallbacks failed, throw error
	throw new Error(`No data available for sourceId ${sourceId} within ±${fallbackMinutes} minutes of ${isoDate}`);
}

/**
 * Finds optimal component data with uniqueness verification and source-aware search strategies.
 * @param isoDate The target date for the image.
 * @param apiKey The NASA API key.
 * @param sourceId The data source ID (10 for SDO, 4 for LASCO).
 * @param imageScale The scale of the image in arcseconds per pixel.
 * @param width The width of the image in pixels.
 * @param height The height of the image in pixels.
 * @param previousChecksum The checksum of the previous frame's component to avoid duplicates.
 * @param style The color grading style to apply.
 * @returns Promise resolving to component data with uniqueness verification.
 */
async function findOptimalComponentData(
	isoDate: string, 
	apiKey: string, 
	sourceId: number, 
	imageScale: number, 
	width: number, 
	height: number, 
	usedChecksums: string[],
	style: string
): Promise<{buffer: Buffer, actualDate: string, checksum: string, isUnique: boolean}> {
	// Define search strategy based on source type and data cadence
	const isSDO = sourceId === 10;
	const maxSearchMinutes = 60; // Max search window is ±60 minutes
	// Use finer-grained search steps as requested, universal for both sources
	const searchSteps = [3, 5, 10, 15, 30, 45, 60];
	
	console.log(`🔍 Finding optimal ${isSDO ? 'SDO' : 'LASCO'} data for ${isoDate}`);
	console.log(`   Search strategy: ±${maxSearchMinutes}min window, steps: [${searchSteps.join(', ')}]min`);
	if (usedChecksums.length > 0) {
		console.log(`   Avoiding ${usedChecksums.length} previously used checksums.`);
	}
	
	// Helper function to process and checksum image with raw verification
	async function processAndChecksum(buffer: Buffer): Promise<{
		buffer: Buffer, 
		checksum: string, 
		rawChecksum: string
	}> {
		// Calculate raw checksum BEFORE processing to detect API-level duplicates
		const rawChecksum = crypto.createHash('md5').update(buffer).digest('hex');
		
		// Apply color grading
		const processedBuffer = isSDO ? 
			await applySdoColorGrading(buffer, style) : 
			await applyCoronaColorGrading(buffer, style);
		
		// Calculate processed checksum for final verification
		const processedChecksum = crypto.createHash('md5').update(processedBuffer).digest('hex');
		
		return { 
			buffer: processedBuffer, 
			checksum: processedChecksum,
			rawChecksum: rawChecksum
		};
	}
	
	// Try exact timestamp first
	try {
		const rawBuffer = await fetchHelioviewerImage(isoDate, apiKey, sourceId, imageScale, width, height);
		const {buffer, checksum, rawChecksum} = await processAndChecksum(rawBuffer);
		
		// Check uniqueness against the entire history
		const isUnique = !usedChecksums.includes(rawChecksum);
		
		if (isUnique) {
			console.log(`✅ Exact timestamp success: raw=${rawChecksum.substring(0, 8)}... (unique)`);
			return { buffer, actualDate: isoDate, checksum: rawChecksum, isUnique: true };
		} else {
			console.log(`⚠️ Exact timestamp duplicate: raw=${rawChecksum.substring(0, 8)}... (already used, searching alternatives)`);
		}
	} catch (error) {
		console.log(`❌ Exact timestamp failed, searching alternatives...`);
	}
	
	// Enhanced fallback search with detailed logging
	const candidates: Array<{buffer: Buffer, actualDate: string, checksum: string, offset: number}> = [];
	let searchAttempts = 0;
	let fallbackTriggered = false;
	
	console.log(`🚀 Starting progressive search - ${searchSteps.length} steps planned`);
	
	for (const stepMinutes of searchSteps) {
		if (stepMinutes > maxSearchMinutes) break;
		
		console.log(`🔎 Search step ${searchSteps.indexOf(stepMinutes) + 1}/${searchSteps.length}: ±${stepMinutes}min window`);
		
		// Try future first (prefer newer data), then past
		const offsets = [stepMinutes, -stepMinutes];
		
		for (const offsetMinutes of offsets) {
			const targetDate = new Date(new Date(isoDate).getTime() + (offsetMinutes * 60 * 1000));
			const targetIsoDate = targetDate.toISOString();
			searchAttempts++;
			
			console.log(`   🎯 Attempt ${searchAttempts}: ${targetIsoDate} (${offsetMinutes > 0 ? '+' : ''}${offsetMinutes}min offset)`);
			
			try {
				const rawBuffer = await fetchHelioviewerImage(targetIsoDate, apiKey, sourceId, imageScale, width, height);
				const {buffer, checksum, rawChecksum} = await processAndChecksum(rawBuffer);
				
				// Check uniqueness using the entire checksum history
				const isUnique = !usedChecksums.includes(rawChecksum);
				
				if (isUnique) {
					if (!fallbackTriggered) {
						fallbackTriggered = true;
						console.log(`🎯 FALLBACK ACTIVATED: Smart search found unique data after ${searchAttempts} attempts`);
					}
					console.log(`✅ UNIQUE DATA FOUND: ${targetIsoDate} (${offsetMinutes > 0 ? '+' : ''}${offsetMinutes}min) → raw=${rawChecksum.substring(0, 8)}...`);
					console.log(`📊 Search completed: ${searchAttempts} attempts, ${candidates.length} duplicates rejected`);
					return { buffer, actualDate: targetIsoDate, checksum: rawChecksum, isUnique: true };
				} else {
					candidates.push({ buffer, actualDate: targetIsoDate, checksum: rawChecksum, offset: Math.abs(offsetMinutes) });
					console.log(`   ❌ DUPLICATE: raw=${rawChecksum.substring(0, 8)}... (already in history)`);
				}
			} catch (error) {
				// This is a recoverable error (e.g., API has no data for this specific minute)
				console.log(`   -> No data at this offset. Continuing search.`);
			}
		}
	}
	
	console.log(`⚠️  Progressive search completed: ${searchAttempts} attempts, ${candidates.length} duplicates found, 0 unique data`);
	fallbackTriggered = true;
	
	// Graceful degradation: If no unique candidates are found, use the best available duplicate.
	if (candidates.length > 0) {
		// Sort candidates by the smallest time offset to find the closest match
		candidates.sort((a, b) => a.offset - b.offset);
		const bestDuplicate = candidates[0];

		console.log(`🟡 GRACEFUL DEGRADATION: No unique frame found. Using best available duplicate.`);
		console.log(`   Best duplicate is from ${bestDuplicate.actualDate} (offset: ${bestDuplicate.offset}min)`);

		// Return the best duplicate, explicitly marking it as not unique
		return {
			buffer: bestDuplicate.buffer,
			actualDate: bestDuplicate.actualDate,
			checksum: bestDuplicate.checksum,
			isUnique: false
		};
	}
	
	// If we reach here, it means no images were found at all (unique or duplicate).
	// This is a hard failure condition.
	throw new Error(`No ${isSDO ? 'SDO' : 'LASCO'} data available within ±${maxSearchMinutes} minutes of ${isoDate}. No images found at any fallback offset.`);
}



const app = express();
const port = process.env.PORT || 3002;

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Recreate __dirname for ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Image cache to store recent images by timestamp and style
const imageCache = new Map<string, Buffer>();
const CACHE_DURATION = 3 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

/**
 * Generates a cache key for storing/retrieving images
 */
function getCacheKey(isoDate: string, compositeRadius: number, featherRadius: number, style: string): string {
	return `${isoDate}_${compositeRadius}_${featherRadius}_${style}`;
}

/**
 * Gets timestamps for current time and previous periods with meaningful solar data changes
 */
function getTimestamps(): string[] {
	const now = new Date();
	const timestamps: string[] = [];
	
	// Use longer intervals to ensure we get different solar data
	const intervals = [
		{ hours: 0, label: 'Now' },
		{ hours: 3, label: '3 hours ago' },
		{ hours: 6, label: '6 hours ago' },
		{ hours: 12, label: '12 hours ago' },
		{ hours: 24, label: '1 day ago' },
		{ hours: 48, label: '2 days ago' }
	];
	
	intervals.forEach(interval => {
		const timestamp = new Date(now.getTime() - (interval.hours * 60 * 60 * 1000));
		timestamps.push(timestamp.toISOString());
	});
	
	return timestamps;
}

/**
 * Cleans expired cache entries
 */
function cleanCache(): void {
	const now = Date.now();
	const cutoff = now - CACHE_DURATION;
	
	for (const [key, _] of imageCache) {
		const timestamp = key.split('_')[0];
		const cacheTime = new Date(timestamp).getTime();
		
		if (cacheTime < cutoff) {
			imageCache.delete(key);
		}
	}
}

/**
 * Enhanced feathering with multi-stage gradients and edge preservation.
 * @param imageBuffer The image to process.
 * @param finalSize The target size for the image (fixed at 1435px).
 * @param compositeRadius The radius of the composite area.
 * @param featherRadius The radius of the feather effect.
 * @param featherProfile The feather profile ('linear', 'exponential', 'smooth').
 * @returns A promise that resolves to the processed image buffer.
 */
async function applyCircularFeather(
	imageBuffer: Buffer, 
	finalSize: number, 
	compositeRadius: number, 
	featherRadius: number
): Promise<Buffer> {
	// First, resize the image to the final size.
	const resizedImage = await sharp(imageBuffer)
		.resize(finalSize, finalSize)
		.toBuffer();

	// If feathering is zero, no need to apply a mask.
	if (featherRadius <= 0) {
		return resizedImage;
	}

	// Create simple feathered mask
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
 * Applies color grading to SOHO corona based on the selected style.
 * @param imageBuffer The corona image to color grade.
 * @param style The color grading style to apply.
 * @returns A promise that resolves to the color-graded image buffer.
 */
async function applyCoronaColorGrading(imageBuffer: Buffer, style: string = 'ad-astra'): Promise<Buffer> {
	let sharpInstance = sharp(imageBuffer);

	switch (style) {
		case 'sunshine':
			// Warm, atmospheric corona to match golden sun
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.5, brightness: 1.1, hue: 5 })
				.tint({ r: 255, g: 245, b: 220 })
				.linear(1.2, -15);
			break;

		case 'natural':
			// Natural blue corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.6, brightness: 1.1, hue: -10 })
				.tint({ r: 180, g: 200, b: 255 })
				.linear(1.2, -15);
			break;

		case 'scifi':
			// Electric blue-white corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.8, brightness: 1.4, hue: -20 })
				.tint({ r: 150, g: 200, b: 255 })
				.linear(1.6, -35);
			break;

		case 'red':
			// Orange-red corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.0, brightness: 1.2, hue: 15 })
				.tint({ r: 255, g: 150, b: 100 })
				.linear(1.4, -25);
			break;

		case 'white':
			// Neutral white corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.3, brightness: 1.3, hue: 0 })
				.tint({ r: 255, g: 255, b: 255 })
				.linear(1.5, -30);
			break;

		case 'vintage':
			// Warm sepia corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.7, brightness: 1.0, hue: 20 })
				.tint({ r: 255, g: 220, b: 180 })
				.linear(1.1, -10);
			break;

		case 'interstellar':
			// Muted, desaturated Earth atmosphere
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.4, brightness: 1.1, hue: 8 })
				.tint({ r: 245, g: 235, b: 210 })
				.linear(1.1, -8);
			break;

		case 'blade-runner':
			// Deep amber atmospheric haze
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.6, brightness: 1.3, hue: 12 })
				.tint({ r: 255, g: 180, b: 120 })
				.linear(1.4, -18);
			break;

		case 'ad-astra':
			// Cool space contrast to warm sun
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
				.tint({ r: 220, g: 230, b: 240 })
				.linear(1.2, -12);
			break;

		case 'apollo':
			// Vintage film stock corona
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.5, brightness: 1.0, hue: 5 })
				.tint({ r: 250, g: 240, b: 220 })
				.linear(1.0, -5);
			break;

		default:
			// Default to sunshine style
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.5, brightness: 1.2, hue: 5 })
				.tint({ r: 255, g: 245, b: 220 })
				.linear(1.3, -20);
	}

	return await sharpInstance.toBuffer();
}

/**
 * Applies color grading to SDO sun disk based on the selected style.
 * @param imageBuffer The SDO image to color grade.
 * @param style The color grading style to apply.
 * @returns A promise that resolves to the color-graded image buffer.
 */
async function applySdoColorGrading(imageBuffer: Buffer, style: string = 'ad-astra'): Promise<Buffer> {
	let sharpInstance = sharp(imageBuffer);

	switch (style) {
		case 'sunshine':
			// Golden-orange solar fire
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.4, brightness: 1.3, hue: 25 })
				.tint({ r: 255, g: 180, b: 80 })
				.linear(1.8, -25)
				.gamma(1.2);
			break;

		case 'natural':
			// Natural solar colors
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.9, brightness: 1.1, hue: 15 })
				.tint({ r: 255, g: 240, b: 200 })
				.linear(1.3, -15)
				.gamma(1.1);
			break;

		case 'scifi':
			// Cool blue-white star
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.4, brightness: 1.6, hue: -30 })
				.tint({ r: 200, g: 230, b: 255 })
				.linear(2.0, -40)
				.gamma(1.3);
			break;

		case 'red':
			// Deep red solar fire
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.6, brightness: 1.2, hue: 40 })
				.tint({ r: 255, g: 100, b: 60 })
				.linear(1.7, -30)
				.gamma(1.2);
			break;

		case 'white':
			// Pure white-hot star
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.2, brightness: 1.7, hue: 0 })
				.tint({ r: 255, g: 255, b: 250 })
				.linear(2.2, -45)
				.gamma(1.4);
			break;

		case 'vintage':
			// Warm sepia/brown vintage look
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.1, brightness: 1.0, hue: 35 })
				.tint({ r: 255, g: 200, b: 150 })
				.linear(1.2, -10)
				.gamma(1.1);
			break;

		case 'interstellar':
			// Earth's golden nostalgic warmth
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.9, brightness: 1.2, hue: 20 })
				.tint({ r: 255, g: 220, b: 180 })
				.linear(1.3, -12)
				.gamma(1.0);
			break;

		case 'blade-runner':
			// Roger Deakins' amber/orange neo-noir aesthetic
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.3, brightness: 1.1, hue: 30 })
				.tint({ r: 255, g: 160, b: 90 })
				.linear(1.6, -20)
				.gamma(1.1);
			break;

		case 'ad-astra':
			// Cosmic isolation with warm solar elements
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.2, brightness: 1.4, hue: 15 })
				.tint({ r: 255, g: 200, b: 120 })
				.linear(1.7, -30)
				.gamma(1.3);
			break;

		case 'apollo':
			// Vintage NASA space program aesthetic
			sharpInstance = sharpInstance
				.modulate({ saturation: 0.8, brightness: 1.1, hue: 18 })
				.tint({ r: 255, g: 240, b: 210 })
				.linear(1.2, -8)
				.gamma(0.95);
			break;

		default:
			// Default to sunshine style
			sharpInstance = sharpInstance
				.modulate({ saturation: 1.4, brightness: 1.3, hue: 25 })
				.tint({ r: 255, g: 180, b: 80 })
				.linear(1.8, -25)
				.gamma(1.2);
	}

	return await sharpInstance.toBuffer();
}

/**
 * Balances exposure between corona and sun disk images for optimal compositing.
 * @param coronaImage The corona image buffer.
 * @param sunDiskImage The sun disk image buffer.
 * @returns Promise resolving to exposure-balanced images.
 */
async function balanceExposure(coronaImage: Buffer, sunDiskImage: Buffer): Promise<{corona: Buffer, sunDisk: Buffer}> {
	// Analyze corona brightness and apply gentle contrast enhancement
	const enhancedCorona = await sharp(coronaImage)
		.normalize({ lower: 1, upper: 99 }) // Normalize to 1st-99th percentile
		.linear(1.1, -5) // Slight contrast boost
		.png() // Ensure output format
		.toBuffer();

	// Analyze sun disk and ensure it doesn't overpower the corona
	const balancedSunDisk = await sharp(sunDiskImage)
		.modulate({ brightness: 0.95 }) // Slightly reduce brightness to prevent overexposure
		.linear(1.05, 0) // Gentle contrast
		.png() // Ensure output format
		.toBuffer();

	return { corona: enhancedCorona, sunDisk: balancedSunDisk };
}

/**
 * Advanced blending function with multiple composite modes.
 * @param coronaImage The processed corona image.
 * @param sunDiskImage The processed and feathered sun disk.
 * @param finalWidth Canvas width.
 * @param finalHeight Canvas height.
 * @param blendMode The blending mode to use.
 * @param blendStrength Strength of the blend (0-1).
 * @returns Promise resolving to the final composite buffer.
 */
async function advancedComposite(
	coronaImage: Buffer, 
	sunDiskImage: Buffer, 
	finalWidth: number, 
	finalHeight: number,
	blendMode: string = 'soft-light',
	blendStrength: number = 0.85
): Promise<Buffer> {
	
	// Create base canvas with corona
	const baseComposite = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
	.composite([{ input: coronaImage, gravity: 'center' }])
	.png()
	.toBuffer();

	// Apply the main blend
	let finalImage: Buffer;
	
	switch (blendMode) {
		case 'soft-light':
			finalImage = await sharp(baseComposite)
				.composite([{ 
					input: sunDiskImage, 
					gravity: 'center', 
					blend: 'soft-light'
				}])
				.png()
				.toBuffer();
			break;
			
		case 'screen':
			finalImage = await sharp(baseComposite)
				.composite([{ 
					input: sunDiskImage, 
					gravity: 'center', 
					blend: 'screen'
				}])
				.png()
				.toBuffer();
			break;
			
		case 'overlay':
			finalImage = await sharp(baseComposite)
				.composite([{ 
					input: sunDiskImage, 
					gravity: 'center', 
					blend: 'overlay'
				}])
				.png()
				.toBuffer();
			break;
			
		case 'multiply':
			finalImage = await sharp(baseComposite)
				.composite([{ 
					input: sunDiskImage, 
					gravity: 'center', 
					blend: 'multiply'
				}])
				.png()
				.toBuffer();
			break;
			
		default: // 'enhanced' - custom solar-optimized blend
			// First layer: soft-light for natural blending
			const softLayer = await sharp(baseComposite)
				.composite([{ 
					input: sunDiskImage, 
					gravity: 'center', 
					blend: 'soft-light'
				}])
				.png()
				.toBuffer();
			
			// Second layer: screen at reduced opacity for glow
			const screenMask = await sharp(sunDiskImage)
				.modulate({ brightness: 0.4 }) // Reduce intensity for glow effect
				.png() // Ensure format compatibility
				.toBuffer();
				
			finalImage = await sharp(softLayer)
				.composite([{ 
					input: screenMask, 
					gravity: 'center', 
					blend: 'screen'
				}])
				.png()
				.toBuffer();
			break;
	}

	// Apply blend strength by mixing with original corona if needed
	if (blendStrength < 1.0) {
		const mixRatio = Math.round(blendStrength * 100);
		finalImage = await sharp(baseComposite)
			.composite([{
				input: finalImage,
				blend: 'over',
				// Note: Sharp doesn't have native opacity control, so we pre-process the blend layer
			}])
			.toBuffer();
	}

	return finalImage;
}

/**
 * Creates a composite image with enhanced quality and advanced blending.
 * @param isoDate The date of the image to fetch.
 * @param apiKey The NASA API key.
 * @param compositeRadius The radius of the composite area.
 * @param featherRadius The radius to feather the sun disk edge.
 * @param style The color grading style to apply.
 * @param blendMode The blending mode for compositing.
 * @param blendStrength The strength of the blend effect.
 * @returns A promise that resolves to the composited image buffer.
 */
async function createTunedCompositeImage(
	isoDate: string, 
	apiKey: string, 
	compositeRadius: number, 
	featherRadius: number, 
	style: string = 'ad-astra',
	cropWidth: number = 1440,
	cropHeight: number = 1200
): Promise<{buffer: Buffer, metadata: {sdoDate: string, lascoDate: string, fallbackUsed: boolean}}> {
	const width = 1920;
	const height = 1200;

	// Fetch corona image (SOHO/LASCO C2) with ±15 minute fallback
	const coronaImageScale = 8;
	const coronaImagePromise = fetchHelioviewerImageWithFallback(isoDate, apiKey, 4, coronaImageScale, width, height, 15);

	// Fetch sun disk image (SDO/AIA 171) with ±5 minute fallback
	const sunDiskImageScale = 2.5;
	const sunDiskImagePromise = fetchHelioviewerImageWithFallback(isoDate, apiKey, 10, sunDiskImageScale, width, width, 5);

	const [coronaResult, sunDiskResult] = await Promise.all([coronaImagePromise, sunDiskImagePromise]);
	
	const coronaImageRaw = coronaResult.buffer;
	const sunDiskImageRaw = sunDiskResult.buffer;
	
	// Track if fallback was used
	const fallbackUsed = coronaResult.actualDate !== isoDate || sunDiskResult.actualDate !== isoDate;

	// Apply color grading to both images with selected style
	const coronaImageGraded = await applyCoronaColorGrading(coronaImageRaw, style);
	const sunDiskImageGraded = await applySdoColorGrading(sunDiskImageRaw, style);

	// Balance exposure between the two images
	const { corona: coronaBalanced, sunDisk: sunDiskBalanced } = await balanceExposure(coronaImageGraded, sunDiskImageGraded);

	// Fixed SDO size at 1435px
	const sdoSize = 1435;
	
	// Apply feathering to the sun disk image
	const featheredSunDisk = await applyCircularFeather(sunDiskBalanced, sdoSize, compositeRadius, featherRadius);

	// Determine the final canvas size
	const finalWidth = Math.max(width, sdoSize);
	const finalHeight = Math.max(height, sdoSize);

	// Simple screen composite
	let finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
	.composite([
		{ input: coronaBalanced, gravity: 'center' },
		{ input: featheredSunDisk, gravity: 'center', blend: 'screen' }
	])
	.png()
	.toBuffer();

	// Apply crop if specified
	if (cropWidth > 0 && cropHeight > 0) {
		// Calculate crop position to center the cropped area
		const cropLeft = Math.max(0, Math.floor((finalWidth - cropWidth) / 2));
		const cropTop = Math.max(0, Math.floor((finalHeight - cropHeight) / 2));
		
		finalImage = await sharp(finalImage)
			.extract({ 
				left: cropLeft, 
				top: cropTop, 
				width: Math.min(cropWidth, finalWidth), 
				height: Math.min(cropHeight, finalHeight) 
			})
			.png()
			.toBuffer();
	}

	return {
		buffer: finalImage,
		metadata: {
			sdoDate: sunDiskResult.actualDate,
			lascoDate: coronaResult.actualDate,
			fallbackUsed: fallbackUsed
		}
	};
}

/**
 * Creates a verified composite image with component uniqueness guarantees.
 * Maintains 30-minute cadence while ensuring both SDO and LASCO components are unique from previous frame.
 * @param isoDate The target 30-minute interval timestamp.
 * @param apiKey The NASA API key.
 * @param compositeRadius The radius of the composite area.
 * @param featherRadius The radius to feather the sun disk edge.
 * @param style The color grading style to apply.
 * @param cropWidth The width to crop the final image.
 * @param cropHeight The height to crop the final image.
 * @param previousSdoChecksum The checksum of the previous frame's SDO component.
 * @param previousLascoChecksum The checksum of the previous frame's LASCO component.
 * @returns A promise that resolves to the verified composite image with enhanced metadata.
 */
async function createVerifiedCompositeImage(
	isoDate: string,
	apiKey: string,
	compositeRadius: number,
	featherRadius: number,
	style: string = 'ad-astra',
	cropWidth: number = 1440,
	cropHeight: number = 1200,
	usedSdoChecksums: string[] = [],
	usedLascoChecksums: string[] = []
): Promise<{
	buffer: Buffer,
	metadata: {
		sdoDate: string,
		lascoDate: string,
		sdoChecksum: string,
		lascoChecksum: string,
		sdoUnique: boolean,
		lascoUnique: boolean,
		targetDate: string,
		fallbackUsed: boolean
	}
}> {
	const width = 1920;
	const height = 1200;

	console.log(`🎬 Creating verified composite for ${isoDate}`);
	
	// Use smart fallback to find optimal component data
	const coronaImageScale = 8;
	const sunDiskImageScale = 2.5;
	
	// Find optimal SDO component
	const sdoDataPromise = findOptimalComponentData(
		isoDate, apiKey, 10, sunDiskImageScale, width, width, 
		usedSdoChecksums, style
	);
	
	// Find optimal LASCO component
	const lascoDataPromise = findOptimalComponentData(
		isoDate, apiKey, 4, coronaImageScale, width, height,
		usedLascoChecksums, style
	);
	
	const [sdoData, lascoData] = await Promise.all([sdoDataPromise, lascoDataPromise]);
	
	// Log component verification results
	console.log(`🔍 SDO: ${sdoData.actualDate} → ${sdoData.checksum.substring(0, 8)}... ${sdoData.isUnique ? '✅ UNIQUE' : '⚠️ DUPLICATE'}`);
	console.log(`🔍 LASCO: ${lascoData.actualDate} → ${lascoData.checksum.substring(0, 8)}... ${lascoData.isUnique ? '✅ UNIQUE' : '⚠️ DUPLICATE'}`);
	
	// Use the already processed (color graded) buffers from smart fallback
	const coronaImageGraded = lascoData.buffer;
	const sunDiskImageGraded = sdoData.buffer;
	
	// Balance exposure between the two images
	const { corona: coronaBalanced, sunDisk: sunDiskBalanced } = await balanceExposure(coronaImageGraded, sunDiskImageGraded);
	
	// Fixed SDO size at 1435px
	const sdoSize = 1435;
	
	// Apply feathering to the sun disk image
	const featheredSunDisk = await applyCircularFeather(sunDiskBalanced, sdoSize, compositeRadius, featherRadius);
	
	// Determine the final canvas size
	const finalWidth = Math.max(width, sdoSize);
	const finalHeight = Math.max(height, sdoSize);
	
	// Simple screen composite
	let finalImage = await sharp({
		create: {
			width: finalWidth,
			height: finalHeight,
			channels: 4,
			background: { r: 0, g: 0, b: 0, alpha: 0 }
		}
	})
	.composite([
		{ input: coronaBalanced, gravity: 'center' },
		{ input: featheredSunDisk, gravity: 'center', blend: 'screen' }
	])
	.png()
	.toBuffer();
	
	// Apply crop if specified
	if (cropWidth > 0 && cropHeight > 0) {
		// Calculate crop position to center the cropped area
		const cropLeft = Math.max(0, Math.floor((finalWidth - cropWidth) / 2));
		const cropTop = Math.max(0, Math.floor((finalHeight - cropHeight) / 2));
		
		finalImage = await sharp(finalImage)
			.extract({ 
				left: cropLeft, 
				top: cropTop, 
				width: Math.min(cropWidth, finalWidth), 
				height: Math.min(cropHeight, finalHeight) 
			})
			.png()
			.toBuffer();
	}
	
	// Calculate overall fallback usage
	const fallbackUsed = sdoData.actualDate !== isoDate || lascoData.actualDate !== isoDate;
	
	console.log(`✨ Verified composite complete: ${sdoData.isUnique && lascoData.isUnique ? 'BOTH UNIQUE' : 'CONTAINS DUPLICATES'}`);
	
	return {
		buffer: finalImage,
		metadata: {
			sdoDate: sdoData.actualDate,
			lascoDate: lascoData.actualDate,
			sdoChecksum: sdoData.checksum,
			lascoChecksum: lascoData.checksum,
			sdoUnique: sdoData.isUnique,
			lascoUnique: lascoData.isUnique,
			targetDate: isoDate,
			fallbackUsed: fallbackUsed
		}
	};
}


// Endpoint to get raw SDO component only
app.get('/sdo-image', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const style = req.query.style ? (req.query.style as string) : 'ad-astra';

	try {
		// Fetch sun disk image (SDO/AIA 171) with ±5 minute fallback
		const sunDiskImageScale = 2.5;
		const width = 1920;
		const sunDiskResult = await fetchHelioviewerImageWithFallback(isoDate, apiKey, 10, sunDiskImageScale, width, width, 5);
		
		// Apply color grading to SDO image
		const sunDiskImageGraded = await applySdoColorGrading(sunDiskResult.buffer, style);
		
		res.set('Content-Type', 'image/png');
		res.set('X-SDO-Date', sunDiskResult.actualDate);
		res.set('X-Fallback-Used', (sunDiskResult.actualDate !== isoDate).toString());
		res.send(sunDiskImageGraded);
	} catch (error) {
		console.error('Error creating SDO image:', error);
		res.status(500).send('An error occurred while creating the SDO image.');
	}
});

// Endpoint to get raw LASCO component only
app.get('/lasco-image', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const style = req.query.style ? (req.query.style as string) : 'ad-astra';

	try {
		// Fetch corona image (SOHO/LASCO C2) with ±15 minute fallback
		const coronaImageScale = 8;
		const width = 1920;
		const height = 1200;
		const coronaResult = await fetchHelioviewerImageWithFallback(isoDate, apiKey, 4, coronaImageScale, width, height, 15);
		
		// Apply color grading to corona image
		const coronaImageGraded = await applyCoronaColorGrading(coronaResult.buffer, style);
		
		res.set('Content-Type', 'image/png');
		res.set('X-LASCO-Date', coronaResult.actualDate);
		res.set('X-Fallback-Used', (coronaResult.actualDate !== isoDate).toString());
		res.send(coronaImageGraded);
	} catch (error) {
		console.error('Error creating LASCO image:', error);
		res.status(500).send('An error occurred while creating the LASCO image.');
	}
});

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


// Endpoint to generate the composite image with caching
app.get('/composite-image', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const compositeRadius = req.query.compositeRadius ? parseInt(req.query.compositeRadius as string) : 400;
	const featherRadius = req.query.featherRadius ? parseInt(req.query.featherRadius as string) : 40;
	const style = req.query.style ? (req.query.style as string) : 'ad-astra';
	const cropWidth = req.query.cropWidth ? parseInt(req.query.cropWidth as string) : 1440;
	const cropHeight = req.query.cropHeight ? parseInt(req.query.cropHeight as string) : 1200;

	console.log(`Crop parameters: width=${cropWidth}, height=${cropHeight}`);

	const cacheKey = getCacheKey(isoDate, compositeRadius, featherRadius, style) + `_${cropWidth}_${cropHeight}`;
	
	try {
		// Check cache first
		if (imageCache.has(cacheKey)) {
			const cachedImage = imageCache.get(cacheKey)!;
			res.set('Content-Type', 'image/png');
			res.set('X-Cache', 'HIT');
			res.send(cachedImage);
			return;
		}

		// Generate new image and cache it
		const result = await createTunedCompositeImage(isoDate, apiKey, compositeRadius, featherRadius, style, cropWidth, cropHeight);
		imageCache.set(cacheKey, result.buffer);
		
		res.set('Content-Type', 'image/png');
		res.set('X-Cache', 'MISS');
		res.set('X-SDO-Date', result.metadata.sdoDate);
		res.set('X-LASCO-Date', result.metadata.lascoDate);
		res.set('X-Fallback-Used', result.metadata.fallbackUsed.toString());
		res.send(result.buffer);
		
		// Clean old cache entries periodically
		if (Math.random() < 0.1) { // 10% chance to clean cache
			cleanCache();
		}
	} catch (error) {
		console.error('Error creating composite image:', error);
		res.status(500).send('An error occurred while creating the composite image.');
	}
});

// Endpoint to generate verified composite with component uniqueness guarantees
app.get('/verified-composite', async (req, res) => {
	const isoDate = req.query.date ? (req.query.date as string) : new Date().toISOString();
	const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
	const compositeRadius = req.query.compositeRadius ? parseInt(req.query.compositeRadius as string) : 400;
	const featherRadius = req.query.featherRadius ? parseInt(req.query.featherRadius as string) : 40;
	const style = req.query.style ? (req.query.style as string) : 'ad-astra';
	const cropWidth = req.query.cropWidth ? parseInt(req.query.cropWidth as string) : 1440;
	const cropHeight = req.query.cropHeight ? parseInt(req.query.cropHeight as string) : 1200;
	
	// Handle used checksums, supporting both new array format and old single checksum for backward compatibility
	const getChecksums = (param: any): string[] => {
		if (!param) return [];
		if (Array.isArray(param)) return param.flatMap(p => p.split(',')); // Handle arrays of strings
		return (param as string).split(',');
	};

	const usedSdoChecksums = getChecksums(req.query.usedSdoChecksums);
	const usedLascoChecksums = getChecksums(req.query.usedLascoChecksums);

	// For backward compatibility, include the old single checksum parameter if present
	if (req.query.previousSdoChecksum) usedSdoChecksums.push(req.query.previousSdoChecksum as string);
	if (req.query.previousLascoChecksum) usedLascoChecksums.push(req.query.previousLascoChecksum as string);

	console.log(`🎬 Verified composite request: ${isoDate} (avoiding ${usedSdoChecksums.length} SDO, ${usedLascoChecksums.length} LASCO checksums)`);

	try {
		// Generate verified composite with component uniqueness checking
		const result = await createVerifiedCompositeImage(
			isoDate, apiKey, compositeRadius, featherRadius, style, 
			cropWidth, cropHeight, usedSdoChecksums, usedLascoChecksums
		);
		
		res.set('Content-Type', 'image/png');
		res.set('X-SDO-Date', result.metadata.sdoDate);
		res.set('X-LASCO-Date', result.metadata.lascoDate);
		res.set('X-SDO-Checksum', result.metadata.sdoChecksum);
		res.set('X-LASCO-Checksum', result.metadata.lascoChecksum);
		res.set('X-SDO-Unique', result.metadata.sdoUnique.toString());
		res.set('X-LASCO-Unique', result.metadata.lascoUnique.toString());
		res.set('X-Target-Date', result.metadata.targetDate);
		res.set('X-Fallback-Used', result.metadata.fallbackUsed.toString());
		res.set('X-Quality-Score', (result.metadata.sdoUnique && result.metadata.lascoUnique ? '1.0' : '0.5'));
		
		res.send(result.buffer);
		
	} catch (error) {
		console.error('Error creating verified composite image:', error);
		res.status(500).send('An error occurred while creating the verified composite image.');
	}
});

// Progress API endpoint for real-time monitoring
app.get('/api/progress', async (req, res) => {
	try {
		// Read progress state from shared file
		const progressPath = 'video_progress.json';
		try {
			const progressData = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
			res.json(progressData);
		} catch (fileError: any) {
			// File doesn't exist or can't be read - return default state
			if (fileError.code === 'ENOENT') {
				res.json({
					status: 'waiting',
					progress: { current: 0, total: 144 },
					performance: { avgTime: 0, totalTime: 0 },
					fallbacks: { count: 0, rate: 0 },
					log: ['Monitor ready - waiting for generation to start...'],
					lastUpdate: new Date().toISOString()
				});
			} else {
				throw fileError;
			}
		}
	} catch (error) {
		console.error('Error reading progress:', error);
		res.status(500).json({ error: 'Failed to read progress data' });
	}
});

// Video generation monitoring page
app.get('/monitor', async (req, res) => {
	const monitoringPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Solar Video Generation Monitor</title>
    <style>
        body { font-family: 'Courier New', monospace; background: #1a1a1a; color: #00ff00; margin: 20px; }
        .header { border: 2px solid #00ff00; padding: 15px; margin-bottom: 20px; }
        .status { background: #2a2a2a; padding: 10px; margin: 10px 0; border-left: 4px solid #00ff00; }
        .status.running { border-left-color: #00ff00; background: #002200; }
        .status.warning { border-left-color: #ffaa00; background: #4a2a00; }
        .status.error { border-left-color: #ff0000; background: #4a0000; }
        .progress-container { background: #333; height: 25px; margin: 10px 0; border: 1px solid #00ff00; position: relative; }
        .progress-bar { background: linear-gradient(90deg, #004400, #00ff00); height: 100%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric { background: #2a2a2a; padding: 10px; border: 1px solid #00ff00; }
        .metric h3 { margin: 0 0 10px 0; color: #00ff00; }
        .log { background: #0a0a0a; padding: 15px; height: 400px; overflow-y: scroll; border: 1px solid #00ff00; }
        pre { margin: 0; white-space: pre-wrap; font-size: 12px; }
        .timestamp { color: #666; }
        .success { color: #00ff00; }
        .warning { color: #ffaa00; }
        .error { color: #ff0000; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎬 Solar Video Generation Monitor</h1>
        <p>Real-time monitoring of smart fallback system and frame generation</p>
        <div id="last-update" class="timestamp">Last update: Never</div>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h3>📊 Current Status</h3>
            <div id="status" class="status">Loading...</div>
        </div>
        <div class="metric">
            <h3>🎯 Progress</h3>
            <div id="progress-text">0/144 frames</div>
            <div class="progress-container">
                <div class="progress-bar" id="progress-bar" style="width: 0%;">0%</div>
            </div>
        </div>
        <div class="metric">
            <h3>🔍 Fallback Activity</h3>
            <div id="fallback-count">0 fallbacks triggered</div>
            <div id="fallback-rate">(0.0% rate)</div>
        </div>
        <div class="metric">
            <h3>⚡ Performance</h3>
            <div id="performance">Avg: 0.0s/frame</div>
            <div id="eta">ETA: Calculating...</div>
        </div>
    </div>
    
    <div class="log">
        <h3>📋 Generation Log <small>(last 50 entries)</small></h3>
        <pre id="log-content">Loading...</pre>
    </div>
    
    <script>
        let isGenerationActive = false;
        
        async function updateProgress() {
            try {
                const response = await fetch('/api/progress');
                const data = await response.json();
                
                // Update status
                const statusEl = document.getElementById('status');
                statusEl.textContent = data.status || 'Unknown';
                statusEl.className = 'status ' + (data.status === 'running' ? 'running' : 
                                                  data.status === 'error' ? 'error' : 
                                                  data.status === 'warning' ? 'warning' : '');
                
                // Update progress
                if (data.progress) {
                    const percent = data.progress.total > 0 ? (data.progress.current / data.progress.total * 100) : 0;
                    document.getElementById('progress-text').textContent = 
                        \`\${data.progress.current}/\${data.progress.total} frames\`;
                    const progressBar = document.getElementById('progress-bar');
                    progressBar.style.width = percent + '%';
                    progressBar.textContent = percent.toFixed(1) + '%';
                }
                
                // Update fallback info
                if (data.fallbacks) {
                    document.getElementById('fallback-count').textContent = 
                        \`\${data.fallbacks.count} fallbacks triggered\`;
                    document.getElementById('fallback-rate').textContent = 
                        \`(\${(data.fallbacks.rate * 100).toFixed(1)}% rate)\`;
                }
                
                // Update performance
                if (data.performance) {
                    document.getElementById('performance').textContent = 
                        \`Avg: \${data.performance.avgTime.toFixed(1)}s/frame\`;
                    
                    // Calculate ETA
                    if (data.progress && data.progress.current > 0 && data.performance.avgTime > 0) {
                        const remaining = data.progress.total - data.progress.current;
                        const etaSeconds = remaining * data.performance.avgTime;
                        const etaMin = Math.floor(etaSeconds / 60);
                        const etaSec = Math.floor(etaSeconds % 60);
                        document.getElementById('eta').textContent = \`ETA: \${etaMin}m \${etaSec}s\`;
                    }
                }
                
                // Update log
                if (data.log && Array.isArray(data.log)) {
                    const logContent = data.log.slice(-50).join('\\n');
                    document.getElementById('log-content').textContent = logContent;
                    
                    // Auto-scroll to bottom
                    const logEl = document.querySelector('.log');
                    logEl.scrollTop = logEl.scrollHeight;
                }
                
                // Update timestamp
                document.getElementById('last-update').textContent = 
                    \`Last update: \${new Date().toLocaleTimeString()}\`;
                    
                // Adjust refresh rate based on activity
                isGenerationActive = data.status === 'running';
                
            } catch (error) {
                console.error('Failed to update progress:', error);
                document.getElementById('status').textContent = 'Connection Error';
                document.getElementById('status').className = 'status error';
            }
        }
        
        // Initial update
        updateProgress();
        
        // Dynamic refresh rate - faster when active
        setInterval(() => {
            updateProgress();
        }, isGenerationActive ? 2000 : 5000);
        
    </script>
</body>
</html>`;
	
	res.set('Content-Type', 'text/html');
	res.send(monitoringPage);
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
