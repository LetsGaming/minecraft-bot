/**
 * PM2 Ecosystem Configuration for the Minecraft Discord Bot.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 restart minecraft-bot
 *   pm2 logs minecraft-bot
 *   pm2 monit
 *
 * The bot compiles TypeScript to dist/ before starting.
 * PM2 watches for changes in the source and auto-restarts.
 */
module.exports = {
  apps: [
    {
      name: 'minecraft-bot',
      script: './dist/index.js',
      cwd: __dirname,

      // ── Node configuration ──
      node_args: '--enable-source-maps',
      interpreter: 'node',

      // ── Process management ──
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // ── Logging ──
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_type: 'json',

      // ── File watching (development convenience, disable in prod) ──
      watch: false,
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        'dist',
        '.git',
      ],

      // ── Resource limits ──
      max_memory_restart: '512M',

      // ── Environment variables ──
      env: {
        NODE_ENV: 'development',
        DEBUG: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        DEBUG: '',
      },
    },
  ],
};
