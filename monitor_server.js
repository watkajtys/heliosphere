#!/usr/bin/env node

import express from 'express';
import { WebSocketServer } from 'ws';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3001;

// Monitoring state
let monitorState = {
    status: 'idle', // idle, running, paused, stopped, error
    total: 5376, // 56 days × 96 frames/day
    completed: 0,
    pending: 5376,
    failures: 0,
    fallbacks: {
        corona: 0,
        sunDisk: 0,
        total: 0
    },
    currentFrame: null,
    startTime: null,
    lastUpdateTime: null,
    frameHistory: [],
    latestFrames: [],
    speed: 0,
    eta: 0,
    progress: 0,
    failureRate: 0,
    fallbackRate: 0,
    manifest: {
        frames: [],
        lastSuccessful: 0,
        checksums: new Set()
    }
};

// Serve static files
app.use(express.static(__dirname));
app.use(express.json());

// Serve monitor page
app.get('/monitor', (req, res) => {
    res.sendFile(path.join(__dirname, 'monitor.html'));
});

// API endpoints
app.get('/api/status', (req, res) => {
    res.json(monitorState);
});

app.post('/api/frame-complete', (req, res) => {
    const { frameNumber, success, fallbackInfo, checksum, timestamp } = req.body;
    
    // Update state
    if (success) {
        monitorState.completed++;
        monitorState.pending--;
        
        // Track fallbacks (not failures!)
        if (fallbackInfo) {
            if (fallbackInfo.corona !== 0) {
                monitorState.fallbacks.corona++;
                monitorState.fallbacks.total++;
                logMessage(`Frame ${frameNumber}: Corona fallback ${fallbackInfo.corona}min`, 'warning');
            }
            if (fallbackInfo.sunDisk !== 0) {
                monitorState.fallbacks.sunDisk++;
                monitorState.fallbacks.total++;
                logMessage(`Frame ${frameNumber}: Sun disk fallback ${fallbackInfo.sunDisk}min`, 'warning');
            }
        }
        
        // Add to manifest
        monitorState.manifest.frames.push({
            number: frameNumber,
            checksum,
            timestamp,
            fallbacks: fallbackInfo
        });
        monitorState.manifest.lastSuccessful = frameNumber;
        
        logMessage(`Frame ${frameNumber} completed successfully`, 'success');
    } else {
        monitorState.failures++;
        logMessage(`Frame ${frameNumber} FAILED - will retry`, 'error');
    }
    
    // Update metrics
    updateMetrics();
    
    // Broadcast update
    broadcastUpdate();
    
    res.json({ success: true });
});

app.post('/api/log', (req, res) => {
    const { message, type = 'info' } = req.body;
    logMessage(message, type);
    res.json({ success: true });
});

// Frame preview endpoint
app.get('/api/frame/:number', async (req, res) => {
    const frameNumber = req.params.number.padStart(4, '0');
    const framePath = path.join(__dirname, 'video_frames_correct', `frame_${frameNumber}.png`);
    
    try {
        const frameData = await fs.readFile(framePath);
        res.contentType('image/png');
        res.send(frameData);
    } catch (error) {
        res.status(404).send('Frame not found');
    }
});

// WebSocket server
const server = app.listen(PORT, () => {
    console.log(`Monitor server running on http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/monitor to view the dashboard`);
});

const wss = new WebSocketServer({ server, path: '/monitor' });

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log('Monitor client connected');
    
    // Send initial state
    ws.send(JSON.stringify(monitorState));
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleAction(data.action);
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
    
    ws.on('close', () => {
        clients.delete(ws);
        console.log('Monitor client disconnected');
    });
});

function handleAction(action) {
    switch (action) {
        case 'start':
            startGeneration();
            break;
        case 'pause':
            pauseGeneration();
            break;
        case 'resume':
            resumeGeneration();
            break;
        case 'stop':
            stopGeneration();
            break;
        case 'generate_video':
            generateVideo();
            break;
    }
}

function startGeneration() {
    monitorState.status = 'running';
    monitorState.startTime = Date.now();
    monitorState.lastUpdateTime = Date.now();
    logMessage('Frame generation started', 'success');
    broadcastUpdate();
}

function pauseGeneration() {
    monitorState.status = 'paused';
    logMessage('Generation paused', 'warning');
    broadcastUpdate();
}

function resumeGeneration() {
    monitorState.status = 'running';
    logMessage('Generation resumed', 'info');
    broadcastUpdate();
}

function stopGeneration() {
    monitorState.status = 'stopped';
    logMessage('Generation stopped', 'error');
    broadcastUpdate();
}

function generateVideo() {
    logMessage('Video generation started', 'info');
    // This would trigger the actual video generation process
    broadcastUpdate();
}

function updateMetrics() {
    const now = Date.now();
    
    // Calculate progress
    monitorState.progress = (monitorState.completed / monitorState.total) * 100;
    
    // Calculate speed (frames per minute)
    if (monitorState.startTime && monitorState.completed > 0) {
        const elapsedMinutes = (now - monitorState.startTime) / 60000;
        monitorState.speed = monitorState.completed / elapsedMinutes;
        
        // Calculate ETA
        const remainingFrames = monitorState.total - monitorState.completed;
        if (monitorState.speed > 0) {
            monitorState.eta = (remainingFrames / monitorState.speed) * 60; // in seconds
        }
    }
    
    // Calculate failure rate
    const totalAttempts = monitorState.completed + monitorState.failures;
    if (totalAttempts > 0) {
        monitorState.failureRate = (monitorState.failures / totalAttempts) * 100;
    }
    
    // Calculate fallback rate (important metric!)
    if (monitorState.completed > 0) {
        monitorState.fallbackRate = (monitorState.fallbacks.total / (monitorState.completed * 2)) * 100;
    }
    
    monitorState.lastUpdateTime = now;
}

function logMessage(message, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    
    // Add to state for broadcast
    monitorState.logEntry = { message, type, timestamp };
}

function broadcastUpdate() {
    const message = JSON.stringify(monitorState);
    clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
        }
    });
}

// Save manifest periodically
setInterval(async () => {
    if (monitorState.status === 'running' && monitorState.manifest.frames.length > 0) {
        try {
            await fs.writeFile(
                'manifest.json',
                JSON.stringify(monitorState.manifest, null, 2)
            );
            console.log('Manifest saved');
        } catch (error) {
            console.error('Error saving manifest:', error);
        }
    }
}, 30000); // Save every 30 seconds

// Update metrics every second
setInterval(() => {
    if (monitorState.status === 'running') {
        updateMetrics();
        broadcastUpdate();
    }
}, 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down monitor server...');
    
    // Save final manifest
    if (monitorState.manifest.frames.length > 0) {
        await fs.writeFile(
            'manifest.json',
            JSON.stringify(monitorState.manifest, null, 2)
        );
        console.log('Final manifest saved');
    }
    
    wss.close();
    server.close();
    process.exit(0);
});

console.log(`
╔══════════════════════════════════════════╗
║     Heliosphere Production Monitor       ║
║                                          ║
║  Tracking:                               ║
║  • Frame generation (5,376 total)        ║
║  • Fallbacks (expected, not failures)    ║
║  • True failures (will retry)            ║
║  • Performance metrics                   ║
║                                          ║
║  Dashboard: http://localhost:3001/monitor║
╚══════════════════════════════════════════╝
`);