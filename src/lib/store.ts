import "server-only";
import { randomBytes } from "node:crypto";
import type { ParsedChat } from "./parse/types";
import type { ChatStats } from "./stats";
import type { FactSheet } from "./report/schemas";
import type { FullReport } from "./report/types";
import type { ChatType } from "./report/persona";

/**
 * In-memory only. Nothing here is ever written to disk or logged.
 * Entries expire after 2 hours; a sweep runs on every access.
 */
export const TTL_MS = 2 * 60 * 60 * 1000;

export function newId(): string {
  return randomBytes(16).toString("base64url");
}

class TtlStore<T> {
  private map = new Map<string, { value: T; expiresAt: number }>();
  constructor(private ttl = TTL_MS) {}
  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.map) if (v.expiresAt <= now) this.map.delete(k);
  }
  get(id: string): T | undefined {
    this.sweep();
    return this.map.get(id)?.value;
  }
  set(id: string, value: T) {
    this.sweep();
    this.map.set(id, { value, expiresAt: Date.now() + this.ttl });
  }
  expiresAt(id: string): number | undefined {
    return this.map.get(id)?.expiresAt;
  }
  delete(id: string) {
    this.map.delete(id);
  }
}

export interface UploadEntry {
  chat: ParsedChat;
  demo: boolean;
}

export type Stage = "parsing" | "counting" | "reading" | "writing" | "done" | "error";

export interface ReportJob {
  id: string;
  chatType: ChatType;
  me: string;
  context?: string;
  chat: ParsedChat;
  stage: Stage;
  /** 0..1 within the "reading" stage when the chat is chunked */
  readingProgress: number;
  error?: { code: string; message: string };
  stats?: ChatStats;
  facts?: FactSheet;
  full?: FullReport;
  /** Stub paywall flag. TODO(razorpay): set only from a verified payment webhook. */
  unlocked: boolean;
  llmCalls: number;
  createdAt: number;
  expiresAt: number;
}

// Survive Next.js dev hot reloads by pinning stores on globalThis.
const g = globalThis as unknown as { __vibeStores?: { uploads: TtlStore<UploadEntry>; reports: TtlStore<ReportJob> } };
g.__vibeStores ??= { uploads: new TtlStore<UploadEntry>(), reports: new TtlStore<ReportJob>() };

export const uploads = g.__vibeStores.uploads;
export const reports = g.__vibeStores.reports;
