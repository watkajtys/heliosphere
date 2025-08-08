import { createServer } from 'http';

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

const server = createServer(async (req, res) => {
  console.log('Received request:', req.url);
  const apiKey = process.env.NASA_API_KEY;
  if (!apiKey) {
    console.error('NASA_API_KEY environment variable not set.');
    res.writeHead(500);
    res.end('NASA_API_KEY environment variable not set.');
    return;
  }

  try {
    const now = new Date();
    const imageBuffer = await fetchSdoImage(now.toISOString(), apiKey);
    console.log('Successfully fetched image.');
    res.writeHead(200, { 'Content-Type': 'image/jp2' });
    res.end(Buffer.from(imageBuffer));
  } catch (error) {
    console.error('Failed to fetch SDO image:', error);
    res.writeHead(500);
    res.end('Failed to fetch SDO image.');
  }
});

const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
