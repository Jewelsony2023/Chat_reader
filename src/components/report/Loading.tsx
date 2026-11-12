"use client";

import { useEffect, useState } from "react";

const STAGES = [
  { key: "parsing", label: "Parsing", detail: "Untangling timestamps and forwarded memes" },
  { key: "counting", label: "Counting", detail: "Who texts first, who replies in 3 hours" },
  { key: "reading", label: "Reading every message", detail: "Yes, even the 2 a.m. ones" },
  { key: "writing", label: "Writing", detail: "Max is drafting. Max has opinions." },
] as const;

const LINES = [
  "Counting how many times someone said “ok” and meant “not ok”…",
  "Finding the exact message where it all changed…",
  "Translating Manglish. Ayyo, there's a lot…",
  "Tallying who owes whom chai…",
  "Measuring double-texts with a ruler…",
  "Noticing the inside joke you forgot was an inside joke…",
  "Reading the voice-call logs like tea leaves…",
  "Checking who apologised first. Every time…",
  "Pretending not to judge the 3 a.m. messages…",
];

export default function Loading({ stage, progress }: { stage: string; progress: number }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3200);
    return () => clearInterval(t);
  }, []);
  const current = Math.max(0, STAGES.findIndex((s) => s.key === stage));

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-xl flex-col justify-center px-4 py-16">
      <div className="text-5xl" aria-hidden>🧐</div>
      <h1 className="mt-4 font-serif text-4xl font-bold">Max is reading your chat.</h1>
      <p key={line} className="fade-up mt-3 min-h-[3rem] text-lg text-ink-2" aria-live="polite">
        {LINES[line]}
      </p>
      <ol className="mt-8 space-y-4">
        {STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.key} className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done ? "bg-accent text-accent-ink" : active ? "border-2 border-accent text-accent" : "border border-line text-ink-3"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <div className="flex-1">
                <div className={`font-semibold ${active ? "" : done ? "text-ink-2" : "text-ink-3"}`}>
                  {s.label}
                  {active && <span className="ml-1 animate-pulse">…</span>}
                </div>
                {active && <div className="text-sm text-ink-3">{s.detail}</div>}
                {active && s.key === "reading" && progress > 0 && progress < 1 && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-10 text-xs text-ink-3">Usually under a minute. Long chats take a little longer. Keep this tab open.</p>
    </main>
  );
}
