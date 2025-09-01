#!/usr/bin/env node

/**
 * Deploy updated index.html to Cloudflare Pages
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const CLOUDFLARE_CONFIG = {
    PROJECT_NAME: 'heliosphere'
};

async function deployToPages() {
    try {
        console.log('🚀 Deploying to Cloudflare Pages...');
        
        const deployDir = path.join(__dirname, 'heliosphere-pages');
        
        // Check if directory exists
        try {
            await fs.access(deployDir);
        } catch {
            console.error(`❌ Directory not found: ${deployDir}`);
            process.exit(1);
        }
        
        console.log(`📦 Deploying from: ${deployDir}`);
        
        // Deploy using wrangler (will use OAuth auth)
        const deployCmd = `npx wrangler pages deploy "${deployDir}" --project-name=${CLOUDFLARE_CONFIG.PROJECT_NAME} --branch=main`;
        
        console.log('⬆️ Uploading to Cloudflare Pages...');
        const { stdout, stderr } = await execAsync(deployCmd, {
            maxBuffer: 10 * 1024 * 1024,
            cwd: __dirname
        });
        
        if (stderr && !stderr.includes('Success')) {
            console.error('⚠️ Warning:', stderr);
        }
        
        console.log(stdout);
        
        // Extract deployment URL from output
        const urlMatch = stdout.match(/https:\/\/[^\s]+\.pages\.dev/);
        if (urlMatch) {
            console.log(`\n✅ Deployment successful!`);
            console.log(`🌐 URL: ${urlMatch[0]}`);
        } else {
            console.log('\n✅ Deployment completed!');
            console.log('🌐 Visit: https://heliosphere.pages.dev');
        }
        
    } catch (error) {
        console.error('❌ Deployment failed:', error.message);
        process.exit(1);
    }
}

// Run deployment
deployToPages();