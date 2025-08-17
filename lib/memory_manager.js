#!/usr/bin/env node

/**
 * Memory Management Module for Large-Scale Video Processing
 * Monitors memory usage and provides optimization strategies
 */

import os from 'os';
import v8 from 'v8';

class MemoryManager {
    constructor(options = {}) {
        this.maxHeapUsage = options.maxHeapUsage || 0.85; // 85% of available heap
        this.gcThreshold = options.gcThreshold || 0.70;   // Trigger GC at 70%
        this.checkInterval = options.checkInterval || 5000; // Check every 5 seconds
        this.monitoring = false;
        this.stats = {
            peakHeapUsed: 0,
            gcCount: 0,
            warnings: 0,
            lastCheck: Date.now()
        };
    }

    /**
     * Get current memory statistics
     */
    getMemoryStats() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const totalSystem = os.totalmem();
        const freeSystem = os.freemem();
        
        return {
            // Process memory
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            
            // V8 heap details
            heapSizeLimit: heapStats.heap_size_limit,
            totalHeapSize: heapStats.total_heap_size,
            usedHeapSize: heapStats.used_heap_size,
            heapUsagePercent: heapStats.used_heap_size / heapStats.heap_size_limit,
            
            // System memory
            totalSystemMemory: totalSystem,
            freeSystemMemory: freeSystem,
            systemUsagePercent: (totalSystem - freeSystem) / totalSystem,
            
            // Formatted values
            formatted: {
                rss: this.formatBytes(memUsage.rss),
                heapUsed: this.formatBytes(memUsage.heapUsed),
                heapTotal: this.formatBytes(memUsage.heapTotal),
                heapLimit: this.formatBytes(heapStats.heap_size_limit),
                systemFree: this.formatBytes(freeSystem),
                heapUsagePercent: `${(heapStats.used_heap_size / heapStats.heap_size_limit * 100).toFixed(1)}%`
            }
        };
    }

    /**
     * Check if memory usage is within safe limits
     */
    isMemorySafe() {
        const stats = this.getMemoryStats();
        return stats.heapUsagePercent < this.maxHeapUsage;
    }

    /**
     * Wait for memory to be available
     */
    async waitForMemory(requiredMB = 100) {
        const requiredBytes = requiredMB * 1024 * 1024;
        let attempts = 0;
        const maxAttempts = 10;
        
        while (attempts < maxAttempts) {
            const stats = this.getMemoryStats();
            const availableHeap = stats.heapSizeLimit - stats.usedHeapSize;
            
            if (availableHeap > requiredBytes && stats.heapUsagePercent < this.maxHeapUsage) {
                return true;
            }
            
            console.log(`⏳ Waiting for memory... (${stats.formatted.heapUsagePercent} used, need ${requiredMB}MB)`);
            
            // Try garbage collection
            if (stats.heapUsagePercent > this.gcThreshold) {
                this.forceGarbageCollection();
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
        }
        
        throw new Error(`Unable to allocate ${requiredMB}MB after ${maxAttempts} attempts`);
    }

    /**
     * Force garbage collection if available
     */
    forceGarbageCollection() {
        if (global.gc) {
            console.log('🗑️ Running garbage collection...');
            const before = process.memoryUsage().heapUsed;
            global.gc();
            const after = process.memoryUsage().heapUsed;
            const freed = before - after;
            console.log(`   Freed: ${this.formatBytes(freed)}`);
            this.stats.gcCount++;
            return freed;
        } else {
            console.log('⚠️ GC not available. Run node with --expose-gc flag');
            return 0;
        }
    }

    /**
     * Start monitoring memory usage
     */
    startMonitoring(callback) {
        if (this.monitoring) return;
        
        this.monitoring = true;
        this.monitorInterval = setInterval(() => {
            const stats = this.getMemoryStats();
            
            // Update peak usage
            if (stats.heapUsed > this.stats.peakHeapUsed) {
                this.stats.peakHeapUsed = stats.heapUsed;
            }
            
            // Check for high usage
            if (stats.heapUsagePercent > this.maxHeapUsage) {
                console.warn(`⚠️ HIGH MEMORY: ${stats.formatted.heapUsagePercent} of heap used`);
                this.stats.warnings++;
                this.forceGarbageCollection();
            } else if (stats.heapUsagePercent > this.gcThreshold) {
                this.forceGarbageCollection();
            }
            
            // Callback with stats
            if (callback) {
                callback(stats);
            }
            
            this.stats.lastCheck = Date.now();
        }, this.checkInterval);
        
        console.log('📊 Memory monitoring started');
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitoring = false;
            console.log('📊 Memory monitoring stopped');
        }
    }

    /**
     * Get memory report
     */
    getReport() {
        const current = this.getMemoryStats();
        return {
            current: current.formatted,
            stats: {
                peakHeapUsed: this.formatBytes(this.stats.peakHeapUsed),
                gcCount: this.stats.gcCount,
                warnings: this.stats.warnings,
                uptime: `${((Date.now() - this.stats.lastCheck) / 1000 / 60).toFixed(1)} minutes`
            },
            recommendations: this.getRecommendations(current)
        };
    }

    /**
     * Get optimization recommendations
     */
    getRecommendations(stats) {
        const recommendations = [];
        
        if (stats.heapUsagePercent > 0.8) {
            recommendations.push('Consider increasing Node.js heap size with --max-old-space-size');
        }
        
        if (stats.systemUsagePercent > 0.9) {
            recommendations.push('System memory is critically low. Close other applications');
        }
        
        if (stats.external > 500 * 1024 * 1024) {
            recommendations.push('High external memory usage. Consider processing smaller batches');
        }
        
        if (stats.arrayBuffers > 1024 * 1024 * 1024) {
            recommendations.push('Large ArrayBuffer usage. Ensure buffers are released after use');
        }
        
        return recommendations;
    }

    /**
     * Calculate optimal chunk size based on available memory
     */
    getOptimalChunkSize(itemSizeMB = 1) {
        const stats = this.getMemoryStats();
        const availableHeap = stats.heapSizeLimit - stats.usedHeapSize;
        const safeAvailable = availableHeap * 0.6; // Use only 60% of available
        const optimalChunk = Math.floor(safeAvailable / (itemSizeMB * 1024 * 1024));
        
        return {
            recommended: Math.max(10, Math.min(optimalChunk, 1000)), // Between 10-1000 items
            maxSafe: optimalChunk,
            availableMB: safeAvailable / 1024 / 1024,
            currentUsage: stats.formatted.heapUsagePercent
        };
    }

    /**
     * Format bytes to human readable
     */
    formatBytes(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let unitIndex = 0;
        let value = bytes;
        
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }
        
        return `${value.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Create memory pressure to test handling
     */
    async testMemoryPressure(sizeMB = 100) {
        console.log(`🧪 Creating ${sizeMB}MB memory pressure...`);
        const arrays = [];
        
        try {
            for (let i = 0; i < sizeMB; i++) {
                arrays.push(new Array(1024 * 1024 / 8).fill(Math.random()));
                
                if (i % 10 === 0) {
                    const stats = this.getMemoryStats();
                    console.log(`   Allocated: ${i}MB, Heap: ${stats.formatted.heapUsagePercent}`);
                    
                    if (!this.isMemorySafe()) {
                        console.log('   Memory limit reached');
                        break;
                    }
                }
            }
        } finally {
            // Clear arrays
            arrays.length = 0;
            this.forceGarbageCollection();
        }
    }
}

// Singleton instance
let instance = null;

export function getMemoryManager(options) {
    if (!instance) {
        instance = new MemoryManager(options);
    }
    return instance;
}

export default MemoryManager;

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const manager = new MemoryManager();
    
    // Show current stats
    console.log('\n📊 Current Memory Status:');
    const stats = manager.getMemoryStats();
    console.log(stats.formatted);
    
    // Get optimal chunk size
    console.log('\n📦 Optimal Chunk Size:');
    const chunkInfo = manager.getOptimalChunkSize(2); // 2MB per item
    console.log(`  Recommended: ${chunkInfo.recommended} items`);
    console.log(`  Available: ${chunkInfo.availableMB.toFixed(0)}MB`);
    console.log(`  Current usage: ${chunkInfo.currentUsage}`);
    
    // Start monitoring
    manager.startMonitoring((stats) => {
        if (stats.heapUsagePercent > 0.5) {
            console.log(`Memory: ${stats.formatted.heapUsagePercent}`);
        }
    });
    
    // Test memory pressure
    setTimeout(async () => {
        await manager.testMemoryPressure(200);
        
        // Show final report
        console.log('\n📈 Memory Report:');
        const report = manager.getReport();
        console.log(report);
        
        manager.stopMonitoring();
        process.exit(0);
    }, 2000);
}