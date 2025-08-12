# Heliosphere - Solar Composite Video System

A sophisticated system for generating cinematic solar composite images and time-lapse videos by combining NASA's SDO (Solar Dynamics Observatory) and SOHO (Solar and Heliospheric Observatory) data.

## 🌟 Features

- **Real-time Solar Compositing**: Combines SDO sun disk (171Å) with SOHO LASCO corona data
- **Cinematic Color Grading**: Ad Astra style for cosmic isolation aesthetic
- **Smart Fallback System**: Automatically finds nearest available data (SDO ±5min, LASCO ±15min)
- **Video-Ready Output**: 1440×1200px frames eliminate deadspace for clean video production
- **Intelligent Caching**: Performance optimization with metadata tracking
- **Time-lapse Capability**: Generate multi-hour solar evolution videos

## 🏗️ Architecture

### Dual Deployment System
- **Cloudflare Workers**: Production deployment with containerized workloads
- **Express Server**: Local development and video generation (current focus)

### Data Pipeline
```
NASA Helioviewer API → Image Fetch → Color Grading → Exposure Balance → Composite → Crop → Output
```

### Components
1. **SDO AIA 171Å**: Sun disk imagery (12-second cadence)
2. **SOHO LASCO C2**: Corona imagery (~30-minute intervals)  
3. **Sharp Image Processing**: WebAssembly-based composition and effects
4. **Fallback Logic**: Ensures continuous frame sequences for video

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm
- NASA API key (optional, defaults to DEMO_KEY)

### Installation
```bash
git clone <repository>
cd heliosphere
npm install
```

### Development
```bash
# Start development server
npm run dev
# or
npm start

# Build TypeScript
npm run build

# Deploy to Cloudflare (production)
npm run deploy
```

### Access Points
- **Tuner Interface**: `http://localhost:3002/tune`
- **Full-screen Display**: `http://localhost:3002/`
- **API Endpoint**: `http://localhost:3002/composite-image`

## 🎨 Current Configuration

### Finalized Settings
- **Style**: Ad Astra (cosmic isolation cinematic aesthetic)
- **Crop**: 1440×1200px (optimized for video, eliminates deadspace)
- **Composite**: 400px radius, 40px feather
- **Blend Mode**: Screen (optimized for solar data)
- **Color Profile**: Warm solar elements against cool cosmic backdrop

### Time Controls
- **Reference Point**: 48 hours ago (guaranteed data backfill)
- **Intervals**: 30-minute steps (48h → 48.5h → 49h → 49.5h → 50h)
- **Direction**: Backwards from reference point for video generation

## 🔧 API Documentation

### Primary Endpoint
```
GET /composite-image
```

### Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `style` | `ad-astra` | Color grading style |
| `cropWidth` | `1440` | Output width in pixels |
| `cropHeight` | `1200` | Output height in pixels |
| `compositeRadius` | `400` | Sun disk composite radius |
| `featherRadius` | `40` | Edge feathering radius |
| `date` | *current* | ISO timestamp for data |

### Response Headers
| Header | Description |
|--------|-------------|
| `X-SDO-Date` | Actual SDO timestamp used |
| `X-LASCO-Date` | Actual LASCO timestamp used |
| `X-Fallback-Used` | Whether fallback data was needed |
| `X-Cache` | Cache hit/miss status |

### Example Usage
```bash
# Generate current composite
curl "http://localhost:3002/composite-image" -o current.png

# Historical composite with specific timestamp
curl "http://localhost:3002/composite-image?date=2025-08-10T05:00:00.000Z" -o historical.png

# Video frame with optimized settings
curl "http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=2025-08-10T05:00:00.000Z" -o frame.png
```

## 🎬 Video Generation

### Specifications
- **Coverage**: 48 hours of solar activity
- **Interval**: 30 minutes between frames
- **Frame Count**: 96 frames total
- **Output**: 4-second video at 24fps
- **Direction**: Backwards from 48 hours ago

### Frame Generation Example
```javascript
const now = new Date();
const startTime = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48hrs ago

for (let i = 0; i < 96; i++) {
    const frameTime = new Date(startTime.getTime() - (i * 30 * 60 * 1000));
    const url = `http://localhost:3002/composite-image?style=ad-astra&cropWidth=1440&cropHeight=1200&date=${frameTime.toISOString()}`;
    // Download frame_${i:03d}.png
}
```

## 📊 Data Sources

### SDO (Solar Dynamics Observatory)
- **Instrument**: AIA (Atmospheric Imaging Assembly)
- **Wavelength**: 171 Ångström
- **Cadence**: 12 seconds
- **Coverage**: Sun disk and lower corona
- **Temperature**: ~600,000 Kelvin

### SOHO (Solar and Heliospheric Observatory)
- **Instrument**: LASCO C2 (Large Angle Spectrometric Coronagraph)
- **Coverage**: 1.5 to 6 solar radii
- **Cadence**: ~30 minutes (variable)
- **Type**: White light coronagraph

### Data Availability
- **Real-time**: Near real-time to few hours delay
- **Historical**: Excellent availability 48+ hours ago
- **Quality**: Higher quality for older data (complete processing)

## 🎨 Color Grading Styles

### Ad Astra (Default)
- **Sun Disk**: Warm cosmic isolation (255,200,120 tint)
- **Corona**: Cool space contrast (220,230,240 tint)
- **Philosophy**: Sophisticated warm-vs-cool cinematic aesthetic

### Other Available Styles
- **Sunshine**: Golden solar fire aesthetic
- **Natural**: Realistic solar colors
- **Sci-Fi**: Cool blue-white star appearance
- **Vintage**: Warm sepia/film stock look

## 🔧 Development

### Key Files
- `src/index.ts`: Main Express server and image processing
- `src/tuner.html`: Interactive parameter tuning interface
- `src/index.html`: Full-screen display interface
- `wrangler.jsonc`: Cloudflare Workers configuration
- `agents.md`: Guide for async agent collaboration

### Image Processing Pipeline
1. **Fetch**: Retrieve SDO and LASCO data from NASA Helioviewer API
2. **Fallback**: Search ±5min (SDO) or ±15min (LASCO) if exact timestamp missing
3. **Color Grade**: Apply cinematic color profiles to both images
4. **Balance**: Normalize exposure between corona and sun disk
5. **Feather**: Apply circular gradient mask to sun disk edges
6. **Composite**: Blend using screen mode for optimal solar visualization
7. **Crop**: Extract 1440×1200 center region, eliminating deadspace

### Caching Strategy
- **Key Format**: `{timestamp}_{radius}_{feather}_{style}_{cropW}_{cropH}`
- **Duration**: 3 days retention
- **Performance**: Significant speedup for repeated requests
- **Headers**: Cache hit/miss status in response

## 🛠️ Troubleshooting

### Common Issues
- **Server not responding**: Check `http://localhost:3002/tune` for health
- **Missing data**: Check `X-Fallback-Used` header, fallback may be needed
- **Slow responses**: First request for timestamp generates image, subsequent cached
- **File size variations**: Normal, depends on solar activity (1.6-1.7MB typical)

### Data Availability
- **Best reliability**: 48+ hours ago (guaranteed complete processing)
- **LASCO gaps**: Normal, system will find nearest available within ±15min
- **SDO availability**: Excellent due to 12-second cadence

### Quality Control
- **Frame uniqueness**: Verify different checksums for sequential frames
- **Metadata**: Check response headers for actual timestamps used
- **Fallback frequency**: Monitor for excessive fallback usage

## 📈 Performance

### Typical Metrics
- **Cold generation**: 10-15 seconds per frame
- **Cached response**: <100ms
- **Frame size**: ~1.6MB PNG
- **Memory usage**: Optimized for batch processing

### Optimization Tips
- Use historical data (48+ hours ago) for best availability
- Batch requests to benefit from caching
- Monitor fallback usage in headers
- Allow for network timeouts in automation

## 🔐 Security & Configuration

### Environment Variables
- `NASA_API_KEY`: NASA API key (defaults to DEMO_KEY)
- `PORT`: Server port (defaults to 3002)

### Rate Limiting
- NASA DEMO_KEY has usage limits
- Production should use registered NASA API key
- Built-in caching reduces API calls

## 📚 Additional Resources

### NASA Data Sources
- [Helioviewer API Documentation](https://api.helioviewer.org/docs/)
- [SDO Mission](https://sdo.gsfc.nasa.gov/)
- [SOHO Mission](https://soho.nascom.nasa.gov/)

### Technical Documentation
- `agents.md`: Detailed guide for video generation agents
- `CLAUDE.md`: Development context and commands
- `wrangler.jsonc`: Cloudflare Workers deployment configuration

## 🎯 Current Status

✅ **Production Ready**
- All components tested and optimized
- Video generation specifications finalized
- Data availability confirmed for 48+ hour ranges
- Frame uniqueness verified across time sequences
- Fallback logic ensures continuous frame sequences

🎬 **Ready for Video Generation**
- 30-minute intervals proven optimal for both data sources
- 1440×1200 crop eliminates deadspace perfectly
- Ad Astra color grading provides cinematic quality
- Metadata headers enable quality control and debugging

The system is optimized for generating high-quality solar time-lapse videos with reliable data sources and sophisticated visual processing.