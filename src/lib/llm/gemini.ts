import "server-only";
import { ApiError, GoogleGenAI, type Schema, type ThinkingLevel } from "@google/genai";
import type { z } from "zod";
import { AppError, QUOTA_MESSAGE } from "../errors";
import { MAX_LLM_CALLS_PER_REPORT, REQUEST_TIMEOUT_MS, modelForAttempt } from "./config";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      "LLM_CONFIG",
      "Max isn't configured yet: set GEMINI_API_KEY in .env.local (or VIBE_MOCK_LLM=1 for offline mode).",
    );
  }
  client ??= new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
  return client;
}

/** Counts Gemini calls that returned a response (429-rejected attempts are not billed and not counted). */
export class LlmBudget {
  used = 0;
  constructor(readonly max = MAX_LLM_CALLS_PER_REPORT) {}
  get remaining() {
    return this.max - this.used;
  }
  take() {
    if (this.used >= this.max) {
      throw new AppError("LLM_FAILED", "Max ran out of attempts writing this report. Please try again.");
    }
    this.used++;
  }
}

/** Transient: rate limits, overload and timeouts. Worth retrying (on the fallback model). */
function isBusyError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status === 503 || err.status === 504;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /\b(429|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate limit|high demand|timed? ?out|aborted/i.test(msg)
  );
}

/** Tunable for tests. */
export const backoffConfig = { baseMs: 2000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Exponential backoff for 429/503/timeouts: up to 3 tries total, then a friendly QUOTA error.
 * `fn` receives the 1-based attempt number so callers can switch to the fallback model.
 */
export async function withBackoff<T>(fn: (attempt: number) => Promise<T>, opts: { tries?: number; baseMs?: number } = {}): Promise<T> {
  const tries = opts.tries ?? 3;
  const base = opts.baseMs ?? backoffConfig.baseMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (!isBusyError(err)) {
        console.error("[vibe-check] Gemini error", err instanceof ApiError ? err.status : "");
        throw new AppError("LLM_FAILED", "Max hit a snag talking to the AI. Please try again in a moment.");
      }
      // Status/name only: never log messages, they can echo request content.
      console.warn(`[vibe-check] Gemini busy on try ${attempt}/${tries}:`, err instanceof ApiError ? err.status : err instanceof Error ? err.name : "unknown");
      if (attempt >= tries) throw new AppError("QUOTA", QUOTA_MESSAGE);
      await sleep(base * 2 ** (attempt - 1) + Math.random() * 400);
    }
  }
}

export interface JsonCallOptions<T> {
  system: string;
  prompt: string;
  responseSchema: Schema;
  validator: z.ZodType<T>;
  budget: LlmBudget;
  temperature?: number;
  label: string;
  /** Calls that must stay available for later steps; a retry never dips into them. */
  reserve?: number;
  /** Lower is faster. Extraction is mechanical and uses LOW; writing keeps the model default. */
  thinkingLevel?: ThinkingLevel;
}

function summarizeIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Structured-output call: responseMimeType JSON + responseSchema, validated with zod.
 * Retries once (if the budget allows) when the model returns invalid JSON.
 */
export async function generateJson<T>(opts: JsonCallOptions<T>): Promise<T> {
  const ai = getClient();
  let prompt = opts.prompt;
  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2 && opts.budget.remaining - (opts.reserve ?? 0) <= 0) break;
    opts.budget.take();
    const res = await withBackoff((n) =>
      ai.models.generateContent({
        model: modelForAttempt(n),
        contents: prompt,
        config: {
          systemInstruction: opts.system,
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema,
          temperature: opts.temperature ?? 0.7,
          ...(opts.thinkingLevel ? { thinkingConfig: { thinkingLevel: opts.thinkingLevel } } : {}),
        },
      }),
    );
    const text = res.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      lastProblem = "The reply was not valid JSON (it may have been cut off).";
      prompt = `${opts.prompt}\n\nIMPORTANT: your previous reply was not valid JSON. ${lastProblem} Reply with ONLY valid JSON matching the schema, and keep it shorter.`;
      continue;
    }
    const result = opts.validator.safeParse(parsed);
    if (result.success) return result.data;
    lastProblem = summarizeIssues(result.error);
    prompt = `${opts.prompt}\n\nIMPORTANT: your previous reply did not match the schema (${lastProblem}). Reply again with ONLY valid JSON matching the schema.`;
  }
  console.error(`[vibe-check] ${opts.label}: invalid JSON after retry`);
  throw new AppError("LLM_JSON", "Max's notes came back garbled. Please try generating the report again.");
}

/** Streaming text call for the follow-up chat. Yields text chunks. */
export async function* streamText(opts: {
  system: string;
  history: { role: "user" | "model"; text: string }[];
}): AsyncGenerator<string> {
  const ai = getClient();
  const stream = await withBackoff((n) =>
    ai.models.generateContentStream({
      model: modelForAttempt(n),
      contents: opts.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      config: { systemInstruction: opts.system, temperature: 0.8 },
    }),
  );
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) yield t;
  }
}
