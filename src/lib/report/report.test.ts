import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- mock the Gemini SDK -------------------------------------------------
const generateContent = vi.fn();
vi.mock("@google/genai", async (orig) => {
  const real = await orig<typeof import("@google/genai")>();
  class GoogleGenAI {
    models = { generateContent, generateContentStream: vi.fn() };
  }
  return { ...real, GoogleGenAI };
});

import { ApiError } from "@google/genai";
import { parseText } from "../parse";
import { computeStats } from "../stats";
import { LlmBudget, backoffConfig, generateJson, withBackoff } from "../llm/gemini";
import { chunkByTime, compactLine, estimateTokens, maskPII } from "./compact";
import { extractFacts, mergeFactSheets, sanitizeFactSheet } from "./extract";
import { FACT_SHEET_SCHEMA, FactSheetZ, ReportDraftZ, type FactSheet } from "./schemas";
import { buildFullReport, resolveQuotes, toFreeReport } from "./resolve";
import { buildWriterPrompt, writeReport } from "./write";
import { mockFactSheet, mockReport } from "./mock";

const chat = parseText(readFileSync(join(process.cwd(), "fixtures", "whatsapp-anjali-rahul.txt"), "utf8"));
const stats = computeStats(chat);
const idOf = (needle: string) => chat.messages.find((m) => m.text.includes(needle))!.id;

const FACTS: FactSheet = FactSheetZ.parse({
  episodes: [
    {
      date: "2025-03-10",
      title: "The exam hall rescue",
      what_happened: "Rahul drove Anjali's sister to her exam at 6am and fetched the forgotten hall ticket.",
      who_helped_whom: "Rahul helped Anjali",
      funny_score: 5,
      quote_ids: [idOf("Rahul urakkam aano"), idOf("ithu 6 mani aanu"), idOf("hall ticket marannu"), idOf("absolute legend")],
    },
  ],
  recurring_jokes_and_nicknames: [{ phrase: "₹40 chai", meaning: "an eternal debt", example_ids: [idOf("₹40 alle")] }],
  unspoken_pattern_candidates: ["Anjali plans, Rahul shows up late but shows up"],
});

const okResponse = (obj: unknown) => ({ text: JSON.stringify(obj) });
const draft = () => mockReport(stats, FACTS, chat, { chatType: "one_friend", me: "Anjali" });

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.VIBE_MOCK_LLM;
  backoffConfig.baseMs = 1;
});
afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe("compaction", () => {
  it("masks phone numbers, emails and UPI ids but not amounts", () => {
    expect(maskPII("call me +91 98765 43210 or 9876543210")).toBe("call me [phone] or [phone]");
    expect(maskPII("mail rahul.n@gmail.com, upi rahul@okaxis")).toBe("mail [email], upi [upi]");
    expect(maskPII("₹1,00,000 and ₹2,350 and 2026")).toBe("₹1,00,000 and ₹2,350 and 2026");
  });

  it("formats compact lines with id, date, sender", () => {
    const m = chat.messages[idOf("ithum note cheythu")];
    expect(compactLine(m)).toMatch(/^\d+\|2025-01-22 \d\d:\d\d\|Anjali\|ithum note cheythu\. ⏎ 1\. ₹40 chai ⏎ /);
  });

  it("estimates more tokens for non-Latin scripts", () => {
    expect(estimateTokens("hello world")).toBeLessThan(estimateTokens("ഹലോ വേൾഡ്"));
  });

  it("splits by time into <= maxChunks contiguous chunks and thins only when needed", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `${i}|2026-01-01 10:00|A|${"word ".repeat(20)}`);
    const one = chunkByTime(lines, 1e9, 2);
    expect(one.chunks).toHaveLength(1);
    expect(one.thinned).toBe(false);
    const two = chunkByTime(lines, 20_000, 2);
    expect(two.chunks).toHaveLength(2);
    expect(two.thinned).toBe(false);
    expect(two.chunks.flat()).toEqual(lines); // order preserved, nothing lost
    const thin = chunkByTime(lines, 5_000, 2);
    expect(thin.thinned).toBe(true);
    expect(thin.chunks).toHaveLength(2);
    expect(thin.chunks.flat().length).toBeLessThan(lines.length);
  });
});

describe("withBackoff / generateJson", () => {
  it("retries 429s with backoff, then gives the friendly quota message", async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }));
    await expect(withBackoff(fn)).rejects.toMatchObject({ code: "QUOTA", message: expect.stringContaining("Max needs a breather") });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("switches to the fallback model when the main one is overloaded", async () => {
    generateContent
      .mockRejectedValueOnce(new ApiError({ message: "This model is currently experiencing high demand", status: 503 }))
      .mockResolvedValueOnce(okResponse(FACTS));
    const budget = new LlmBudget();
    await generateJson({ label: "t", system: "s", prompt: "p", responseSchema: FACT_SHEET_SCHEMA, validator: FactSheetZ, budget });
    const models = generateContent.mock.calls.map((c) => c[0].model);
    expect(models).toHaveLength(2);
    expect(models[1]).not.toBe(models[0]);
    expect(budget.used).toBe(1); // the rejected attempt isn't counted
  });

  it("treats request timeouts as transient", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fn = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValue("ok");
    await expect(withBackoff(fn)).resolves.toBe("ok");
  });

  it("recovers when a retry succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new ApiError({ message: "quota", status: 429 })).mockResolvedValue("ok");
    await expect(withBackoff(fn)).resolves.toBe("ok");
  });

  it("does not retry non-quota errors", async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError({ message: "bad", status: 400 }));
    await expect(withBackoff(fn)).rejects.toMatchObject({ code: "LLM_FAILED" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on invalid JSON, then succeeds", async () => {
    generateContent.mockResolvedValueOnce({ text: "{not json" }).mockResolvedValueOnce(okResponse(FACTS));
    const budget = new LlmBudget();
    const out = await generateJson({ label: "t", system: "s", prompt: "p", responseSchema: FACT_SHEET_SCHEMA, validator: FactSheetZ, budget });
    expect(out.episodes).toHaveLength(1);
    expect(budget.used).toBe(2);
    const secondPrompt = generateContent.mock.calls[1][0].contents as string;
    expect(secondPrompt).toContain("not valid JSON");
    // structured output config is sent
    expect(generateContent.mock.calls[0][0].config).toMatchObject({ responseMimeType: "application/json" });
    expect(generateContent.mock.calls[0][0].config.responseSchema).toBeDefined();
  });

  it("fails with LLM_JSON after one retry", async () => {
    generateContent.mockResolvedValue({ text: "[]" });
    const budget = new LlmBudget();
    await expect(
      generateJson({ label: "t", system: "s", prompt: "p", responseSchema: FACT_SHEET_SCHEMA, validator: ReportDraftZ, budget }),
    ).rejects.toMatchObject({ code: "LLM_JSON" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("never retries into the reserved budget", async () => {
    generateContent.mockResolvedValue({ text: "nope" });
    const budget = new LlmBudget(4);
    budget.used = 2;
    await expect(
      generateJson({ label: "t", system: "s", prompt: "p", responseSchema: FACT_SHEET_SCHEMA, validator: FactSheetZ, budget, reserve: 1 }),
    ).rejects.toMatchObject({ code: "LLM_JSON" });
    expect(budget.used).toBe(3);
  });

  it("explains a missing API key", async () => {
    delete process.env.GEMINI_API_KEY;
    // the client is cached after first creation, so test via a fresh module
    vi.resetModules();
    const fresh = await import("../llm/gemini");
    await expect(
      fresh.generateJson({ label: "t", system: "s", prompt: "p", responseSchema: FACT_SHEET_SCHEMA, validator: FactSheetZ, budget: new fresh.LlmBudget() }),
    ).rejects.toMatchObject({ code: "LLM_CONFIG" });
  });
});

describe("pipeline: extraction + writing within the call budget", () => {
  it("does a full report in 2 calls for a normal-sized chat", async () => {
    generateContent.mockResolvedValueOnce(okResponse(FACTS)).mockResolvedValueOnce(okResponse(draft()));
    const budget = new LlmBudget();
    const { facts, chunks } = await extractFacts(chat, { chatType: "one_friend", budget });
    expect(chunks).toBe(1);
    const prompt = generateContent.mock.calls[0][0].contents as string;
    expect(prompt).toContain("|Anjali|");
    expect(prompt).not.toMatch(/\d{10}/); // masked
    const report = await writeReport(stats, facts, chat, { chatType: "one_friend", me: "Anjali", today: "2026-11-12" }, budget);
    expect(report.sections.length).toBe(7);
    expect(budget.used).toBe(2);
  });

  it("drops quote ids that don't exist", () => {
    const bad = { ...FACTS, episodes: [{ ...FACTS.episodes[0], quote_ids: [0, 999999, idOf("absolute legend")] }] };
    const clean = sanitizeFactSheet(bad, chat);
    // id 0 is the encryption system line
    expect(clean.episodes[0].quote_ids).toEqual([idOf("absolute legend")]);
  });

  it("merges chunk fact sheets deterministically", () => {
    const a = FactSheetZ.parse({ episodes: [{ date: "2025-02-01", title: "B", what_happened: "x", funny_score: 2, quote_ids: [] }], places: ["Goa"] });
    const b = FactSheetZ.parse({ episodes: [{ date: "2024-12-01", title: "A", what_happened: "y", funny_score: 9, quote_ids: [] }], places: ["goa", "Kochi"] });
    const m = mergeFactSheets([a, b]);
    expect(m.episodes.map((e) => e.title)).toEqual(["A", "B"]);
    expect(m.episodes[0].funny_score).toBe(5); // clamped
    expect(m.places).toEqual(["Goa", "Kochi"]);
  });

  it("writer prompt carries stats, facts, quote bank, context and today", () => {
    const p = buildWriterPrompt(stats, FACTS, chat, { chatType: "one_friend", me: "Anjali", context: "final year", today: "2026-11-12" });
    expect(p).toContain("TODAY: 2026-11-12");
    expect(p).toContain("first name: Anjali");
    expect(p).toContain("final year");
    expect(p).toContain("hall ticket marannu");
    expect(p).toContain('"moneyMentions"');
  });
});

describe("quotes and the paywall split", () => {
  const full = buildFullReport(ReportDraftZ.parse(draft()), chat, stats, FACTS, {
    id: "r1", chatType: "one_friend", me: "Anjali", createdAt: 0, expiresAt: 1, mock: false,
  });

  it("resolves quotes to the exact chat text", () => {
    const q = resolveQuotes([idOf("absolute legend")], chat, "Anjali");
    expect(q[0]).toMatchObject({ sender: "Anjali", text: "Rahul you absolute legend", mine: true, at: expect.stringMatching(/^2025-03-10/) });
  });

  it("free report contains only the free portion", () => {
    const free = toFreeReport(full);
    const json = JSON.stringify(free);
    expect(free.preview_section.evidence.length).toBeLessThanOrEqual(2);
    expect(json).not.toContain(full.verdict);
    for (const s of full.sections.slice(1)) {
      expect(json).not.toContain(s.intro_markdown);
    }
    for (const e of full.sections[0].evidence.slice(2)) {
      expect(json).not.toContain(e.point);
    }
    expect(json).not.toContain("participant_profiles");
    expect(json).not.toContain("suggested_questions");
    expect(json).not.toContain('"charts"');
    expect(free.locked_sections).toHaveLength(6);
  });
});

describe("report deadline", () => {
  it("gives the friendly busy message instead of hanging when Gemini never answers", async () => {
    const { createJob, runJob } = await import("./pipeline");
    generateContent.mockImplementation(() => new Promise(() => {})); // hangs forever
    const job = createJob({ chat, chatType: "one_friend", me: "Anjali" });
    await runJob(job, 50);
    expect(job.stage).toBe("error");
    expect(job.error).toMatchObject({ code: "QUOTA", message: expect.stringContaining("Max needs a breather") });
    expect(job.full).toBeUndefined();
  });
});

describe("mock mode", () => {
  it("produces schema-valid output from fixtures alone", () => {
    for (const f of ["whatsapp-anjali-rahul.txt", "whatsapp-hostel-group.txt"]) {
      const c = parseText(readFileSync(join(process.cwd(), "fixtures", f), "utf8"));
      const facts = FactSheetZ.parse(mockFactSheet(c));
      const r = ReportDraftZ.parse(mockReport(computeStats(c), facts, c, { chatType: "friend_group", me: c.participants[0] }));
      expect(r.sections).toHaveLength(7);
    }
  });
});
