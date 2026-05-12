const path = require("path");

module.exports = {
  apps: [
    {
      name: "scalper-api",
      script: path.join(__dirname, "artifacts/api-server/dist/index.mjs"),
      cwd: __dirname,
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      env_file: path.join(__dirname, "artifacts/api-server/.env"),
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 15,
      min_uptime: "10s",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
