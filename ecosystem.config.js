module.exports = {
  apps: [{
    name: 'heliolens-unified',
    script: './vps_production_unified.js',
    args: '--run',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '3G',
    node_args: '--expose-gc --max-old-space-size=3072',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    autorestart: true,
    max_restarts: 3,
    restart_delay: 60000,
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    kill_timeout: 30000,
    listen_timeout: 10000,
    cron_restart: '0 2 * * *'  // Restart daily at 2 AM
  }]
};