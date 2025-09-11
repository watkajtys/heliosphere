/**
 * Environment Variable Validator
 * Ensures all required environment variables are set
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
export function loadEnvironment() {
    // Try to load from .env file
    const envPath = path.resolve(__dirname, '../.env');
    
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    } else {
        console.warn('⚠️ No .env file found, using system environment variables');
    }
}

// Validate required environment variables
export function validateEnvironment(requiredVars = null) {
    // Default required variables for all scripts
    const defaultRequired = [
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID'
    ];
    
    const required = requiredVars || defaultRequired;
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(key => {
            console.error(`   - ${key}`);
        });
        console.error('\n📝 Copy .env.example to .env and fill in your values');
        console.error('   Or set these as environment variables');
        process.exit(1);
    }
}

// Mask sensitive tokens in output
export function maskToken(token) {
    if (!token) return 'not set';
    if (token.length < 8) return '***';
    return token.substring(0, 4) + '...' + token.substring(token.length - 4);
}

// Get required config with validation
export function getConfig() {
    loadEnvironment();
    validateEnvironment();
    
    return {
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_PAGES_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_STREAM_SUBDOMAIN: process.env.CLOUDFLARE_STREAM_SUBDOMAIN || 
            'customer-931z4aajcqul6afi.cloudflarestream.com'
    };
}
