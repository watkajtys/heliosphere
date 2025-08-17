#!/usr/bin/env node

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3005;

// Serve video files with proper headers
app.use('/videos', express.static('/opt/heliosphere/test_comparison_videos', {
    setHeaders: (res, path) => {
        if (path.endsWith('.mp4')) {
            res.set('Content-Type', 'video/mp4');
            res.set('Accept-Ranges', 'bytes');
        }
    }
}));

// Serve comparison page
app.get('/compare', (req, res) => {
    res.sendFile('/opt/heliosphere/test_comparison_videos/comparison.html');
});

// Simple comparison page
app.get('/simple', (req, res) => {
    res.sendFile('/opt/heliosphere/test_comparison_videos/simple_compare.html');
});

// List available videos
app.get('/list', (req, res) => {
    const videoDir = '/opt/heliosphere/test_comparison_videos';
    fs.readdir(videoDir, (err, files) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const videos = files.filter(f => f.endsWith('.mp4'));
        const videoInfo = videos.map(v => {
            const stats = fs.statSync(path.join(videoDir, v));
            return {
                name: v,
                size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
                path: `/videos/${v}`
            };
        });
        res.json(videoInfo);
    });
});

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/simple');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Comparison server running at http://65.109.0.112:${PORT}`);
    console.log(`   /simple - Simple comparison page`);
    console.log(`   /compare - Full comparison page`);
    console.log(`   /list - List available videos`);
});