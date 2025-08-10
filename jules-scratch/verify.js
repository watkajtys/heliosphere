import fetch from 'node-fetch';
import fs from 'fs/promises';
import { spawn, execSync } from 'child_process';

const VERIFICATION_URL = 'http://localhost:3000';
const OUTPUT_FILE = 'jules-scratch/composite_image.png';

async function verify() {
	console.log('Building the project...');
	try {
		execSync('npm run build');
		console.log('Build successful.');
	} catch (error) {
		console.error('Build failed:', error);
		process.exit(1);
	}

	console.log('Starting server...');
	const server = spawn('npm', ['start']);
	let serverReady = false;

	server.stdout.on('data', (data) => {
		const output = data.toString();
		console.log(`Server: ${output}`);
		if (output.includes('Server listening on port')) {
			serverReady = true;
			runVerification();
		}
	});

	server.stderr.on('data', (data) => {
		console.error(`Server Error: ${data}`);
	});

	async function runVerification() {
		console.log(`Sending request to ${VERIFICATION_URL}...`);
		try {
			const response = await fetch(VERIFICATION_URL);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(`Verification request failed with status ${response.status}: ${errorText}`);
				process.exit(1);
			}

			const imageBuffer = await response.arrayBuffer();
			await fs.writeFile(OUTPUT_FILE, Buffer.from(imageBuffer));
			console.log(`Image successfully saved to ${OUTPUT_FILE}`);
		} catch (error) {
			console.error('An error occurred during verification:', error);
			process.exit(1);
		} finally {
			console.log('Stopping server...');
			server.kill();
		}
	}

	// Timeout if the server doesn't start within a reasonable time
	setTimeout(() => {
		if (!serverReady) {
			console.error('Server failed to start in time.');
			server.kill();
			process.exit(1);
		}
	}, 30000); // 30 seconds
}

verify();
