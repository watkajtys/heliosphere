#!/bin/bash

echo "🚀 Deploying and Running Full Production on VPS"
echo "================================================"

# Copy all necessary files to VPS
echo "📦 Copying files to VPS..."
scp -r lib/ config/ root@65.109.0.112:/opt/heliosphere/
scp vps_production_optimized.js \
    frame_quality_validator.js \
    monitor_production.html \
    run_full_production.js \
    package.json \
    root@65.109.0.112:/opt/heliosphere/

echo "✅ Files copied"

# SSH and run the full production
ssh root@65.109.0.112 << 'ENDSSH'
cd /opt/heliosphere

echo "📦 Installing dependencies..."
npm install

echo "🚀 Starting Full Production (5,376 frames)..."
echo "This will take ~3.5 hours with parallel processing"
echo ""
echo "Monitor at: http://65.109.0.112:3001/monitor"
echo ""

# Run the full production script
node --max-old-space-size=4096 --expose-gc run_full_production.js

echo "✅ Production complete!"
ENDSSH