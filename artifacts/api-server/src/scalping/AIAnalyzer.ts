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

const SYSTEM_PROMPT = `You are an expert meme coin scalping analyst for the Base blockchain network. 
Your job is to analyze token data and decide if it's worth entering a scalp trade.
Respond ONLY with valid JSON in this exact format:
{
  "decision": "buy" | "skip",
  "confidence": <integer 0-100>,
  "reasons": ["reason1", "reason2", "reason3"]
}
Rules:
- "buy" if confidence >= 65 and signals are aligned
- "skip" if confidence < 65 or risk is too high
- Give 2-4 concise reasons
- Focus on: momentum, liquidity health, buy pressure, risk/reward`;

function buildPrompt(data: AIAnalysisInput): string {
  return `Analyze this Base meme coin for a scalp trade ($1 position, target +5-15% in <15min):

Token: ${data.symbol} (${data.name})
Price: $${data.priceUsd.toFixed(8)}
5m Change: ${data.priceChange5m > 0 ? "+" : ""}${data.priceChange5m.toFixed(1)}%
1h Change: ${data.priceChange1h > 0 ? "+" : ""}${data.priceChange1h.toFixed(1)}%
5m Volume: $${data.volume5mUsd.toFixed(0)}
Liquidity: $${data.liquidityUsd.toFixed(0)}
Age: ${data.ageMinutes.toFixed(0)} minutes
Buy/Sell Ratio (5m): ${data.buySellRatio5m.toFixed(2)}
Safety Score: ${data.safetyScore}/100
Meme Score: ${data.memeScore}/100

Provide your analysis as JSON only.`;
}

async function analyzeWithGemini(data: AIAnalysisInput): Promise<AIAnalysisResult> {
  const start = Date.now();
  const baseUrl = process.env["AI_INTEGRATIONS_GEMINI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_GEMINI_API_KEY"];

  if (!baseUrl || !apiKey) throw new Error("Gemini env vars not configured");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { baseUrl } });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + buildPrompt(data) }] }
    ],
    config: { maxOutputTokens: 512, responseMimeType: "application/json" },
  });

  const raw = response.text ?? "{}";
  const parsed = JSON.parse(raw);

  return {
    decision: parsed.decision === "buy" ? "buy" : "skip",
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
    model: "gemini-2.5-flash",
    provider: "Gemini",
    latencyMs: Date.now() - start,
  };
}

async function analyzeWithOpenRouter(data: AIAnalysisInput, model: string, providerName: string): Promise<AIAnalysisResult> {
  const start = Date.now();
  const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];

  if (!baseUrl || !apiKey) throw new Error("OpenRouter env vars not configured");

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ baseURL: baseUrl, apiKey });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 512,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildPrompt(data) },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  return {
    decision: parsed.decision === "buy" ? "buy" : "skip",
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons.slice(0, 4) : [],
    model,
    provider: providerName,
    latencyMs: Date.now() - start,
  };
}

export class AIAnalyzer {
  private enabled: boolean;
  private minConfidence: number;
  private primaryProvider: "gemini" | "groq" | "huggingface";
  private cache = new Map<string, { result: AIAnalysisResult; ts: number }>();
  private readonly CACHE_TTL = 60_000; // 1 minute

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

  async analyze(data: AIAnalysisInput): Promise<AIAnalysisResult | null> {
    if (!this.enabled) return null;

    const cacheKey = `${data.symbol}-${Math.floor(Date.now() / this.CACHE_TTL)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL) {
      return cached.result;
    }

    // Provider chain:
    // Gemini (primary) → OpenRouter/Llama-fast (Groq-style) → OpenRouter/Llama-HF
    const providers: Array<() => Promise<AIAnalysisResult>> = [];

    if (this.primaryProvider === "gemini") {
      providers.push(() => analyzeWithGemini(data));
      providers.push(() => analyzeWithOpenRouter(data, "meta-llama/llama-3.1-8b-instruct", "Groq/OpenRouter"));
    } else if (this.primaryProvider === "groq") {
      providers.push(() => analyzeWithOpenRouter(data, "meta-llama/llama-3.1-8b-instruct", "Groq/OpenRouter"));
      providers.push(() => analyzeWithGemini(data));
    } else {
      // huggingface: use llama via openrouter (HF models), then gemini
      providers.push(() => analyzeWithOpenRouter(data, "meta-llama/llama-3.2-3b-instruct", "HuggingFace/OpenRouter"));
      providers.push(() => analyzeWithGemini(data));
    }

    for (const tryProvider of providers) {
      try {
        const result = await tryProvider();
        this.cache.set(cacheKey, { result, ts: Date.now() });
        return result;
      } catch (err) {
        logger.warn({ err }, `AIAnalyzer provider failed, trying fallback`);
      }
    }

    logger.warn({}, "All AI providers failed — skipping AI filter");
    return null;
  }

  shouldBuy(result: AIAnalysisResult | null): boolean {
    if (!result) return true; // No AI result — don't block
    return result.decision === "buy" && result.confidence >= this.minConfidence;
  }
}
