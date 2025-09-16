#!/bin/bash

# Load environment variables
export $(grep -v '^#' /opt/heliosphere/.env | xargs)

# Check which token is being used
echo "Using API Token: ${CLOUDFLARE_API_TOKEN:0:10}..."

# Upload videos
cd /opt/heliosphere

# Upload full video
echo "Uploading full video..."
node cloudflare_tus_upload.js /opt/heliosphere/videos/heliosphere_full_2025-09-15.mp4 full

# Upload social video
echo "Uploading social video..."
node cloudflare_tus_upload.js /opt/heliosphere/videos/heliosphere_social_2025-09-15.mp4 social