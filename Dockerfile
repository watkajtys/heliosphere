# Production Dockerfile for Heliosphere
FROM node:20-slim

# Install FFmpeg for video generation and curl for API calls
RUN apt-get update && \
    apt-get install -y ffmpeg curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application files
COPY cloud_server.js ./
COPY cloud_monitor.html ./
COPY gcs_storage.js ./

# Create temp directory for video processing
RUN mkdir -p /tmp/frames

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Expose port
EXPOSE 8080

# Run the application
CMD ["node", "cloud_server.js"]