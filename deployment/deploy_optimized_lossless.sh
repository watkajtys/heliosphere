#!/bin/bash

# Deploy Optimized Lossless Production to VPS
# Server: 65.109.0.112

echo "🚀 Deploying Optimized Lossless Production to VPS"
echo "================================================"

# Step 1: Copy updated files to VPS
echo "📦 Copying files to VPS..."
scp vps_production_optimized.js \
    lib/video_encoder.js \
    lib/memory_manager.js \
    lib/chunk_processor.js \
    lib/quality_monitor.js \
    frame_quality_validator.js \
    config/production.config.js \
    monitor_production.html \
    package.json \
    root@65.109.0.112:/opt/heliosphere/

# Create lib and config directories on VPS
ssh root@65.109.0.112 "mkdir -p /opt/heliosphere/lib /opt/heliosphere/config"

# Copy lib files
scp lib/*.js root@65.109.0.112:/opt/heliosphere/lib/
scp config/*.js root@65.109.0.112:/opt/heliosphere/config/

echo "✅ Files copied"

# Step 2: SSH and run commands
echo "🔧 Setting up on VPS..."
ssh root@65.109.0.112 << 'ENDSSH'
cd /opt/heliosphere

# Install dependencies if needed
echo "📦 Installing dependencies..."
npm install express sharp crypto

# Create necessary directories
mkdir -p /opt/heliosphere/frames
mkdir -p /opt/heliosphere/videos
mkdir -p /tmp/heliosphere
mkdir -p /tmp/heliosphere_encode

echo "✅ Setup complete"

# Kill any existing process on port 3001
echo "🔄 Stopping any existing process..."
pm2 stop heliosphere-optimized 2>/dev/null || true

# Start the optimized production with PM2
echo "🚀 Starting optimized production..."
pm2 start vps_production_optimized.js \
    --name heliosphere-optimized \
    --max-memory-restart 3G \
    --node-args="--max-old-space-size=4096 --expose-gc"

pm2 save

echo "✅ Production started!"
echo ""
echo "📊 Monitoring available at:"
echo "   Dashboard: http://65.109.0.112:3001/monitor"
echo "   API Status: http://65.109.0.112:3001/api/status"
echo ""
echo "📝 Commands:"
echo "   Logs: pm2 logs heliosphere-optimized"
echo "   Status: pm2 status"
echo "   Stop: pm2 stop heliosphere-optimized"
ENDSSH

echo ""
echo "🎉 Deployment complete!"
echo "📊 Monitor at: http://65.109.0.112:3001/monitor"