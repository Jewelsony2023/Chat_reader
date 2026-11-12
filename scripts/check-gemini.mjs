// Quick health check for your Gemini key and models (never prints the key).
//   npm run check-gemini
import { readFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.log("✗ No .env.local found. Create it with GEMINI_API_KEY=...");
  process.exit(1);
}
if (!env.GEMINI_API_KEY) {
  console.log("✗ GEMINI_API_KEY is missing from .env.local");
  process.exit(1);
}
// Same defaults as src/lib/llm/config.ts when the variables aren't set
const configSrc = readFileSync("src/lib/llm/config.ts", "utf8");
const def = (name) => new RegExp(`${name} = "([^"]+)"`).exec(configSrc)?.[1];
const models = [...new Set([env.GEMINI_MODEL || def("DEFAULT_GEMINI_MODEL"), env.GEMINI_FALLBACK_MODEL || def("DEFAULT_FALLBACK_MODEL")])].filter(
  (m) => m && m !== "none",
);

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { timeout: 45_000 } });
let ok = 0;
for (const [i, model] of models.entries()) {
  const t = Date.now();
  try {
    await ai.models.generateContent({ model, contents: "Reply with the single word: ok" });
    console.log(`✓ ${model} (${i === 0 ? "main" : "fallback"}) answered in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    ok++;
  } catch (e) {
    const s = e?.status;
    const why =
      s === 401 || s === 403 ? "key rejected: check GEMINI_API_KEY"
      : s === 404 ? "model not available to this key"
      : s === 429 ? "rate limit / quota reached"
      : s === 503 ? "Google says the model is overloaded right now"
      : s === 504 || e?.name === "TimeoutError" || /timed? ?out|aborted/i.test(e?.message ?? "") ? "too slow (timed out)"
      : `error ${s ?? e?.name ?? ""}`;
    console.log(`✗ ${model} (${i === 0 ? "main" : "fallback"}): ${why} after ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}
console.log(ok ? "\nYour key works. Reports should generate." : "\nNo model answered. If the key was rejected, fix it; otherwise Google is busy, try again later.");
process.exit(ok ? 0 : 1);
