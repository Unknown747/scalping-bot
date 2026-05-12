const path = require("path");
const fs = require("fs");

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const envFile = path.join(__dirname, "artifacts/api-server/.env");
const envVars = loadEnv(envFile);

module.exports = {
  apps: [
    {
      name: "scalper-api",
      script: path.join(__dirname, "artifacts/api-server/dist/index.mjs"),
      cwd: __dirname,
      interpreter: "node",
      interpreter_args: "--enable-source-maps --experimental-sqlite",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        ...envVars,
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
