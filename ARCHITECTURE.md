# Heliolens Architecture Documentation

## Overview

Heliolens is a distributed solar visualization system that processes NASA satellite imagery into daily time-lapse videos. Built with AI + Vibes, the architecture emphasizes parallel processing, fault tolerance, and global content delivery.

**Built by Vibes** | [www.builtbyvibes.com](https://www.builtbyvibes.com) | [@builtbyvibes](https://twitter.com/builtbyvibes)

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Data Sources                         │
├──────────────────────┬──────────────────────────────────────┤
│   SOHO/LASCO C2      │        SDO/AIA 171Å                  │
│   (Coronagraph)      │        (EUV Imager)                  │
└──────────┬───────────┴───────────────┬──────────────────────┘
           │                           │
           ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Helioviewer API                           │
│                 (takeScreenshot endpoint)                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Processing Pipeline                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Fetch   │→ │ Process  │→ │ Validate │→ │  Store   │   │
│  │ (8 par.) │  │ (4 par.) │  │ Quality  │  │  Frame   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Video Generation                          │
├─────────────────────────────────────────────────────────────┤
│   ┌────────────┐        ┌────────────┐                      │
│   │  Desktop   │        │   Mobile   │                      │
│   │ 1460×1200  │        │ 1080×1350  │                      │
│   └─────┬──────┘        └─────┬──────┘                      │
│         │                      │                             │
│         └──────────┬───────────┘                             │
│                    ▼                                         │
│              FFmpeg H.264                                    │
│             (CRF 8, veryslow)                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Content Delivery                            │
├─────────────────────────────────────────────────────────────┤
│   ┌──────────────┐              ┌──────────────┐           │
│   │  Cloudflare  │              │  Cloudflare  │           │
│   │    Stream    │              │     Pages    │           │
│   └──────┬───────┘              └──────┬───────┘           │
│          │                              │                    │
│          ▼                              ▼                    │
│    Video Hosting                  Static Website             │
│    (HLS/DASH)                    (HTML/JS/CSS)              │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Data Acquisition Layer

#### Helioviewer API Integration
- **Endpoint**: `https://api.helioviewer.org/v2/takeScreenshot`
- **Rate Limiting**: 8 concurrent requests max
- **Retry Logic**: ±15 minute fallback windows
- **Error Handling**: Exponential backoff with jitter

#### Source Configuration
```javascript
const SOURCES = {
  corona: {
    id: 4,           // SOHO/LASCO C2
    scale: 8,        // arcseconds/pixel
    size: 2048,      // output dimensions
    layer: '[SOHO,LASCO,C2,white-light,1,100]'
  },
  sunDisk: {
    id: 10,          // SDO/AIA 171
    scale: 2.5,      // arcseconds/pixel
    size: 1435,      // final composite size
    layer: '[SDO,AIA,171,1,100]'
  }
};
```

### 2. Processing Pipeline

#### Parallel Architecture
```javascript
// Fetch Stage - 8 concurrent workers
const fetchQueue = new PQueue({ concurrency: 8 });

// Process Stage - 4 concurrent workers  
const processQueue = new PQueue({ concurrency: 4 });

// Pipeline flow
fetchQueue.add(() => fetchFrame(date))
  .then(buffer => processQueue.add(() => processFrame(buffer)))
  .then(frame => validateAndStore(frame));
```

#### Image Processing Steps
1. **Color Grading**
   - Corona: Blue shift, reduce saturation (0.2), gamma 1.6 for dramatic contrast
   - Sun Disk: Gold shift, enhance saturation (1.4), brightness 1.2

2. **Feathering (Square or Circular)**
   - **Square Feathering** (current production):
     - Linear gradient on X and Y axes
     - 40px feather radius from 400px square boundary
     - Multiplicative blend for corner smoothing
   - **Circular Feathering** (alternative):
     - Radial gradient mask
     - 40px feather radius
     - Smooth transition at 400px radius
   - Both use Lanczos3 resampling for quality

3. **Compositing**
   - Screen blend mode for additive light effect
   - Sun disk size: 1435px (properly scaled)
   - Final crop: 1460×1200 with tuned offsets (230px left, 117px top)
   - Final JPEG compression (Q=95-100 with mozjpeg)

### 3. Quality Validation

#### Frame Metrics
```javascript
const validateFrame = (buffer) => {
  const metrics = {
    brightness: calculateBrightness(buffer),    // 0.3-0.7 range
    contrast: calculateContrast(buffer),        // > 0.2
    entropy: calculateEntropy(buffer),          // > 4.0
    size: buffer.length,                        // > 50KB
    checksum: crypto.createHash('md5').digest()
  };
  
  return metrics.brightness > 0.3 && 
         metrics.contrast > 0.2 &&
         metrics.entropy > 4.0;
};
```

#### Duplicate Detection
- MD5 checksums for each frame
- Skip identical consecutive frames
- Maintain frame continuity

### 4. Video Generation

#### FFmpeg Configuration
```bash
ffmpeg -framerate 24 \
  -i frames/frame_%05d.jpg \
  -c:v libx264 \
  -preset veryslow \
  -crf 8 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  output.mp4
```

#### Encoding Parameters
- **Codec**: H.264 (most compatible)
- **Preset**: veryslow (best compression)
- **CRF**: 8 (near-lossless quality)
- **Pixel Format**: yuv420p (compatibility)
- **Fast Start**: Enabled for streaming

### 5. Distribution Layer

#### Cloudflare Stream
- **Upload**: TUS protocol for resumable uploads
- **Formats**: HLS + DASH adaptive streaming
- **Thumbnails**: Automatic generation
- **Analytics**: View counts and engagement

#### Cloudflare Pages
- **Deployment**: Wrangler CLI
- **Edge Functions**: Not used (static only)
- **Caching**: Immutable assets, 1 year TTL
- **Security**: HTTPS only, HSTS enabled

## Performance Optimizations

### Memory Management
```javascript
// Stream processing for large files
const stream = sharp()
  .resize(1460, 1200)
  .jpeg({ quality: 98, mozjpeg: true });

// Garbage collection hints
if (global.gc) {
  setInterval(() => global.gc(), 30000);
}
```

### Concurrency Control
- **Fetch**: 8 parallel (API limit)
- **Process**: 4 parallel (CPU cores)
- **Memory**: 4GB heap limit
- **Backpressure**: Queue size limits

### Caching Strategy
- **Frames**: 15-minute in-memory cache
- **API Responses**: 5-minute cache
- **Processed Images**: Disk cache
- **Videos**: CDN edge cache

## Monitoring & Observability

### Metrics Collection
```javascript
const metrics = {
  framesProcessed: 0,
  framesPerMinute: 0,
  duplicatesDetected: 0,
  failedFetches: 0,
  retryAttempts: 0,
  averageQuality: 0,
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage()
};
```

### Health Checks
- **/health**: Basic liveness check
- **/ready**: Processing readiness
- **/metrics**: Prometheus format
- **/status**: Detailed status JSON

### Logging
```javascript
// Structured logging
const log = {
  timestamp: new Date().toISOString(),
  level: 'info',
  component: 'processor',
  message: 'Frame processed',
  metadata: {
    frame: frameNumber,
    quality: metrics.quality,
    duration: processingTime
  }
};
```

## Error Handling

### Retry Strategy
1. **Immediate Retry**: Network timeouts
2. **Fallback Windows**: ±15 minutes for missing data
3. **Exponential Backoff**: API rate limits
4. **Circuit Breaker**: Repeated failures

### Failure Modes
- **Partial Data**: Continue with available frames
- **API Outage**: Use cached data if available
- **Memory Pressure**: Reduce concurrency
- **Disk Full**: Clean old frames

## Security Considerations

### API Token Management
```javascript
// Never log tokens
const sanitizedConfig = {
  ...config,
  CLOUDFLARE_TOKEN: '***REDACTED***'
};

// Use environment variables
process.env.CLOUDFLARE_TOKEN
```

### Input Validation
- Sanitize date parameters
- Validate image dimensions
- Check file sizes
- Verify checksums

### Network Security
- HTTPS only for APIs
- TLS 1.2+ required
- Certificate pinning for critical APIs
- Rate limiting on endpoints

## Deployment Architecture

### Production Setup
```yaml
# PM2 Ecosystem File
module.exports = {
  apps: [{
    name: 'heliosphere',
    script: 'vps_production_optimized.js',
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
    time: true
  }]
};
```

### Infrastructure Requirements
- **CPU**: 4+ cores recommended
- **RAM**: 8GB minimum, 16GB optimal
- **Storage**: 100GB for frames/videos
- **Network**: 100Mbps+ bandwidth
- **OS**: Ubuntu 22.04 LTS

## Scalability Considerations

### Horizontal Scaling
- Stateless processing nodes
- Shared storage (S3/GCS)
- Queue-based work distribution
- Load balancer for API endpoints

### Vertical Scaling
- Increase worker concurrency
- Larger memory allocation
- NVMe storage for I/O
- GPU acceleration (future)

## Future Architecture Improvements

### Planned Enhancements
1. **Kubernetes Deployment**: Container orchestration
2. **Redis Queue**: Distributed job queue
3. **S3 Storage**: Object storage for frames
4. **GraphQL API**: Public data access
5. **WebAssembly**: Client-side processing
6. **ML Pipeline**: Anomaly detection

### Performance Goals
- < 2 hour full production run
- 50+ frames/minute processing
- 99.9% uptime availability
- < 100ms API response time

---

*Last Updated: January 2025*
*Version: 2.0.0*