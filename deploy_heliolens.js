#!/usr/bin/env node

/**
 * Deploy Heliolens to Cloudflare Pages
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PAGES_TOKEN = 'Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ';

async function deploy() {
    try {
        console.log('🚀 Deploying Heliolens to Cloudflare Pages...');
        
        // Set the Pages token
        process.env.CLOUDFLARE_API_TOKEN = PAGES_TOKEN;
        
        // Deploy using wrangler
        const { stdout, stderr } = await execAsync(
            'npx wrangler pages deploy heliosphere-pages --project-name heliosphere',
            {
                env: {
                    ...process.env,
                    CLOUDFLARE_API_TOKEN: PAGES_TOKEN
                }
            }
        );
        
        console.log(stdout);
        if (stderr && !stderr.includes('warning')) {
            console.error(stderr);
        }
        
        // Extract deployment URL
        const urlMatch = stdout.match(/https:\/\/[^\s]+/);
        if (urlMatch) {
            console.log('\n✅ Deployment successful!');
            console.log(`   Live at: ${urlMatch[0]}`);
            console.log(`   Custom domain: https://heliolens.builtbyvibes.com`);
        }
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        if (error.stdout) console.error(error.stdout);
        if (error.stderr) console.error(error.stderr);
        process.exit(1);
    }
}

// Run deployment
deploy().catch(console.error);