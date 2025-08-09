import Vips from 'wasm-vips';

interface Env {
	NASA_API_KEY: string;
}

async function createCompositeImage(sdoBuffer: ArrayBuffer, sohoBuffer: ArrayBuffer): Promise<ArrayBuffer> {
	const vips = await Vips();

	const sdoImage = vips.Image.newFromBuffer(sdoBuffer);
	const sohoImage = vips.Image.newFromBuffer(sohoBuffer);

	// The SDO image needs to be scaled to fit into the occulting disk of the SOHO image.
	// This scaling factor may need to be adjusted for the best visual result.
	const sdoWidth = 512;
	const resizedSdoImage = sdoImage.resize(sdoWidth / sdoImage.width);

	// Center the SDO image on the SOHO image
	const x_pos = (sohoImage.width - resizedSdoImage.width) / 2;
	const y_pos = (sohoImage.height - resizedSdoImage.height) / 2;

	const finalImage = sohoImage.composite([resizedSdoImage], 'over', {
		x: [x_pos],
		y: [y_pos],
	});

	// Write the final image to a buffer as a JPEG
	return finalImage.writeToBuffer('.jpg');
}

async function fetchSdoImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
	const sourceId = 10; // SDO/AIA 171
	const apiUrl = `https://helioviewer.org/api/jp2/jp2.php?date=${isoDate}&sourceId=${sourceId}&jpip=true`;

	const response = await fetch(apiUrl, {
		headers: { 'X-API-Key': apiKey },
	});

	if (!response.ok) {
		throw new Error(`Helioviewer API request for SDO image failed with status ${response.status}`);
	}

	return response.arrayBuffer();
}

async function fetchSohoImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
	const sourceId = 4; // SOHO/LASCO C2
	const apiUrl = `https://helioviewer.org/api/jp2/jp2.php?date=${isoDate}&sourceId=${sourceId}&jpip=true`;

	const response = await fetch(apiUrl, {
		headers: { 'X-API-Key': apiKey },
	});

	if (!response.ok) {
		throw new Error(`Helioviewer API request for SOHO image failed with status ${response.status}`);
	}

	return response.arrayBuffer();
}

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const now = new Date().toISOString();
		const apiKey = env.NASA_API_KEY;

		try {
			const [sdoBuffer, sohoBuffer] = await Promise.all([
				fetchSdoImage(now, apiKey),
				fetchSohoImage(now, apiKey),
			]);

			// The compositing logic will be implemented in the next step
			const compositeImageBuffer = await createCompositeImage(sdoBuffer, sohoBuffer);

			return new Response(compositeImageBuffer, {
				headers: { 'Content-Type': 'image/jpeg' },
			});
		} catch (error) {
			console.error('Error in worker:', error);
			const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
			return new Response(`An error occurred: ${errorMessage}`, { status: 500 });
		}
	},
};
