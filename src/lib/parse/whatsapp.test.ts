import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { classify, detectDateOrder, parseWhatsApp } from "./whatsapp";
import { parseText, parseUpload } from "./index";
import { AppError } from "../errors";

const fixture = (name: string) => readFileSync(join(process.cwd(), "fixtures", name), "utf8");

describe("parseWhatsApp — line formats", () => {
  it("parses Android 12h lines", () => {
    const chat = parseWhatsApp(
      "12/11/26, 10:45 pm - Anjali: hello\n13/11/26, 9:05 am - Rahul: hi da",
    );
    expect(chat.messages).toHaveLength(2);
    const [a, b] = chat.messages;
    expect(a).toMatchObject({ id: 0, sender: "Anjali", text: "hello", kind: "text" });
    expect(new Date(a.ts).toISOString()).toBe("2026-11-12T22:45:00.000Z");
    expect(new Date(b.ts).toISOString()).toBe("2026-11-13T09:05:00.000Z");
    expect(chat.participants.sort()).toEqual(["Anjali", "Rahul"]);
  });

  it("parses iOS bracketed lines with seconds and narrow no-break spaces", () => {
    const chat = parseWhatsApp(
      "[12/11/26, 10:45:12 PM] Anjali: hey\n[13/11/26, 12:01:00 AM] Rahul: ‎image omitted",
    );
    expect(new Date(chat.messages[0].ts).toISOString()).toBe("2026-11-12T22:45:12.000Z");
    expect(new Date(chat.messages[1].ts).toISOString()).toBe("2026-11-13T00:01:00.000Z");
    expect(chat.messages[1].kind).toBe("media");
  });

  it("parses 24h clocks and 4-digit years", () => {
    const chat = parseWhatsApp("25.12.2025, 18:30 - A: merry\n25.12.2025, 00:15 - B: xmas");
    expect(new Date(chat.messages[0].ts).toISOString()).toBe("2025-12-25T18:30:00.000Z");
  });

  it("handles 12 am / 12 pm correctly", () => {
    const chat = parseWhatsApp("01/02/26, 12:10 am - A: midnight\n01/02/26, 12:10 pm - B: noon");
    expect(new Date(chat.messages[0].ts).getUTCHours()).toBe(0);
    expect(new Date(chat.messages[1].ts).getUTCHours()).toBe(12);
  });

  it("joins multi-line messages", () => {
    const chat = parseWhatsApp(
      "12/11/26, 10:45 pm - A: line one\nline two\n\nline four\n12/11/26, 10:46 pm - B: ok",
    );
    expect(chat.messages[0].text).toBe("line one\nline two\n\nline four");
    expect(chat.messages[1].text).toBe("ok");
  });

  it("keeps colons inside message text", () => {
    const chat = parseWhatsApp("12/11/26, 10:45 pm - A: time: 10:30 ok?");
    expect(chat.messages[0]).toMatchObject({ sender: "A", text: "time: 10:30 ok?" });
  });
});

describe("date order detection", () => {
  it("detects dd/mm when a day > 12 appears", () => {
    const chat = parseWhatsApp("05/03/26, 10:00 am - A: x\n25/03/26, 10:00 am - B: y");
    expect(new Date(chat.messages[0].ts).toISOString().slice(0, 10)).toBe("2026-03-05");
  });

  it("detects mm/dd when the second field > 12", () => {
    const chat = parseWhatsApp("3/5/26, 10:00 AM - A: x\n3/25/26, 10:00 AM - B: y");
    expect(new Date(chat.messages[0].ts).toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(new Date(chat.messages[1].ts).toISOString().slice(0, 10)).toBe("2026-03-25");
  });

  it("falls back to chronological consistency when all fields <= 12", () => {
    // As mm/dd this runs Jan 2 -> Jan 3 -> Feb 1 (monotonic); as dd/mm it jumps backwards.
    const h = (a: number, b: number) => ({ a, b, year: 2026, hour: 10, minute: 0, ampm: undefined });
    expect(detectDateOrder([h(1, 2), h(1, 3), h(2, 1)])).toBe("mdy");
    expect(detectDateOrder([h(2, 1), h(3, 1), h(1, 2)])).toBe("dmy");
  });
});

describe("classify", () => {
  it.each([
    ["<Media omitted>", "media"],
    ["image omitted", "media"],
    ["sticker omitted", "media"],
    ["<attached: 00000012-PHOTO.jpg>", "media"],
    ["This message was deleted", "deleted"],
    ["You deleted this message", "deleted"],
    ["hello", "text"],
  ])("%s -> %s", (text, kind) => {
    expect(classify(text).kind).toBe(kind);
  });

  it("parses call logs and keeps them as call events", () => {
    expect(classify("Missed voice call").call).toEqual({ type: "voice", missed: true, durationSec: 0, group: false });
    expect(classify("Voice call, 48 sec").call).toEqual({ type: "voice", missed: false, durationSec: 48, group: false });
    expect(classify("Video call, 1 hr 12 min").call).toMatchObject({ type: "video", durationSec: 4320 });
    expect(classify("Missed group voice call").call).toMatchObject({ missed: true, group: true });
  });
});

describe("system messages", () => {
  it("flags sender-less lines and encryption notices", () => {
    const chat = parseWhatsApp(
      "12/11/26, 10:00 am - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.\n" +
        "12/11/26, 10:01 am - Rahul added Anjali\n" +
        "12/11/26, 10:02 am - Rahul: I changed my mind",
    );
    expect(chat.messages.map((m) => m.kind)).toEqual(["system", "system", "text"]);
    expect(chat.participants).toEqual(["Rahul"]);
  });

  it("excludes the iOS group-name pseudo-sender from participants", () => {
    const chat = parseWhatsApp(
      "[02/06/25, 8:00:00 PM] Hostel 4B: ‎Arjun created group “Hostel 4B”\n" +
        "[02/06/25, 8:00:05 PM] Hostel 4B: ‎Arjun added Meera\n" +
        "[02/06/25, 8:01:00 PM] Arjun: welcome",
    );
    expect(chat.messages.slice(0, 2).every((m) => m.kind === "system")).toBe(true);
    expect(chat.participants).toEqual(["Arjun"]);
  });
});

describe("fixtures", () => {
  it("parses the 2-person Android fixture", () => {
    const chat = parseText(fixture("whatsapp-anjali-rahul.txt"));
    expect(chat.participants.sort()).toEqual(["Anjali", "Rahul"]);
    expect(chat.messages.length).toBeGreaterThan(1300);
    const kinds = new Set(chat.messages.map((m) => m.kind));
    expect(kinds).toEqual(new Set(["system", "text", "media", "deleted", "call"]));
    // chronological
    for (let i = 1; i < chat.messages.length; i++) {
      expect(chat.messages[i].ts).toBeGreaterThanOrEqual(chat.messages[i - 1].ts);
    }
    const multi = chat.messages.find((m) => m.text.startsWith("ithum note cheythu"));
    expect(multi?.text.split("\n")).toHaveLength(4);
  });

  it("parses the 5-person iOS group fixture", () => {
    const chat = parseText(fixture("whatsapp-hostel-group.txt"));
    expect(chat.participants.sort()).toEqual(["Arjun", "Fathima", "Kevin", "Meera", "Sid"]);
    expect(chat.messages.length).toBeGreaterThan(700);
    const calls = chat.messages.filter((m) => m.kind === "call");
    expect(calls.some((c) => c.call?.durationSec === 4320)).toBe(true);
  });
});

describe("parseUpload", () => {
  it("reads _chat.txt from a zip", async () => {
    const zip = new JSZip();
    zip.file("_chat.txt", fixture("whatsapp-hostel-group.txt"));
    zip.file("IMG-0001.jpg", new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const chat = await parseUpload(bytes, "WhatsApp Chat - Hostel 4B.zip");
    expect(chat.participants).toHaveLength(5);
  });

  it("rejects wrong file types", async () => {
    await expect(parseUpload(new Uint8Array([1, 2]), "photo.png")).rejects.toMatchObject({ code: "WRONG_FILE" });
  });

  it("rejects text that isn't a chat", async () => {
    const bytes = new TextEncoder().encode("Dear diary,\ntoday was fine.\nThe end.");
    await expect(parseUpload(bytes, "notes.txt")).rejects.toMatchObject({ code: "UNPARSEABLE" });
  });

  it("rejects chats under 50 messages", () => {
    const text = Array.from({ length: 10 }, (_, i) => `12/11/26, 10:${String(i).padStart(2, "0")} am - A: hi ${i}`).join("\n");
    expect(() => parseText(text)).toThrow(AppError);
    try {
      parseText(text);
    } catch (e) {
      expect((e as AppError).code).toBe("TOO_FEW_MESSAGES");
    }
  });
});
