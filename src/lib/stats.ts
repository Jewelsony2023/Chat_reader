/**
 * Stats engine: pure functions over a ParsedChat. No LLM, no I/O.
 * All timestamps are wall-clock-as-UTC (see parse/types.ts), so we use getUTC*.
 */
import type { ChatMessage, ParsedChat } from "./parse/types";

export const CONVERSATION_GAP_MS = 6 * 3600 * 1000;
export const DOUBLE_TEXT_GAP_MS = 20 * 60 * 1000;

export interface PersonStats {
  name: string;
  messages: number;
  share: number; // 0..1 of all non-system, non-call messages
  words: number;
  avgWords: number;
  media: number;
  deleted: number;
  callsMade: number;
  callsReceived: number;
  missedCallsMade: number;
  callMinutes: number;
  initiations: number;
  initiationShare: number;
  medianReplyMinutes: number | null;
  replies: number;
  doubleTexts: number;
  questions: number;
  questionRatio: number;
  topEmojis: { emoji: string; count: number }[];
}

export interface Silence {
  from: string; // ISO date-time of last message before the silence
  to: string;
  days: number;
  brokenBy: string;
}

export interface MoneyMention {
  id: number;
  date: string;
  sender: string;
  amount: number;
  raw: string;
}

export interface ChatStats {
  totals: {
    messages: number;
    words: number;
    calls: number;
    firstDate: string;
    lastDate: string;
    spanDays: number;
    spanYears: number;
    activeDays: number;
    conversations: number;
  };
  people: PersonStats[];
  /** heatmap[weekday 0=Mon..6=Sun][hour 0..23] */
  heatmap: number[][];
  byHour: number[];
  byWeekday: number[];
  monthly: { month: string; total: number; counts: Record<string, number> }[];
  longestSilences: Silence[];
  busiestDays: { date: string; count: number }[];
  topEmojis: { emoji: string; count: number }[];
  topPhrases: { phrase: string; count: number }[];
  moneyMentions: MoneyMention[];
}

const isCountable = (m: ChatMessage) => m.kind === "text" || m.kind === "media" || m.kind === "deleted";

export const isoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10);
export const isoDateTime = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");
const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/u).length : 0;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- emojis ----------
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTO = /\p{Extended_Pictographic}/u;

export function extractEmojis(text: string): string[] {
  if (!PICTO.test(text)) return [];
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) {
    if (PICTO.test(segment)) out.push(segment.replace(/️/g, ""));
  }
  return out;
}

function topN(counts: Map<string, number>, n: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

// ---------- phrases ----------
const STOPWORDS = new Set(
  (
    "a an the and or but if then so of to in on at by for with from up down out over is am are was were be been being " +
    "i me my mine you your yours he him his she her it its we us our they them their this that these those there here " +
    "do does did doing have has had will would can could should shall may might must not no yes ok okay oh ah hmm " +
    "just like what when where who why how all any some very too also im its dont cant wont ill ive youre thats " +
    "lol haha hahaha omg pls plz u ur r k kk ya yeah yep nah media omitted deleted message"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

export function topPhrases(messages: ChatMessage[], n = 15, minCount = 3) {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.kind !== "text") continue;
    const toks = tokenize(m.text);
    const seen = new Set<string>();
    for (const size of [2, 3]) {
      for (let i = 0; i + size <= toks.length; i++) {
        const gram = toks.slice(i, i + size);
        if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[size - 1])) continue;
        if (gram.every((t) => /^\d+$/.test(t))) continue;
        const key = gram.join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const frequent = [...counts.entries()].filter(([, c]) => c >= minCount);
  const trigrams = frequent.filter(([k]) => k.split(" ").length === 3);
  const kept = frequent.filter(([k, c]) => {
    if (k.split(" ").length === 3) return true;
    // drop a bigram that's mostly just part of a frequent trigram
    return !trigrams.some(([t, tc]) => (` ${t} `).includes(` ${k} `) && tc >= 0.7 * c);
  });
  return kept
    .sort((a, b) => b[1] - a[1] || b[0].split(" ").length - a[0].split(" ").length || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([phrase, count]) => ({ phrase, count }));
}

// ---------- money ----------
const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?`;
const MONEY_RE = new RegExp(
  String.raw`(?:₹|(?<![\p{L}\p{N}])(?:rs|inr)\.?)\s?${NUM}\s?(k)?(?![\p{L}\p{N}])` +
    String.raw`|(?<![\p{L}\p{N}₹])${NUM}\s?(k)?\s?(?:rupees?|rs\.?|bucks|\/-)(?![\p{L}\p{N}])`,
  "giu",
);

export function findMoney(text: string): { amount: number; raw: string }[] {
  const out: { amount: number; raw: string }[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const whole = m[1] ?? m[4];
    const frac = m[2] ?? m[5];
    const k = m[3] ?? m[6];
    if (!whole) continue;
    let amount = Number(whole.replace(/,/g, "") + (frac ? "." + frac : ""));
    if (k) amount *= 1000;
    if (amount > 0 && Number.isFinite(amount)) out.push({ amount, raw: m[0].trim() });
  }
  return out;
}

// ---------- main ----------
export function computeStats(chat: ParsedChat): ChatStats {
  const people = chat.participants;
  const msgs = chat.messages.filter((m) => m.kind !== "system");
  const countable = msgs.filter(isCountable);

  const per = new Map<string, PersonStats & { _replies: number[]; _emoji: Map<string, number> }>();
  for (const name of people) {
    per.set(name, {
      name, messages: 0, share: 0, words: 0, avgWords: 0, media: 0, deleted: 0, callsMade: 0, callsReceived: 0,
      missedCallsMade: 0, callMinutes: 0, initiations: 0, initiationShare: 0, medianReplyMinutes: null, replies: 0,
      doubleTexts: 0, questions: 0, questionRatio: 0, topEmojis: [], _replies: [], _emoji: new Map(),
    });
  }
  const get = (name: string) => per.get(name);

  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const byHour = Array<number>(24).fill(0);
  const byWeekday = Array<number>(7).fill(0);
  const monthly = new Map<string, Record<string, number>>();
  const daily = new Map<string, number>();
  const emojiAll = new Map<string, number>();
  const moneyMentions: MoneyMention[] = [];
  let totalWords = 0;

  for (const m of countable) {
    const p = get(m.sender);
    const d = new Date(m.ts);
    const wd = (d.getUTCDay() + 6) % 7;
    const hr = d.getUTCHours();
    heatmap[wd][hr]++;
    byHour[hr]++;
    byWeekday[wd]++;
    const mk = monthKey(m.ts);
    const row = monthly.get(mk) ?? {};
    row[m.sender] = (row[m.sender] ?? 0) + 1;
    monthly.set(mk, row);
    const dk = isoDate(m.ts);
    daily.set(dk, (daily.get(dk) ?? 0) + 1);
    if (!p) continue;
    p.messages++;
    if (m.kind === "media") p.media++;
    if (m.kind === "deleted") p.deleted++;
    if (m.kind === "text") {
      const w = countWords(m.text);
      p.words += w;
      totalWords += w;
      if (m.text.includes("?")) p.questions++;
      for (const e of extractEmojis(m.text)) {
        p._emoji.set(e, (p._emoji.get(e) ?? 0) + 1);
        emojiAll.set(e, (emojiAll.get(e) ?? 0) + 1);
      }
      for (const money of findMoney(m.text)) {
        moneyMentions.push({ id: m.id, date: isoDate(m.ts), sender: m.sender, ...money });
      }
    }
  }

  // calls
  let calls = 0;
  for (const m of msgs) {
    if (m.kind !== "call" || !m.call) continue;
    calls++;
    const p = get(m.sender);
    if (p) {
      p.callsMade++;
      if (m.call.missed) p.missedCallsMade++;
      p.callMinutes += m.call.durationSec / 60;
    }
    if (people.length === 2) {
      const other = get(people.find((x) => x !== m.sender) ?? "");
      if (other) other.callsReceived++;
    }
  }

  // conversation flow: initiations, replies, double texts, silences
  const silences: Silence[] = [];
  let conversations = 0;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const p = get(m.sender);
    const prev = i > 0 ? msgs[i - 1] : null;
    const gap = prev ? m.ts - prev.ts : Infinity;
    if (gap >= CONVERSATION_GAP_MS) {
      conversations++;
      if (p) p.initiations++;
      if (prev) {
        silences.push({ from: isoDateTime(prev.ts), to: isoDateTime(m.ts), days: +(gap / 86400000).toFixed(1), brokenBy: m.sender });
      }
    } else if (prev && p && m.kind !== "call" && prev.kind !== "call") {
      // calls start conversations but are not "replies" or "double texts"
      if (prev.sender !== m.sender) {
        p._replies.push(gap / 60000);
      } else if (gap >= DOUBLE_TEXT_GAP_MS) {
        p.doubleTexts++;
      }
    }
  }

  const totalCountable = countable.length || 1;
  for (const p of per.values()) {
    p.share = +(p.messages / totalCountable).toFixed(4);
    const texts = p.messages - p.media - p.deleted;
    p.avgWords = texts ? +(p.words / texts).toFixed(1) : 0;
    p.initiationShare = conversations ? +(p.initiations / conversations).toFixed(4) : 0;
    const med = median(p._replies);
    p.medianReplyMinutes = med === null ? null : +med.toFixed(1);
    p.replies = p._replies.length;
    p.questionRatio = texts ? +(p.questions / texts).toFixed(4) : 0;
    p.callMinutes = Math.round(p.callMinutes);
    p.topEmojis = topN(p._emoji, 5).map(([emoji, count]) => ({ emoji, count }));
  }

  // monthly series with zero-filled gaps
  const monthRows: ChatStats["monthly"] = [];
  if (countable.length) {
    const first = new Date(countable[0].ts);
    const last = new Date(countable[countable.length - 1].ts);
    for (let y = first.getUTCFullYear(), mo = first.getUTCMonth(); y < last.getUTCFullYear() || (y === last.getUTCFullYear() && mo <= last.getUTCMonth()); ) {
      const key = `${y}-${String(mo + 1).padStart(2, "0")}`;
      const raw = monthly.get(key) ?? {};
      const counts: Record<string, number> = {};
      for (const name of people) counts[name] = raw[name] ?? 0;
      monthRows.push({ month: key, total: Object.values(counts).reduce((a, b) => a + b, 0), counts });
      mo++;
      if (mo === 12) { mo = 0; y++; }
    }
  }

  const firstTs = msgs[0]?.ts ?? 0;
  const lastTs = msgs[msgs.length - 1]?.ts ?? 0;
  const spanDays = Math.max(0, Math.round((lastTs - firstTs) / 86400000));

  return {
    totals: {
      messages: countable.length,
      words: totalWords,
      calls,
      firstDate: firstTs ? isoDate(firstTs) : "",
      lastDate: lastTs ? isoDate(lastTs) : "",
      spanDays,
      spanYears: +(spanDays / 365.25).toFixed(1),
      activeDays: daily.size,
      conversations,
    },
    people: people
      .map((n) => {
        const { _replies, _emoji, ...rest } = per.get(n)!;
        void _replies; void _emoji;
        return rest;
      })
      .sort((a, b) => b.messages - a.messages),
    heatmap,
    byHour,
    byWeekday,
    monthly: monthRows,
    longestSilences: silences.sort((a, b) => b.days - a.days).slice(0, 5),
    busiestDays: topN(daily, 5).map(([date, count]) => ({ date, count })),
    topEmojis: topN(emojiAll, 10).map(([emoji, count]) => ({ emoji, count })),
    topPhrases: topPhrases(chat.messages),
    moneyMentions,
  };
}
