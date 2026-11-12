import type { ChatMessage } from "../parse/types";
import { isoDateTime } from "../stats";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const UPI_RE = /\b[\w.-]{2,}@(?:ok)?[a-z]{2,12}\b/gi;
// 10-15 digits, optionally with +, spaces or dashes in between (amounts use commas, so they survive)
const PHONE_RE = /(?<![\d₹])\+?\d(?:[\s-]?\d){9,14}(?!\d)/g;

export function maskPII(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(UPI_RE, "[upi]").replace(PHONE_RE, "[phone]");
}

function bodyOf(m: ChatMessage): string {
  switch (m.kind) {
    case "media":
      return "[media]";
    case "deleted":
      return "[deleted message]";
    case "call": {
      const c = m.call;
      if (!c) return "[call]";
      if (c.missed) return `[missed ${c.type} call]`;
      const mins = Math.round(c.durationSec / 60);
      return `[${c.type} call, ${mins > 0 ? `${mins} min` : `${c.durationSec} sec`}]`;
    }
    default:
      return maskPII(m.text).replace(/\n+/g, " ⏎ ");
  }
}

/** "id|YYYY-MM-DD HH:mm|Sender|text" — the id lets the model cite exact quotes. */
export function compactLine(m: ChatMessage): string {
  return `${m.id}|${isoDateTime(m.ts)}|${m.sender}|${bodyOf(m)}`;
}

export function compactTranscript(messages: ChatMessage[]): string[] {
  return messages.filter((m) => m.kind !== "system").map(compactLine);
}

/**
 * Rough token estimate without a network call. Latin text ~3.6 chars/token;
 * Indic scripts and emoji tokenize much worse, so count them ~1 token per char.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3.6 + other);
}

/** Split lines into n contiguous time chunks of roughly equal token size. */
export function chunkByTime(lines: string[], maxTokens: number, maxChunks: number): { chunks: string[][]; thinned: boolean } {
  const sizes = lines.map((l) => estimateTokens(l) + 1);
  const total = sizes.reduce((a, b) => a + b, 0);
  let thinned = false;
  let working = lines;
  let workingSizes = sizes;

  // If even maxChunks chunks can't hold it, keep an evenly spaced sample.
  const capacity = maxTokens * maxChunks;
  if (total > capacity) {
    thinned = true;
    const keepRatio = capacity / total;
    const kept: string[] = [];
    const keptSizes: number[] = [];
    let acc = 0;
    lines.forEach((l, i) => {
      acc += keepRatio;
      if (acc >= 1) {
        acc -= 1;
        kept.push(l);
        keptSizes.push(sizes[i]);
      }
    });
    working = kept;
    workingSizes = keptSizes;
  }

  const workingTotal = workingSizes.reduce((a, b) => a + b, 0);
  const n = Math.min(maxChunks, Math.max(1, Math.ceil(workingTotal / maxTokens)));
  const target = workingTotal / n;
  const chunks: string[][] = [[]];
  let acc = 0;
  working.forEach((l, i) => {
    if (acc >= target && chunks.length < n) {
      chunks.push([]);
      acc = 0;
    }
    chunks[chunks.length - 1].push(l);
    acc += workingSizes[i];
  });
  return { chunks, thinned };
}
