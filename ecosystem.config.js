module.exports = {
  apps: [
    {
      name: 'blutor-scheduler',
      cwd: '/home/ubuntu/blutor-scheduler',
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      max_memory_restart: '1500M',
      node_args: '--max-old-space-size=1280',
      kill_timeout: 60000,
      merge_logs: true,
      output: './logs/access.log',
      error: './logs/error.log',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
