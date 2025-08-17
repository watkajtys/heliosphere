#!/usr/bin/env node

/**
 * Real-time Quality Monitoring Module
 * Tracks quality metrics during production
 */

import EventEmitter from 'events';

class QualityMonitor extends EventEmitter {
    constructor() {
        super();
        
        this.metrics = {
            // Frame metrics
            totalFrames: 0,
            processedFrames: 0,
            validatedFrames: 0,
            failedFrames: 0,
            
            // Quality scores
            scores: [],
            currentScore: 0,
            averageScore: 0,
            minScore: 100,
            maxScore: 0,
            
            // Issues tracking
            criticalIssues: 0,
            warnings: 0,
            duplicates: 0,
            
            // Performance
            framesPerMinute: 0,
            startTime: null,
            lastUpdateTime: null,
            
            // Spot checks
            spotChecksPassed: 0,
            spotChecksFailed: 0,
            lastSpotCheck: null,
            
            // Video encoding
            encodingProgress: 0,
            encodingChunk: null,
            encodingSpeed: 0,
            
            // Memory
            heapUsed: 0,
            heapPercent: 0,
            gcCount: 0
        };
        
        this.history = [];
        this.maxHistorySize = 1000;
    }
    
    /**
     * Start monitoring
     */
    start(totalFrames) {
        this.metrics.totalFrames = totalFrames;
        this.metrics.startTime = Date.now();
        this.metrics.lastUpdateTime = Date.now();
        
        console.log(`📊 Quality monitoring started for ${totalFrames} frames`);
        this.emit('started', this.metrics);
    }
    
    /**
     * Update frame processing metrics
     */
    updateFrameMetrics(frameNumber, result) {
        this.metrics.processedFrames++;
        
        if (result.success) {
            this.metrics.validatedFrames++;
            
            // Update quality score if available
            if (result.qualityScore !== undefined) {
                this.metrics.scores.push(result.qualityScore);
                this.metrics.currentScore = result.qualityScore;
                this.metrics.minScore = Math.min(this.metrics.minScore, result.qualityScore);
                this.metrics.maxScore = Math.max(this.metrics.maxScore, result.qualityScore);
                this.metrics.averageScore = this.calculateAverage(this.metrics.scores);
                
                // Track issues
                if (result.qualityScore < 50) {
                    this.metrics.criticalIssues++;
                } else if (result.qualityScore < 70) {
                    this.metrics.warnings++;
                }
            }
            
            // Check for duplicates
            if (result.isDuplicate) {
                this.metrics.duplicates++;
            }
        } else {
            this.metrics.failedFrames++;
            this.metrics.criticalIssues++;
        }
        
        // Update performance metrics
        this.updatePerformanceMetrics();
        
        // Add to history
        this.addToHistory({
            frame: frameNumber,
            score: result.qualityScore || 0,
            success: result.success,
            timestamp: Date.now()
        });
        
        // Emit update event
        this.emit('frameUpdate', {
            frame: frameNumber,
            metrics: this.getMetrics()
        });
        
        // Log progress every 100 frames
        if (this.metrics.processedFrames % 100 === 0) {
            this.logProgress();
        }
    }
    
    /**
     * Update spot check results
     */
    updateSpotCheck(passed, failed, avgScore) {
        this.metrics.spotChecksPassed += passed;
        this.metrics.spotChecksFailed += failed;
        this.metrics.lastSpotCheck = {
            passed,
            failed,
            avgScore,
            timestamp: Date.now()
        };
        
        this.emit('spotCheckComplete', this.metrics.lastSpotCheck);
    }
    
    /**
     * Update encoding progress
     */
    updateEncodingProgress(chunk, progress, speed) {
        this.metrics.encodingChunk = chunk;
        this.metrics.encodingProgress = progress;
        this.metrics.encodingSpeed = speed;
        
        this.emit('encodingUpdate', {
            chunk,
            progress,
            speed
        });
    }
    
    /**
     * Update memory metrics
     */
    updateMemoryMetrics(heapUsed, heapPercent, gcCount) {
        this.metrics.heapUsed = heapUsed;
        this.metrics.heapPercent = heapPercent;
        this.metrics.gcCount = gcCount;
        
        this.emit('memoryUpdate', {
            heapUsed,
            heapPercent,
            gcCount
        });
    }
    
    /**
     * Update performance metrics
     */
    updatePerformanceMetrics() {
        const now = Date.now();
        const elapsed = (now - this.metrics.startTime) / 1000 / 60; // minutes
        
        if (elapsed > 0) {
            this.metrics.framesPerMinute = this.metrics.processedFrames / elapsed;
        }
        
        this.metrics.lastUpdateTime = now;
    }
    
    /**
     * Calculate average
     */
    calculateAverage(array) {
        if (array.length === 0) return 0;
        return array.reduce((a, b) => a + b, 0) / array.length;
    }
    
    /**
     * Add to history
     */
    addToHistory(entry) {
        this.history.push(entry);
        
        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
    }
    
    /**
     * Log current progress
     */
    logProgress() {
        const progress = (this.metrics.processedFrames / this.metrics.totalFrames * 100).toFixed(1);
        const passRate = (this.metrics.validatedFrames / this.metrics.processedFrames * 100).toFixed(1);
        
        console.log(`\n📊 Progress: ${progress}% (${this.metrics.processedFrames}/${this.metrics.totalFrames})`);
        console.log(`   Quality: ${this.metrics.averageScore.toFixed(1)} avg (${this.metrics.minScore.toFixed(1)}-${this.metrics.maxScore.toFixed(1)})`);
        console.log(`   Pass Rate: ${passRate}%`);
        console.log(`   Speed: ${this.metrics.framesPerMinute.toFixed(1)} frames/min`);
        
        if (this.metrics.criticalIssues > 0) {
            console.log(`   ⚠️ Issues: ${this.metrics.criticalIssues} critical, ${this.metrics.warnings} warnings`);
        }
    }
    
    /**
     * Get current metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            progress: (this.metrics.processedFrames / this.metrics.totalFrames * 100).toFixed(1),
            passRate: this.metrics.processedFrames > 0 
                ? (this.metrics.validatedFrames / this.metrics.processedFrames * 100).toFixed(1)
                : 0,
            eta: this.calculateETA()
        };
    }
    
    /**
     * Calculate ETA
     */
    calculateETA() {
        if (this.metrics.framesPerMinute === 0) return 'Unknown';
        
        const remaining = this.metrics.totalFrames - this.metrics.processedFrames;
        const minutesRemaining = remaining / this.metrics.framesPerMinute;
        
        if (minutesRemaining < 60) {
            return `${Math.round(minutesRemaining)} minutes`;
        } else {
            const hours = Math.floor(minutesRemaining / 60);
            const mins = Math.round(minutesRemaining % 60);
            return `${hours}h ${mins}m`;
        }
    }
    
    /**
     * Get quality report
     */
    getQualityReport() {
        const passRate = this.metrics.processedFrames > 0 
            ? (this.metrics.validatedFrames / this.metrics.processedFrames * 100)
            : 0;
            
        return {
            summary: {
                totalFrames: this.metrics.totalFrames,
                processedFrames: this.metrics.processedFrames,
                validatedFrames: this.metrics.validatedFrames,
                failedFrames: this.metrics.failedFrames,
                passRate: passRate.toFixed(1),
                averageScore: this.metrics.averageScore.toFixed(1),
                minScore: this.metrics.minScore.toFixed(1),
                maxScore: this.metrics.maxScore.toFixed(1)
            },
            issues: {
                critical: this.metrics.criticalIssues,
                warnings: this.metrics.warnings,
                duplicates: this.metrics.duplicates
            },
            spotChecks: {
                passed: this.metrics.spotChecksPassed,
                failed: this.metrics.spotChecksFailed,
                lastCheck: this.metrics.lastSpotCheck
            },
            performance: {
                framesPerMinute: this.metrics.framesPerMinute.toFixed(1),
                totalTime: ((Date.now() - this.metrics.startTime) / 1000 / 60).toFixed(1) + ' minutes'
            },
            overallStatus: this.getOverallStatus()
        };
    }
    
    /**
     * Determine overall status
     */
    getOverallStatus() {
        const passRate = this.metrics.processedFrames > 0 
            ? (this.metrics.validatedFrames / this.metrics.processedFrames * 100)
            : 0;
        
        if (passRate >= 95 && this.metrics.averageScore >= 80) {
            return 'EXCELLENT';
        } else if (passRate >= 85 && this.metrics.averageScore >= 70) {
            return 'GOOD';
        } else if (passRate >= 75 && this.metrics.averageScore >= 60) {
            return 'ACCEPTABLE';
        } else {
            return 'NEEDS_ATTENTION';
        }
    }
    
    /**
     * Reset metrics
     */
    reset() {
        this.metrics = {
            totalFrames: 0,
            processedFrames: 0,
            validatedFrames: 0,
            failedFrames: 0,
            scores: [],
            currentScore: 0,
            averageScore: 0,
            minScore: 100,
            maxScore: 0,
            criticalIssues: 0,
            warnings: 0,
            duplicates: 0,
            framesPerMinute: 0,
            startTime: null,
            lastUpdateTime: null,
            spotChecksPassed: 0,
            spotChecksFailed: 0,
            lastSpotCheck: null,
            encodingProgress: 0,
            encodingChunk: null,
            encodingSpeed: 0,
            heapUsed: 0,
            heapPercent: 0,
            gcCount: 0
        };
        this.history = [];
    }
}

// Singleton instance
let instance = null;

export function getQualityMonitor() {
    if (!instance) {
        instance = new QualityMonitor();
    }
    return instance;
}

export default QualityMonitor;