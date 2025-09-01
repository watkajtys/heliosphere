#!/bin/bash

# Heliosphere Daily Production Cron Script
# Runs daily production with proper locking and timeout

SCRIPT_DIR="/opt/heliosphere"
LOCK_FILE="$SCRIPT_DIR/production.lock"
LOG_FILE="$SCRIPT_DIR/logs/daily_production.log"
STATE_FILE="$SCRIPT_DIR/production_state.json"
MAX_RUNTIME=21600  # 6 hours in seconds

# Ensure log directory exists
mkdir -p "$SCRIPT_DIR/logs"

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# Check if another instance is running
if [ -f "$LOCK_FILE" ]; then
    # Check if lock file is stale (older than MAX_RUNTIME)
    if [ "$(find "$LOCK_FILE" -mmin +360 2>/dev/null)" ]; then
        log "WARNING: Stale lock file detected, removing and continuing"
        rm -f "$LOCK_FILE"
    else
        log "Production already running, exiting"
        exit 0
    fi
fi

# Create lock file with PID
echo $$ > "$LOCK_FILE"

# Cleanup function
cleanup() {
    rm -f "$LOCK_FILE"
    log "Production ended (PID: $$)"
}

# Set trap to cleanup on exit
trap cleanup EXIT

log "=========================================="
log "Starting Heliosphere daily production (PID: $$)"
log "=========================================="

# Load environment variables if .env exists
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -E '^CLOUDFLARE_API_TOKEN=' "$SCRIPT_DIR/.env" | xargs)
fi

# Run the production script with timeout
timeout $MAX_RUNTIME /usr/bin/node --max-old-space-size=3072 "$SCRIPT_DIR/vps_daily_simple.js" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
    log "ERROR: Production timed out after $MAX_RUNTIME seconds"
    
    # Mark state as error
    if [ -f "$STATE_FILE" ]; then
        # Update status in state file
        node -e "
        const fs = require('fs');
        const state = JSON.parse(fs.readFileSync('$STATE_FILE', 'utf8'));
        state.status = 'timeout';
        state.lastError = 'Production timed out after 6 hours';
        fs.writeFileSync('$STATE_FILE', JSON.stringify(state, null, 2));
        " 2>/dev/null || log "Failed to update state file"
    fi
    
    exit 1
elif [ $EXIT_CODE -ne 0 ]; then
    log "ERROR: Production failed with exit code $EXIT_CODE"
    exit $EXIT_CODE
else
    log "SUCCESS: Production completed successfully"
    
    # Clean up old frames (older than 60 days)
    log "Cleaning up old frames..."
    find "$SCRIPT_DIR/frames" -type d -mtime +60 -exec rm -rf {} + 2>/dev/null
    
    # Rotate logs if they get too big (keep last 1MB)
    if [ -f "$LOG_FILE" ] && [ $(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null) -gt 1048576 ]; then
        tail -c 1048576 "$LOG_FILE" > "$LOG_FILE.tmp"
        mv "$LOG_FILE.tmp" "$LOG_FILE"
        log "Log file rotated"
    fi
fi

exit 0