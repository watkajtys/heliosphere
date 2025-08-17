#!/bin/bash

# VPS Production Startup Script
# Run this on the VPS after deployment

cd /opt/heliosphere

echo "╔════════════════════════════════════════╗"
echo "║   Starting Heliosphere Production      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run as root"
   exit 1
fi

# Ensure directories exist
echo "→ Checking directories..."
mkdir -p /opt/heliosphere/output/frames
mkdir -p /opt/heliosphere/output/logs
mkdir -p /opt/heliosphere/cache
mkdir -p /tmp/heliosphere

# Set environment variables
export NODE_ENV=production
export PORT=3000
export USE_CLOUDFLARE_PROXY=true
export CLOUDFLARE_WORKER_URL=https://heliosphere-proxy.matty-f7e.workers.dev

# Stop any existing instance
echo "→ Stopping existing instances..."
pm2 stop heliosphere 2>/dev/null || true
pm2 delete heliosphere 2>/dev/null || true

# Start with PM2
echo "→ Starting production server..."
pm2 start vps_production.js \
    --name heliosphere \
    --max-memory-restart 3G \
    --log /opt/heliosphere/output/logs/pm2.log \
    --error /opt/heliosphere/output/logs/pm2-error.log \
    --merge-logs \
    --time

# Save PM2 configuration
pm2 save
pm2 startup systemd -u root --hp /root

# Show status
echo ""
echo "✅ Server started!"
echo ""
pm2 status

echo ""
echo "📊 Access points:"
echo "   Monitor: http://65.109.0.112:3000/monitor"
echo "   Status:  http://65.109.0.112:3000/status"
echo "   Health:  http://65.109.0.112:3000/health"
echo ""
echo "📝 Commands:"
echo "   View logs:    pm2 logs heliosphere"
echo "   Restart:      pm2 restart heliosphere"
echo "   Stop:         pm2 stop heliosphere"
echo "   Monitor:      pm2 monit"
echo ""
echo "🧪 To run test pipeline:"
echo "   node vps_pipeline_test.js"