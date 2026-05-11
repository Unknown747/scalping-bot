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

// ─── Prompt ─────────────────────────────────────────────────────────────────

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
    ? "🆕 BRAND NEW (<5min)"
    : data.ageMinutes < 15
    ? "🆕 Very Fresh (<15min)"
    : data.ageMinutes < 30
    ? "New (<30min)"
    : `Older (${data.ageMinutes.toFixed(0)}min)`;

  return `Analyze Base meme coin for scalp (position: small, target +5-25% in <10min):

Token: ${data.symbol} (${data.name})  ${ageTag}
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

// ─── Provider Functions ──────────────────────────────────────────────────────

async function analyzeWithGemini(data: AIAnalysisInput, model = "gemini-2.5-flash"): Promise<AIAnalysisResult> {
  const start = Date.now();
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];

  if (!baseUrl || !apiKey) throw new Error("Gemini not configured");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl } });

  const response = await ai.models.generateContent({
    model,
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
    model,
    provider: `Gemini/${model}`,
    latencyMs: Date.now() - start,
  };
}

async function analyzeWithOpenRouter(
  data: AIAnalysisInput,
  model: string,
  providerName: string
): Promise<AIAnalysisResult> {
  const start = Date.now();
  const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] || "https://openrouter.ai/api/v1";
  const apiKey = process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];

  if (!apiKey) throw new Error("OpenRouter not configured");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  const response = await client.chat.completions.create({
    model,
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
    model,
    provider: providerName,
    latencyMs: Date.now() - start,
  };
}

// ─── Provider Roster (round-robin) ──────────────────────────────────────────
// Each entry: { name, fn }
// Gemini models + OpenRouter models — rotated to spread load across all

interface ProviderEntry {
  name: string;
  fn: (data: AIAnalysisInput) => Promise<AIAnalysisResult>;
  requiresGemini: boolean;
  requiresOpenRouter: boolean;
}

function buildProviderRoster(): ProviderEntry[] {
  return [
    {
      name: "Gemini-2.5-Flash",
      fn: (d) => analyzeWithGemini(d, "gemini-2.5-flash"),
      requiresGemini: true,
      requiresOpenRouter: false,
    },
    {
      name: "OR-Llama3.1-8b",
      fn: (d) => analyzeWithOpenRouter(d, "meta-llama/llama-3.1-8b-instruct:free", "Llama3.1/OR"),
      requiresGemini: false,
      requiresOpenRouter: true,
    },
    {
      name: "Gemini-2.0-Flash",
      fn: (d) => analyzeWithGemini(d, "gemini-2.0-flash"),
      requiresGemini: true,
      requiresOpenRouter: false,
    },
    {
      name: "OR-Mistral-7b",
      fn: (d) => analyzeWithOpenRouter(d, "mistralai/mistral-7b-instruct:free", "Mistral7b/OR"),
      requiresGemini: false,
      requiresOpenRouter: true,
    },
    {
      name: "OR-Qwen2.5-7b",
      fn: (d) => analyzeWithOpenRouter(d, "qwen/qwen-2.5-7b-instruct:free", "Qwen2.5/OR"),
      requiresGemini: false,
      requiresOpenRouter: true,
    },
    {
      name: "OR-DeepSeek-8b",
      fn: (d) => analyzeWithOpenRouter(d, "deepseek/deepseek-r1-distill-llama-8b:free", "DeepSeek/OR"),
      requiresGemini: false,
      requiresOpenRouter: true,
    },
    {
      name: "OR-Llama3.2-3b",
      fn: (d) => analyzeWithOpenRouter(d, "meta-llama/llama-3.2-3b-instruct:free", "Llama3.2/OR"),
      requiresGemini: false,
      requiresOpenRouter: true,
    },
  ];
}

// ─── AIAnalyzer Class ────────────────────────────────────────────────────────

export class AIAnalyzer {
  private enabled: boolean;
  private minConfidence: number;
  private primaryProvider: "gemini" | "groq" | "huggingface";

  // Cache: avoid re-calling AI for same token in same minute
  private cache = new Map<string, { result: AIAnalysisResult; ts: number }>();
  private readonly CACHE_TTL = 90_000; // 90 seconds

  // Round-robin index — persists across analyze() calls
  private rotationIndex = 0;

  // Per-provider failure tracking for smart skip
  private providerFailures = new Map<string, { count: number; lastFail: number }>();
  private readonly PROVIDER_COOLDOWN_MS = 120_000; // 2 min cooldown after 2 failures

  constructor(enabled: boolean, minConfidence: number, primaryProvider: "gemini" | "groq" | "huggingface" = "gemini") {
    this.enabled = enabled;
    this.minConfidence = minConfidence;
    this.primaryProvider = primaryProvider;
  }

  updateSettings(enabled: boolean, minConfidence: number, primaryProvider?: "gemini" | "groq" | "huggingface") {
    this.enabled = enabled;
    this.minConfidence = minConfidence;
    if (primaryProvider) this.primaryProvider = primaryProvider;
  }

  private isProviderHealthy(name: string): boolean {
    const f = this.providerFailures.get(name);
    if (!f) return true;
    if (f.count >= 2 && Date.now() - f.lastFail < this.PROVIDER_COOLDOWN_MS) return false;
    return true;
  }

  private recordProviderFailure(name: string) {
    const f = this.providerFailures.get(name) ?? { count: 0, lastFail: 0 };
    f.count++;
    f.lastFail = Date.now();
    this.providerFailures.set(name, f);
  }

  private recordProviderSuccess(name: string) {
    this.providerFailures.set(name, { count: 0, lastFail: 0 });
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

    const hasGemini = !!(process.env["AI_INTEGRATIONS_GEMINI_API_KEY"]);
    const hasOpenRouter = !!(process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"]);

    const roster = buildProviderRoster().filter((p) => {
      if (p.requiresGemini && !hasGemini) return false;
      if (p.requiresOpenRouter && !hasOpenRouter) return false;
      return true;
    });

    if (roster.length === 0) {
      logger.warn({}, "No AI providers configured");
      return null;
    }

    // Try starting at current rotation index, try up to roster.length providers
    const startIndex = this.rotationIndex % roster.length;

    for (let attempt = 0; attempt < roster.length; attempt++) {
      const idx = (startIndex + attempt) % roster.length;
      const provider = roster[idx];

      if (!this.isProviderHealthy(provider.name)) {
        logger.debug({ provider: provider.name }, "AI provider cooling down, skipping");
        continue;
      }

      try {
        const result = await provider.fn(data);

        // Advance rotation only on success
        this.rotationIndex = (idx + 1) % roster.length;
        this.recordProviderSuccess(provider.name);

        this.cache.set(cacheKey, { result, ts: Date.now() });
        logger.info(
          { symbol: data.symbol, provider: provider.name, decision: result.decision, confidence: result.confidence, latencyMs: result.latencyMs },
          "AI analysis complete"
        );
        return result;
      } catch (err: any) {
        this.recordProviderFailure(provider.name);
        logger.warn({ provider: provider.name, err: err?.message }, "AI provider failed, rotating to next");
      }
    }

    logger.warn({ symbol: data.symbol }, "All AI providers failed — skipping AI filter for this token");
    return null;
  }

  shouldBuy(result: AIAnalysisResult | null): boolean {
    if (!result) return true; // If no AI result, don't block (fail-open)
    return result.decision === "buy" && result.confidence >= this.minConfidence;
  }

  getProviderStatus(): Array<{ name: string; healthy: boolean; failures: number }> {
    const roster = buildProviderRoster();
    return roster.map((p) => {
      const f = this.providerFailures.get(p.name);
      return {
        name: p.name,
        healthy: this.isProviderHealthy(p.name),
        failures: f?.count ?? 0,
      };
    });
  }
}
