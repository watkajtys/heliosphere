# Heliosphere Project - Quick Reference for Claude

## Project Overview
Heliosphere generates daily solar timelapse videos from NASA satellite data (SOHO/LASCO C2 + SDO/AIA 171) with optimized parallel processing and automatic upload to Cloudflare Stream.

## VPS Access
```bash
ssh vps  # or ssh root@65.109.0.112
# Credentials are stored in .env file
# Password: Check VPS_PASSWORD in .env
```

## Key URLs
- **Production Monitor**: http://65.109.0.112:3001/monitor
- **Test Monitor**: http://65.109.0.112:3002/monitor  
- **Optimized Test Monitor**: http://65.109.0.112:3003/monitor
- **Cloudflare Stream Video**: https://customer-931z4aajcqul6afi.cloudflarestream.com/9b6555f4eeac42f4a1f4e9cbaed65662/iframe

## Important Commands

### Run 2-Day Test
```bash
ssh vps "cd /opt/heliosphere && node vps_2day_test.js"
```

### Run Full Production (56 days)
```bash
ssh vps "cd /opt/heliosphere && pm2 start vps_daily_production.js --name heliosphere-daily -- --run"
```

### Check Status
```bash
ssh vps "pm2 status"
ssh vps "pm2 logs heliosphere-daily --lines 50"
```

### Access Videos
```bash
# List generated videos
ssh vps "ls -lah /opt/heliosphere/test_videos/*.mp4"
ssh vps "ls -lah /opt/heliosphere/videos/*.mp4"

# Start video server (if not running)
ssh vps "cd /opt/heliosphere && python3 -m http.server 8080 --directory test_videos &"
```

## Critical API Details

### Correct takeScreenshot API
```javascript
const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
    `date=${date}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
    `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;

// Source IDs:
// Corona: 4 (SOHO/LASCO C2)  
// Sun Disk: 10 (SDO/AIA 171)
```

### Key Configuration
- **48-hour delay** for satellite data availability
- **Fallback limit**: ±14 minutes max
- **Frame rate**: 24 fps for all videos
- **Resolution**: 1460×1200
- **Intervals**: Every 15 minutes (96 frames/day)

## Performance Metrics
- **Sequential Processing**: ~9.3 frames/minute
- **Optimized Parallel**: ~27.5 frames/minute (3x faster!)
- **Full run (sequential)**: ~9.6 hours for 5,376 frames
- **Full run (optimized)**: ~3.5 hours for 5,376 frames

## File Locations
- **Production script**: `/opt/heliosphere/vps_daily_production.js`
- **Optimized script**: `/opt/heliosphere/vps_production_optimized.js`
- **Test script**: `/opt/heliosphere/vps_2day_test.js`
- **Frames**: `/opt/heliosphere/frames/`
- **Videos**: `/opt/heliosphere/videos/` and `/opt/heliosphere/test_videos/`
- **State**: `/opt/heliosphere/daily_state.json`

## Testing Commands
```bash
# Run lint/typecheck if available
npm run lint
npm run typecheck

# Test video generation
ssh vps "cd /opt/heliosphere && ffmpeg -version"
```

## Recent Test Results
- ✅ 2-day test completed successfully (192 frames)
- ✅ Optimized parallel processing: 3x faster (27.5 fps)
- ✅ Video quality fixed: proper sun disk sizing (1435px)
- ✅ Cloudflare Stream upload working
- ✅ SSH passwordless access configured

## Cloudflare Stream Integration
```bash
# Upload video to Cloudflare (uses token from .env file)
source .env  # Load environment variables
node cloudflare_upload.js /path/to/video.mp4 full

# All credentials and account details are in .env file
# Account ID: f7e27d63f4766d7fb6a0f5b4789e2cdb
# Subdomain: customer-931z4aajcqul6afi.cloudflarestream.com
```

## Quality Settings
- **Frame Quality**: JPEG 95% with mozjpeg
- **Video Encoding**: H.264, CRF 15 (very high quality)
- **Scaling**: Lanczos filter
- **Sun Disk**: 1435px with 400px composite radius
- **Feathering**: 40px radial gradient

## Next Steps
1. Set up daily cron job for automation
2. Deploy optimized production script
3. Configure auto-upload to Cloudflare Stream

## Troubleshooting
- If SSH asks for password, run: `chmod 600 ~/.ssh/id_ed25519_hetzner`
- Monitor logs: `ssh vps "pm2 logs heliosphere-daily"`
- Check disk space: `ssh vps "df -h"`
- System resources: `ssh vps "htop"`