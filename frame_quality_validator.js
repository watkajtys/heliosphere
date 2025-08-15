#!/usr/bin/env node

/**
 * Frame Quality Validation System
 * Programmatic validation of frame quality metrics
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

class FrameQualityValidator {
    constructor(config = {}) {
        this.config = {
            // Expected dimensions
            width: 1460,
            height: 1200,
            
            // Brightness thresholds (0-255 scale)
            minBrightness: 10,
            maxBrightness: 245,
            avgBrightnessRange: [30, 150],
            
            // File size thresholds (in KB)
            minFileSize: 100,
            maxFileSize: 300,
            
            // Color validation
            expectedChannels: 3,
            
            // Histogram thresholds
            blackPixelThreshold: 0.5,  // Max 50% black pixels
            whitePixelThreshold: 0.1,  // Max 10% white pixels
            
            // Temporal consistency (frame-to-frame)
            maxTemporalDelta: 0.15,    // 15% max change between frames
            
            // Quality scores
            minSharpness: 0.3,
            minContrast: 0.2,
            
            ...config
        };
        
        this.frameCache = new Map();
        this.baselineMetrics = null;
    }
    
    /**
     * Validate a single frame
     */
    async validateFrame(framePath, frameNumber = null) {
        const startTime = Date.now();
        const issues = [];
        
        try {
            // Check file exists and get stats
            const stats = await fs.stat(framePath);
            const fileSizeKB = stats.size / 1024;
            
            // Load image with Sharp
            const image = sharp(framePath);
            const metadata = await image.metadata();
            const stats_ = await image.stats();
            
            // Extract metrics
            const metrics = {
                frameNumber,
                filePath: framePath,
                fileSize: fileSizeKB,
                width: metadata.width,
                height: metadata.height,
                channels: metadata.channels,
                format: metadata.format,
                density: metadata.density,
                hasAlpha: metadata.hasAlpha,
                
                // Color statistics per channel
                brightness: {
                    r: stats_.channels[0].mean,
                    g: stats_.channels[1].mean,
                    b: stats_.channels[2].mean,
                    avg: (stats_.channels[0].mean + stats_.channels[1].mean + stats_.channels[2].mean) / 3
                },
                
                contrast: {
                    r: stats_.channels[0].stdev,
                    g: stats_.channels[1].stdev,
                    b: stats_.channels[2].stdev,
                    avg: (stats_.channels[0].stdev + stats_.channels[1].stdev + stats_.channels[2].stdev) / 3
                },
                
                // Min/Max values
                minValues: {
                    r: stats_.channels[0].min,
                    g: stats_.channels[1].min,
                    b: stats_.channels[2].min
                },
                
                maxValues: {
                    r: stats_.channels[0].max,
                    g: stats_.channels[1].max,
                    b: stats_.channels[2].max
                },
                
                // Additional metrics
                entropy: await this.calculateEntropy(stats_),
                histogram: await this.analyzeHistogram(image),
                checksum: await this.calculateChecksum(framePath),
                processingTime: Date.now() - startTime
            };
            
            // Validate dimensions
            if (metrics.width !== this.config.width || metrics.height !== this.config.height) {
                issues.push({
                    type: 'dimension',
                    severity: 'critical',
                    message: `Invalid dimensions: ${metrics.width}x${metrics.height}, expected ${this.config.width}x${this.config.height}`
                });
            }
            
            // Validate file size
            if (metrics.fileSize < this.config.minFileSize) {
                issues.push({
                    type: 'filesize',
                    severity: 'warning',
                    message: `File too small: ${metrics.fileSize.toFixed(1)}KB < ${this.config.minFileSize}KB`
                });
            }
            
            if (metrics.fileSize > this.config.maxFileSize) {
                issues.push({
                    type: 'filesize',
                    severity: 'warning',
                    message: `File too large: ${metrics.fileSize.toFixed(1)}KB > ${this.config.maxFileSize}KB`
                });
            }
            
            // Validate brightness
            if (metrics.brightness.avg < this.config.avgBrightnessRange[0]) {
                issues.push({
                    type: 'brightness',
                    severity: 'warning',
                    message: `Frame too dark: avg brightness ${metrics.brightness.avg.toFixed(1)} < ${this.config.avgBrightnessRange[0]}`
                });
            }
            
            if (metrics.brightness.avg > this.config.avgBrightnessRange[1]) {
                issues.push({
                    type: 'brightness',
                    severity: 'warning',
                    message: `Frame too bright: avg brightness ${metrics.brightness.avg.toFixed(1)} > ${this.config.avgBrightnessRange[1]}`
                });
            }
            
            // Check for black/white frames
            if (metrics.histogram.blackPixelRatio > this.config.blackPixelThreshold) {
                issues.push({
                    type: 'histogram',
                    severity: 'critical',
                    message: `Too many black pixels: ${(metrics.histogram.blackPixelRatio * 100).toFixed(1)}%`
                });
            }
            
            if (metrics.histogram.whitePixelRatio > this.config.whitePixelThreshold) {
                issues.push({
                    type: 'histogram',
                    severity: 'warning',
                    message: `Too many white pixels: ${(metrics.histogram.whitePixelRatio * 100).toFixed(1)}%`
                });
            }
            
            // Check contrast
            if (metrics.contrast.avg < this.config.minContrast * 255) {
                issues.push({
                    type: 'contrast',
                    severity: 'warning',
                    message: `Low contrast: ${metrics.contrast.avg.toFixed(1)}`
                });
            }
            
            // Store in cache for temporal analysis
            if (frameNumber !== null) {
                this.frameCache.set(frameNumber, metrics);
            }
            
            return {
                valid: issues.filter(i => i.severity === 'critical').length === 0,
                metrics,
                issues,
                score: this.calculateQualityScore(metrics, issues)
            };
            
        } catch (error) {
            return {
                valid: false,
                metrics: null,
                issues: [{
                    type: 'error',
                    severity: 'critical',
                    message: `Failed to validate frame: ${error.message}`
                }],
                score: 0
            };
        }
    }
    
    /**
     * Calculate entropy (measure of information/detail)
     */
    async calculateEntropy(stats) {
        let entropy = 0;
        for (const channel of stats.channels) {
            const variance = channel.stdev * channel.stdev;
            if (variance > 0) {
                entropy += Math.log2(variance);
            }
        }
        return entropy / stats.channels.length;
    }
    
    /**
     * Analyze histogram for anomalies
     */
    async analyzeHistogram(image) {
        const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        const totalPixels = info.width * info.height;
        let blackPixels = 0;
        let whitePixels = 0;
        
        // Sample every 10th pixel for performance
        for (let i = 0; i < data.length; i += 30) { // 3 channels * 10 sample rate
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const avg = (r + g + b) / 3;
            
            if (avg < 10) blackPixels++;
            if (avg > 245) whitePixels++;
        }
        
        const sampleSize = data.length / 30;
        
        return {
            blackPixelRatio: blackPixels / sampleSize,
            whitePixelRatio: whitePixels / sampleSize,
            totalPixels
        };
    }
    
    /**
     * Calculate file checksum
     */
    async calculateChecksum(filePath) {
        const buffer = await fs.readFile(filePath);
        return crypto.createHash('md5').update(buffer).digest('hex');
    }
    
    /**
     * Calculate overall quality score (0-100)
     */
    calculateQualityScore(metrics, issues) {
        let score = 100;
        
        // Deduct points for issues
        for (const issue of issues) {
            if (issue.severity === 'critical') score -= 30;
            else if (issue.severity === 'warning') score -= 10;
        }
        
        // Bonus for good metrics
        if (metrics) {
            // Good contrast
            if (metrics.contrast.avg > 30 && metrics.contrast.avg < 80) score += 5;
            
            // Good brightness
            if (metrics.brightness.avg > 50 && metrics.brightness.avg < 120) score += 5;
            
            // High entropy (lots of detail)
            if (metrics.entropy > 5) score += 5;
        }
        
        return Math.max(0, Math.min(100, score));
    }
    
    /**
     * Validate temporal consistency between frames
     */
    async validateTemporalConsistency(frame1Path, frame2Path) {
        const [result1, result2] = await Promise.all([
            this.validateFrame(frame1Path),
            this.validateFrame(frame2Path)
        ]);
        
        if (!result1.valid || !result2.valid) {
            return {
                valid: false,
                message: 'Cannot compare invalid frames'
            };
        }
        
        const m1 = result1.metrics;
        const m2 = result2.metrics;
        
        // Calculate brightness delta
        const brightnessDelta = Math.abs(m1.brightness.avg - m2.brightness.avg) / m1.brightness.avg;
        
        // Calculate size delta
        const sizeDelta = Math.abs(m1.fileSize - m2.fileSize) / m1.fileSize;
        
        const issues = [];
        
        if (brightnessDelta > this.config.maxTemporalDelta) {
            issues.push({
                type: 'temporal',
                severity: 'warning',
                message: `Large brightness change: ${(brightnessDelta * 100).toFixed(1)}%`
            });
        }
        
        if (sizeDelta > this.config.maxTemporalDelta) {
            issues.push({
                type: 'temporal',
                severity: 'warning',
                message: `Large size change: ${(sizeDelta * 100).toFixed(1)}%`
            });
        }
        
        // Check if frames are identical (duplicate detection)
        if (m1.checksum === m2.checksum) {
            issues.push({
                type: 'duplicate',
                severity: 'critical',
                message: 'Frames are identical'
            });
        }
        
        return {
            valid: issues.filter(i => i.severity === 'critical').length === 0,
            brightnessDelta,
            sizeDelta,
            issues
        };
    }
    
    /**
     * Validate an entire batch of frames
     */
    async validateBatch(frameDir, pattern = 'frame_*.jpg') {
        const framePaths = await this.getFramePaths(frameDir, pattern);
        const results = [];
        const summary = {
            totalFrames: framePaths.length,
            validFrames: 0,
            criticalIssues: 0,
            warnings: 0,
            avgQualityScore: 0,
            issues: [],
            temporalIssues: []
        };
        
        console.log(`Validating ${framePaths.length} frames...`);
        
        // Validate each frame
        for (let i = 0; i < framePaths.length; i++) {
            const result = await this.validateFrame(framePaths[i], i);
            results.push(result);
            
            if (result.valid) summary.validFrames++;
            summary.criticalIssues += result.issues.filter(i => i.severity === 'critical').length;
            summary.warnings += result.issues.filter(i => i.severity === 'warning').length;
            summary.avgQualityScore += result.score;
            
            // Check temporal consistency with previous frame
            if (i > 0) {
                const temporal = await this.validateTemporalConsistency(
                    framePaths[i - 1],
                    framePaths[i]
                );
                
                if (!temporal.valid || temporal.issues.length > 0) {
                    summary.temporalIssues.push({
                        frames: [i - 1, i],
                        ...temporal
                    });
                }
            }
            
            // Progress update
            if ((i + 1) % 10 === 0) {
                console.log(`  Validated ${i + 1}/${framePaths.length} frames...`);
            }
        }
        
        summary.avgQualityScore /= framePaths.length;
        
        // Generate report
        const report = this.generateReport(summary, results);
        
        return {
            summary,
            results,
            report
        };
    }
    
    /**
     * Get list of frame paths
     */
    async getFramePaths(dir, pattern) {
        const files = await fs.readdir(dir);
        const frameFiles = files
            .filter(f => f.match(/frame_\d+\.jpg/))
            .sort((a, b) => {
                const numA = parseInt(a.match(/\d+/)[0]);
                const numB = parseInt(b.match(/\d+/)[0]);
                return numA - numB;
            });
        
        return frameFiles.map(f => path.join(dir, f));
    }
    
    /**
     * Generate quality report
     */
    generateReport(summary, results) {
        const report = [];
        
        report.push('═'.repeat(60));
        report.push('FRAME QUALITY VALIDATION REPORT');
        report.push('═'.repeat(60));
        report.push('');
        report.push(`Total Frames: ${summary.totalFrames}`);
        report.push(`Valid Frames: ${summary.validFrames} (${(summary.validFrames / summary.totalFrames * 100).toFixed(1)}%)`);
        report.push(`Average Quality Score: ${summary.avgQualityScore.toFixed(1)}/100`);
        report.push('');
        
        if (summary.criticalIssues > 0) {
            report.push(`⚠️  CRITICAL ISSUES: ${summary.criticalIssues}`);
        }
        
        if (summary.warnings > 0) {
            report.push(`⚠️  Warnings: ${summary.warnings}`);
        }
        
        if (summary.temporalIssues.length > 0) {
            report.push('');
            report.push('TEMPORAL CONSISTENCY ISSUES:');
            for (const issue of summary.temporalIssues) {
                report.push(`  Frames ${issue.frames[0]}-${issue.frames[1]}: ${issue.issues.map(i => i.message).join(', ')}`);
            }
        }
        
        // Find worst frames
        const worstFrames = results
            .filter(r => r.score < 70)
            .sort((a, b) => a.score - b.score)
            .slice(0, 5);
        
        if (worstFrames.length > 0) {
            report.push('');
            report.push('LOWEST QUALITY FRAMES:');
            for (const frame of worstFrames) {
                report.push(`  Frame ${frame.metrics?.frameNumber}: Score ${frame.score}, Issues: ${frame.issues.length}`);
            }
        }
        
        report.push('');
        report.push('═'.repeat(60));
        
        return report.join('\n');
    }
}

// Export for use in other modules
export default FrameQualityValidator;

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const validator = new FrameQualityValidator();
    const frameDir = process.argv[2] || '/opt/heliosphere/frames';
    
    console.log('Starting frame quality validation...');
    
    validator.validateBatch(frameDir)
        .then(({ summary, report }) => {
            console.log('\n' + report);
            
            // Save report
            const reportPath = path.join(frameDir, 'quality_report.txt');
            fs.writeFile(reportPath, report)
                .then(() => console.log(`\nReport saved to: ${reportPath}`));
            
            // Exit with error if critical issues
            if (summary.criticalIssues > 0) {
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('Validation failed:', error);
            process.exit(1);
        });
}