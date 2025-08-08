import { Container, getContainer } from '@cloudflare/containers';

export class CronContainer extends Container {
	sleepAfter = '5m';
	manualStart = true;
}

/**
 * Fetches an SDO image from the NASA Helioviewer API for a given date.
 * @param isoDate - The date in ISO format (e.g., "YYYY-MM-DDTHH:MM:SSZ").
 * @param apiKey - Your Helioviewer API key.
 * @returns A Promise that resolves to an ArrayBuffer of the image data.
 */
async function fetchSdoImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
	const sourceId = 14; // SDO/AIA 193
	const apiUrl = `https://helioviewer.org/api/jp2/jp2.php?date=${isoDate}&sourceId=${sourceId}&jpip=true`;

	try {
		const response = await fetch(apiUrl, {
			headers: {
				'X-API-Key': apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`Helioviewer API request failed with status ${response.status}`);
		}

		return await response.arrayBuffer();
	} catch (error) {
		console.error('Error fetching SDO image:', error);
		throw error;
	}
}

/**
 * Fetches a SOHO/LASCO C2 coronagraph image from the NASA Helioviewer API for a given date.
 * @param isoDate - The date in ISO format (e.g., "YYYY-MM-DDTHH:MM:SSZ").
 * @param apiKey - Your Helioviewer API key.
 * @returns A Promise that resolves to an ArrayBuffer of the image data.
 */
async function fetchSohoImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
	const sourceId = 6; // SOHO/LASCO C2
	const apiUrl = `https://helioviewer.org/api/jp2/jp2.php?date=${isoDate}&sourceId=${sourceId}&jpip=true`;

	try {
		const response = await fetch(apiUrl, {
			headers: {
				'X-API-Key': apiKey,
			},
		});

		if (!response.ok) {
			throw new Error(`Helioviewer API request failed with status ${response.status}`);
		}

		return await response.arrayBuffer();
	} catch (error) {
		console.error('Error fetching SOHO image:', error);
		throw error;
	}
}

export default {
	async fetch(
		_req: Request,
		env: {
			CRON_CONTAINER: DurableObjectNamespace<CronContainer>;
			NASA_API_KEY: string;
		},
		_ectx: ExecutionContext
	): Promise<Response> {
		const now = new Date().toISOString();
		const apiKey = env.NASA_API_KEY;

		try {
			const [sdoBuffer, sohoBuffer] = await Promise.all([fetchSdoImage(now, apiKey), fetchSohoImage(now, apiKey)]);

			if (sdoBuffer && sohoBuffer) {
				return new Response('Successfully fetched 2 image buffers.', { status: 200 });
			} else {
				return new Response('Failed to fetch one or both image buffers.', { status: 500 });
			}
		} catch (error) {
			console.error('Error fetching images:', error);
			return new Response('An error occurred while fetching images.', { status: 500 });
		}
	},

	async scheduled(_controller: any, env: { CRON_CONTAINER: DurableObjectNamespace<CronContainer>; NASA_API_KEY: string }, ectx: ExecutionContext) {
		const container = getContainer(env.CRON_CONTAINER);
		await container.start({
			env: {
				NASA_API_KEY: env.NASA_API_KEY,
			},
		});

		// Give the container a moment to start up
		await new Promise((resolve) => setTimeout(resolve, 5000));

		const resp = await container.fetch('http://localhost:8080');

		if (resp.ok) {
			console.log('Successfully fetched image from container');
		} else {
			const text = await resp.text();
			console.error('Failed to fetch image from container:', text);
		}
	},
};
