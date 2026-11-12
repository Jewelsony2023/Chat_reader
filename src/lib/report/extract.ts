import "server-only";
import { ThinkingLevel } from "@google/genai";
import type { ParsedChat } from "../parse/types";
import { EXTRACT_CHUNK_TOKENS, MAX_EXTRACT_CHUNKS, isMockLlm } from "../llm/config";
import { generateJson, type LlmBudget } from "../llm/gemini";
import { CHAT_TYPES, type ChatType } from "./persona";
import { compactTranscript, chunkByTime } from "./compact";
import { FACT_SHEET_SCHEMA, FactSheetZ, type FactSheet } from "./schemas";
import { mockFactSheet } from "./mock";

const EXTRACTOR_SYSTEM = `You are a meticulous research assistant reading a WhatsApp chat export so a writer can later tell the story of the relationship.
The chat may mix English with Malayalam, Hindi, Tamil, Manglish, Hinglish or other languages and transliterations; read them all and write your notes in English.
Each line is: id|YYYY-MM-DD HH:mm|Sender|text. "⏎" marks a line break inside one message. [media], [deleted message] and [call ...] are events.
Rules:
- Record only what the chat actually shows. No speculation presented as fact; no invented dates, amounts, names or places.
- Dates must be the real dates from the lines (YYYY-MM-DD).
- Quote ids must be ids of real lines that show the moment. Prefer short, vivid, funny or telling lines.
- Cover the WHOLE timeline, not just the beginning. Prefer specific, concrete moments (objects, amounts, places) over generic chit-chat.
- money_events: real amounts mentioned with who paid/owes whom.
- favours_ledger: concrete favours (lifts, notes, loans, help moving, covering for someone).
- unspoken_pattern_candidates: careful hypotheses about patterns visible across many messages (e.g. one person always initiates; apologies come as memes), phrased tentatively.`;

function userPrompt(lines: string[], ctx: { chatType: ChatType; participants: string[]; part?: [number, number] }) {
  const t = CHAT_TYPES[ctx.chatType];
  const part = ctx.part ? `\nThis is part ${ctx.part[0]} of ${ctx.part[1]} of the chat (split by time). Extract facts for this part only.` : "";
  return `Chat type: ${t.label}. Participants: ${ctx.participants.join(", ")}.${part}
Return the FACT SHEET JSON for this chat.

CHAT:
${lines.join("\n")}`;
}

/** Deterministic merge of per-chunk fact sheets (no extra LLM call). */
export function mergeFactSheets(sheets: FactSheet[]): FactSheet {
  const uniq = <T>(items: T[], key: (x: T) => string) => {
    const seen = new Set<string>();
    return items.filter((x) => {
      const k = key(x).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const byDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date));
  const all = <K extends keyof FactSheet>(k: K) => sheets.flatMap((s) => s[k] as FactSheet[K][number][]) as FactSheet[K];

  const jokes = new Map<string, FactSheet["recurring_jokes_and_nicknames"][number]>();
  for (const j of all("recurring_jokes_and_nicknames")) {
    const k = j.phrase.toLowerCase();
    const prev = jokes.get(k);
    if (prev) prev.example_ids = [...new Set([...prev.example_ids, ...j.example_ids])].slice(0, 4);
    else jokes.set(k, { ...j });
  }

  return {
    episodes: byDate(uniq(all("episodes"), (e) => `${e.date}|${e.title}`)),
    life_milestones: byDate(uniq(all("life_milestones"), (m) => `${m.date}|${m.event}`)),
    people_mentioned: uniq(all("people_mentioned"), (p) => p.name),
    places: uniq(all("places"), (p) => p),
    recurring_jokes_and_nicknames: [...jokes.values()],
    favours_ledger: byDate(uniq(all("favours_ledger"), (f) => `${f.date}|${f.favour}`)),
    money_events: byDate(uniq(all("money_events"), (m) => `${m.date}|${m.amount}`)),
    tensions: byDate(uniq(all("tensions"), (t) => `${t.date}|${t.what}`)),
    unspoken_pattern_candidates: uniq(all("unspoken_pattern_candidates"), (s) => s).slice(0, 8),
  };
}

/** Drop quote ids that don't exist or point at system lines; cap at 6 per item. */
export function sanitizeFactSheet(facts: FactSheet, chat: ParsedChat): FactSheet {
  const valid = (ids: number[], max: number) =>
    [...new Set(ids)].filter((id) => chat.messages[id] && chat.messages[id].kind !== "system").slice(0, max);
  return {
    ...facts,
    episodes: facts.episodes.map((e) => ({ ...e, quote_ids: valid(e.quote_ids, 6) })),
    recurring_jokes_and_nicknames: facts.recurring_jokes_and_nicknames.map((j) => ({
      ...j,
      example_ids: valid(j.example_ids, 4),
    })),
  };
}

export async function extractFacts(
  chat: ParsedChat,
  opts: { chatType: ChatType; budget: LlmBudget; onChunk?: (done: number, total: number) => void },
): Promise<{ facts: FactSheet; chunks: number; thinned: boolean }> {
  if (isMockLlm()) {
    opts.onChunk?.(1, 1);
    return { facts: sanitizeFactSheet(mockFactSheet(chat), chat), chunks: 1, thinned: false };
  }
  const lines = compactTranscript(chat.messages);
  const { chunks, thinned } = chunkByTime(lines, EXTRACT_CHUNK_TOKENS, MAX_EXTRACT_CHUNKS);
  const sheets: FactSheet[] = [];
  for (let i = 0; i < chunks.length; i++) {
    sheets.push(
      await generateJson({
        label: `extract ${i + 1}/${chunks.length}`,
        system: EXTRACTOR_SYSTEM,
        prompt: userPrompt(chunks[i], {
          chatType: opts.chatType,
          participants: chat.participants,
          part: chunks.length > 1 ? [i + 1, chunks.length] : undefined,
        }),
        responseSchema: FACT_SHEET_SCHEMA,
        validator: FactSheetZ,
        budget: opts.budget,
        temperature: 0.2,
        thinkingLevel: ThinkingLevel.LOW,
        reserve: chunks.length - i - 1 + 1, // remaining chunks + the writing call
      }),
    );
    opts.onChunk?.(i + 1, chunks.length);
  }
  const facts = sheets.length === 1 ? sheets[0] : mergeFactSheets(sheets);
  return { facts: sanitizeFactSheet(facts, chat), chunks: chunks.length, thinned };
}
