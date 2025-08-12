# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Start development server with scheduled task testing
npm run dev
# or
npm run start

# Deploy to Cloudflare Workers
npm run deploy

# Generate TypeScript types from Wrangler configuration
npm run cf-typegen
```

## Architecture Overview

This is a Cloudflare Workers application that fetches solar imagery from NASA's Helioviewer API. The application consists of two main components:

### 1. Worker (src/index.ts)
- **Main entry point** that handles both HTTP requests and scheduled cron jobs
- **CronContainer** - A Durable Object that manages containerized workloads with 5-minute sleep-after policy
- **Image fetching functions** - `fetchSdoImage()` and `fetchSohoImage()` fetch solar images from Helioviewer API
- **Scheduled handler** - Triggers every minute (cron: `* * * * *`), starts a container, and fetches images from it

### 2. Container Application (container_src/index.ts)
- **Standalone Node.js HTTP server** running in a Docker container on port 8080
- **Duplicated image fetching logic** for SDO and SOHO images
- **Container environment** - Receives NASA_API_KEY via environment variable
- **Docker setup** - Uses Node 18 Alpine base image, exposed on port 8080

### 3. Image Compositor Module (src/compositor.js)
- **Image processing** using `@carlsverre/wasm-vips` for WebAssembly-based image manipulation
- **Composite creation** - Centers a resized SDO image (512px width) over a SOHO coronagraph image
- **Output format** - Returns JPEG buffer of the composite image

## Configuration

- **wrangler.jsonc** - Main configuration for Cloudflare Workers deployment
  - Defines cron triggers, Durable Objects, containers, and environment variables
  - NASA_API_KEY is set to "DEMO_KEY" by default
- **TypeScript configuration** - Strict mode enabled, targets ES2021, no emit

## Key Dependencies

- `@cloudflare/containers` - For container management in Workers
- `wrangler` - Cloudflare Workers CLI and deployment tool
- `@carlsverre/wasm-vips` - WebAssembly image processing (compositor module)

## Important Notes

- The application uses Cloudflare's Container API to run Docker containers within Workers
- Both the Worker and Container have duplicate image fetching functions
- The compositor module is currently not integrated into the main workflow
- Default NASA API key is "DEMO_KEY" which has rate limits