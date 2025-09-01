#!/usr/bin/env node

/**
 * Quick test script for fixed production - 2 days only
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runTest() {
    console.log('🚀 Starting 2-day test of fixed production script...\n');
    
    try {
        // Temporarily modify config to 2 days for testing
        const modifyCommand = `sed -i.test_backup 's/TOTAL_DAYS: 56/TOTAL_DAYS: 2/' /opt/heliosphere/vps_production_unified.js`;
        await execAsync(`ssh vps "${modifyCommand}"`);
        console.log('✓ Modified config to 2 days for testing');
        
        // Run the production script
        console.log('📊 Starting production run...\n');
        const { stdout } = await execAsync(
            `ssh vps "cd /opt/heliosphere && timeout 300 node vps_production_unified.js --run 2>&1"`,
            { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
        );
        
        console.log(stdout);
        
        // Check the results
        const checkCommand = `ssh vps "grep -E 'Progress:|Processed:|CRITICAL' /opt/heliosphere/production_state.json 2>/dev/null || echo 'No state file yet'"`;
        const { stdout: checkOutput } = await execAsync(checkCommand);
        console.log('\n📋 State check:', checkOutput);
        
    } catch (error) {
        if (error.code === 124) {
            console.log('\n⏱️ Test timed out after 5 minutes (expected for full run)');
        } else {
            console.error('❌ Test failed:', error.message);
            if (error.stdout) console.log('Output:', error.stdout);
            if (error.stderr) console.log('Errors:', error.stderr);
        }
    } finally {
        // Restore original config
        const restoreCommand = `mv /opt/heliosphere/vps_production_unified.js.test_backup /opt/heliosphere/vps_production_unified.js 2>/dev/null || true`;
        await execAsync(`ssh vps "${restoreCommand}"`);
        console.log('\n✓ Restored original config');
    }
}

runTest().catch(console.error);