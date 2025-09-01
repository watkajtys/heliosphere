#!/bin/bash

echo "╔════════════════════════════════════════╗"
echo "║   Lossless MJPEG Video Generation     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Create sorted frame list
echo "Creating frame list..."
find /opt/heliosphere/frames -name '*.jpg' -type f | sort | sed "s|^|file '|; s|$|'|" > /tmp/full_frames.txt
FRAME_COUNT=$(wc -l < /tmp/full_frames.txt)
echo "Found $FRAME_COUNT frames"

# Generate lossless MJPEG video (just copying JPEG frames into container)
echo ""
echo "🎬 Generating FULL video (lossless MJPEG)..."
ffmpeg -y -r 24 -f concat -safe 0 -i /tmp/full_frames.txt \
  -c:v copy \
  -f mp4 \
  /opt/heliosphere/videos/heliosphere_full_mjpeg_$(date +%Y-%m-%d).mp4

# For social (square crop) - we need to re-encode but can use lossless H.264
echo ""
echo "🎬 Generating SOCIAL video (1200x1200 square)..."
# Get last 30 days of frames
SOCIAL_START=$(date -d "30 days ago" +%Y-%m-%d)
find /opt/heliosphere/frames -name '*.jpg' -type f | sort | awk -F/ '{if ($4 >= "'$SOCIAL_START'") print}' | sed "s|^|file '|; s|$|'|" > /tmp/social_frames.txt
SOCIAL_COUNT=$(wc -l < /tmp/social_frames.txt)
echo "Using $SOCIAL_COUNT frames (last 30 days)"

ffmpeg -y -r 24 -f concat -safe 0 -i /tmp/social_frames.txt \
  -vf "crop=1200:1200:130:0" \
  -c:v libx264 -preset ultrafast -qp 0 \
  /opt/heliosphere/videos/heliosphere_social_lossless_$(date +%Y-%m-%d).mp4

# For portrait - also needs crop
echo ""
echo "🎬 Generating PORTRAIT video (900x1200)..."
ffmpeg -y -r 24 -f concat -safe 0 -i /tmp/full_frames.txt \
  -vf "crop=900:1200:280:0" \
  -c:v libx264 -preset ultrafast -qp 0 \
  /opt/heliosphere/videos/heliosphere_portrait_lossless_$(date +%Y-%m-%d).mp4

echo ""
echo "✅ Done! Generated videos:"
ls -lah /opt/heliosphere/videos/*$(date +%Y-%m-%d)*.mp4