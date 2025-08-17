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

// Progress API endpoint
app.get('/api/progress', async (req, res) => {
	try {
		const progressPath = path.join(__dirname, '../progress.json');
		try {
			const progressData = JSON.parse(await fs.readFile(progressPath, 'utf-8'));
			res.json(progressData);
		} catch (fileError: any) {
			// File doesn't exist or can't be read - return default state
			if (fileError.code === 'ENOENT') {
				res.json({
					status: 'waiting',
					progress: { current: 0, total: 288 },
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
        <p>Real-time monitoring of 15-minute interval system with ±1,3,5,7 min fallback</p>
        <div id="last-update" class="timestamp">Last update: Never</div>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h3>📊 Current Status</h3>
            <div id="status" class="status">Loading...</div>
        </div>
        <div class="metric">
            <h3>🎯 Progress</h3>
            <div id="progress-text">0/288 frames</div>
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
                statusEl.textContent = data.status.charAt(0).toUpperCase() + data.status.slice(1);
                statusEl.className = 'status ' + data.status;
                
                // Update progress
                const progress = (data.progress.current / data.progress.total) * 100;
                document.getElementById('progress-text').textContent = 
                    \`\${data.progress.current}/\${data.progress.total} frames\`;
                document.getElementById('progress-bar').style.width = progress + '%';
                document.getElementById('progress-bar').textContent = progress.toFixed(1) + '%';
                
                // Update fallbacks
                document.getElementById('fallback-count').textContent = 
                    \`\${data.fallbacks.count} fallbacks triggered\`;
                document.getElementById('fallback-rate').textContent = 
                    \`(\${data.fallbacks.rate.toFixed(1)}% rate)\`;
                
                // Update performance
                document.getElementById('performance').textContent = 
                    \`Avg: \${data.performance.avgTime.toFixed(1)}s/frame\`;
                
                // Calculate ETA
                const remaining = data.progress.total - data.progress.current;
                const eta = remaining * data.performance.avgTime;
                if (eta > 0 && data.progress.current > 0) {
                    const etaMinutes = Math.floor(eta / 60);
                    const etaSeconds = Math.floor(eta % 60);
                    document.getElementById('eta').textContent = 
                        \`ETA: \${etaMinutes}m \${etaSeconds}s\`;
                } else {
                    document.getElementById('eta').textContent = 'ETA: Calculating...';
                }
                
                // Update log
                const logContent = data.log.slice(-50).join('\\n');
                document.getElementById('log-content').textContent = logContent;
                
                // Auto-scroll log to bottom
                const logEl = document.querySelector('.log');
                logEl.scrollTop = logEl.scrollHeight;
                
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

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
