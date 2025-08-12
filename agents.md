# Agents Collaboration Guide - Heliosphere Solar Composite Video

## Project Status: Ready for Video Generation

This system generates solar composite images by combining SDO (sun disk) and SOHO LASCO (corona) data with cinematic color grading. All components are operational and tested for video production.

## Current System Configuration

### ✅ Finalized Settings
- **Style**: Ad Astra (cosmic isolation cinematic aesthetic) 
- **Crop**: 1440×1200px (eliminates all deadspace)
- **Composite**: 400px radius, 40px feather
- **Blend Mode**: Screen (optimized for solar data)
- **Server**: Running on `http://localhost:3002`

### ✅ Data Sources
- **SDO AIA 171Å**: Sun disk data, 12-second native cadence
- **SOHO LASCO C2**: Corona data, ~30-minute intervals
- **Fallback Logic**: SDO ±5min, LASCO ±15min for missing data
- **Data Status**: All timestamps 48-50+ hours ago verified working

## Video Generation Specifications

### Timeline Direction
- **"Live" Reference**: 48 hours ago (guaranteed complete data backfill)
- **Video Direction**: Backwards in time from 48hrs ago
- **Frame Sequence**: 48hrs → 48.5hrs → 49hrs → 49.5hrs → 50hrs → ... (going further back)

### Technical Requirements
- **Interval**: 30 minutes between frames
- **Coverage**: 48 hours total (96 frames)
- **Output**: 4-second video at 24fps
- **Format**: Each frame is 1440×1200px PNG

### Timestamp Calculation
```javascript
const now = new Date();
const startTime = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48hrs ago
const frameTime = new Date(startTime.getTime() - (frameNumber * 30 * 60 * 1000));
```

## API Documentation

### Primary Endpoint
```
GET /composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date={ISO_TIMESTAMP}
```

### Parameters
- `style`: "ad-astra" (default, finalized)
- `cropWidth`: 1440 (default, optimized)
- `cropHeight`: 1200 (default, optimized)
- `date`: ISO timestamp (e.g., "2025-08-10T05:00:00.000Z")

### Response Headers (Critical for Quality Control)
- `X-SDO-Date`: Actual SDO timestamp used
- `X-LASCO-Date`: Actual LASCO timestamp used
- `X-Fallback-Used`: "true" if fallback data was needed
- `X-Cache`: "HIT" or "MISS" for performance monitoring

### Example Request
```bash
curl "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T05:00:00.000Z" -o frame_001.png
```

## Video Agent Tasks

### 1. Frame Generation Loop
```bash
# Pseudo-code for frame generation
for frameNumber in range(96):  # 48 hours * 2 frames per hour
    timestamp = calculate_timestamp(48_hours_ago - frameNumber * 30_minutes)
    download_frame(timestamp, f"frame_{frameNumber:03d}.png")
    verify_metadata_headers()
```

### 2. Quality Control
- Verify `X-Fallback-Used` header for each frame
- Check file sizes (expect 1.6-1.7MB per frame)
- Log any frames using fallback data
- Ensure sequential timestamps are working

### 3. Video Assembly
- Input: 96 PNG frames (1440×1200)
- Output: MP4 video, 24fps, 4 seconds duration
- Codec: H.264 for compatibility
- Quality: High (minimal compression for solar detail)

### 4. Verification Steps
- Confirm frame count (96 frames)
- Check frame uniqueness (no duplicate checksums)
- Verify smooth temporal progression
- Test final video playback

## Data Availability Notes

### Confirmed Working Ranges
- **48-50 hours ago**: All exact timestamps available
- **LASCO**: Updates every ~30 minutes (matches our interval)
- **SDO**: 12-second cadence (abundant data)

### Fallback Behavior
- System automatically finds nearest available data within tolerance
- SDO: ±5 minutes (very reliable due to high cadence)
- LASCO: ±15 minutes (accounts for 30-min download cycle)
- Headers show actual timestamps used for transparency

## Error Handling

### Expected Scenarios
- **Cache hits**: Faster response for repeated requests
- **Occasional fallbacks**: Normal, logged in headers
- **Network timeouts**: Retry after 30 seconds

### Failure Conditions
- No data within fallback window (extremely rare for 48+ hour old data)
- Server unavailable (check `http://localhost:3002/tune` for health)
- Disk space issues (each frame ~1.6MB, total ~160MB for 96 frames)

## File Management

### Recommended Structure
```
frames/
├── frame_001.png  # 48hrs ago (most recent)
├── frame_002.png  # 48.5hrs ago
├── frame_003.png  # 49hrs ago
...
└── frame_096.png  # 96hrs ago (oldest)
```

### Naming Convention
- Zero-padded frame numbers (001-096)
- Chronological order (001 = most recent, 096 = oldest)
- PNG format for lossless solar detail preservation

## Success Criteria

1. **96 unique frames generated** (verified by checksum)
2. **Metadata logged** for each frame (timestamps and fallback status)
3. **4-second video created** showing 48 hours of solar evolution in reverse
4. **Quality verification** (no obvious artifacts or missing frames)
5. **Performance metrics** (cache hit rate, generation time)

## Contact Information

- **System Status**: Check `/tune` endpoint for live testing
- **Current Settings**: All optimized for video production
- **Data Window**: 48+ hours ago ensures complete backfill
- **Frame Rate**: 30-minute intervals proven optimal for both data sources

The system is production-ready for video generation. All testing shows reliable frame generation with high data availability and quality.