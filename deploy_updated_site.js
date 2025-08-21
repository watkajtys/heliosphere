#!/usr/bin/env node

/**
 * Deploy updated site to Cloudflare Pages
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

const PAGES_TOKEN = 'Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ';

async function deploy() {
    try {
        console.log('🚀 Deploying to Cloudflare Pages...');
        
        // Set the Pages token temporarily
        process.env.CLOUDFLARE_API_TOKEN = PAGES_TOKEN;
        
        // Deploy using wrangler with the Pages token
        const { stdout, stderr } = await execAsync(
            'npx wrangler pages deploy heliosphere-site --project-name heliosphere',
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
        
        // Extract deployment URL from output
        const urlMatch = stdout.match(/https:\/\/[^\s]+/);
        if (urlMatch) {
            console.log('\n✅ Deployment successful!');
            console.log(`   Live at: ${urlMatch[0]}`);
        }
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        console.error(error.stdout);
        console.error(error.stderr);
    }
}

deploy().catch(console.error);