#!/bin/bash

# Heliosphere Deployment Script
# Deploys the landing page to Cloudflare Pages

echo "🚀 Deploying Heliosphere to Cloudflare Pages..."

# Load Pages token from .env if it exists
if [ -f .env ]; then
    export $(grep CLOUDFLARE_PAGES_TOKEN .env | xargs)
fi

# Check if token is set
if [ -z "$CLOUDFLARE_PAGES_TOKEN" ]; then
    echo "❌ Error: CLOUDFLARE_PAGES_TOKEN not found in .env file"
    exit 1
fi

# Deploy to Cloudflare Pages
export CLOUDFLARE_API_TOKEN=$CLOUDFLARE_PAGES_TOKEN
npx wrangler pages deploy heliosphere-pages \
    --project-name heliosphere \
    --branch main \
    --commit-dirty=true

echo "✅ Deployment complete!"
echo "🌐 Visit: https://heliosphere.pages.dev"