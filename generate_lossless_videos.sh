#!/bin/bash

echo "Generating lossless MJPEG videos..."

# Create frame list
find /opt/heliosphere/frames -name '*.jpg' -type f | sort > /tmp/all_frames.txt

# Option 1: MJPEG in MOV container (Apple ProRes style - very compatible)
echo "Creating MJPEG MOV (lossless)..."
cat /tmp/all_frames.txt | xargs cat | ffmpeg -y \
  -f image2pipe -framerate 24 -i - \
  -c:v copy \
  -f mov \
  /opt/heliosphere/videos/heliosphere_full_lossless.mov

# Option 2: MJPEG in AVI container (widely compatible)
echo "Creating MJPEG AVI (lossless)..."
ffmpeg -y -r 24 -f concat -safe 0 -i /tmp/full_frames.txt \
  -c:v copy \
  /opt/heliosphere/videos/heliosphere_full_lossless.avi

# Option 3: MJPEG in MKV container (modern, flexible)
echo "Creating MJPEG MKV (lossless)..."
ffmpeg -y -r 24 -f concat -safe 0 -i /tmp/full_frames.txt \
  -c:v copy \
  /opt/heliosphere/videos/heliosphere_full_lossless.mkv

# Check sizes
echo -e "\nFile sizes:"
ls -lah /opt/heliosphere/videos/*lossless*