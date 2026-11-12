import "server-only";

/** The only place the default model name lives. Override with GEMINI_MODEL. */
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Used when the main model is overloaded (503/429). Override with GEMINI_FALLBACK_MODEL; set it to "none" to disable. */
const DEFAULT_FALLBACK_MODEL = "gemini-3.6-flash";

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function geminiFallbackModel(): string | null {
  const v = process.env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  return v === "none" || v === geminiModel() ? null : v;
}

/**
 * Model to use on a given try (1-based): primary, then fallback, then primary again.
 * Switching quickly beats waiting out a spike on an overloaded model.
 */
export function modelForAttempt(attempt: number): string {
  const fb = geminiFallbackModel();
  return fb && attempt % 2 === 0 ? fb : geminiModel();
}

/** Per-request timeout. A stuck request becomes a friendly "busy" error instead of hanging. */
export const REQUEST_TIMEOUT_MS = 120_000;

/** Whole-report cap: past this the user gets the friendly "busy" message instead of waiting. */
export const REPORT_DEADLINE_MS = 5 * 60_000;

/** Offline mode for development and demos without a key: VIBE_MOCK_LLM=1 */
export function isMockLlm(): boolean {
  return process.env.VIBE_MOCK_LLM === "1";
}

/** Hard cap on Gemini calls that produce a response, per report (extraction + writing + retries). */
export const MAX_LLM_CALLS_PER_REPORT = 4;

/** Above this (estimated) size the chat is split by time and extracted per chunk. */
export const EXTRACT_CHUNK_TOKENS = 600_000;

/** Chunks allowed for extraction: leaves 1 call for writing and 1 for a JSON retry. */
export const MAX_EXTRACT_CHUNKS = 2;
