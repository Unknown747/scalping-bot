import { Router } from "express";

const router = Router();

interface SecretStatus {
  key: string;
  label: string;
  set: boolean;
  required: boolean;
  note?: string;
  maskedValue?: string;
}

function mask(val: string | undefined): string | undefined {
  if (!val) return undefined;
  if (val.length <= 8) return "●●●●●●●●";
  return val.slice(0, 4) + "●●●●●●●●" + val.slice(-4);
}

router.get("/secrets-status", (_req, res) => {
  const secrets: SecretStatus[] = [
    {
      key: "PRIVATE_KEY",
      label: "Wallet Private Key",
      set: !!process.env["PRIVATE_KEY"],
      required: true,
      note: "Kunci privat wallet Base Network untuk live trading",
      maskedValue: mask(process.env["PRIVATE_KEY"]),
    },
    {
      key: "WALLET_ADDRESS",
      label: "Wallet Address",
      set: !!process.env["WALLET_ADDRESS"],
      required: true,
      note: "Alamat wallet 0x... di Base Network",
      maskedValue: process.env["WALLET_ADDRESS"]
        ? process.env["WALLET_ADDRESS"].slice(0, 6) + "..." + process.env["WALLET_ADDRESS"].slice(-4)
        : undefined,
    },
    {
      key: "BASE_RPC_URL",
      label: "Base RPC URL",
      set: !!process.env["BASE_RPC_URL"],
      required: false,
      note: process.env["BASE_RPC_URL"]
        ? "Custom RPC configured"
        : "Menggunakan public RPC (mainnet.base.org) — lambat, gunakan Alchemy/Infura untuk produksi",
      maskedValue: process.env["BASE_RPC_URL"]
        ? process.env["BASE_RPC_URL"].replace(/\/[a-zA-Z0-9]{20,}/, "/●●●●●●●●")
        : undefined,
    },
    {
      key: "MEV_PROTECTION_RPC",
      label: "MEV Protection RPC",
      set: !!process.env["MEV_PROTECTION_RPC"],
      required: false,
      note: "Opsional: Flashbots Protect atau Beaverbuild untuk anti-sandwich",
      maskedValue: process.env["MEV_PROTECTION_RPC"]
        ? process.env["MEV_PROTECTION_RPC"].replace(/\/[a-zA-Z0-9]{20,}/, "/●●●●●●●●")
        : undefined,
    },
    {
      key: "SESSION_SECRET",
      label: "Session Secret",
      set: !!process.env["SESSION_SECRET"],
      required: true,
      note: "String acak panjang untuk enkripsi session. Wajib diset.",
    },
    {
      key: "DASHBOARD_PASSWORD",
      label: "Dashboard Password",
      set: !!process.env["DASHBOARD_PASSWORD"],
      required: false,
      note: process.env["DASHBOARD_PASSWORD"]
        ? "Password sudah dikustomisasi"
        : "⚠ Menggunakan password default 'scalper2024' — GANTI sebelum deploy ke VPS!",
    },
    // ── AI Provider Keys (opsional, min 1 untuk AI Filter aktif) ─────────────
    {
      key: "AI_INTEGRATIONS_GEMINI_API_KEY",
      label: "Gemini AI Key (Google)",
      set: !!process.env["AI_INTEGRATIONS_GEMINI_API_KEY"],
      required: false,
      note: process.env["AI_INTEGRATIONS_GEMINI_API_KEY"]
        ? "Gemini aktif — slot 1 rotasi AI"
        : "Opsional. Gratis di https://aistudio.google.com/app/apikey",
    },
    {
      key: "GROQ_API_KEY",
      label: "Groq API Key",
      set: !!process.env["GROQ_API_KEY"],
      required: false,
      note: process.env["GROQ_API_KEY"]
        ? "Groq aktif — slot 2 rotasi AI (ultra-fast)"
        : "Opsional. Gratis di https://console.groq.com/keys",
    },
    {
      key: "HUGGINGFACE_API_KEY",
      label: "HuggingFace API Key",
      set: !!process.env["HUGGINGFACE_API_KEY"],
      required: false,
      note: process.env["HUGGINGFACE_API_KEY"]
        ? "HuggingFace aktif — slot 3 rotasi AI"
        : "Opsional. Gratis di https://huggingface.co/settings/tokens",
    },
  ];

  const allRequired = secrets.filter((s) => s.required);
  const missingRequired = allRequired.filter((s) => !s.set);

  // AI: at least 1 provider configured is recommended (not required)
  const aiProviderCount = [
    process.env["AI_INTEGRATIONS_GEMINI_API_KEY"],
    process.env["GROQ_API_KEY"],
    process.env["HUGGINGFACE_API_KEY"],
  ].filter(Boolean).length;

  res.json({
    secrets,
    summary: {
      total: secrets.length,
      set: secrets.filter((s) => s.set).length,
      missingRequired: missingRequired.map((s) => s.key),
      readyForLive: missingRequired.length === 0,
      aiProvidersConfigured: aiProviderCount,
    },
  });
});

export default router;
