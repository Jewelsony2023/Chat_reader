import type { ChatMessage, ParsedChat } from "../parse/types";
import { tokenize } from "../stats";
import { compactLine } from "./compact";
import { statsForPrompt } from "./write";
import { CHAT_PERSONA_ADDENDUM, MAX_PERSONA } from "./persona";
import type { ReportJob } from "../store";

const QUESTION_STOPWORDS = new Set(
  "a an the and or but of to in on at for with is are was were be do does did i me my you your we us our they them he she it this that who what when where why how which most more ever about from than so did does have has had not no yes can could would should will".split(" "),
);

/**
 * Simple keyword search over the parsed chat: score messages by distinct query
 * tokens they contain (prefix match handles plurals/suffixes), then include a
 * little surrounding context for the best hits.
 */
export function searchMessages(chat: ParsedChat, query: string, maxHits = 25, context = 2): ChatMessage[] {
  const terms = [...new Set(tokenize(query).filter((t) => t.length > 2 && !QUESTION_STOPWORDS.has(t)))];
  if (terms.length === 0) return [];
  const scored: { m: ChatMessage; score: number }[] = [];
  for (const m of chat.messages) {
    if (m.kind !== "text") continue;
    const toks = tokenize(m.text);
    let score = 0;
    for (const t of terms) if (toks.some((w) => w === t || (t.length >= 4 && w.startsWith(t.slice(0, Math.max(4, t.length - 2)))))) score++;
    if (score > 0) scored.push({ m, score });
  }
  scored.sort((a, b) => b.score - a.score || b.m.id - a.m.id);
  const ids = new Set<number>();
  for (const { m } of scored.slice(0, maxHits)) {
    for (let i = m.id - context; i <= m.id + context; i++) {
      const x = chat.messages[i];
      if (x && x.kind !== "system") ids.add(i);
    }
  }
  return [...ids].sort((a, b) => a - b).map((i) => chat.messages[i]);
}

export function buildFollowupSystem(job: ReportJob, question: string): string {
  const full = job.full!;
  const relevant = searchMessages(job.chat, question).map(compactLine);
  const summary = {
    title: full.title,
    sections: full.sections.map((s) => ({ heading: s.heading, coined: s.coined_pattern_name })),
    profiles: full.participant_profiles,
    verdict: full.verdict,
  };
  return `${MAX_PERSONA}

${CHAT_PERSONA_ADDENDUM}

The user is ${job.me}. Today is ${new Date().toISOString().slice(0, 10)}.

YOUR REPORT (summary):
${JSON.stringify(summary)}

STATS:
${JSON.stringify(statsForPrompt(job.stats!))}

FACT SHEET:
${JSON.stringify(job.facts)}

RELEVANT MESSAGES (keyword search for the latest question; id|date|sender|text):
${relevant.length ? relevant.join("\n") : "(no direct keyword matches; rely on stats and fact sheet)"}`;
}
