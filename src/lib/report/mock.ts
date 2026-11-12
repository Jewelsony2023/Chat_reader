/**
 * Offline stand-in for Gemini (VIBE_MOCK_LLM=1). Builds a fact sheet and report
 * from the stats engine alone so the whole flow can be developed and tested
 * without an API key. Output is schema-valid but deliberately plain; the UI
 * labels mock reports as such.
 */
import type { ParsedChat } from "../parse/types";
import { computeStats, isoDate } from "../stats";
import type { ChatStats } from "../stats";
import type { FactSheet } from "./schemas";
import type { ChatType } from "./persona";

function followUps(chat: ParsedChat, id: number, n = 4): number[] {
  const start = chat.messages[id];
  const out = [id];
  for (let i = id + 1; i < chat.messages.length && out.length < n; i++) {
    const m = chat.messages[i];
    if (m.ts - start.ts > 3 * 3600 * 1000) break;
    if (m.kind !== "system") out.push(i);
  }
  return out;
}

export function mockFactSheet(chat: ParsedChat): FactSheet {
  const stats = computeStats(chat);
  const episodes: FactSheet["episodes"] = stats.moneyMentions.slice(0, 12).map((m) => ({
    date: m.date,
    title: `The ₹${m.amount.toLocaleString("en-IN")} moment`,
    what_happened: `${m.sender} brought up ₹${m.amount.toLocaleString("en-IN")} in the chat.`,
    who_helped_whom: "",
    funny_score: 3,
    quote_ids: followUps(chat, m.id),
  }));
  for (const d of stats.busiestDays.slice(0, 3)) {
    const first = chat.messages.find((m) => isoDate(m.ts) === d.date && m.kind === "text");
    if (first) {
      episodes.push({
        date: d.date,
        title: `The ${d.count}-message day`,
        what_happened: `${d.count} messages in one day.`,
        who_helped_whom: "",
        funny_score: 2,
        quote_ids: followUps(chat, first.id, 5),
      });
    }
  }
  episodes.sort((a, b) => a.date.localeCompare(b.date));

  const jokes = stats.topPhrases.slice(0, 5).map((p) => ({
    phrase: p.phrase,
    meaning: `A phrase that shows up ${p.count} times.`,
    example_ids: chat.messages
      .filter((m) => m.kind === "text" && m.text.toLowerCase().includes(p.phrase))
      .slice(0, 3)
      .map((m) => m.id),
  }));

  return {
    episodes,
    life_milestones: [{ date: stats.totals.firstDate, event: "First message in this export" }],
    people_mentioned: [],
    places: [],
    recurring_jokes_and_nicknames: jokes,
    favours_ledger: [],
    money_events: stats.moneyMentions.map((m) => ({ date: m.date, amount: m.amount, context: `mentioned by ${m.sender}` })),
    tensions: stats.longestSilences.slice(0, 3).map((s) => ({
      date: s.from.slice(0, 10),
      what: `${s.days} days of silence`,
      how_resolved: `${s.brokenBy} broke it`,
    })),
    unspoken_pattern_candidates: [],
  };
}

export function mockReport(stats: ChatStats, facts: FactSheet, chat: ParsedChat, ctx: { chatType: ChatType; me: string }) {
  const first = ctx.me.split(/\s+/)[0];
  const me = stats.people.find((p) => p.name === ctx.me) ?? stats.people[0];
  const others = stats.people.filter((p) => p.name !== me.name);
  const ep = facts.episodes;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const evidence = (from: number) =>
    ep.slice(from, from + 4).map((e) => ({ date: e.date, point: `${e.title}: ${e.what_happened}`, quote_ids: e.quote_ids.slice(0, 3) }));
  const amounts = [...new Set(stats.moneyMentions.map((m) => `₹${m.amount.toLocaleString("en-IN")}`))].slice(0, 2);
  const phrase = stats.topPhrases[0]?.phrase ?? "the usual";

  const section = (emoji: string, heading: string, intro: string, from: number, coined: string) => ({
    emoji,
    heading,
    intro_markdown: intro,
    evidence: evidence(from),
    closing_markdown: "(Offline mock mode: connect Gemini for Max's real take.)",
    coined_pattern_name: coined,
  });

  return {
    title: [...amounts, `“${phrase}”`].slice(0, 3).join(", ").replace(/, ([^,]*)$/, ", and $1"),
    subtitle: `${stats.totals.messages.toLocaleString("en-IN")} messages, ${stats.totals.spanYears} years, one very long group project.`,
    cold_open: {
      date: ep[0]?.date ?? stats.totals.firstDate,
      quote_ids: ep[0]?.quote_ids ?? [],
      reaction_markdown: `This is a **mock** cold open, ${first}. With a Gemini key, Max picks the scene that says the most about you.`,
    },
    context_paragraph: `${chat.participants.join(" and ")}: ${stats.totals.messages.toLocaleString("en-IN")} messages between ${stats.totals.firstDate} and ${stats.totals.lastDate}. You sent ${pct(me.share)} of them (${me.messages.toLocaleString("en-IN")}).`,
    promise_line: "Stick around: the numbers have opinions even when the AI is offline.",
    sections: [
      section("🛠️", "The role you think you play vs. the job you actually have", `You started ${pct(me.initiationShare)} of conversations and your median reply time is ${me.medianReplyMinutes ?? "n/a"} minutes.`, 0, "the Mock Starter"),
      section("⚖️", "The ledger: who gives, who takes", `Message share: ${stats.people.map((p) => `${p.name} ${pct(p.share)}`).join(", ")}.`, 2, "the Ledger Keeper"),
      section("😂", "The greatest hits", `Top phrase: “${phrase}”.`, 4, "the Callback"),
      section("📅", "The eras", `${stats.monthly.length} months of history.`, 6, "the Slow Fade-In"),
      section("🌧️", "The friction", `Longest silence: ${stats.longestSilences[0]?.days ?? 0} days.`, 8, "the Quiet Week"),
      section("🤐", "The part nobody talks about", "Mock mode doesn't guess at feelings.", 10, "the Unsaid"),
      section("🔮", "Max's verdict", "See below.", 12, "the Verdict"),
    ],
    participant_profiles: stats.people.map((p) => ({
      name: p.name,
      role_title: p.initiationShare > 0.5 ? "The Starter" : "The Responder",
      description: `${p.messages.toLocaleString("en-IN")} messages, ${pct(p.share)} of the chat.`,
    })),
    verdict: `Mock verdict for ${first}: ${others.length ? `you and ${others.map((o) => o.name).join(", ")} clearly keep showing up.` : "keep showing up."}`,
    suggested_questions: ["Who texts first more often?", "When were we closest?", "What's our most repeated joke?"],
  };
}
