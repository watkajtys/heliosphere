#!/usr/bin/env node

import express from 'express';

const app = express();
const port = 3001;

app.get('/', (req, res) => {
    res.send('<h1>Monitor Test</h1><p>Server is working!</p>');
});

app.get('/api/test', (req, res) => {
    res.json({ status: 'working', timestamp: new Date().toISOString() });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Test server listening on port ${port}`);
    console.log(`Test URL: http://65.109.0.112:${port}`);
});