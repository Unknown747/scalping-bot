import { logger } from "../lib/logger.js";

export interface AIAnalysisInput {
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  volume5mUsd: number;
  liquidityUsd: number;
  ageMinutes: number;
  buySellRatio5m: number;
  safetyScore: number;
  memeScore: number;
}

export interface AIAnalysisResult {
  decision: "buy" | "skip";
  confidence: number;
  reasons: string[];
  model: string;
  provider: string;
  latencyMs: number;
}

// ─── Shared Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert meme coin scalping analyst for the Base blockchain network.
Your job is to analyze newly listed / early meme token data and decide if it's worth entering a very short scalp trade.
IMPORTANT CONTEXT: These are new meme coins — extremely high risk, 80% fail. Only buy if multiple strong bullish signals align.
Respond ONLY with valid JSON:
{
  "decision": "buy" | "skip",
  "confidence": <integer 0-100>,
  "reasons": ["reason1", "reason2", "reason3"]
}
Rules:
- "buy" only if confidence >= 65 AND buy pressure strong AND liquidity healthy
- "skip" if any red flag (honeypot risk, weak volume, sell pressure, age > 30min)
- NEW LISTING BONUS: age < 10min with strong momentum = +15 confidence
- 2-4 concise reasons max`;

function buildPrompt(data: AIAnalysisInput): string {
  const ageTag = data.ageMinutes < 5
    ? "BRAND NEW (<5min)"
    : data.ageMinutes < 15
    ? "Very Fresh (<15min)"
    : data.ageMinutes < 30
    ? "New (<30min)"
    : `Older (${data.ageMinutes.toFixed(0)}min)`;

  return `Analyze Base meme coin for scalp (position: small, target +5-25% in <10min):

Token: ${data.symbol} (${data.name})  [${ageTag}]
Price: $${data.priceUsd.toFixed(8)}
5m Change: ${data.priceChange5m > 0 ? "+" : ""}${data.priceChange5m.toFixed(1)}%
1h Change: ${data.priceChange1h > 0 ? "+" : ""}${data.priceChange1h.toFixed(1)}%
5m Volume: $${data.volume5mUsd.toFixed(0)}
Liquidity: $${data.liquidityUsd.toFixed(0)}
Vol/Liq ratio: ${data.liquidityUsd > 0 ? (data.volume5mUsd / data.liquidityUsd).toFixed(2) : "N/A"}
Buy/Sell Ratio (5m): ${data.buySellRatio5m.toFixed(2)}x
Safety Score: ${data.safetyScore}/100
Meme Score: ${data.memeScore}/100

JSON only:`;
}

// ─── Provider: Gemini (Google AI Studio) ─────────────────────────────────────
// Free tier: 1500 req/day, 15 req/min
// Get key: https://aistudio.google.com/app/apikey

async function analyzeWithGemini(data: AIAnalysisInput): Promise<AIAnalysisResult> {
  const start = Date.now();
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"] || "https://generativelanguage.googleapis.com";

  if (!apiKey) throw new Error("GEMINI: AI_INTEGRATIONS_GEMINI_API_KEY not set");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl } });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + buildPrompt(data) }] }],
    config: { maxOutputTokens: 300, responseMimeType: "application/json" },
  });

  const raw = response.text ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  return {
    decision: parsed.decision === "buy" ? "buy" : "skip",
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
    model: "gemini-2.5-flash",
    provider: "Gemini",
    latencyMs: Date.now() - start,
  };
}

// ─── Provider: Groq (native API) ─────────────────────────────────────────────
// Free tier: generous RPM/RPD limits, ultra-fast inference
// Get key: https://console.groq.com/keys

async function analyzeWithGroq(data: AIAnalysisInput): Promise<AIAnalysisResult> {
  const start = Date.now();
  const apiKey = process.env["GROQ_API_KEY"];

  if (!apiKey) throw new Error("GROQ: GROQ_API_KEY not set");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: "https://api.groq.com/openai/v1",
    apiKey,
  });

  const response = await client.chat.completions.create({
    model: "llama-3.1-8b-instant",
    max_tokens: 300,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(data) },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  return {
    decision: parsed.decision === "buy" ? "buy" : "skip",
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
    model: "llama-3.1-8b-instant",
    provider: "Groq",
    latencyMs: Date.now() - start,
  };
}

// ─── Provider: HuggingFace Inference API ─────────────────────────────────────
// Free tier: rate-limited, no credit card needed
// Get key: https://huggingface.co/settings/tokens
// OpenAI-compatible v1 endpoint: https://api-inference.huggingface.co/v1

async function analyzeWithHuggingFace(data: AIAnalysisInput): Promise<AIAnalysisResult> {
  const start = Date.now();
  const apiKey = process.env["HUGGINGFACE_API_KEY"];

  if (!apiKey) throw new Error("HUGGINGFACE: HUGGINGFACE_API_KEY not set");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    baseURL: "https://api-inference.huggingface.co/v1",
    apiKey,
  });

  const response = await client.chat.completions.create({
    model: "Qwen/Qwen2.5-7B-Instruct",
    max_tokens: 300,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(data) },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  return {
    decision: parsed.decision === "buy" ? "buy" : "skip",
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
    model: "Qwen2.5-7B-Instruct",
    provider: "HuggingFace",
    latencyMs: Date.now() - start,
  };
}

// ─── Provider Roster ─────────────────────────────────────────────────────────

interface ProviderEntry {
  name: string;
  label: string;
  envKey: string;
  fn: (data: AIAnalysisInput) => Promise<AIAnalysisResult>;
}

function buildAvailableRoster(): ProviderEntry[] {
  const all: ProviderEntry[] = [
    {
      name: "Gemini",
      label: "Google Gemini 2.5 Flash",
      envKey: "AI_INTEGRATIONS_GEMINI_API_KEY",
      fn: analyzeWithGemini,
    },
    {
      name: "Groq",
      label: "Groq / Llama 3.1-8b",
      envKey: "GROQ_API_KEY",
      fn: analyzeWithGroq,
    },
    {
      name: "HuggingFace",
      label: "HuggingFace / Qwen2.5-7B",
      envKey: "HUGGINGFACE_API_KEY",
      fn: analyzeWithHuggingFace,
    },
  ];

  // Only include providers that are configured
  return all.filter((p) => !!process.env[p.envKey]);
}

// ─── AIAnalyzer Class ────────────────────────────────────────────────────────

export class AIAnalyzer {
  private enabled: boolean;
  private minConfidence: number;
  private primaryProvider: "gemini" | "groq" | "huggingface";

  // Cache: avoid re-calling AI for same token in same 90s window
  private cache = new Map<string, { result: AIAnalysisResult; ts: number }>();
  private readonly CACHE_TTL = 90_000; // 90 seconds

  // Strict round-robin index — advances by 1 on every SUCCESSFUL call
  // This ensures each provider handles exactly 1/N of all analyses
  private rotationIndex = 0;

  // Per-provider failure tracking for smart cooldown
  private providerFailures = new Map<string, { count: number; lastFail: number }>();
  private readonly PROVIDER_COOLDOWN_MS = 120_000; // 2 min cooldown after 3 failures

  constructor(
    enabled: boolean,
    minConfidence: number,
    primaryProvider: "gemini" | "groq" | "huggingface" = "gemini"
  ) {
    this.enabled = enabled;
    this.minConfidence = minConfidence;
    this.primaryProvider = primaryProvider;
  }

  updateSettings(
    enabled: boolean,
    minConfidence: number,
    primaryProvider?: "gemini" | "groq" | "huggingface"
  ) {
    this.enabled = enabled;
    this.minConfidence = minConfidence;
    if (primaryProvider) this.primaryProvider = primaryProvider;
  }

  private isProviderHealthy(name: string): boolean {
    const f = this.providerFailures.get(name);
    if (!f) return true;
    if (f.count >= 3 && Date.now() - f.lastFail < this.PROVIDER_COOLDOWN_MS) return false;
    // Reset failures if cooldown has passed
    if (Date.now() - f.lastFail >= this.PROVIDER_COOLDOWN_MS) {
      this.providerFailures.delete(name);
      return true;
    }
    return true;
  }

  private recordProviderFailure(name: string) {
    const f = this.providerFailures.get(name) ?? { count: 0, lastFail: 0 };
    f.count++;
    f.lastFail = Date.now();
    this.providerFailures.set(name, f);
  }

  private recordProviderSuccess(name: string) {
    this.providerFailures.delete(name);
  }

  async analyze(data: AIAnalysisInput): Promise<AIAnalysisResult | null> {
    if (!this.enabled) return null;

    // Cache per token per 90s window
    const cacheKey = `${data.symbol}-${Math.floor(Date.now() / this.CACHE_TTL)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      logger.debug({ symbol: data.symbol, provider: cached.result.provider }, "AI cache hit");
      return cached.result;
    }

    const roster = buildAvailableRoster();

    if (roster.length === 0) {
      logger.warn({}, "No AI providers configured — set at least one of: AI_INTEGRATIONS_GEMINI_API_KEY, GROQ_API_KEY, HUGGINGFACE_API_KEY");
      return null;
    }

    // Round-robin: start at current rotation index
    // Each provider gets ~1/N of all token analyses
    const startIndex = this.rotationIndex % roster.length;

    for (let attempt = 0; attempt < roster.length; attempt++) {
      const idx = (startIndex + attempt) % roster.length;
      const provider = roster[idx];

      if (!this.isProviderHealthy(provider.name)) {
        logger.debug({ provider: provider.name }, "AI provider on cooldown, trying next");
        continue;
      }

      try {
        const result = await provider.fn(data);

        // Advance rotation index on success — next token goes to next provider
        this.rotationIndex = (idx + 1) % roster.length;
        this.recordProviderSuccess(provider.name);

        this.cache.set(cacheKey, { result, ts: Date.now() });
        logger.info(
          {
            symbol: data.symbol,
            provider: provider.name,
            decision: result.decision,
            confidence: result.confidence,
            latencyMs: result.latencyMs,
          },
          "AI analysis complete"
        );
        return result;
      } catch (err: any) {
        this.recordProviderFailure(provider.name);
        logger.warn(
          { provider: provider.name, err: err?.message },
          "AI provider failed, rotating to next"
        );
      }
    }

    logger.warn({ symbol: data.symbol }, "All AI providers failed — skipping AI filter");
    return null;
  }

  shouldBuy(result: AIAnalysisResult | null): boolean {
    if (!result) return true; // fail-open: if no AI result, don't block trade
    return result.decision === "buy" && result.confidence >= this.minConfidence;
  }

  // Returns status of all 3 providers for dashboard display
  getProviderStatus(): Array<{
    name: string;
    label: string;
    configured: boolean;
    healthy: boolean;
    failures: number;
    rotationSlot: number | null;
  }> {
    const roster = buildAvailableRoster();
    const allProviders: ProviderEntry[] = [
      { name: "Gemini",      label: "Google Gemini 2.5 Flash",  envKey: "AI_INTEGRATIONS_GEMINI_API_KEY", fn: analyzeWithGemini },
      { name: "Groq",        label: "Groq / Llama 3.1-8b",      envKey: "GROQ_API_KEY",                  fn: analyzeWithGroq },
      { name: "HuggingFace", label: "HuggingFace / Qwen2.5-7B", envKey: "HUGGINGFACE_API_KEY",           fn: analyzeWithHuggingFace },
    ];

    return allProviders.map((p) => {
      const configured = !!process.env[p.envKey];
      const f = this.providerFailures.get(p.name);
      const slotIndex = roster.findIndex((r) => r.name === p.name);
      return {
        name: p.name,
        label: p.label,
        configured,
        healthy: configured ? this.isProviderHealthy(p.name) : false,
        failures: f?.count ?? 0,
        rotationSlot: slotIndex >= 0 ? slotIndex : null,
      };
    });
  }
}
