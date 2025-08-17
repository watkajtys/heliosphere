# Heliosphere Daily Production System
## Complete Setup and Operations Guide

---

## 🌞 Overview

Heliosphere generates daily solar timelapse videos from NASA satellite data:
- **Full Video**: 56 days, 5,376 frames, ~3:44 @ 24fps
- **Social Video**: 30 days, 2,880 frames, ~2:00 @ 24fps
- **Data Sources**: SOHO/LASCO C2 (corona) + SDO/AIA 171 (sun disk)
- **48-Hour Delay**: Ensures complete satellite data availability
- **Processing**: Optimized parallel processing (3x faster)
- **Distribution**: Automatic upload to Cloudflare Stream

---

## 🚀 Quick Start

### 1. SSH Access (Passwordless)
```bash
# Connect to VPS
ssh vps  # or ssh root@65.109.0.112
```

### 2. Run 2-Day Test
```bash
cd /opt/heliosphere
node vps_2day_test.js
```
- Monitor at: http://65.109.0.112:3002/monitor
- Takes ~20 minutes for 192 frames
- Generates 2 test videos

### 3. Run Optimized Production (56 days)
```bash
pm2 start vps_production_optimized.js --name heliosphere-optimized -- --run
pm2 logs heliosphere-optimized
```
- Monitor at: http://65.109.0.112:3001/status
- Takes ~3.5 hours for 5,376 frames (3x faster!)

### 4. Upload to Cloudflare Stream
```bash
export CLOUDFLARE_API_TOKEN='kvbVY2J5N1-FAhQsOYsdtB_HPIpoINXs0ERlhQA7'
node cloudflare_upload.js /opt/heliosphere/videos/heliosphere_full_*.mp4 full
node cloudflare_upload.js /opt/heliosphere/videos/heliosphere_social_*.mp4 social
```

---

## 📁 File Structure

```
/opt/heliosphere/
├── vps_daily_production.js    # Original production script
├── vps_production_optimized.js # Optimized parallel processing
├── vps_2day_test.js           # Test script (2 days)
├── vps_optimized_test.js      # Optimized test script
├── cloudflare_upload.js       # Cloudflare Stream upload
├── monitor_optimized.html     # Optimized monitoring dashboard
├── frames/                    # Production frames
│   ├── 2025-08-13/
│   │   ├── frame_0000.jpg
│   │   └── ...
├── videos/                    # Generated videos
│   ├── heliosphere_full_2025-08-15.mp4
│   └── heliosphere_social_2025-08-15.mp4
├── daily_state.json          # Production state
└── frame_manifest.json       # Frame metadata
```

---

## 🔧 Configuration

### Key Parameters (in vps_daily_production.js)
```javascript
CONFIG = {
    SAFE_DELAY_DAYS: 2,    // 48-hour data delay
    TOTAL_DAYS: 56,        // Full video window
    SOCIAL_DAYS: 30,       // Social media window
    FRAMES_PER_DAY: 96,    // Every 15 minutes
    FPS: 24,               // Frame rate for all videos
    
    // Fallback limits (±14 minutes max)
    FALLBACK_STEPS_SOHO: [0, -3, -7, -1, 1, 3, -5, 5, 7, -10, 10, -14, 14],
    FALLBACK_STEPS_SDO: [0, 1, -1, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14]
}
```

### Data Sources
- **Corona**: Source ID 4 (SOHO/LASCO C2)
- **Sun Disk**: Source ID 10 (SDO/AIA 171)

---

## 🎬 Video Specifications

### Full Video (56 days)
- **Frames**: 5,376 (56 days × 96 frames/day)
- **Duration**: 3:44 @ 24fps
- **Resolution**: 1460×1200
- **Size**: ~200-300 MB
- **Codec**: H.264, CRF 18

### Social Video (30 days)
- **Frames**: 2,880 (30 days × 96 frames/day)
- **Duration**: 2:00 @ 24fps
- **Resolution**: 1460×1200
- **Size**: ~100-150 MB
- **Codec**: H.264, CRF 18

---

## 📊 Monitoring

### Web Dashboard
- **Production**: http://65.109.0.112:3001/monitor
- **Test**: http://65.109.0.112:3002/monitor

### API Endpoints
```bash
# Check status
curl http://65.109.0.112:3001/status

# Start production
curl -X POST http://65.109.0.112:3001/run

# Health check
curl http://65.109.0.112:3001/health
```

### PM2 Commands
```bash
pm2 status                    # View all processes
pm2 logs heliosphere-daily    # View logs
pm2 monit                     # Real-time monitoring
pm2 restart heliosphere-daily # Restart production
pm2 stop heliosphere-daily    # Stop production
```

---

## 🔄 Daily Automation

### Set up Cron Job
```bash
# Edit crontab
crontab -e

# Add daily run at 2 AM
0 2 * * * cd /opt/heliosphere && /usr/bin/node vps_daily_production.js --run >> /opt/heliosphere/cron.log 2>&1
```

### Or use PM2 Cron
```bash
pm2 start vps_daily_production.js --name heliosphere-daily --cron "0 2 * * *"
pm2 save
```

---

## 🛠️ Troubleshooting

### Common Issues

#### 1. Missing Data
- **Symptom**: Fallback messages in logs
- **Solution**: Normal - uses ±14 minute fallbacks automatically

#### 2. Duplicate Frames
- **Symptom**: "Duplicate detected" warnings
- **Solution**: System tries fallbacks, then interpolates if needed

#### 3. SSH Timeout
- **Symptom**: Commands hang
- **Solution**: Use `ssh vps` with configured key

#### 4. Out of Memory
- **Symptom**: PM2 restarts process
- **Solution**: Check with `pm2 monit`, increase memory limit

### Check Logs
```bash
# PM2 logs
pm2 logs heliosphere-daily --lines 100

# Production logs
tail -f /opt/heliosphere/output/logs/*.log

# System resources
htop
df -h
```

---

## 📈 Performance

### VPS Specifications
- **Server**: Hetzner CX22
- **CPU**: 2 vCPUs
- **RAM**: 4 GB
- **Disk**: 40 GB
- **Network**: Excellent

### Processing Speed

#### Sequential (Original)
- **Rate**: ~9.3 frames per minute
- **Full Run**: ~9.6 hours for 5,376 frames

#### Parallel (Optimized)
- **Rate**: ~27.5 frames per minute (3x faster!)
- **Full Run**: ~3.5 hours for 5,376 frames
- **Concurrency**: 8 parallel fetches, 4 parallel processing
- **Speedup**: 7.1x theoretical, 3x actual

### Resource Usage
- **Memory**: ~400-500 MB during processing
- **Disk**: ~1.5 GB for frames, 300 MB for videos
- **Network**: ~10 GB download for full run

---

## 🔒 Security

### SSH Access
- Key-based authentication only
- No password login
- IP whitelist (optional)

### API Access
- Currently public (no auth)
- Consider adding basic auth for production

---

## 📝 Testing Checklist

### Before Production
- [ ] Run 2-day test (`node vps_2day_test.js`)
- [ ] Verify both videos generated
- [ ] Check monitoring dashboard works
- [ ] Verify fallback logic in logs
- [ ] Check frame quality
- [ ] Test resume capability (stop/start)

### Daily Operations
- [ ] Check morning video generation
- [ ] Verify frame count (should add 96 daily)
- [ ] Monitor disk space
- [ ] Check for errors in logs
- [ ] Verify video uploads (if configured)

---

## 🚨 Emergency Procedures

### Stop Everything
```bash
pm2 stop all
pm2 kill
```

### Clean Start
```bash
# Clean up
rm -rf /opt/heliosphere/frames/*
rm -f /opt/heliosphere/daily_state.json
rm -f /opt/heliosphere/frame_manifest.json

# Restart
pm2 start vps_daily_production.js --name heliosphere-daily
```

### Recovery from Failure
```bash
# Production auto-resumes from last state
pm2 restart heliosphere-daily

# Check what was processed
cat /opt/heliosphere/daily_state.json | grep processedFrames
```

---

## 📞 Support

### Key Files
- **Main Script**: `/opt/heliosphere/vps_daily_production.js`
- **Test Script**: `/opt/heliosphere/vps_2day_test.js`
- **State File**: `/opt/heliosphere/daily_state.json`
- **Logs**: `/opt/heliosphere/output/logs/`

### Server Access
- **IP**: 65.109.0.112
- **SSH**: `ssh vps` or `ssh root@65.109.0.112`
- **Monitor**: http://65.109.0.112:3001/monitor

---

## 🎯 Next Steps

1. **Run 2-day test** to validate pipeline
2. **Set up daily cron** for automation
3. **Configure CDN/storage** for video distribution
4. **Add social media posting** automation
5. **Set up alerts** for failures

---

Last Updated: August 15, 2025