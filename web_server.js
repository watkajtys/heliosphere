#!/usr/bin/env node

/**
 * Web Server for Heliosphere Video Page
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 8080;

// Serve static files
app.use(express.static(__dirname));

// Main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'heliosphere-web' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Heliosphere web server running`);
    console.log(`   Local: http://localhost:${PORT}`);
    console.log(`   Public: http://65.109.0.112:${PORT}`);
    console.log(`   Video Page: http://65.109.0.112:${PORT}/`);
});