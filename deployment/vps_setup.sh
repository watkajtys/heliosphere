#!/bin/bash
# Simple VPS Setup for Heliosphere

echo "╔════════════════════════════════════════╗"
echo "║   Heliosphere VPS Setup                ║"
echo "╚════════════════════════════════════════╝"

# Update system
echo "→ Updating system packages..."
apt update && apt upgrade -y

# Install essential packages
echo "→ Installing dependencies..."
apt install -y curl git build-essential ffmpeg htop tmux

# Install Node.js 20
echo "→ Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2
echo "→ Installing PM2..."
npm install -g pm2

# Create directories
echo "→ Creating directories..."
mkdir -p /opt/heliosphere
mkdir -p /var/log/heliosphere

echo ""
echo "✅ Basic setup complete!"
echo ""
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "PM2 version: $(pm2 -v)"
echo ""
echo "Next steps:"
echo "1. Clone your repository to /opt/heliosphere"
echo "2. Install dependencies with npm install"
echo "3. Set up Google Cloud credentials"
echo "4. Start the service with PM2"