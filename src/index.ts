import { Container, getContainer } from '@cloudflare/containers';

export class CronContainer extends Container {
	sleepAfter = '5m';
	manualStart = true;
}

export default {
	async fetch(): Promise<Response> {
		return new Response('This Worker runs a cron job to execute a container on a schedule.');
	},
	async scheduled(_controller: any, env: { CRON_CONTAINER: DurableObjectNamespace<CronContainer>; NASA_API_KEY: string },ectx: ExecutionContext) {
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
