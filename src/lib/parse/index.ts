import JSZip from "jszip";
import { AppError } from "../errors";
import type { ChatParser, ParsedChat } from "./types";
import { whatsappParser } from "./whatsapp";

export type { ChatMessage, ParsedChat, MessageKind, ChatParser } from "./types";

/** Add Instagram/Telegram JSON parsers here; first one whose canParse() matches wins. */
export const PARSERS: ChatParser[] = [whatsappParser];

export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
export const MIN_MESSAGES = 50;

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

async function textFromZip(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new AppError("WRONG_FILE", "That zip file looks damaged. Try exporting the chat again.");
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const entry =
    files.find((f) => /(^|\/)_chat\.txt$/i.test(f.name)) ??
    files.find((f) => /whatsapp chat.*\.txt$/i.test(f.name)) ??
    files.find((f) => /\.txt$/i.test(f.name));
  if (!entry) {
    throw new AppError(
      "WRONG_FILE",
      "We couldn't find a chat inside that zip. It should contain a file called _chat.txt.",
    );
  }
  return decode(await entry.async("uint8array"));
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function parseText(text: string, filename?: string): ParsedChat {
  const parser = PARSERS.find((p) => p.canParse(text, filename));
  if (!parser) {
    throw new AppError(
      "UNPARSEABLE",
      "This doesn't look like a WhatsApp export. Use “Export chat → Without media” and upload the .txt or .zip.",
    );
  }
  const chat = parser.parse(text);
  const real = chat.messages.filter((m) => m.kind !== "system").length;
  if (real === 0 || chat.participants.length === 0) {
    throw new AppError("UNPARSEABLE", "We couldn't read any messages from that file.");
  }
  if (real < MIN_MESSAGES) {
    throw new AppError(
      "TOO_FEW_MESSAGES",
      `Only ${real} messages found — Max needs at least ${MIN_MESSAGES} to have opinions.`,
    );
  }
  return chat;
}

/** Entry point for uploads. Works purely in memory; nothing is written to disk. */
export async function parseUpload(bytes: Uint8Array, filename: string): Promise<ParsedChat> {
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError("FILE_TOO_LARGE", "That file is over 40 MB. Export the chat without media.");
  }
  const lower = filename.toLowerCase();
  let text: string;
  if (isZip(bytes)) {
    text = await textFromZip(bytes);
  } else if (lower.endsWith(".txt") || lower.endsWith(".zip") || !/\.[a-z0-9]+$/.test(lower)) {
    if (lower.endsWith(".zip")) {
      throw new AppError("WRONG_FILE", "That .zip file isn't a valid zip. Try exporting again.");
    }
    text = decode(bytes);
  } else {
    throw new AppError(
      "WRONG_FILE",
      "Please upload the .txt or .zip that WhatsApp's “Export chat” gives you.",
    );
  }
  if (text.includes("\u0000")) {
    throw new AppError("WRONG_FILE", "That file isn't a text chat export.");
  }
  return parseText(text, filename);
}
