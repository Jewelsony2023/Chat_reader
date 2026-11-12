/**
 * Shared chat model. Every source parser (WhatsApp today, Instagram/Telegram
 * JSON later) produces a ParsedChat so stats and the LLM pipeline never care
 * where the chat came from.
 *
 * Timestamps: exports carry wall-clock time with no timezone, so `ts` is the
 * wall-clock time encoded as if it were UTC (Date.UTC(...)). Always read it
 * back with getUTC* helpers; never with local-time getters.
 */

export type MessageKind = "text" | "media" | "deleted" | "call" | "system";

export interface CallInfo {
  type: "voice" | "video";
  missed: boolean;
  /** Seconds; 0 when missed or unknown. */
  durationSec: number;
  group: boolean;
}

export interface ChatMessage {
  id: number;
  ts: number;
  /** Empty string for system messages without a sender. */
  sender: string;
  text: string;
  kind: MessageKind;
  call?: CallInfo;
}

export interface ParsedChat {
  source: "whatsapp" | "instagram" | "telegram";
  participants: string[];
  messages: ChatMessage[];
}

export interface ChatParser {
  id: ParsedChat["source"];
  label: string;
  /** Cheap sniff on the decoded text (and optionally the filename). */
  canParse(text: string, filename?: string): boolean;
  parse(text: string): ParsedChat;
}
