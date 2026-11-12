import type { ParsedChat } from "../parse/types";
import type { ChatStats } from "../stats";
import { isoDateTime } from "../stats";
import { CHAT_TYPES, type ChatType } from "./persona";
import type { FactSheet, ReportDraft } from "./schemas";
import type { FreeReport, FullReport, Quote, Section, StatCallout } from "./types";

export const FREE_EVIDENCE_COUNT = 2;

/** Pull the exact text for a message id from the parsed chat. Quotes are never model-written. */
export function resolveQuotes(ids: number[], chat: ParsedChat, me: string, max = 8): Quote[] {
  const out: Quote[] = [];
  for (const id of [...new Set(ids)]) {
    const m = chat.messages[id];
    if (!m || m.kind === "system") continue;
    out.push({ id, sender: m.sender, at: isoDateTime(m.ts), text: m.text, kind: m.kind, mine: m.sender === me });
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.id - b.id);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-IN");

function fmtMinutes(m: number | null): string {
  if (m === null) return "n/a";
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

/** Deterministic stat callouts per section index (numbers come from the stats engine, not the LLM). */
export function sectionCallouts(stats: ChatStats, me: string, index: number): StatCallout[] {
  const mine = stats.people.find((p) => p.name === me);
  switch (index) {
    case 0:
      return mine
        ? [
            { value: fmtMinutes(mine.medianReplyMinutes), label: "your median reply time" },
            { value: pct(mine.questionRatio), label: "of your texts ask a question" },
          ]
        : [];
    case 1:
      return [
        ...(mine ? [{ value: pct(mine.share), label: `of all messages are yours (${fmt(mine.messages)})` }] : []),
        ...(mine ? [{ value: pct(mine.initiationShare), label: "of conversations you started" }] : []),
      ];
    case 2:
      return stats.topEmojis.slice(0, 1).map((e) => ({ value: e.emoji, label: `top emoji, used ${fmt(e.count)} times` }));
    case 3: {
      const busiest = [...stats.monthly].sort((a, b) => b.total - a.total)[0];
      return busiest ? [{ value: busiest.month, label: `busiest month (${fmt(busiest.total)} messages)` }] : [];
    }
    case 4: {
      const s = stats.longestSilences[0];
      return s ? [{ value: `${s.days} days`, label: `longest silence, broken by ${s.brokenBy}` }] : [];
    }
    default:
      return [];
  }
}

export interface BuildContext {
  id: string;
  chatType: ChatType;
  me: string;
  createdAt: number;
  expiresAt: number;
  mock: boolean;
}

export function buildFullReport(draft: ReportDraft, chat: ParsedChat, stats: ChatStats, facts: FactSheet, ctx: BuildContext): FullReport {
  let coldQuotes = resolveQuotes(draft.cold_open.quote_ids, chat, ctx.me);
  let coldDate = draft.cold_open.date;
  if (coldQuotes.length < 2) {
    // fall back to the funniest episode that has real quotes
    const ep = [...facts.episodes].sort((a, b) => b.funny_score - a.funny_score).find((e) => e.quote_ids.length >= 2);
    if (ep) {
      coldQuotes = resolveQuotes(ep.quote_ids, chat, ctx.me);
      coldDate = ep.date;
    }
  }

  const sections: Section[] = draft.sections.map((s, i) => ({
    emoji: s.emoji,
    heading: s.heading,
    intro_markdown: s.intro_markdown,
    evidence: s.evidence.map((e) => ({ date: e.date, point: e.point, quotes: resolveQuotes(e.quote_ids, chat, ctx.me, 4) })),
    closing_markdown: s.closing_markdown,
    coined_pattern_name: s.coined_pattern_name || undefined,
    callouts: sectionCallouts(stats, ctx.me, i),
  }));

  return {
    id: ctx.id,
    chatType: ctx.chatType,
    chatTypeLabel: CHAT_TYPES[ctx.chatType].label,
    me: ctx.me,
    participants: chat.participants,
    createdAt: ctx.createdAt,
    expiresAt: ctx.expiresAt,
    mock: ctx.mock,
    title: draft.title,
    subtitle: draft.subtitle,
    cold_open: { date: coldDate, quotes: coldQuotes, reaction_markdown: draft.cold_open.reaction_markdown },
    context_paragraph: draft.context_paragraph,
    promise_line: draft.promise_line,
    totals: {
      messages: stats.totals.messages,
      spanYears: stats.totals.spanYears,
      firstDate: stats.totals.firstDate,
      lastDate: stats.totals.lastDate,
    },
    sections,
    participant_profiles: draft.participant_profiles,
    verdict: draft.verdict,
    suggested_questions: draft.suggested_questions,
    charts: {
      people: stats.people.map((p) => ({ name: p.name, messages: p.messages, share: p.share })),
      monthly: stats.monthly.map((m) => ({ month: m.month, counts: m.counts })),
      heatmap: stats.heatmap,
    },
  };
}

/**
 * The ONLY shape the browser receives before unlock. Built by copying fields
 * explicitly (an allow-list), so new paid fields can't leak by accident.
 */
export function toFreeReport(full: FullReport): FreeReport {
  const first = full.sections[0];
  return {
    id: full.id,
    chatType: full.chatType,
    chatTypeLabel: full.chatTypeLabel,
    me: full.me,
    participants: full.participants,
    createdAt: full.createdAt,
    expiresAt: full.expiresAt,
    mock: full.mock,
    title: full.title,
    subtitle: full.subtitle,
    cold_open: full.cold_open,
    context_paragraph: full.context_paragraph,
    promise_line: full.promise_line,
    totals: full.totals,
    locked: true,
    preview_section: {
      emoji: first.emoji,
      heading: first.heading,
      intro_markdown: first.intro_markdown,
      evidence: first.evidence.slice(0, FREE_EVIDENCE_COUNT),
      closing_markdown: "",
      coined_pattern_name: undefined,
      callouts: first.callouts,
    },
    locked_sections: full.sections.slice(1).map((s) => ({ emoji: s.emoji, heading: s.heading })),
  };
}
