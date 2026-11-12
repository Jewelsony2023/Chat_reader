import "server-only";
import type { ParsedChat } from "../parse/types";
import type { ChatStats } from "../stats";
import { isMockLlm } from "../llm/config";
import { generateJson, type LlmBudget } from "../llm/gemini";
import { compactLine } from "./compact";
import { CHAT_TYPES, MAX_PERSONA, sectionPlan, type ChatType } from "./persona";
import { REPORT_SCHEMA, ReportDraftZ, type FactSheet, type ReportDraft } from "./schemas";
import { mockReport } from "./mock";

export interface WriteContext {
  chatType: ChatType;
  me: string;
  context?: string;
  today: string; // YYYY-MM-DD
}

/** Stats trimmed to what the writer needs (the full heatmap is noise for prose). */
export function statsForPrompt(stats: ChatStats) {
  const { heatmap, ...rest } = stats;
  void heatmap;
  return {
    ...rest,
    monthly: stats.monthly.map((m) => ({ month: m.month, ...m.counts })),
  };
}

/** Every message the fact sheet cites, plus money lines: the only quotable material. */
export function quoteBank(facts: FactSheet, stats: ChatStats, chat: ParsedChat, limit = 500): string[] {
  const ids = new Set<number>();
  for (const e of facts.episodes) e.quote_ids.forEach((id) => ids.add(id));
  for (const j of facts.recurring_jokes_and_nicknames) j.example_ids.forEach((id) => ids.add(id));
  for (const m of stats.moneyMentions) ids.add(m.id);
  return [...ids]
    .sort((a, b) => a - b)
    .slice(0, limit)
    .map((id) => chat.messages[id])
    .filter((m) => m && m.kind !== "system")
    .map(compactLine);
}

export function buildWriterPrompt(stats: ChatStats, facts: FactSheet, chat: ParsedChat, ctx: WriteContext): string {
  const firstName = ctx.me.split(/\s+/)[0];
  const others = chat.participants.filter((p) => p !== ctx.me);
  return `TODAY: ${ctx.today}
CHAT TYPE: ${CHAT_TYPES[ctx.chatType].label}
THE USER (write to them as "you"): ${ctx.me} (first name: ${firstName})
OTHER PARTICIPANT(S): ${others.join(", ")}
USER'S CONTEXT LINE: ${ctx.context?.trim() ? ctx.context.trim() : "(none given)"}

${sectionPlan(ctx.chatType, chat.participants.length)}

STATS (computed exactly; shares are 0-1 fractions, reply times in minutes):
${JSON.stringify(statsForPrompt(stats))}

FACT SHEET:
${JSON.stringify(facts)}

QUOTE BANK (id|YYYY-MM-DD HH:mm|Sender|text) — cite ONLY these ids:
${quoteBank(facts, stats, chat).join("\n")}

Write the full report JSON now.`;
}

export async function writeReport(
  stats: ChatStats,
  facts: FactSheet,
  chat: ParsedChat,
  ctx: WriteContext,
  budget: LlmBudget,
): Promise<ReportDraft> {
  if (isMockLlm()) return ReportDraftZ.parse(mockReport(stats, facts, chat, ctx));
  return generateJson({
    label: "write",
    system: MAX_PERSONA,
    prompt: buildWriterPrompt(stats, facts, chat, ctx),
    responseSchema: REPORT_SCHEMA,
    validator: ReportDraftZ,
    budget,
    temperature: 0.9,
  });
}
