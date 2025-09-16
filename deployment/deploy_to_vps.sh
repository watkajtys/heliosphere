#!/bin/bash

# Heliolens VPS Deployment Script
# Deploy to: 65.109.0.112 (builtbyvibes-server)

VPS_IP="65.109.0.112"
VPS_USER="root"
VPS_DIR="/opt/heliolens"

echo "╔════════════════════════════════════════╗"
echo "║   Deploying Heliolens to VPS           ║"
echo "║   Server: $VPS_IP                      ║"
echo "╚════════════════════════════════════════╝"

# Files to deploy
FILES=(
    "vps_production_unified.js"
    "vps_unified_test.js"
    "cloud_monitor.html"
    "package.json"
    "package-lock.json"
    "ecosystem.config.js"
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
cd /opt/heliolens

# Create required directories
echo "Creating directories..."
mkdir -p /opt/heliolens/output
mkdir -p /opt/heliolens/cache
mkdir -p /opt/heliolens/logs
mkdir -p /tmp/heliolens
mkdir -p /opt/heliolens/output/frames

# Install dependencies
echo "Installing Node.js dependencies..."
npm install

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Stop any existing instance
pm2 stop heliolens-unified 2>/dev/null || true
pm2 delete heliolens-unified 2>/dev/null || true

echo ""
echo "✅ VPS setup complete!"
ENDSSH

echo ""
echo "🚀 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. SSH into VPS: ssh vps"
echo "2. Test pipeline: cd $VPS_DIR && node vps_unified_test.js"
echo "3. Start production: pm2 start ecosystem.config.js"
echo "4. Monitor at: http://$VPS_IP:3001/monitor"
echo "5. View logs: pm2 logs heliolens-unified"