#!/usr/bin/env node

/**
 * Regenerate July 10-12 frames with correct white corona grading
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dates to regenerate
const DATES_TO_REGENERATE = [
    '2025-07-10',
    '2025-07-11',
    '2025-07-12'
];

async function regenerateFrames() {
    console.log('🔄 Regenerating July 10-12 frames with correct colors...\n');
    
    for (const dateStr of DATES_TO_REGENERATE) {
        console.log(`📅 Processing ${dateStr}...`);
        
        try {
            // Run the daily cron script for just this date
            const { stdout, stderr } = await execAsync(
                `cd /opt/heliosphere && node -e "
                    global.FORCE_DATE_RANGE = {
                        start: '${dateStr}T00:00:00Z',
                        end: '${dateStr}T23:59:59Z'
                    };
                    import('./vps_daily_cron.js');
                "`,
                {
                    timeout: 600000, // 10 minutes per day
                    maxBuffer: 10 * 1024 * 1024
                }
            );
            
            if (stderr && !stderr.includes('Warning')) {
                console.error(`  ⚠️ Warning: ${stderr}`);
            }
            
            console.log(`  ✅ Completed ${dateStr}`);
            
        } catch (error) {
            console.error(`  ❌ Failed ${dateStr}: ${error.message}`);
        }
    }
    
    console.log('\n✨ Regeneration complete!');
    
    // Verify frames exist
    console.log('\n📊 Verifying frames:');
    for (const dateStr of DATES_TO_REGENERATE) {
        try {
            await fs.access(`/opt/heliosphere/frames/${dateStr}/frame_1200.jpg`);
            console.log(`  ✅ ${dateStr}: Frame exists`);
        } catch {
            console.log(`  ❌ ${dateStr}: Frame missing`);
        }
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    regenerateFrames().catch(console.error);
}