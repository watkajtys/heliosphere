# Solar Test Videos Summary

## Generated Videos

### 1. Standard Quality - 30 FPS
- **File:** `solar_test_30fps.mp4`
- **Size:** 24.7 MB
- **Duration:** 9.5 seconds
- **Frame Rate:** 30 FPS
- **Quality:** CRF 18 (high quality)
- **Resolution:** 1460x1200
- **Total Frames:** 285 frames
- **Description:** Standard playback speed with high quality encoding

### 2. Slow Motion - 15 FPS  
- **File:** `solar_test_15fps.mp4`
- **Size:** 34.0 MB
- **Duration:** 19 seconds
- **Frame Rate:** 15 FPS
- **Quality:** CRF 18 (high quality)
- **Resolution:** 1460x1200
- **Total Frames:** 285 frames
- **Description:** Half-speed playback for detailed analysis

### 3. Web Optimized - 30 FPS Fast
- **File:** `solar_test_30fps_fast.mp4`
- **Size:** 5.6 MB
- **Duration:** 9.5 seconds
- **Frame Rate:** 30 FPS
- **Quality:** CRF 23 (good quality, smaller file)
- **Resolution:** 1460x1200
- **Total Frames:** 285 frames
- **Description:** Optimized for web streaming with smaller file size

## Frame Processing Details

- **Original Frames:** 300 frames collected (with 15 gaps)
- **Sequential Frames:** 285 frames after removing gaps
- **Time Span:** ~71 hours of solar activity (285 frames × 15 min intervals)
- **Chronological Order:** Frames reversed to show oldest-to-newest

## Video Features

All videos include:
- Ad Astra color grading (golden sun disk, cool corona)
- Feathered compositing (400px radius, 40px feather)
- 1460x1200 resolution (73:60 aspect ratio)
- H.264 encoding for wide compatibility

## Recommendations

1. **For Exhibition:** Use `solar_test_30fps.mp4` - best quality and smooth playback
2. **For Web Streaming:** Use `solar_test_30fps_fast.mp4` - optimized file size
3. **For Analysis:** Use `solar_test_15fps.mp4` - slower playback to see transitions

## Next Steps for Production

1. Scale up to 5400 frames (56 days of data)
2. Implement manifest-based resume capability
3. Deploy to Google Cloud Run with daily updates
4. Upload to Cloudflare Stream for distribution
5. Create exhibit website with full-screen video player