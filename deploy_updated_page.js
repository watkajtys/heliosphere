#!/usr/bin/env node

/**
 * Deploy updated index.html to Cloudflare Pages
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    ACCOUNT_ID: 'f7e27d63f4766d7fb6a0f5b4789e2cdb',
    PAGES_TOKEN: 'Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ',
    PROJECT_NAME: 'heliosphere'
};

async function deployToPages() {
    try {
        console.log('🚀 Deploying to Cloudflare Pages...');
        
        // Create a temporary directory for deployment
        const tempDir = '/tmp/heliosphere-deploy';
        await fs.mkdir(tempDir, { recursive: true });
        
        // Copy index.html to temp directory
        await fs.copyFile('/opt/heliosphere/index.html', path.join(tempDir, 'index.html'));
        
        console.log('📦 Files prepared for deployment');
        
        // Deploy using wrangler
        const deployCmd = `cd ${tempDir} && CLOUDFLARE_API_TOKEN=${CLOUDFLARE_CONFIG.PAGES_TOKEN} npx wrangler pages deploy . --project-name=${CLOUDFLARE_CONFIG.PROJECT_NAME} --branch=main`;
        
        console.log('⬆️ Uploading to Cloudflare Pages...');
        const { stdout, stderr } = await execAsync(deployCmd, {
            maxBuffer: 10 * 1024 * 1024
        });
        
        if (stderr && !stderr.includes('Success')) {
            console.error('⚠️ Warning:', stderr);
        }
        
        console.log(stdout);
        
        // Extract deployment URL from output
        const urlMatch = stdout.match(/https:\/\/[^\s]+\.pages\.dev/);
        if (urlMatch) {
            console.log(`\n✅ Deployment successful!`);
            console.log(`🌐 Preview URL: ${urlMatch[0]}`);
            console.log(`🌐 Production URL: https://heliosphere.app`);
        } else {
            console.log('\n✅ Deployment completed!');
            console.log('🌐 Production URL: https://heliosphere.app');
        }
        
        // Clean up temp directory
        await fs.rm(tempDir, { recursive: true, force: true });
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

// Run deployment
deployToPages().catch(console.error);