#!/bin/bash

# Heliosphere VPS Deployment Script
# Deploy to: 65.109.0.112 (builtbyvibes-server)

VPS_IP="65.109.0.112"
VPS_USER="root"
VPS_DIR="/opt/heliosphere"

echo "╔════════════════════════════════════════╗"
echo "║   Deploying Heliosphere to VPS         ║"
echo "║   Server: $VPS_IP                      ║"
echo "╚════════════════════════════════════════╝"

# Files to deploy
FILES=(
    "vps_production.js"
    "vps_pipeline_test.js"
    "cloud_monitor.html"
    "package.json"
    "package-lock.json"
)

echo ""
echo "📦 Uploading files to VPS..."

# Create directory on VPS
ssh $VPS_USER@$VPS_IP "mkdir -p $VPS_DIR"

# Copy files
for file in "${FILES[@]}"; do
    echo "  → Uploading $file..."
    scp "$file" $VPS_USER@$VPS_IP:$VPS_DIR/
done

echo ""
echo "🔧 Setting up VPS environment..."

# Run setup commands on VPS
ssh $VPS_USER@$VPS_IP << 'ENDSSH'
cd /opt/heliosphere

# Create required directories
echo "Creating directories..."
mkdir -p /opt/heliosphere/output
mkdir -p /opt/heliosphere/cache
mkdir -p /opt/heliosphere/logs
mkdir -p /tmp/heliosphere
mkdir -p /opt/heliosphere/output/frames

# Install dependencies
echo "Installing Node.js dependencies..."
npm install

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Stop any existing instance
pm2 stop heliosphere 2>/dev/null || true
pm2 delete heliosphere 2>/dev/null || true

echo ""
echo "✅ VPS setup complete!"
ENDSSH

echo ""
echo "🚀 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. SSH into VPS: ssh $VPS_USER@$VPS_IP"
echo "2. Test pipeline: cd $VPS_DIR && node vps_pipeline_test.js"
echo "3. Start production: pm2 start vps_production.js --name heliosphere"
echo "4. Monitor at: http://$VPS_IP:3000/monitor"
echo "5. View logs: pm2 logs heliosphere"