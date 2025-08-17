#!/usr/bin/env node

/**
 * TEST VERSION - Only processes 1 day (96 frames)
 * For testing the daily production system
 */

// At the top of vps_daily_production.js, modify CONFIG:
const CONFIG_OVERRIDE = {
    TOTAL_DAYS: 1,    // Just 1 day for testing!
    SOCIAL_DAYS: 1,   // Same video for test
};

console.log('⚠️  TEST MODE: Only processing 1 day (96 frames)');
console.log('This is a test run - not full production!\n');

// Import and override the config
import('./vps_daily_production.js').then(module => {
    // The module will run with overridden config
}).catch(console.error);