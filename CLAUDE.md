# Heliolens Project - Quick Reference for Claude

## Project Overview
Heliolens generates daily solar timelapse videos from NASA satellite data (SOHO/LASCO C2 + SDO/AIA 171) with optimized parallel processing and automatic upload to Cloudflare Stream.

## VPS Access
```bash
ssh vps-heliolens  # Connect as heliolens user (root access disabled)
# Uses SSH key authentication only (password auth disabled)
# For root operations, use: sudo <command>
# Old root access (ssh vps) is now blocked for security
```

## Key URLs
- **Production Monitor**: http://65.109.0.112:3001/monitor
- **Test Monitor**: http://65.109.0.112:3002/monitor  
- **Optimized Test Monitor**: http://65.109.0.112:3003/monitor
- **Cloudflare Stream Video**: https://customer-931z4aajcqul6afi.cloudflarestream.com/9b6555f4eeac42f4a1f4e9cbaed65662/iframe

## Important Commands

### 🔍 Quick Status Check (ALWAYS RUN THIS FIRST!)
```bash
# From local machine - shows everything at once
node check_status.js

# Manual quick check
ssh vps-heliolens "df -h / | tail -1 && pm2 status && ps aux | grep ffmpeg | wc -l"

# What the output means:
# - Disk usage should be < 80% (needs 10GB free)
# - PM2 should show "online" status
# - FFmpeg count > 0 means videos are generating
```

### Run 2-Day Test (Unified Script)
```bash
ssh vps-heliolens "cd /opt/heliosphere && node vps_unified_test.js --run"
```

### Run Full Production (56 days) - NEW UNIFIED SCRIPT
```bash
ssh vps-heliolens "cd /opt/heliosphere && pm2 start vps_production_unified.js --name heliolens-unified -- --run"
```

### Check Detailed Status
```bash
ssh vps-heliolens "pm2 status"
ssh vps-heliolens "pm2 logs heliolens-daily --lines 50"
```

### Fix Common Issues
```bash
# If production is stuck (shows "already running" repeatedly)
ssh vps-heliolens "rm -f /opt/heliosphere/daily_production.lock"
ssh vps-heliolens "pm2 restart heliolens-daily"

# If disk is full (> 80% usage)
ssh vps-heliolens "ls -lah /opt/heliosphere/videos/*.mp4 | wc -l"  # Count videos
ssh vps-heliolens "rm /opt/heliosphere/videos/*2025-09-0[1-5]*"    # Delete old videos
ssh vps-heliolens "df -h"  # Verify space freed

# If PM2 has high restart count (> 100)
ssh vps-heliolens "pm2 logs heliolens-daily --err --lines 20"  # Check error logs
```

### Access Videos
```bash
# List generated videos
ssh vps-heliolens "ls -lah /opt/heliosphere/test_videos/*.mp4"
ssh vps-heliolens "ls -lah /opt/heliosphere/videos/*.mp4"

# Start video server (if not running)
ssh vps-heliolens "cd /opt/heliosphere && python3 -m http.server 8080 --directory test_videos &"
```

## Critical API Details

### ⚠️ CRITICAL: Correct Image Parameters
**NEVER change these values or frames will be incorrect!**

```javascript
// Corona (SOHO/LASCO C2 - Source ID 4):
const coronaParams = {
    sourceId: 4,
    imageScale: 8,        // MUST BE 8 (not 2.5!) or corona will be black
    width: 1920,          // MUST BE 1920 for proper corona
    height: 1200
};

// Sun Disk (SDO/AIA 171 - Source ID 10):
const sunParams = {
    sourceId: 10,
    imageScale: 2.5,      // 2.5 for sun (NOT 1.87!)
    width: 1920,          // 1920 for proper resolution
    height: 1920          // Square for sun disk
};

// API URL Format (DO NOT use URLSearchParams - it breaks the brackets!):
const apiUrl = `https://api.helioviewer.org/v2/takeScreenshot/?` +
    `date=${date}&layers=[${sourceId},1,100]&imageScale=${imageScale}` +
    `&width=${width}&height=${height}&x0=0&y0=0&display=true&watermark=false`;

// IMPORTANT: Remove milliseconds from dates!
const dateStr = date.toISOString().replace(/\.\d{3}/, '');  // .000Z causes 400 errors
```

### Compositing Process (CRITICAL!)
```javascript
// 1. Grade Corona (white/blue appearance)
const gradedCorona = await sharp(coronaBuffer)
    .modulate({ saturation: 0.3, brightness: 1.0, hue: -5 })
    .tint({ r: 220, g: 230, b: 240 })  // Blue-white tint
    .linear(1.2, -12)
    .gamma(1.2)
    .toBuffer();

// 2. Grade Sun Disk (warm/golden)
const gradedSunDisk = await sharp(sunBuffer)
    .modulate({ brightness: 1.3, saturation: 0.95 })
    .gamma(1.05)
    .linear(1.3, -8)
    .toBuffer();

// 3. Apply circular feather to sun (1435px - larger than frame!)
const featheredSunDisk = await applyCircularFeather(gradedSunDisk, 1435, 400, 40);

// 4. Composite on large canvas (1920×1435) to avoid dimension errors
const composite = await sharp({
    create: { width: 1920, height: 1435, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 }}
})
.composite([
    { input: gradedCorona, gravity: 'center' },
    { input: featheredSunDisk, gravity: 'center', blend: 'screen' }
])
.png().toBuffer();

// 5. Crop to final dimensions (1460×1200)
const final = await sharp(composite)
    .extract({ left: 230, top: 117, width: 1460, height: 1200 })
    .jpeg({ quality: 95 })
    .toBuffer();
```

### Key Configuration
- **48-hour delay** for satellite data availability
- **Fallback limit**: ±14 minutes max
- **Frame rate**: 24 fps for all videos
- **Resolution**: 1460×1200 (cropped from 1920×1435)
- **Intervals**: Every 15 minutes (96 frames/day)
- **Sun disk size**: 1435px (extends beyond frame for dramatic effect)

## Performance Metrics
- **Sequential Processing**: ~9.3 frames/minute
- **Optimized Parallel**: ~27.5 frames/minute (3x faster!)
- **Full run (sequential)**: ~9.6 hours for 5,376 frames
- **Full run (optimized)**: ~3.5 hours for 5,376 frames

## File Locations
- **UNIFIED script (RECOMMENDED)**: `/opt/heliolens/vps_production_unified.js`
- **Original production**: `/opt/heliolens/vps_daily_production.js`
- **Optimized script**: `/opt/heliolens/vps_production_optimized.js`
- **Test scripts**: `/opt/heliolens/vps_2day_test.js`, `/opt/heliolens/vps_unified_test.js`
- **Frames**: `/opt/heliolens/frames/`
- **Videos**: `/opt/heliolens/videos/` and `/opt/heliolens/test_videos/`
- **State**: `/opt/heliolens/daily_state.json`

## Testing Commands
```bash
# Run lint/typecheck if available
npm run lint
npm run typecheck

# Test video generation
ssh vps-heliolens "cd /opt/heliosphere && ffmpeg -version"
```

## Recent Production Results (Aug 26, 2025)
- ✅ Full 56-day production run completed (5376 frames)
- ✅ Generated all three video formats:
  - **Full**: 1460×1200, 224 seconds, 56 days (original resolution)
  - **Social**: 1200×1200 square, ~120 seconds, 30 days (cropped for social media)
  - **Portrait**: 900×1200, 224 seconds, 56 days (3:4 aspect for mobile)
- ✅ All videos uploaded to Cloudflare Stream
- ✅ Landing page deployed with responsive video selection
- ⚠️ Identified highlight blowout issue with screen blend mode
- 🔄 Planning HDR processing implementation for plasma detail recovery

## Cloudflare Stream Integration
```bash
# Upload video to Cloudflare (uses token from .env file)
source .env  # Load environment variables
node cloudflare_upload.js /path/to/video.mp4 full  # For files < 100MB
node cloudflare_tus_upload.js /path/to/video.mp4 full  # For large files

# Current Video IDs (Aug 19, 2025):
# Full: ecc7a58c6cea4a315257e1701b4b9823
# Social: 7d0ab32b3b69317b17a2a0c7bc959092
# Portrait: 90c2570ebb09cc12679f12a6d0ea3a9f

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
1. ✅ Daily cron job configured (runs at 3 AM UTC as heliolens user)
2. ✅ Optimized production script deployed
3. ✅ Auto-upload to Cloudflare Stream configured

## Security Hardening (Completed Sep 11, 2025)
- ✅ Non-root user 'heliolens' with sudo privileges
- ✅ UFW firewall enabled (ports 22, 80, 443 open)
- ✅ fail2ban protecting SSH
- ✅ SSH hardened (no root login, key-only auth)
- ✅ Application migrated to non-root user
- ✅ Cron jobs running as heliolens user
- ✅ File permissions secured (750 for app, 600 for .env)

## Production Status Monitoring

### Quick Health Check
Run `node check_status.js` to see:
- ✅/⚠️/❌ Disk usage status
- 🔄/⏸️ Production running or idle
- 📹 Latest video dates
- 🔧 PM2 status and restart count
- 🎬 Currently generating videos
- 🌐 Website last update date

### Signs Production is Working:
- Disk usage < 80%
- PM2 status "online" with low restart count
- FFmpeg processes running (video generation)
- New dated files in /opt/heliosphere/videos/
- Logs show "Progress: X%" increasing

### Signs Production is Stuck:
- PM2 restart count > 100
- Logs show "Production already running" repeatedly  
- No FFmpeg processes but should be running
- Same error repeating in logs
- Disk usage > 90%

## Troubleshooting

### Common Issues and Fixes

#### 1. Corona is Missing (Black or Red)
- **Symptom**: Frames show only sun disk, no white streamers
- **Cause**: Wrong imageScale for corona (using 2.5 instead of 8)
- **Fix**: Corona MUST use `imageScale: 8` and `width: 1920`

#### 2. "Image to composite must have same dimensions or smaller"
- **Symptom**: Composite operation fails
- **Cause**: Sun disk (1435px) larger than frame height (1200px)
- **Fix**: Use large canvas (1920×1435) then crop to 1460×1200

#### 3. API Returns HTML/400 Errors
- **Symptom**: Fetching fails, getting HTML instead of images
- **Causes**: 
  - URL-encoded brackets (using URLSearchParams)
  - Date includes milliseconds (.000Z)
- **Fix**: 
  - Use string concatenation for URL
  - Remove milliseconds: `date.toISOString().replace(/\.\d{3}/, '')`

#### 4. Identifying Bad Frames
```bash
# Find frames without corona (too small)
ssh vps-heliolens "find /opt/heliosphere/frames -name '*.jpg' -size -200k"

# Delete bad frames
ssh vps-heliolens "find /opt/heliosphere/frames -name '*.jpg' -size -200k -delete"

# Good frames should be 280-370KB
```

### System Maintenance
- Monitor logs: `ssh vps-heliolens "pm2 logs heliolens-daily"`
- Check disk space: `ssh vps-heliolens "df -h"`
- System resources: `ssh vps-heliolens "htop"`
- If SSH asks for password: `chmod 600 ~/.ssh/id_ed25519_hetzner`