import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseText } from "./parse";
import { parseWhatsApp } from "./parse/whatsapp";
import { computeStats, extractEmojis, findMoney, median, topPhrases } from "./stats";

// A tiny, hand-checkable chat (dd/mm/yy, Wed 4 Nov 2026 onwards)
const SMALL = [
  "04/11/26, 9:00 am - A: good morning? 😂😂",    // conv 1 start (A initiates)
  "04/11/26, 9:10 am - B: morning",                 // B replies after 10 min
  "04/11/26, 9:12 am - A: chai? ₹40",               // A replies after 2 min
  "04/11/26, 9:50 am - A: hello??",                 // A double text (38 min)
  "04/11/26, 9:55 am - B: <Media omitted>",         // B replies after 5 min
  "04/11/26, 10:00 am - B: Missed voice call",      // call by B (not counted as message)
  "05/11/26, 8:00 pm - B: sorry 😅 rs 1,200 sent",  // conv 2 start (B initiates) after ~34h
  "05/11/26, 8:01 pm - A: This message was deleted",
  "05/11/26, 8:30 pm - A: Voice call, 5 min",
].join("\n");

describe("computeStats on a small chat", () => {
  const stats = computeStats(parseWhatsApp(SMALL));
  const A = stats.people.find((p) => p.name === "A")!;
  const B = stats.people.find((p) => p.name === "B")!;

  it("counts messages, share, media, deleted", () => {
    expect(stats.totals.messages).toBe(7);
    expect(A.messages).toBe(4);
    expect(B.messages).toBe(3);
    expect(A.share).toBeCloseTo(4 / 7, 3);
    expect(B.media).toBe(1);
    expect(A.deleted).toBe(1);
  });

  it("counts words and avg length over text messages only", () => {
    // A texts: "good morning? 😂😂"(3) "chai? ₹40"(2) "hello??"(1) => 6 words / 3 texts
    expect(A.words).toBe(6);
    expect(A.avgWords).toBe(2);
  });

  it("tracks calls made and received", () => {
    expect(B.callsMade).toBe(1);
    expect(B.missedCallsMade).toBe(1);
    expect(A.callsMade).toBe(1);
    expect(A.callMinutes).toBe(5);
    expect(A.callsReceived).toBe(1);
    expect(B.callsReceived).toBe(1);
    expect(stats.totals.calls).toBe(2);
  });

  it("detects initiations after >= 6h gaps", () => {
    expect(stats.totals.conversations).toBe(2);
    expect(A.initiations).toBe(1);
    expect(B.initiations).toBe(1);
    expect(A.initiationShare).toBe(0.5);
  });

  it("computes median reply times and double texts", () => {
    // B replies: 10, 5 => 7.5. A replies: 2, 1 (deleted msg at 8:01 after B 8:00) => 1.5
    expect(B.medianReplyMinutes).toBe(7.5);
    expect(A.medianReplyMinutes).toBe(1.5);
    expect(A.doubleTexts).toBe(1);
    expect(B.doubleTexts).toBe(0);
  });

  it("computes question ratio", () => {
    expect(A.questions).toBe(3);
    expect(A.questionRatio).toBe(1);
  });

  it("builds activity by hour/weekday and monthly volume", () => {
    expect(stats.byHour[9]).toBe(5);
    expect(stats.byHour[20]).toBe(2);
    // 4 Nov 2026 is a Wednesday => index 2 (Mon=0)
    expect(stats.byWeekday[2]).toBe(5);
    expect(stats.heatmap[2][9]).toBe(5);
    expect(stats.monthly).toEqual([{ month: "2026-11", total: 7, counts: { A: 4, B: 3 } }]);
  });

  it("finds silences and busiest days", () => {
    expect(stats.longestSilences[0]).toMatchObject({ from: "2026-11-04 10:00", to: "2026-11-05 20:00", brokenBy: "B" });
    expect(stats.longestSilences[0].days).toBeCloseTo(1.4, 1);
    expect(stats.busiestDays[0]).toEqual({ date: "2026-11-04", count: 5 });
  });

  it("collects emojis and money mentions", () => {
    expect(stats.topEmojis[0]).toEqual({ emoji: "😂", count: 2 });
    expect(stats.moneyMentions.map((m) => [m.sender, m.amount, m.date])).toEqual([
      ["A", 40, "2026-11-04"],
      ["B", 1200, "2026-11-05"],
    ]);
  });

  it("reports totals and span", () => {
    expect(stats.totals.firstDate).toBe("2026-11-04");
    expect(stats.totals.lastDate).toBe("2026-11-05");
    expect(stats.totals.activeDays).toBe(2);
  });
});

describe("helpers", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it("extractEmojis handles skin tones, ZWJ sequences and variation selectors", () => {
    expect(extractEmojis("hi 👍🏽 ❤️ 👨‍👩‍👧 ok")).toEqual(["👍🏽", "❤", "👨‍👩‍👧"]);
    expect(extractEmojis("no emoji")).toEqual([]);
  });

  it.each([
    ["₹40 chai", [40]],
    ["Rs. 1,200 for fees", [1200]],
    ["rs500", [500]],
    ["2k rupees", [2000]],
    ["paid 350/-", [350]],
    ["INR 99.50", [99.5]],
    ["5 bucks", [5]],
    ["hours and hours, 3 rs", [3]],
    ["meet at 5 pm, room 204", []],
    ["₹1,00,000 lottery", [100000]],
  ])("findMoney(%s)", (text, amounts) => {
    expect(findMoney(text).map((m) => m.amount)).toEqual(amounts);
  });

  it("topPhrases removes stopwords and prefers longer phrases", () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({ id: i, ts: i, sender: "A", kind: "text" as const, text: "the charger evide da" }));
    const phrases = topPhrases(msgs).map((p) => p.phrase);
    expect(phrases).toContain("charger evide da");
    expect(phrases).not.toContain("the charger");
    expect(phrases).not.toContain("charger evide"); // swallowed by the trigram
  });
});

describe("computeStats on fixtures", () => {
  const load = (f: string) => parseText(readFileSync(join(process.cwd(), "fixtures", f), "utf8"));

  it("produces sane numbers for the 2-person chat", () => {
    const s = computeStats(load("whatsapp-anjali-rahul.txt"));
    const shares = s.people.reduce((a, p) => a + p.share, 0);
    expect(shares).toBeCloseTo(1, 2);
    expect(s.people[0].name).toBe("Anjali");
    expect(s.totals.spanYears).toBeGreaterThan(1.9);
    expect(s.monthly.length).toBeGreaterThanOrEqual(24);
    // the 9-day July 2025 fight silence should be among the longest
    expect(s.longestSilences.some((x) => x.from.startsWith("2025-07-03"))).toBe(true);
    const amounts = s.moneyMentions.map((m) => m.amount);
    expect(amounts).toEqual(expect.arrayContaining([40, 2350, 1200, 1240, 500]));
    expect(s.topPhrases).toHaveLength(15);
    const chat = load("whatsapp-anjali-rahul.txt");
    expect(topPhrases(chat.messages, 60).some((p) => p.phrase.includes("40 chai"))).toBe(true);
    expect(s.people.every((p) => p.callsMade > 0)).toBe(true);
  });

  it("handles a 5-person group", () => {
    const s = computeStats(load("whatsapp-hostel-group.txt"));
    expect(s.people).toHaveLength(5);
    const kevin = s.people.find((p) => p.name === "Kevin")!;
    expect(kevin.share).toBeLessThan(0.1);
    expect(s.people.every((p) => p.callsReceived === 0)).toBe(true); // undefined for groups
  });
});
