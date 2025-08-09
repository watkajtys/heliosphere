// This interface is needed for the environment bindings in the fetch handler.
interface Env {
	NASA_API_KEY: string;
}

async function fetchCompositeImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
	// Layering LASCO C2 (sourceId 4) as the base and AIA 171 (sourceId 10) on top.
	const layers = `[[4,1,100],[10,1,100]]`;
	// This value may need to be tuned to get the scaling right between the two instruments.
	// The SOHO/LASCO C2 instrument has a much wider field of view than SDO/AIA.
	// A value of ~0.5 might be a good starting point for LASCO C2, while AIA 171 might need a different scale.
	// The takeScreenshot API seems to apply the same scale to all layers, which might be the source of the problem.
	// A potential solution is to make two separate requests and composite them manually,
	// or to find a scale that works reasonably well for both.
	const imageScale = 2.5;
	const width = 1920;
	const height = 1200;

	const apiUrl = new URL('https://api.helioviewer.org/v2/takeScreenshot/');
	apiUrl.searchParams.set('date', isoDate);
	apiUrl.searchParams.set('layers', layers);
	apiUrl.searchParams.set('imageScale', imageScale.toString());
	apiUrl.searchParams.set('width', width.toString());
	apiUrl.searchParams.set('height', height.toString());
	apiUrl.searchParams.set('display', 'true');
	apiUrl.searchParams.set('watermark', 'false');

	console.log(`Fetching composite image from: ${apiUrl.toString()}`);

	const response = await fetch(apiUrl.toString(), {
		headers: {
			'X-API-Key': apiKey,
		},
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Helioviewer API request failed with status ${response.status}: ${errorText}`);
	}

	return response.arrayBuffer();
}

export default {
	async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const now = new Date().toISOString();
		const apiKey = env.NASA_API_KEY;

		try {
			// The actual implementation of fetchCompositeImage will be done in the next step.
			// For now, this will throw an error, which is expected for this refactoring step.
			const imageBuffer = await fetchCompositeImage(now, apiKey);

			return new Response(imageBuffer, {
				headers: {
					'Content-Type': 'image/png',
				},
			});
		} catch (error) {
			console.error('Error fetching composite image:', error);
			return new Response('An error occurred while fetching the composite image.', {
				status: 500,
			});
		}
	},
};
