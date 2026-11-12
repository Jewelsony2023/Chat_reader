import type { CallInfo, ChatMessage, ChatParser, MessageKind, ParsedChat } from "./types";

/*
 * WhatsApp "Export chat" parser.
 *
 * Android:  12/11/26, 10:45 pm - Name: message
 * iOS:      [12/11/26, 10:45:12 PM] Name: message
 * Also tolerates 24h clocks, 4-digit years, '.' or '-' date separators,
 * narrow no-break spaces before am/pm, and invisible LRM marks iOS sprinkles in.
 */

const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s?([aApP]\.?\s?[mM]\.?)?`;
const DATE = String.raw`(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})`;

const ANDROID_RE = new RegExp(String.raw`^${DATE},?\s+${TIME}\s+[-–]\s+(.*)$`);
const IOS_RE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s+(.*)$`);

interface RawHeader {
  a: number;
  b: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
  ampm: string | undefined;
  rest: string;
}

function cleanLine(line: string): string {
  return line
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[  ]/g, " ")
    .replace(/\r$/, "");
}

function matchHeader(line: string): RawHeader | null {
  const m = IOS_RE.exec(line) ?? ANDROID_RE.exec(line);
  if (!m) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return {
    a: Number(m[1]),
    b: Number(m[2]),
    year,
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
    ampm: m[7],
    rest: m[8],
  };
}

function to24h(hour: number, ampm: string | undefined): number {
  if (!ampm) return hour;
  const pm = /p/i.test(ampm);
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

type DateOrder = "dmy" | "mdy";

/**
 * Decide dd/mm vs mm/dd from the data: any first field > 12 proves dmy, any
 * second field > 12 proves mdy. If still ambiguous, pick the order with fewer
 * backwards jumps in time; ties go to dmy (more common outside the US).
 */
export function detectDateOrder(headers: Pick<RawHeader, "a" | "b" | "year" | "hour" | "minute" | "ampm">[]): DateOrder {
  let dmyVotes = 0;
  let mdyVotes = 0;
  for (const h of headers) {
    if (h.a > 12 && h.b <= 12) dmyVotes++;
    if (h.b > 12 && h.a <= 12) mdyVotes++;
  }
  if (dmyVotes !== mdyVotes) return dmyVotes > mdyVotes ? "dmy" : "mdy";

  const backwards = (order: DateOrder) => {
    let prev = -Infinity;
    let count = 0;
    for (const h of headers) {
      const [d, mo] = order === "dmy" ? [h.a, h.b] : [h.b, h.a];
      const t = Date.UTC(h.year, mo - 1, d, to24h(h.hour, h.ampm), h.minute);
      if (t < prev) count++;
      prev = t;
    }
    return count;
  };
  return backwards("mdy") < backwards("dmy") ? "mdy" : "dmy";
}

/** Unambiguous system phrases: flagged even when a "sender" is present. */
const SYSTEM_PATTERNS: RegExp[] = [
  /^messages and calls are end-to-end encrypted/i,
  /^messages to this (chat|group) are now secured/i,
  /end-to-end encrypted\.? no one outside of this chat/i,
  /changed (the subject|this group's|the group (description|name|icon))/i,
  /changed their phone number/i,
  /security code (with .* )?changed/i,
  /^you were added$/i,
  /^disappearing messages/i,
  /turned (on|off) disappearing messages/i,
  /^this chat is with a business account/i,
  /joined using this group's invite link/i,
  /^waiting for this message/i,
  /pinned a message/i,
];

const MEDIA_PATTERNS: RegExp[] = [
  /^<media omitted>$/i,
  /^(image|video|audio|sticker|gif|document|contact card|video note) omitted$/i,
  /^<attached: [^>]+>$/i,
  /^[^\n]+\.(jpg|jpeg|png|webp|mp4|opus|pdf|vcf) \(file attached\)$/i,
  /^null$/i, // older Android exports for view-once media
];

const DELETED_PATTERNS: RegExp[] = [
  /^this message was deleted\.?$/i,
  /^you deleted this message\.?$/i,
  /^this message was deleted by admin/i,
];

const CALL_RE =
  /^(missed |silenced |declined )?(group )?(voice|video) call(?:,\s*(.+?))?(?:\s*•.*)?$/i;

function parseDuration(s: string | undefined): number {
  if (!s) return 0;
  let sec = 0;
  const hr = /(\d+)\s*(?:hr|hour|h)\b/i.exec(s);
  const min = /(\d+)\s*(?:min|m)\b/i.exec(s);
  const secs = /(\d+)\s*(?:sec|s)\b/i.exec(s);
  if (hr) sec += Number(hr[1]) * 3600;
  if (min) sec += Number(min[1]) * 60;
  if (secs) sec += Number(secs[1]);
  return sec;
}

export function classify(text: string): { kind: MessageKind; call?: CallInfo } {
  const t = text.trim();
  if (MEDIA_PATTERNS.some((r) => r.test(t))) return { kind: "media" };
  if (DELETED_PATTERNS.some((r) => r.test(t))) return { kind: "deleted" };
  const c = CALL_RE.exec(t);
  if (c) {
    const missedWord = (c[1] ?? "").trim().toLowerCase();
    const detail = c[4];
    const missed = missedWord !== "" || /no answer|missed|declined/i.test(detail ?? "");
    return {
      kind: "call",
      call: {
        type: c[3].toLowerCase() as "voice" | "video",
        missed,
        durationSec: missed ? 0 : parseDuration(detail),
        group: Boolean(c[2]),
      },
    };
  }
  return { kind: "text" };
}

/** Ambiguous phrases ("Rahul added Anjali"): only trusted with the iOS LRM marker. */
const WEAK_SYSTEM_PATTERNS: RegExp[] = [
  /^.{1,80} (created group|added|removed|left|joined|changed)\b/i,
  /^you (created group|added|removed|left|joined|changed)\b/i,
];

function isSystemText(text: string, lrmMarked: boolean): boolean {
  const t = text.trim();
  if (SYSTEM_PATTERNS.some((r) => r.test(t))) return true;
  return lrmMarked && WEAK_SYSTEM_PATTERNS.some((r) => r.test(t));
}

interface Draft {
  header: RawHeader;
  lines: string[];
  /** iOS prefixes system/media text with U+200E right after "Name: ". */
  lrmMarked: boolean;
}

export function parseWhatsApp(raw: string): ParsedChat {
  const drafts: Draft[] = [];

  for (const rawLine of raw.split("\n")) {
    const line = cleanLine(rawLine);
    const header = matchHeader(line);
    if (header) {
      drafts.push({ header, lines: [header.rest], lrmMarked: /: ‎/.test(rawLine) });
    } else if (drafts.length > 0) {
      drafts[drafts.length - 1].lines.push(line);
    }
    // Lines before the first header are ignored.
  }

  const order = detectDateOrder(drafts.map((d) => d.header));
  const messages: ChatMessage[] = [];
  const senderNonSystem = new Map<string, number>();

  for (const d of drafts) {
    const h = d.header;
    const [day, month] = order === "dmy" ? [h.a, h.b] : [h.b, h.a];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const ts = Date.UTC(h.year, month - 1, day, to24h(h.hour, h.ampm), h.minute, h.second);

    const body = d.lines.join("\n").replace(/\s+$/, "");
    // Sender is everything before the first ": " on the first line.
    const sep = d.lines[0].indexOf(": ");
    let sender = "";
    let text = body;
    if (sep > 0 && sep < 80) {
      sender = d.lines[0].slice(0, sep).trim();
      text = body.slice(sep + 2);
    } else if (d.lines[0].endsWith(":") && d.lines[0].length < 80 && d.lines.length === 1) {
      // "Name:" followed by an empty message
      sender = d.lines[0].slice(0, -1).trim();
      text = "";
    }

    let kind: MessageKind;
    let call: CallInfo | undefined;
    if (!sender || isSystemText(text, d.lrmMarked)) {
      kind = "system";
      if (!sender) text = body;
    } else {
      ({ kind, call } = classify(text));
    }

    if (kind !== "system") senderNonSystem.set(sender, (senderNonSystem.get(sender) ?? 0) + 1);
    messages.push({ id: messages.length, ts, sender, text, kind, ...(call ? { call } : {}) });
  }

  // iOS puts the group name as "sender" of system lines; only real people count.
  const participants = [...senderNonSystem.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([name]) => name);

  return { source: "whatsapp", participants, messages };
}

export const whatsappParser: ChatParser = {
  id: "whatsapp",
  label: "WhatsApp",
  canParse(text) {
    const lines = text.split("\n", 60).map(cleanLine);
    return lines.filter((l) => matchHeader(l)).length >= Math.min(3, lines.filter(Boolean).length);
  },
  parse: parseWhatsApp,
};
