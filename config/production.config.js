#!/usr/bin/env node

/**
 * Centralized Production Configuration
 * All settings for Heliosphere production pipeline
 */

import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Detect environment
const IS_VPS = process.env.NODE_ENV === 'production' || os.hostname().includes('vps');
const IS_TEST = process.env.NODE_ENV === 'test';

const CONFIG = {
    // Environment
    ENV: process.env.NODE_ENV || 'development',
    IS_VPS,
    IS_TEST,
    ROOT_DIR,
    
    // Time settings
    TIME: {
        SAFE_DELAY_DAYS: 2,        // 48-hour data availability delay
        TOTAL_DAYS: 56,             // Full production duration
        SOCIAL_DAYS: 30,            // Social media version
        TEST_DAYS: 2,               // Test mode duration
        FRAMES_PER_DAY: 96,         // Every 15 minutes
        INTERVAL_MINUTES: 15,       // Frame interval
        get TOTAL_FRAMES() {
            return this.TOTAL_DAYS * this.FRAMES_PER_DAY;
        },
        get SOCIAL_FRAMES() {
            return this.SOCIAL_DAYS * this.FRAMES_PER_DAY;
        }
    },
    
    // Performance settings
    PERFORMANCE: {
        FETCH_CONCURRENCY: 8,       // Parallel API fetches
        PROCESS_CONCURRENCY: 4,     // Parallel frame processing
        CHUNK_SIZE: 500,            // Frames per processing chunk
        VIDEO_CHUNK_SIZE: 1000,     // Frames per video chunk
        BATCH_SAVE_SIZE: 100,       // Save state every N frames
        MEMORY_CHECK_INTERVAL: 5000, // Check memory every 5 seconds
        MAX_HEAP_USAGE: 0.85,       // Max 85% heap usage
        GC_THRESHOLD: 0.70,         // Trigger GC at 70% heap
    },
    
    // API settings
    API: {
        HELIOVIEWER_BASE: 'https://api.helioviewer.org/v2',
        TIMEOUT: 30000,             // 30 second timeout
        RETRY_ATTEMPTS: 3,          // Max retries per request
        RETRY_DELAY: 2000,          // Delay between retries
        
        // Source configurations
        SOURCES: {
            CORONA: {
                id: 4,              // SOHO/LASCO C2
                name: 'SOHO,LASCO,C2,white-light',
                scale: 8,           // arcseconds per pixel
                size: 2048,         // Output size
                x0: -5760,
                y0: -4320,
                x1: 5760,
                y1: 4320
            },
            SUN_DISK: {
                id: 10,             // SDO/AIA 171
                name: 'SDO,AIA,171',
                scale: 2.5,         // arcseconds per pixel
                size: 1435,         // Final composite size
                x0: -3600,
                y0: -2700,
                x1: 3600,
                y1: 2700
            }
        },
        
        // Fallback strategies
        FALLBACK: {
            MAX_MINUTES: 14,
            STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
            STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14]
        }
    },
    
    // Image processing
    IMAGE: {
        // Color grading
        GRADING: {
            CORONA: {
                saturation: 0.3,
                brightness: 1.0,
                hue: -5,
                tint: { r: 220, g: 230, b: 240 },
                linear: { a: 1.2, b: -12 },
                gamma: 1.2
            },
            SUN_DISK: {
                saturation: 1.2,
                brightness: 1.4,
                hue: 15,
                tint: { r: 255, g: 200, b: 120 },
                linear: { a: 1.7, b: -30 },
                gamma: 1.15
            }
        },
        
        // Compositing
        COMPOSITE: {
            WIDTH: 1460,
            HEIGHT: 1200,
            CANVAS_WIDTH: 1920,
            CANVAS_HEIGHT: 1435,
            EXTRACT: {
                left: 230,
                top: 117,
                width: 1460,
                height: 1200
            },
            FEATHER_RADIUS: 40,
            JPEG_QUALITY: 95,
            USE_MOZJPEG: true
        },
        
        // Quality validation
        QUALITY: {
            MIN_BRIGHTNESS: 0.3,
            MAX_BRIGHTNESS: 0.7,
            MIN_CONTRAST: 0.2,
            MIN_ENTROPY: 4.0,
            MIN_FILE_SIZE: 50000,   // 50KB minimum
            MAX_FILE_SIZE: 5000000  // 5MB maximum
        }
    },
    
    // Video encoding - MAXIMUM QUALITY FOR CLOUDFLARE STREAM
    VIDEO: {
        FPS: 24,
        CRF: 0,                     // LOSSLESS - Cloudflare will compress
        PRESET: 'ultrafast',        // Fast encoding since we're not compressing
        PIXEL_FORMAT: 'yuv420p',    // Compatible with all players
        
        // Simplified parameters for lossless
        EXTRA_PARAMS: [
            '-profile:v', 'high',   // High profile
            '-level', '5.1'         // Support high bitrates
        ],
        
        // Output formats
        FORMATS: {
            DESKTOP: {
                width: 1460,
                height: 1200,
                duration_days: 56,  // Full production
                suffix: '_desktop'
            },
            MOBILE: {
                width: 1080,
                height: 1350,       // Portrait 9:16
                duration_days: 56,  // Full production
                suffix: '_mobile',
                crop: 'crop=1080:1350:190:0'
            },
            SOCIAL: {
                width: 1080,
                height: 1350,       // Same as mobile
                duration_days: 14,  // 14 days = ~57 seconds at 24fps
                suffix: '_social_60s'
            }
        },
        
        // Encoding optimization
        ENCODING: {
            USE_HW_ACCEL: false,    // CPU encoding for best quality
            TWO_PASS: false,        // Single pass is fine with CRF
            CHUNK_FRAMES: 1000,     // Max frames per video chunk
            THUMBNAILS: 5,          // Number of thumbnails to generate
            TARGET_BITRATE: '50M',  // Target bitrate for quality
            MAX_BITRATE: '80M',     // Maximum bitrate
            BUFFER_SIZE: '100M'     // VBV buffer size
        }
    },
    
    // Storage paths
    PATHS: {
        // Base directories
        get BASE() { return IS_VPS ? '/opt/heliosphere' : ROOT_DIR; },
        
        // Frame directories
        get FRAMES_DIR() { return path.join(this.BASE, IS_TEST ? 'test_frames' : 'frames'); },
        get FRAMES_DESKTOP() { return path.join(this.BASE, 'frames_desktop'); },
        get FRAMES_MOBILE() { return path.join(this.BASE, 'frames_mobile'); },
        
        // Video output
        get VIDEOS_DIR() { return path.join(this.BASE, IS_TEST ? 'test_videos' : 'videos'); },
        
        // Temporary storage
        get TEMP_DIR() { return IS_VPS ? '/tmp/heliosphere' : path.join(this.BASE, 'temp'); },
        get CHUNK_TEMP() { return path.join(this.TEMP_DIR, 'chunks'); },
        get ENCODE_TEMP() { return path.join(this.TEMP_DIR, 'encode'); },
        
        // State files
        get STATE_FILE() { 
            return path.join(this.BASE, IS_TEST ? 'test_state.json' : 'production_state.json');
        },
        get CHUNK_STATE() { return path.join(this.BASE, 'chunk_state.json'); },
        
        // Logs
        get LOG_DIR() { return path.join(this.BASE, 'logs'); },
        get ERROR_LOG() { return path.join(this.LOG_DIR, 'error.log'); },
        get OUTPUT_LOG() { return path.join(this.LOG_DIR, 'output.log'); }
    },
    
    // Cloudflare settings
    CLOUDFLARE: {
        STREAM_TOKEN: process.env.CLOUDFLARE_STREAM_TOKEN,
        PAGES_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN,
        ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        STREAM_SUBDOMAIN: process.env.CLOUDFLARE_STREAM_SUBDOMAIN || 'customer-931z4aajcqul6afi.cloudflarestream.com',
        PAGES_PROJECT: process.env.CLOUDFLARE_PAGES_PROJECT || 'heliosphere',
        
        // Upload settings
        UPLOAD: {
            AUTO_UPLOAD: true,      // Automatically upload after generation
            DELETE_LOCAL: false,    // Delete local files after upload
            SET_METADATA: true,     // Set video metadata
            ALLOWED_ORIGINS: ['https://heliosphere.pages.dev']
        }
    },
    
    // Monitoring
    MONITORING: {
        WEB_PORT: IS_TEST ? 3003 : 3001,
        API_PORT: IS_TEST ? 3004 : 3002,
        ENABLE_WEB_UI: true,
        ENABLE_API: true,
        UPDATE_INTERVAL: 5000,      // Update every 5 seconds
        
        // Metrics to track
        METRICS: {
            FRAMES_PER_MINUTE: true,
            MEMORY_USAGE: true,
            DUPLICATE_DETECTION: true,
            ERROR_TRACKING: true,
            QUALITY_SCORES: true
        }
    },
    
    // Error handling
    ERROR_HANDLING: {
        MAX_RETRIES: 3,
        RETRY_DELAY: 5000,
        CONTINUE_ON_ERROR: true,    // Continue processing on non-fatal errors
        SAVE_ERROR_FRAMES: true,    // Save frames that cause errors
        ERROR_REPORT_EMAIL: null    // Email for error reports
    },
    
    // Node.js settings
    NODE: {
        MAX_OLD_SPACE_SIZE: process.env.NODE_OPTIONS?.includes('max-old-space-size') 
            ? parseInt(process.env.NODE_OPTIONS.match(/max-old-space-size=(\d+)/)[1])
            : 4096,  // Default 4GB
        EXPOSE_GC: true             // Enable manual garbage collection
    }
};

// Validate configuration
function validateConfig() {
    const errors = [];
    
    // Check required environment variables in production
    if (CONFIG.ENV === 'production') {
        if (!CONFIG.CLOUDFLARE.STREAM_TOKEN) {
            errors.push('CLOUDFLARE_STREAM_TOKEN is required in production');
        }
        if (!CONFIG.CLOUDFLARE.ACCOUNT_ID) {
            errors.push('CLOUDFLARE_ACCOUNT_ID is required in production');
        }
    }
    
    // Check paths exist or can be created
    const requiredPaths = [
        CONFIG.PATHS.BASE,
        CONFIG.PATHS.FRAMES_DIR,
        CONFIG.PATHS.VIDEOS_DIR
    ];
    
    // Memory check
    const totalMemory = os.totalmem();
    const requiredMemory = 4 * 1024 * 1024 * 1024; // 4GB
    if (totalMemory < requiredMemory) {
        errors.push(`System has ${(totalMemory / 1024 / 1024 / 1024).toFixed(1)}GB RAM, 4GB+ recommended`);
    }
    
    if (errors.length > 0) {
        console.warn('⚠️ Configuration warnings:');
        errors.forEach(e => console.warn(`   - ${e}`));
    }
    
    return errors.length === 0;
}

// Get config for specific module
export function getConfig(module) {
    if (module && CONFIG[module]) {
        return CONFIG[module];
    }
    return CONFIG;
}

// Update config value
export function updateConfig(path, value) {
    const keys = path.split('.');
    let obj = CONFIG;
    
    for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) {
            obj[keys[i]] = {};
        }
        obj = obj[keys[i]];
    }
    
    obj[keys[keys.length - 1]] = value;
}

// Export full config
export default CONFIG;

// Validate on import
validateConfig();

// Show config in development
if (CONFIG.ENV === 'development' && import.meta.url === `file://${process.argv[1]}`) {
    console.log('\n📋 Heliosphere Production Configuration\n');
    console.log('Environment:', CONFIG.ENV);
    console.log('VPS Mode:', CONFIG.IS_VPS);
    console.log('Test Mode:', CONFIG.IS_TEST);
    console.log('\nPaths:');
    Object.entries(CONFIG.PATHS).forEach(([key, value]) => {
        if (typeof value === 'string') {
            console.log(`  ${key}: ${value}`);
        }
    });
    console.log('\nPerformance:');
    Object.entries(CONFIG.PERFORMANCE).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
    });
    console.log('\nMemory:');
    console.log(`  System: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB`);
    console.log(`  Node Heap: ${CONFIG.NODE.MAX_OLD_SPACE_SIZE}MB`);
}