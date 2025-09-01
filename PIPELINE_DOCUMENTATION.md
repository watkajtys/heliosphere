# Heliosphere Complete Pipeline Documentation

## Overview
Heliosphere generates daily solar timelapse videos from NASA satellite data (SOHO/LASCO C2 + SDO/AIA 171) with optimized parallel processing and automatic upload to Cloudflare Stream. The system runs automatically every day at 3 AM UTC.

## Architecture

### Components
1. **VPS Server** (65.109.0.112) - Runs daily production
2. **Cloudflare Stream** - Hosts the videos
3. **Cloudflare Pages** - Hosts the landing page
4. **GitHub** - Source code repository

### Data Flow
```
NASA APIs → VPS Processing → Frame Generation → Video Creation → Cloudflare Stream → Landing Page
```

## Daily Production Pipeline

### 1. Automated Cron Job (3 AM UTC Daily)
**Location**: VPS Server  
**Script**: `/opt/heliosphere/cron_production.sh`  
**Crontab**: `0 3 * * * /opt/heliosphere/cron_production.sh`

The cron wrapper script:
- Implements file-based locking to prevent multiple instances
- Has a 6-hour timeout protection
- Automatically cleans up stale locks
- Rotates logs when they exceed 1MB
- Cleans up frames older than 60 days

### 2. Frame Fetching and Processing
**Script**: `/opt/heliosphere/vps_daily_simple.js`  
**Configuration**:
- 56-day window (48-hour delay for data availability)
- 96 frames per day (every 15 minutes)
- Parallel fetching with 4 concurrent downloads
- Fallback system: ±7 minutes for missing data
- Checksum-based duplicate detection

**Process**:
1. Fetches corona images from SOHO/LASCO C2 (Source ID: 4)
2. Fetches sun disk images from SDO/AIA 171 (Source ID: 10)
3. Applies color grading (Ad Astra style for sun, cool tones for corona)
4. Composites images with radial feathering
5. Saves frames to `/opt/heliosphere/frames/YYYY-MM-DD/frame_HHMM.jpg`

### 3. Video Generation
**Script**: `/opt/heliosphere/generate_videos_only.js`  
**Outputs**: Three video formats
- **Full** (1460×1200): 56 days, desktop viewing
- **Social** (1200×1200): 30 days, square crop for social media
- **Portrait** (900×1200): 56 days, mobile viewing

**Video Settings**:
- Frame rate: 24 fps
- Codec: H.264 (MP4) for streaming, MJPEG (MOV) for quality
- Quality: CRF 18 (very high quality)

### 4. Cloudflare Upload
**Script**: `/opt/heliosphere/cloudflare_tus_upload.js`  
**Process**:
- Uses TUS resumable upload protocol for large files
- Automatically replaces existing videos
- Returns new video IDs for each format

### 5. Landing Page Update
**File**: `/heliosphere-pages/index.html`  
**Updates Required**:
- Video IDs in JavaScript VIDEO_IDS object
- Open Graph meta tags for social sharing
- Twitter Card metadata
- Schema.org structured data
- Upload date

### 6. Deployment to Cloudflare Pages
**Script**: `deploy.sh` (local) or manual command  
**Command**: 
```bash
export CLOUDFLARE_API_TOKEN=Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ
npx wrangler pages deploy heliosphere-pages --project-name heliosphere --branch main
```

## Manual Operations

### Running Production Manually

#### From Local Machine
```bash
# Full 56-day production
ssh vps "cd /opt/heliosphere && node vps_daily_simple.js"

# Test with 2-day window
ssh vps "cd /opt/heliosphere && node vps_unified_test.js --run"
```

#### On VPS Directly
```bash
cd /opt/heliosphere
export CLOUDFLARE_API_TOKEN=kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7
node vps_daily_simple.js
```

### Generating Videos from Existing Frames
```bash
ssh vps "cd /opt/heliosphere && node generate_videos_only.js"
```

### Manual Video Upload
```bash
# On VPS
cd /opt/heliosphere
export CLOUDFLARE_API_TOKEN=kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7
node cloudflare_tus_upload.js /path/to/video.mov full|social|portrait
```

### Updating Landing Page

1. **Edit locally**: `heliosphere-pages/index.html`
2. **Update video IDs**:
```javascript
const VIDEO_IDS = {
    desktop: 'NEW_FULL_VIDEO_ID',
    mobile: 'NEW_PORTRAIT_VIDEO_ID',
    social: 'NEW_SOCIAL_VIDEO_ID'
};
```
3. **Update meta tags** (search and replace old video IDs)
4. **Deploy**:
```bash
./deploy.sh
# or manually:
export CLOUDFLARE_API_TOKEN=Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ
npx wrangler pages deploy heliosphere-pages --project-name heliosphere --branch main
```

## API Keys and Credentials

### Environment Variables (.env file)
```env
# Cloudflare Stream API (for video uploads)
CLOUDFLARE_STREAM_TOKEN=kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7

# Cloudflare Pages API (for website deployment)
CLOUDFLARE_PAGES_TOKEN=Vgv15xXNQSgcyRZmlTk1Ah7TZ7-qCyxiVBdM0KcQ

# Cloudflare Account
CLOUDFLARE_ACCOUNT_ID=f7e27d63f4766d7fb6a0f5b4789e2cdb
CLOUDFLARE_STREAM_SUBDOMAIN=customer-931z4aajcqul6afi.cloudflarestream.com

# VPS Access
VPS_HOST=65.109.0.112
VPS_USER=root
VPS_PASSWORD=AJtha7MkUjkFxV9c7qWC!
```

### SSH Access
```bash
# Using SSH alias (configured in ~/.ssh/config)
ssh vps

# Direct connection
ssh root@65.109.0.112
```

## File Locations

### VPS Server (/opt/heliosphere/)
```
/opt/heliosphere/
├── vps_daily_simple.js        # Main production script (no web server)
├── cron_production.sh          # Cron wrapper with locking
├── generate_videos_only.js     # Video generation from frames
├── cloudflare_tus_upload.js   # Upload to Cloudflare Stream
├── frames/                     # Generated frames (YYYY-MM-DD/frame_HHMM.jpg)
├── videos/                     # Generated videos
├── logs/                       # Production logs
├── production_state.json       # Current production state
├── frame_manifest.json         # Frame metadata
└── .env                        # Environment variables
```

### Local Repository
```
heliosphere/
├── heliosphere-pages/
│   └── index.html             # Landing page
├── vps_daily_simple.js        # Production script (deploy to VPS)
├── cron_production.sh          # Cron wrapper (deploy to VPS)
├── deploy.sh                   # Deployment script for Pages
├── .env                        # Local environment variables
└── PIPELINE_DOCUMENTATION.md   # This file
```

## Monitoring and Troubleshooting

### Check Cron Status
```bash
ssh vps "crontab -l"                                    # View cron jobs
ssh vps "tail -f /opt/heliosphere/logs/daily_production.log"  # Watch logs
ssh vps "ps aux | grep node"                           # Check running processes
```

### Check Production State
```bash
ssh vps "cat /opt/heliosphere/production_state.json | python3 -m json.tool | head -20"
```

### Frame Verification
```bash
# Count total frames
ssh vps "find /opt/heliosphere/frames -name '*.jpg' | wc -l"

# Check date range
ssh vps "ls /opt/heliosphere/frames/ | head -5"
ssh vps "ls /opt/heliosphere/frames/ | tail -5"

# Check specific day
ssh vps "ls /opt/heliosphere/frames/2025-08-27/*.jpg | wc -l"  # Should be 96
```

### Common Issues and Solutions

#### Port 3001 Already in Use
**Symptom**: Cron job fails with "address already in use"  
**Cause**: Old production script with web server still running  
**Solution**: This has been fixed by removing the web server from the production script

#### Production Stuck in Infinite Loop
**Symptom**: Processing >100% of expected frames  
**Cause**: Promise handling bug in parallel processing  
**Solution**: Fixed in `vps_daily_simple.js` with proper promise awaiting

#### Missing Frames
**Symptom**: Gaps in video  
**Cause**: NASA API temporarily unavailable  
**Solution**: Script uses fallback system (±7 minutes) and will retry on next run

#### Cloudflare Upload Fails
**Symptom**: Videos not appearing on website  
**Check**: 
```bash
ssh vps "echo $CLOUDFLARE_API_TOKEN"  # Should show the Stream token
```
**Solution**: Ensure .env file exists on VPS with correct token

#### Website Not Updating
**Symptom**: Old videos still showing  
**Solution**: 
1. Clear browser cache
2. Check video IDs in index.html
3. Redeploy with correct Pages token

## Important URLs

### Production
- **Website**: https://heliosphere.pages.dev
- **Monitor** (disabled): http://65.109.0.112:3001/monitor

### Video IDs (Current as of Sep 1, 2025)
- **Full**: 996437e232eabe17c40240b4e37276a8
- **Social**: da252b796d765e906e1c8da7095f1eb1
- **Portrait**: 8aed97c0533e726d983264fff3dee861

### Cloudflare Stream Base URL
```
https://customer-931z4aajcqul6afi.cloudflarestream.com/{VIDEO_ID}/iframe
```

## Development Workflow

### Making Changes

1. **Edit locally** in this repository
2. **Test locally** if possible
3. **Deploy to VPS**:
```bash
scp vps_daily_simple.js vps:/opt/heliosphere/
scp cron_production.sh vps:/opt/heliosphere/
ssh vps "chmod +x /opt/heliosphere/cron_production.sh"
```
4. **Update crontab** if needed:
```bash
ssh vps "crontab -e"
```

### Testing Changes

1. **Run test production** (2 days only):
```bash
ssh vps "cd /opt/heliosphere && node vps_unified_test.js --run"
```

2. **Check output**:
```bash
ssh vps "ls -la /opt/heliosphere/test_videos/*.mp4"
```

### Deploying Landing Page Updates

1. **Edit** `heliosphere-pages/index.html`
2. **Commit** changes to git
3. **Deploy**:
```bash
./deploy.sh
```
4. **Verify** at https://heliosphere.pages.dev

## Backup and Recovery

### Backing Up Frames
```bash
# Create tarball of all frames
ssh vps "cd /opt/heliosphere && tar -czf frames_backup_$(date +%Y%m%d).tar.gz frames/"

# Download to local
scp vps:/opt/heliosphere/frames_backup_*.tar.gz ./backups/
```

### Restoring Production
If production fails, you can:
1. Check and fix the state file
2. Remove lock file: `ssh vps "rm -f /opt/heliosphere/production.lock"`
3. Run manually to test
4. Check logs for errors

### Emergency Video Generation
If frames exist but videos are missing:
```bash
ssh vps "cd /opt/heliosphere && node generate_videos_only.js"
```

## Performance Metrics

- **Frame Generation**: ~27 frames/minute (optimized parallel)
- **Full Production**: ~3.5 hours for 5,376 frames
- **Video Generation**: ~2-3 minutes per video
- **Upload Time**: ~5-10 minutes per video
- **Total Daily Runtime**: ~4 hours

## Future Improvements

1. **HDR Processing**: Implement tone mapping for better plasma detail
2. **Webhook Notifications**: Send alerts on production completion/failure
3. **Multi-region Backup**: Store frames in multiple locations
4. **API Rate Limiting**: Implement backoff for NASA API limits
5. **Progressive Video Loading**: Generate multiple quality levels

## Contact and Support

- **GitHub Repository**: https://github.com/watkajtys/heliosphere
- **VPS Provider**: Hetzner
- **CDN**: Cloudflare Stream & Pages
- **Data Source**: NASA Helioviewer API

---

*Last Updated: September 1, 2025*  
*Version: 2.0 (Simplified pipeline without web server)*