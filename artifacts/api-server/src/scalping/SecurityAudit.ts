import { logger } from "../lib/logger.js";

export interface SecurityCheck {
  name: string;
  passed: boolean;
  severity: "critical" | "warning" | "info";
  message: string;
  fix?: string;
}

export interface SecurityAuditResult {
  safe: boolean;
  canRunLive: boolean;
  checks: SecurityCheck[];
  criticalFailures: string[];
  warnings: string[];
  auditedAt: string;
}

function checkPrivateKey(): SecurityCheck {
  const pk = process.env["PRIVATE_KEY"];
  if (!pk) {
    return {
      name: "PRIVATE_KEY",
      passed: false,
      severity: "critical",
      message: "PRIVATE_KEY tidak ditemukan di environment variables",
      fix: "Set PRIVATE_KEY di Replit Secrets. JANGAN masukkan ke dalam kode!",
    };
  }
  const cleaned = pk.startsWith("0x") ? pk.slice(2) : pk;
  if (!/^[a-fA-F0-9]{64}$/.test(cleaned)) {
    return {
      name: "PRIVATE_KEY",
      passed: false,
      severity: "critical",
      message: "PRIVATE_KEY format tidak valid (harus 32-byte hex, 64 karakter)",
      fix: "Pastikan private key adalah 64 karakter hex tanpa spasi",
    };
  }
  return {
    name: "PRIVATE_KEY",
    passed: true,
    severity: "critical",
    message: "PRIVATE_KEY tersedia dan format valid",
  };
}

function checkWalletAddress(): SecurityCheck {
  const addr = process.env["WALLET_ADDRESS"];
  if (!addr) {
    return {
      name: "WALLET_ADDRESS",
      passed: false,
      severity: "critical",
      message: "WALLET_ADDRESS tidak ditemukan di environment variables",
      fix: "Set WALLET_ADDRESS di Replit Secrets (format: 0x...)",
    };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    return {
      name: "WALLET_ADDRESS",
      passed: false,
      severity: "critical",
      message: "WALLET_ADDRESS format tidak valid (harus 0x + 40 karakter hex)",
      fix: "Pastikan wallet address dalam format EVM yang benar: 0x...",
    };
  }
  return {
    name: "WALLET_ADDRESS",
    passed: true,
    severity: "critical",
    message: `WALLET_ADDRESS valid: ${addr.slice(0, 6)}...${addr.slice(-4)}`,
  };
}

function checkSessionSecret(): SecurityCheck {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    return {
      name: "SESSION_SECRET",
      passed: false,
      severity: "critical",
      message: "SESSION_SECRET tidak diset — dashboard session tidak aman",
      fix: "Generate dengan: openssl rand -hex 32, lalu set di Replit Secrets",
    };
  }
  if (secret.length < 32) {
    return {
      name: "SESSION_SECRET",
      passed: false,
      severity: "critical",
      message: `SESSION_SECRET terlalu pendek (${secret.length} karakter, minimal 32)`,
      fix: "Generate secret baru: openssl rand -hex 32",
    };
  }
  const weak = ["changeme", "secret", "password", "scalper2024", "ganti_dengan"];
  if (weak.some((w) => secret.toLowerCase().includes(w))) {
    return {
      name: "SESSION_SECRET",
      passed: false,
      severity: "critical",
      message: "SESSION_SECRET menggunakan nilai default yang tidak aman",
      fix: "Generate secret acak: openssl rand -hex 32",
    };
  }
  return {
    name: "SESSION_SECRET",
    passed: true,
    severity: "critical",
    message: "SESSION_SECRET tersedia dan kuat",
  };
}

function checkDashboardPassword(): SecurityCheck {
  const pwd = process.env["DASHBOARD_PASSWORD"];
  if (!pwd) {
    return {
      name: "DASHBOARD_PASSWORD",
      passed: false,
      severity: "warning",
      message: "DASHBOARD_PASSWORD tidak diset — menggunakan password default 'scalper2024'",
      fix: "Set DASHBOARD_PASSWORD di Replit Secrets dengan password yang kuat",
    };
  }
  if (pwd === "scalper2024" || pwd.length < 8) {
    return {
      name: "DASHBOARD_PASSWORD",
      passed: false,
      severity: "warning",
      message: pwd === "scalper2024"
        ? "DASHBOARD_PASSWORD masih menggunakan nilai default"
        : `DASHBOARD_PASSWORD terlalu pendek (${pwd.length} karakter)`,
      fix: "Gunakan password minimal 12 karakter dengan kombinasi huruf, angka, dan simbol",
    };
  }
  return {
    name: "DASHBOARD_PASSWORD",
    passed: true,
    severity: "warning",
    message: "DASHBOARD_PASSWORD sudah dikustomisasi",
  };
}

function checkRpcUrl(): SecurityCheck {
  const rpc = process.env["BASE_RPC_URL"];
  if (!rpc) {
    return {
      name: "BASE_RPC_URL",
      passed: false,
      severity: "warning",
      message: "BASE_RPC_URL tidak diset — menggunakan public RPC yang lambat dan tidak reliable",
      fix: "Daftar Alchemy (gratis) di https://alchemy.com dan set BASE_RPC_URL",
    };
  }
  if (rpc.includes("YOUR_ALCHEMY_KEY") || rpc.includes("placeholder")) {
    return {
      name: "BASE_RPC_URL",
      passed: false,
      severity: "warning",
      message: "BASE_RPC_URL masih menggunakan nilai placeholder",
      fix: "Ganti dengan RPC URL yang valid dari Alchemy/Infura",
    };
  }
  return {
    name: "BASE_RPC_URL",
    passed: true,
    severity: "warning",
    message: "BASE_RPC_URL tersedia",
  };
}

function checkPrivateKeyNotInCode(): SecurityCheck {
  // This check verifies the private key isn't accidentally the same as common test keys
  const pk = process.env["PRIVATE_KEY"];
  if (!pk) {
    return {
      name: "PRIVATE_KEY_NOT_TESTKEY",
      passed: true,
      severity: "critical",
      message: "Private key check dilewati (tidak ada key)",
    };
  }
  const cleaned = pk.startsWith("0x") ? pk.slice(2) : pk;
  const knownTestKeys = [
    "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  ];
  if (knownTestKeys.includes(cleaned.toLowerCase())) {
    return {
      name: "PRIVATE_KEY_NOT_TESTKEY",
      passed: false,
      severity: "critical",
      message: "PRIVATE_KEY adalah test key yang terkenal — JANGAN gunakan di mainnet!",
      fix: "Ganti dengan private key wallet baru yang hanya Anda yang tahu",
    };
  }
  return {
    name: "PRIVATE_KEY_NOT_TESTKEY",
    passed: true,
    severity: "critical",
    message: "Private key bukan test key yang umum diketahui",
  };
}

function checkMevProtection(): SecurityCheck {
  const mev = process.env["MEV_PROTECTION_RPC"];
  if (!mev) {
    return {
      name: "MEV_PROTECTION_RPC",
      passed: false,
      severity: "info",
      message: "MEV protection tidak diaktifkan — rentan sandwich attack",
      fix: "Set MEV_PROTECTION_RPC=https://rpc.flashbots.net/fast untuk proteksi gratis",
    };
  }
  return {
    name: "MEV_PROTECTION_RPC",
    passed: true,
    severity: "info",
    message: "MEV protection aktif",
  };
}

export function runSecurityAudit(): SecurityAuditResult {
  const checks: SecurityCheck[] = [
    checkPrivateKey(),
    checkWalletAddress(),
    checkPrivateKeyNotInCode(),
    checkSessionSecret(),
    checkDashboardPassword(),
    checkRpcUrl(),
    checkMevProtection(),
  ];

  const criticalFailures = checks
    .filter((c) => !c.passed && c.severity === "critical")
    .map((c) => c.message);

  const warnings = checks
    .filter((c) => !c.passed && c.severity === "warning")
    .map((c) => c.message);

  const canRunLive = criticalFailures.length === 0;
  const safe = criticalFailures.length === 0 && warnings.length === 0;

  const result: SecurityAuditResult = {
    safe,
    canRunLive,
    checks,
    criticalFailures,
    warnings,
    auditedAt: new Date().toISOString(),
  };

  if (!canRunLive) {
    logger.error({ criticalFailures }, "SECURITY AUDIT FAILED — bot tidak dapat berjalan di live mode");
  } else if (warnings.length > 0) {
    logger.warn({ warnings }, "Security audit: ada peringatan yang perlu diperhatikan");
  } else {
    logger.info({}, "Security audit passed — semua check lolos");
  }

  return result;
}
