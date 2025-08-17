#!/usr/bin/env node

/**
 * Enhanced Production Pipeline with Quality Validation
 * Full integration of chunked processing, quality monitoring, and validation
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import sharp from 'sharp';
import express from 'express';
import CONFIG from './config/production.config.js';
import { getMemoryManager } from './lib/memory_manager.js';
import { ChunkProcessor } from './lib/chunk_processor.js';
import VideoEncoder from './lib/video_encoder.js';
import FrameQualityValidator from './frame_quality_validator.js';
import { getQualityMonitor } from './lib/quality_monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class EnhancedProductionPipeline {
    constructor() {
        this.memoryManager = getMemoryManager();
        this.chunkProcessor = new ChunkProcessor();
        this.videoEncoder = new VideoEncoder({
            fps: CONFIG.VIDEO.FPS,
            crf: CONFIG.VIDEO.CRF,
            preset: CONFIG.VIDEO.PRESET,
            maxChunkFrames: CONFIG.VIDEO.ENCODING.CHUNK_FRAMES
        });
        this.qualityValidator = new FrameQualityValidator();
        this.qualityMonitor = getQualityMonitor();
        
        this.state = {
            status: 'idle',
            phase: 'initialization',
            startTime: null,
            endTime: null,
            processedFrames: 0,
            totalFrames: CONFIG.TIME.TOTAL_FRAMES,
            errors: [],
            qualityResults: null,
            videoResults: null
        };
        
        this.monitoringServer = null;
    }
    
    /**
     * Initialize production pipeline
     */
    async initialize() {
        console.log('\n🚀 Initializing Enhanced Production Pipeline');
        console.log('=' .repeat(60));
        
        try {
            // Create directories
            await this.createDirectories();
            
            // Initialize components
            await this.videoEncoder.initialize();
            this.memoryManager.startMonitoring();
            
            // Start quality monitoring
            this.qualityMonitor.start(this.state.totalFrames);
            
            // Start web monitoring server
            await this.startMonitoringServer();
            
            // Load previous state if exists
            await this.loadState();
            
            console.log('\n✅ Pipeline initialized successfully');
            console.log(`   Total frames to process: ${this.state.totalFrames}`);
            console.log(`   Memory limit: ${CONFIG.NODE.MAX_OLD_SPACE_SIZE}MB`);
            console.log(`   Chunk size: ${CONFIG.PERFORMANCE.CHUNK_SIZE} frames`);
            console.log(`   Monitoring: http://localhost:${CONFIG.MONITORING.WEB_PORT}`);
            
            return true;
            
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            throw error;
        }
    }
    
    /**
     * Create required directories
     */
    async createDirectories() {
        const dirs = [
            CONFIG.PATHS.FRAMES_DIR,
            CONFIG.PATHS.FRAMES_DESKTOP,
            CONFIG.PATHS.FRAMES_MOBILE,
            CONFIG.PATHS.VIDEOS_DIR,
            CONFIG.PATHS.TEMP_DIR,
            CONFIG.PATHS.LOG_DIR
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }
    
    /**
     * Start monitoring server
     */
    async startMonitoringServer() {
        const app = express();
        
        // Serve monitoring dashboard
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'monitor_production.html'));
        });
        
        // API endpoints
        app.get('/api/status', (req, res) => {
            res.json({
                status: this.state.status,
                phase: this.state.phase,
                processedFrames: this.state.processedFrames,
                totalFrames: this.state.totalFrames,
                framesPerMinute: this.calculateFramesPerMinute(),
                eta: this.calculateETA(),
                quality: this.qualityMonitor.getMetrics(),
                memory: this.memoryManager.getMemoryStats(),
                encoding: this.videoEncoder.getEncodingState(),
                performance: this.getPerformanceMetrics(),
                issues: this.getIssuesSummary()
            });
        });
        
        app.get('/api/quality', (req, res) => {
            res.json(this.qualityMonitor.getQualityReport());
        });
        
        app.get('/api/memory', (req, res) => {
            res.json(this.memoryManager.getMemoryStats());
        });
        
        this.monitoringServer = app.listen(CONFIG.MONITORING.WEB_PORT, () => {
            console.log(`📊 Monitoring server started on port ${CONFIG.MONITORING.WEB_PORT}`);
        });
    }
    
    /**
     * Main production run
     */
    async run() {
        console.log('\n🎬 Starting Enhanced Production Run');
        console.log('=' .repeat(60));
        
        this.state.status = 'running';
        this.state.startTime = Date.now();
        
        try {
            // Phase 1: Fetch frames
            await this.fetchFrames();
            
            // Phase 2: Process frames with quality validation
            await this.processFramesWithValidation();
            
            // Phase 3: Perform comprehensive quality checks
            await this.performQualityValidation();
            
            // Phase 4: Generate videos
            await this.generateVideos();
            
            // Phase 5: Upload to Cloudflare (optional)
            if (CONFIG.CLOUDFLARE.UPLOAD.AUTO_UPLOAD) {
                await this.uploadToCloudflare();
            }
            
            // Complete
            this.state.status = 'completed';
            this.state.phase = 'done';
            this.state.endTime = Date.now();
            
            // Generate final report
            await this.generateFinalReport();
            
            console.log('\n✅ Production completed successfully!');
            
        } catch (error) {
            console.error('\n❌ Production failed:', error);
            this.state.status = 'error';
            this.state.errors.push(error.message);
            
            // Save error state
            await this.saveState();
            
            throw error;
        }
    }
    
    /**
     * Fetch frames from API
     */
    async fetchFrames() {
        console.log('\n📡 Phase 1: Fetching Frames');
        console.log('-' .repeat(40));
        
        this.state.phase = 'fetch';
        
        const frames = this.generateFrameTimestamps();
        let fetched = 0;
        
        // Process in chunks
        await this.chunkProcessor.processFramesInChunks(
            frames,
            async (chunk) => {
                await Promise.all(chunk.map(async (frame) => {
                    try {
                        // Check if frame already exists
                        const framePath = path.join(
                            CONFIG.PATHS.FRAMES_DIR,
                            `frame_${String(frame.index).padStart(5, '0')}.jpg`
                        );
                        
                        try {
                            await fs.access(framePath);
                            // Frame exists, skip
                            fetched++;
                            return;
                        } catch {
                            // Frame doesn't exist, fetch it
                        }
                        
                        // Fetch and save frame
                        await this.fetchAndSaveFrame(frame, framePath);
                        fetched++;
                        
                        // Update progress
                        if (fetched % 100 === 0) {
                            console.log(`  Fetched ${fetched}/${frames.length} frames`);
                        }
                        
                    } catch (error) {
                        console.error(`  Error fetching frame ${frame.index}:`, error.message);
                        this.state.errors.push({
                            frame: frame.index,
                            error: error.message
                        });
                    }
                }));
                
                // Update state
                this.state.processedFrames = fetched;
                await this.saveState();
            }
        );
        
        console.log(`  ✓ Fetched ${fetched} frames`);
    }
    
    /**
     * Process frames with integrated quality validation
     */
    async processFramesWithValidation() {
        console.log('\n🎨 Phase 2: Processing Frames with Quality Validation');
        console.log('-' .repeat(40));
        
        this.state.phase = 'process';
        
        const frameFiles = await this.getFrameFiles();
        let processed = 0;
        let validationResults = [];
        
        // Process in chunks
        await this.chunkProcessor.processFramesInChunks(
            frameFiles,
            async (chunk) => {
                for (const frameFile of chunk) {
                    try {
                        const framePath = path.join(CONFIG.PATHS.FRAMES_DIR, frameFile);
                        const frameNumber = parseInt(frameFile.match(/\d+/)[0]);
                        
                        // Apply any processing (resize, color grade, etc.)
                        await this.processFrame(framePath, frameNumber);
                        
                        // Validate frame quality inline
                        const validation = await this.qualityValidator.validateFrame(framePath, frameNumber);
                        validationResults.push(validation);
                        
                        // Update quality monitor
                        this.qualityMonitor.updateFrameMetrics(frameNumber, {
                            success: validation.valid,
                            qualityScore: validation.score,
                            isDuplicate: false
                        });
                        
                        processed++;
                        
                        // Log progress
                        if (processed % 100 === 0) {
                            const avgScore = validationResults
                                .slice(-100)
                                .reduce((sum, r) => sum + r.score, 0) / 100;
                            console.log(`  Processed ${processed}/${frameFiles.length} frames (avg score: ${avgScore.toFixed(1)})`);
                        }
                        
                    } catch (error) {
                        console.error(`  Error processing frame ${frameFile}:`, error.message);
                        this.state.errors.push({
                            frame: frameFile,
                            error: error.message
                        });
                    }
                }
                
                // Memory management
                await this.memoryManager.waitForMemory(200);
                this.memoryManager.forceGarbageCollection();
                
                // Save state
                await this.saveState();
            }
        );
        
        console.log(`  ✓ Processed ${processed} frames`);
        
        // Store validation results
        this.state.qualityResults = {
            totalValidated: validationResults.length,
            avgScore: validationResults.reduce((sum, r) => sum + r.score, 0) / validationResults.length,
            passed: validationResults.filter(r => r.valid).length,
            failed: validationResults.filter(r => !r.valid).length
        };
    }
    
    /**
     * Perform comprehensive quality validation
     */
    async performQualityValidation() {
        console.log('\n✅ Phase 3: Quality Validation');
        console.log('-' .repeat(40));
        
        this.state.phase = 'validate';
        
        // Perform spot checks
        const spotCheckResults = await this.qualityValidator.performSpotChecks(
            CONFIG.PATHS.FRAMES_DIR,
            this.state.totalFrames
        );
        
        // Update quality monitor with spot check results
        this.qualityMonitor.updateSpotCheck(
            spotCheckResults.passed,
            spotCheckResults.failed,
            spotCheckResults.avgScore
        );
        
        // Store results
        this.state.qualityResults = {
            ...this.state.qualityResults,
            spotChecks: spotCheckResults
        };
        
        // Determine if quality is acceptable
        if (!spotCheckResults.overallPass) {
            if (CONFIG.ERROR_HANDLING.CONTINUE_ON_ERROR) {
                console.warn('  ⚠️ Quality validation failed but continuing due to config');
            } else {
                throw new Error('Quality validation failed - stopping production');
            }
        } else {
            console.log('  ✓ Quality validation passed');
        }
    }
    
    /**
     * Generate videos
     */
    async generateVideos() {
        console.log('\n🎬 Phase 4: Video Generation');
        console.log('-' .repeat(40));
        
        this.state.phase = 'encode';
        
        const timestamp = new Date().toISOString().split('T')[0];
        const results = {};
        
        // Generate desktop format
        console.log('\n  📺 Generating desktop video (1460x1200)...');
        results.desktop = await this.videoEncoder.generateChunkedVideo(
            this.state.totalFrames,
            `heliosphere_${timestamp}_desktop`,
            {
                width: CONFIG.VIDEO.FORMATS.DESKTOP.width,
                height: CONFIG.VIDEO.FORMATS.DESKTOP.height
            }
        );
        
        // Generate mobile format
        console.log('\n  📱 Generating mobile video (1080x1350)...');
        results.mobile = await this.videoEncoder.generateChunkedVideo(
            this.state.totalFrames,
            `heliosphere_${timestamp}_mobile`,
            {
                width: CONFIG.VIDEO.FORMATS.MOBILE.width,
                height: CONFIG.VIDEO.FORMATS.MOBILE.height
            }
        );
        
        // Generate social format (shorter duration)
        const socialFrames = Math.min(
            this.state.totalFrames,
            CONFIG.TIME.SOCIAL_DAYS * CONFIG.TIME.FRAMES_PER_DAY
        );
        
        console.log('\n  📱 Generating social video (60 seconds)...');
        results.social = await this.videoEncoder.generateChunkedVideo(
            socialFrames,
            `heliosphere_${timestamp}_social_60s`,
            {
                width: CONFIG.VIDEO.FORMATS.SOCIAL.width,
                height: CONFIG.VIDEO.FORMATS.SOCIAL.height
            }
        );
        
        this.state.videoResults = results;
        
        console.log('\n  ✓ All videos generated successfully');
    }
    
    /**
     * Upload to Cloudflare Stream
     */
    async uploadToCloudflare() {
        console.log('\n☁️ Phase 5: Uploading to Cloudflare');
        console.log('-' .repeat(40));
        
        this.state.phase = 'upload';
        
        // Implementation would go here
        console.log('  ⚠️ Upload to Cloudflare not yet implemented');
    }
    
    /**
     * Generate frame timestamps
     */
    generateFrameTimestamps() {
        const frames = [];
        const now = Date.now();
        const intervalMs = CONFIG.TIME.INTERVAL_MINUTES * 60 * 1000;
        const safeDelayMs = CONFIG.TIME.SAFE_DELAY_DAYS * 24 * 60 * 60 * 1000;
        
        for (let i = 0; i < this.state.totalFrames; i++) {
            const timestamp = new Date(now - safeDelayMs - (i * intervalMs));
            frames.push({
                index: i,
                timestamp,
                dateString: timestamp.toISOString()
            });
        }
        
        return frames;
    }
    
    /**
     * Fetch and save a single frame
     */
    async fetchAndSaveFrame(frame, outputPath) {
        // Implementation would fetch from API
        // For now, create a placeholder
        const image = sharp({
            create: {
                width: CONFIG.IMAGE.COMPOSITE.WIDTH,
                height: CONFIG.IMAGE.COMPOSITE.HEIGHT,
                channels: 3,
                background: { r: 20, g: 20, b: 40 }
            }
        });
        
        await image.jpeg({ quality: 95 }).toFile(outputPath);
    }
    
    /**
     * Process a single frame
     */
    async processFrame(framePath, frameNumber) {
        // Apply any necessary processing
        // This is where color grading, compositing, etc. would happen
        return true;
    }
    
    /**
     * Get list of frame files
     */
    async getFrameFiles() {
        const files = await fs.readdir(CONFIG.PATHS.FRAMES_DIR);
        return files
            .filter(f => f.match(/frame_\d+\.jpg/))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });
    }
    
    /**
     * Calculate frames per minute
     */
    calculateFramesPerMinute() {
        if (!this.state.startTime) return 0;
        const elapsed = (Date.now() - this.state.startTime) / 1000 / 60;
        return elapsed > 0 ? this.state.processedFrames / elapsed : 0;
    }
    
    /**
     * Calculate ETA
     */
    calculateETA() {
        const fpm = this.calculateFramesPerMinute();
        if (fpm === 0) return 'Unknown';
        
        const remaining = this.state.totalFrames - this.state.processedFrames;
        const minutesRemaining = remaining / fpm;
        
        if (minutesRemaining < 60) {
            return `${Math.round(minutesRemaining)} minutes`;
        } else {
            const hours = Math.floor(minutesRemaining / 60);
            const mins = Math.round(minutesRemaining % 60);
            return `${hours}h ${mins}m`;
        }
    }
    
    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        const elapsed = this.state.startTime ? Date.now() - this.state.startTime : 0;
        return {
            elapsedTime: this.formatTime(elapsed),
            cpuUsage: process.cpuUsage ? process.cpuUsage().user / 1000000 : 0,
            avgProcessTime: this.state.processedFrames > 0 ? 
                elapsed / this.state.processedFrames : 0,
            queueSize: 0
        };
    }
    
    /**
     * Get issues summary
     */
    getIssuesSummary() {
        const critical = this.state.errors.filter(e => e.severity === 'critical').length;
        const warnings = this.state.errors.filter(e => e.severity === 'warning').length;
        return {
            critical,
            warnings,
            duplicates: 0,
            recent: this.state.errors.slice(-10)
        };
    }
    
    /**
     * Format time
     */
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        } else {
            return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
        }
    }
    
    /**
     * Save state to file
     */
    async saveState() {
        await fs.writeFile(
            CONFIG.PATHS.STATE_FILE,
            JSON.stringify(this.state, null, 2)
        );
    }
    
    /**
     * Load state from file
     */
    async loadState() {
        try {
            const data = await fs.readFile(CONFIG.PATHS.STATE_FILE, 'utf-8');
            const savedState = JSON.parse(data);
            
            // Merge with current state
            this.state = {
                ...this.state,
                ...savedState,
                status: 'resumed'
            };
            
            console.log('  📂 Resumed from previous state');
            console.log(`     Processed: ${this.state.processedFrames}/${this.state.totalFrames}`);
            
        } catch (error) {
            // No previous state, start fresh
            console.log('  📂 Starting fresh (no previous state)');
        }
    }
    
    /**
     * Generate final report
     */
    async generateFinalReport() {
        const duration = (this.state.endTime - this.state.startTime) / 1000;
        
        const report = [
            '',
            '=' .repeat(60),
            '🎉 PRODUCTION COMPLETE',
            '=' .repeat(60),
            '',
            `Total Frames Processed: ${this.state.processedFrames}/${this.state.totalFrames}`,
            `Total Time: ${this.formatTime(this.state.endTime - this.state.startTime)}`,
            `Average Speed: ${(this.state.processedFrames / duration).toFixed(1)} frames/sec`,
            '',
            'Quality Results:',
            `  Average Score: ${this.state.qualityResults?.avgScore?.toFixed(1) || 'N/A'}`,
            `  Pass Rate: ${this.state.qualityResults?.spotChecks?.passRate?.toFixed(1) || 'N/A'}%`,
            `  Critical Issues: ${this.state.qualityResults?.spotChecks?.criticalIssues?.length || 0}`,
            '',
            'Videos Generated:'
        ];
        
        if (this.state.videoResults) {
            for (const [format, result] of Object.entries(this.state.videoResults)) {
                report.push(`  ${format}: ${(result.size / 1024 / 1024).toFixed(2)} MB (${result.duration.toFixed(1)}s)`);
            }
        }
        
        if (this.state.errors.length > 0) {
            report.push('', `Errors Encountered: ${this.state.errors.length}`);
            this.state.errors.slice(0, 5).forEach(e => {
                report.push(`  - ${e.frame || 'Unknown'}: ${e.error || e}`);
            });
        }
        
        report.push('', '=' .repeat(60));
        
        const reportText = report.join('\n');
        console.log(reportText);
        
        // Save report
        const reportPath = path.join(CONFIG.PATHS.LOG_DIR, `production_report_${Date.now()}.txt`);
        await fs.writeFile(reportPath, reportText);
        console.log(`\n📄 Report saved to: ${reportPath}`);
        
        // Also get quality report
        const qualityReport = this.qualityMonitor.getQualityReport();
        const qualityReportPath = path.join(CONFIG.PATHS.LOG_DIR, `quality_report_${Date.now()}.json`);
        await fs.writeFile(qualityReportPath, JSON.stringify(qualityReport, null, 2));
        console.log(`📊 Quality report saved to: ${qualityReportPath}`);
    }
    
    /**
     * Cleanup
     */
    async cleanup() {
        console.log('\n🧹 Cleaning up...');
        
        // Stop monitoring
        this.memoryManager.stopMonitoring();
        
        // Stop server
        if (this.monitoringServer) {
            this.monitoringServer.close();
        }
        
        // Clean video encoder
        await this.videoEncoder.cleanup();
        
        console.log('  ✓ Cleanup complete');
    }
}

// Main execution
async function main() {
    const pipeline = new EnhancedProductionPipeline();
    
    try {
        // Initialize
        await pipeline.initialize();
        
        // Run production
        await pipeline.run();
        
        console.log('\n🎉 Production completed successfully!');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Production failed:', error);
        process.exit(1);
        
    } finally {
        await pipeline.cleanup();
    }
}

// Handle signals
process.on('SIGINT', async () => {
    console.log('\n⚠️ Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n⚠️ Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default EnhancedProductionPipeline;