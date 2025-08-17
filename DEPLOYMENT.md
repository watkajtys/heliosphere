# Heliosphere Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [VPS Setup](#vps-setup)
4. [Production Deployment](#production-deployment)
5. [Cloudflare Configuration](#cloudflare-configuration)
6. [Monitoring Setup](#monitoring-setup)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software
- Node.js 20+ (with npm 9+)
- FFmpeg 6+ with H.264 support
- Git
- PM2 (for production)

### Required Accounts
- Cloudflare account with:
  - Stream API access
  - Pages enabled
  - API tokens created
- VPS with:
  - Ubuntu 22.04 LTS
  - 4+ CPU cores
  - 8GB+ RAM
  - 100GB+ storage

## Local Development

### 1. Clone Repository
```bash
git clone https://github.com/yourusername/heliosphere.git
cd heliosphere
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit with your tokens
nano .env
```

Required environment variables (see .env.example for full list):
```bash
# Cloudflare API credentials
CLOUDFLARE_STREAM_TOKEN=your_stream_api_token_here
CLOUDFLARE_PAGES_TOKEN=your_pages_deployment_token_here
CLOUDFLARE_ACCOUNT_ID=your_account_id_here

# VPS configuration (if using remote server)
VPS_HOST=65.109.0.112
VPS_USER=root

# Production settings
NODE_ENV=production
PRODUCTION_DAYS=56
VIDEO_FPS=24
```

### 4. Run Test Mode
```bash
# Process 2 days of data for testing
npm run test
# or for optimized test:
npm run test:optimized

# Monitor progress
open http://localhost:3003/monitor
```

## VPS Setup

### 1. Initial Server Configuration

```bash
# Connect to VPS
ssh root@your-vps-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Install FFmpeg
apt install -y ffmpeg

# Install PM2 globally
npm install -g pm2

# Install git
apt install -y git
```

### 2. Create Application Directory

```bash
# Create directory
mkdir -p /opt/heliosphere
cd /opt/heliosphere

# Clone repository
git clone https://github.com/yourusername/heliosphere.git .

# Install dependencies
npm install
```

### 3. Configure Environment

```bash
# Create .env file
cat > .env << 'EOF'
CLOUDFLARE_STREAM_TOKEN=your_stream_token
CLOUDFLARE_PAGES_TOKEN=your_pages_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
NODE_ENV=production
EOF

# Secure the file
chmod 600 .env
```

### 4. Set Up SSH Keys (Optional but Recommended)

```bash
# Generate SSH key for deployments
ssh-keygen -t ed25519 -C "heliosphere-deploy" -f ~/.ssh/heliosphere_deploy

# Add to authorized_keys if needed
cat ~/.ssh/heliosphere_deploy.pub >> ~/.ssh/authorized_keys
```

## Production Deployment

### 1. PM2 Configuration

Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'heliosphere-production',
    script: './vps_production_optimized.js',
    cwd: '/opt/heliosphere',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=4096'
    },
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    merge_logs: true,
    time: true,
    cron_restart: '0 0 * * *',  // Daily at midnight
    autorestart: true,
    watch: false
  }]
};
```

### 2. Start Production Service

```bash
# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup systemd
# Follow the command it outputs

# View logs
pm2 logs heliosphere-production

# Monitor
pm2 monit
```

### 3. Set Up Daily Cron Job

```bash
# Edit crontab
crontab -e

# Add daily execution at midnight UTC
0 0 * * * cd /opt/heliosphere && /usr/bin/node vps_production_optimized.js >> /opt/heliosphere/logs/cron.log 2>&1

# Or use PM2's cron restart feature (already in ecosystem.config.js)
```

### 4. Nginx Configuration (Optional)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        return 301 https://heliosphere.pages.dev$request_uri;
    }

    location /monitor {
        proxy_pass http://localhost:3003/monitor;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:3003/api;
        proxy_http_version 1.1;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }
}
```

## Cloudflare Configuration

### 1. Create API Tokens

#### Stream API Token
1. Go to Cloudflare Dashboard → Stream
2. Click "Manage API Tokens"
3. Create token with permissions:
   - Stream:Edit
   - Account:Read

#### Pages Deployment Token
1. Go to Profile → API Tokens
2. Create Custom Token with:
   - Cloudflare Pages:Edit
   - Account:Read
   - Zone:Read (for your domain)

### 2. Configure Stream

```bash
# Test upload
node cloudflare_upload.js test_video.mp4

# Set allowed origins (if needed)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/${VIDEO_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"allowedOrigins": ["https://heliosphere.pages.dev"]}'
```

### 3. Set Up Pages Project

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create Pages project
wrangler pages project create heliosphere

# Deploy
node deploy_museum_seo.js
```

### 4. Configure Custom Domain (Optional)

1. Go to Pages → heliosphere → Custom domains
2. Add your domain
3. Follow DNS configuration instructions

## Monitoring Setup

### 1. Web Dashboard

The monitoring dashboard runs automatically with the production script:
- Local: `http://localhost:3003/monitor`
- Production: `http://your-vps:3003/monitor`

### 2. System Monitoring

```bash
# Install htop for system monitoring
apt install -y htop

# Monitor system resources
htop

# Check disk usage
df -h

# Monitor PM2 processes
pm2 monit
```

### 3. Log Management

```bash
# Set up log rotation
cat > /etc/logrotate.d/heliosphere << EOF
/opt/heliosphere/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF

# View logs
tail -f /opt/heliosphere/logs/output.log
tail -f /opt/heliosphere/logs/error.log
```

### 4. Alerts (Optional)

```javascript
// Add to production script for alerts
const sendAlert = async (message) => {
  // Implement your preferred alerting method
  // Examples: Email, Slack, Discord, Telegram
  
  // Slack webhook example:
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message })
  });
};

// Use in error handlers
if (failedFrames > 100) {
  await sendAlert('⚠️ Heliosphere: High failure rate detected');
}
```

## Troubleshooting

### Common Issues and Solutions

#### 1. FFmpeg Not Found
```bash
# Install FFmpeg
apt install -y ffmpeg

# Verify installation
ffmpeg -version
```

#### 2. Memory Issues
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=8192"

# Or in PM2 ecosystem file
env: {
  NODE_OPTIONS: '--max-old-space-size=8192'
}
```

#### 3. Permission Errors
```bash
# Fix permissions
chown -R $USER:$USER /opt/heliosphere
chmod -R 755 /opt/heliosphere
chmod 600 /opt/heliosphere/.env
```

#### 4. API Rate Limiting
```javascript
// Adjust concurrency in production script
const FETCH_CONCURRENCY = 4;  // Reduce from 8
const PROCESS_CONCURRENCY = 2;  // Reduce from 4
```

#### 5. Cloudflare Upload Failures
```bash
# Check token permissions
curl -X GET "https://api.cloudflare.com/client/v4/user/tokens/verify" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}"

# Check account ID
curl -X GET "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}"
```

### Debug Mode

```bash
# Run with debug output
DEBUG=* node vps_production_optimized.js

# Or add to script
console.log('Debug:', {
  date: targetDate,
  url: apiUrl,
  response: response.status
});
```

### Performance Tuning

```bash
# Monitor resource usage
iostat -x 1
vmstat 1
netstat -tulpn

# Optimize system
# Increase file descriptors
ulimit -n 65536

# Tune kernel parameters
echo "net.core.somaxconn = 65536" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65536" >> /etc/sysctl.conf
sysctl -p
```

## Backup and Recovery

### 1. Backup Strategy

```bash
# Create backup script
cat > /opt/heliosphere/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/heliosphere/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# Backup code
cp -r /opt/heliosphere $BACKUP_DIR/

# Backup environment
cp /opt/heliosphere/.env $BACKUP_DIR/

# Backup PM2
pm2 save
cp ~/.pm2/dump.pm2 $BACKUP_DIR/

# Compress
tar -czf $BACKUP_DIR.tar.gz $BACKUP_DIR
rm -rf $BACKUP_DIR

# Keep only last 7 backups
find /backup/heliosphere -name "*.tar.gz" -mtime +7 -delete
EOF

chmod +x /opt/heliosphere/backup.sh

# Add to crontab
echo "0 3 * * * /opt/heliosphere/backup.sh" | crontab -
```

### 2. Recovery Process

```bash
# Restore from backup
tar -xzf /backup/heliosphere/20240101.tar.gz -C /
pm2 resurrect

# Restart services
pm2 restart all
```

## Security Hardening

### 1. Firewall Configuration

```bash
# Install UFW
apt install -y ufw

# Configure firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3003/tcp  # Monitor port (restrict to your IP)
ufw enable
```

### 2. Fail2ban Setup

```bash
# Install fail2ban
apt install -y fail2ban

# Configure for SSH
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
systemctl restart fail2ban
```

### 3. SSL Certificate (if using custom domain)

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d your-domain.com

# Auto-renewal
echo "0 0 * * 0 certbot renew --quiet" | crontab -
```

## Maintenance

### Regular Tasks

#### Daily
- Check monitoring dashboard
- Review error logs
- Verify video generation

#### Weekly
- Check disk space
- Review performance metrics
- Update dependencies (if needed)

#### Monthly
- System updates
- Backup verification
- Performance review

### Update Process

```bash
# Backup current version
cp -r /opt/heliosphere /opt/heliosphere.backup

# Pull latest changes
cd /opt/heliosphere
git pull origin main

# Update dependencies
npm install

# Restart service
pm2 restart heliosphere-production
```

## Support

For issues or questions:
1. Check logs: `pm2 logs heliosphere-production`
2. Review monitoring: `http://your-vps:3003/monitor`
3. Open GitHub issue with:
   - Error messages
   - Log excerpts
   - System specifications
   - Steps to reproduce

---

*Last Updated: January 2025*
*Version: 2.0.0*