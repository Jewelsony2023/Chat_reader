import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Creator access: the app owner sees every report in full without paying.
 * Visit /api/creator?key=<CREATOR_KEY> once; that sets an httpOnly cookie for this browser.
 * The cookie holds a hash of the key, never the key itself.
 */
export const CREATOR_COOKIE = "vc_creator";

function creatorKey(): string | null {
  const k = process.env.CREATOR_KEY?.trim();
  return k && k.length >= 16 ? k : null;
}

export function creatorCookieValue(): string | null {
  const k = creatorKey();
  return k ? createHash("sha256").update(`vibe-check-creator:${k}`).digest("hex") : null;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function isValidCreatorKey(candidate: string | null): boolean {
  const k = creatorKey();
  return Boolean(k && candidate && safeEqual(candidate, k));
}

/** True when the request carries a valid creator cookie. */
export function isCreator(req: Request): boolean {
  const expected = creatorCookieValue();
  if (!expected) return false;
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${CREATOR_COOKIE}=`));
  return Boolean(match && safeEqual(match.slice(CREATOR_COOKIE.length + 1), expected));
}
