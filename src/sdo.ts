/**
 * Fetches an SDO image from the NASA Helioviewer API for a given date.
 * @param isoDate - The date in ISO format (e.g., "YYYY-MM-DDTHH:MM:SSZ").
 * @param apiKey - Your Helioviewer API key.
 * @returns A Promise that resolves to an ArrayBuffer of the image data.
 */
export async function fetchSdoImage(isoDate: string, apiKey: string): Promise<ArrayBuffer> {
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
