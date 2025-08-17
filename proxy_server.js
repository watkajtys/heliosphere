#!/usr/bin/env node

import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy endpoint for Helioviewer API
app.get('/proxy/helioviewer/*', async (req, res) => {
    try {
        // Extract the API path after /proxy/helioviewer/
        const apiPath = req.params[0];
        const queryString = new URLSearchParams(req.query).toString();
        const helioviewerUrl = `https://api.helioviewer.org/${apiPath}?${queryString}`;
        
        console.log(`Proxying request to: ${helioviewerUrl}`);
        const startTime = Date.now();
        
        const response = await fetch(helioviewerUrl);
        const buffer = await response.buffer();
        
        console.log(`Helioviewer response in ${Date.now() - startTime}ms`);
        
        // Forward the response
        res.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
        res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.send(buffer);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'helioviewer-proxy' });
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`Example: http://localhost:${PORT}/proxy/helioviewer/v2/takeScreenshot/?date=2024-01-01T00:00:00Z&layers=[10,1,100]`);
});