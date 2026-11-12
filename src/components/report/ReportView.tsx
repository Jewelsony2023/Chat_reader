"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { FreeReport, FullReport } from "@/lib/report/types";
import Bubbles from "./Bubbles";
import Charts from "./Charts";
import FollowUpChat from "./FollowUpChat";
import Loading from "./Loading";
import SectionView, { Md } from "./SectionView";
import ShareButton from "./ShareButton";

type Status = { stage: string; readingProgress: number; error: { code: string; message: string } | null };

function fmtDay(d: string) {
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function ErrorScreen({ message, code }: { message: string; code?: string }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-4">
      <div className="text-5xl">{code === "QUOTA" ? "😮‍💨" : "🫠"}</div>
      <h1 className="mt-4 font-serif text-3xl font-bold">{code === "QUOTA" ? "Max needs a breather" : "That didn't work"}</h1>
      <p className="mt-3 text-lg text-ink-2">{message}</p>
      <Link href="/" className="mt-8 self-start rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink">
        Start over
      </Link>
    </main>
  );
}

export default function ReportView({ id }: { id: string }) {
  const [status, setStatus] = useState<Status>({ stage: "parsing", readingProgress: 0, error: null });
  const [free, setFree] = useState<FreeReport | null>(null);
  const [full, setFull] = useState<FullReport | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [creator, setCreator] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);

  const loadFull = useCallback(async () => {
    const res = await fetch(`/api/report/${id}/full`);
    if (res.ok) setFull((await res.json()).report);
    return res.ok;
  }, [id]);

  // Poll generation status, then fetch the free report (and the full one if already unlocked).
  useEffect(() => {
    let stop = false;
    async function poll() {
      while (!stop) {
        const res = await fetch(`/api/report/${id}/status`).catch(() => null);
        if (!res) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        const j = await res.json();
        if (!res.ok) return setError({ message: j.error, code: j.code });
        setStatus(j);
        if (j.stage === "error") return setError({ message: j.error?.message ?? "Report failed.", code: j.error?.code });
        if (j.stage === "done") break;
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (stop) return;
      const res = await fetch(`/api/report/${id}`);
      const j = await res.json();
      if (!res.ok) return setError({ message: j.error, code: j.code });
      setFree(j.report);
      setCreator(Boolean(j.creator));
      if (j.unlocked) await loadFull();
    }
    poll();
    return () => {
      stop = true;
    };
  }, [id, loadFull]);

  async function unlock() {
    setUnlocking(true);
    // TODO(razorpay): open Razorpay Checkout here; the server unlocks only after verifying payment.
    const res = await fetch(`/api/report/${id}/unlock`, { method: "POST" });
    if (res.ok) await loadFull();
    setUnlocking(false);
  }

  if (error) return <ErrorScreen {...error} />;
  if (!free) return <Loading stage={status.stage} progress={status.readingProgress} />;

  const r = full ?? free;
  const group = r.participants.length > 2;
  const sections = full ? full.sections : [free.preview_section];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <nav className="flex items-center justify-between">
        <Link href="/" className="font-serif text-xl font-bold tracking-tight">
          Vibe Check<span className="text-accent">.</span>
        </Link>
        <div className="flex items-center gap-2">
          {creator && <span className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-paper">Creator view</span>}
          <ShareButton target={heroRef} filename="vibe-check.png" />
        </div>
      </nav>

      {r.mock && (
        <p className="mt-4 rounded-xl border border-line bg-paper-2 px-4 py-2 text-sm text-ink-2">
          🧪 Offline mock mode: this report was generated without Gemini, from the stats alone.
        </p>
      )}

      <header ref={heroRef} className="mt-10 pb-2 fade-up" style={{ background: "var(--paper)" }}>
        <p className="text-sm font-medium uppercase tracking-widest text-accent">A Vibe Check · {r.chatTypeLabel}</p>
        <h1 className="mt-3 font-serif text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{r.title}</h1>
        <p className="mt-4 font-serif text-xl italic text-ink-2 sm:text-2xl">{r.subtitle}</p>
        <div className="mt-6 flex items-center gap-3 border-y border-line py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink font-serif text-lg font-bold text-paper">M</div>
          <div className="text-sm">
            <div className="font-semibold">By Max</div>
            <div className="text-ink-3">an AI with opinions and no filter</div>
          </div>
          <div className="ml-auto text-right text-xs text-ink-3">
            {r.totals.messages.toLocaleString("en-IN")} messages
            <br />
            {r.totals.spanYears} years
          </div>
        </div>
      </header>
      <p className="mt-3 text-xs text-ink-3">🔒 Written from your chat in memory. Nothing was saved; this report disappears in 2 hours.</p>

      <section className="mt-12" aria-label="Cold open">
        <p className="text-sm font-medium uppercase tracking-widest text-ink-3">{fmtDay(r.cold_open.date)}</p>
        <Bubbles quotes={r.cold_open.quotes} showNames={group} />
        <Md className="mt-4">{r.cold_open.reaction_markdown}</Md>
      </section>

      <Md className="dropcap mt-10">{r.context_paragraph}</Md>
      <p className="my-10 border-l-4 border-accent pl-5 font-serif text-2xl font-semibold italic leading-snug">{r.promise_line}</p>

      {sections.map((s, i) => (
        <SectionView key={i} section={s} index={i} showNames={group} />
      ))}

      {!full && (
        <div className="relative">
          <div className="paywall-fade pointer-events-none absolute -top-40 left-0 right-0 h-40" />
          <div className="rounded-3xl border border-line bg-card p-6 text-center shadow-sm sm:p-8">
            <p className="text-sm font-medium uppercase tracking-widest text-accent">Max isn&apos;t done with you</p>
            <h2 className="mt-2 font-serif text-3xl font-bold">Unlock the full report</h2>
            <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left">
              {free.locked_sections.map((s) => (
                <li key={s.heading} className="flex gap-2 text-ink-2">
                  <span>{s.emoji}</span>
                  <span>{s.heading}</span>
                  <span className="ml-auto" aria-label="locked">🔒</span>
                </li>
              ))}
              <li className="flex gap-2 text-ink-2"><span>📊</span><span>Charts, profiles &amp; the verdict</span><span className="ml-auto">🔒</span></li>
              <li className="flex gap-2 text-ink-2"><span>💬</span><span>Ask Max follow-up questions</span><span className="ml-auto">🔒</span></li>
            </ul>
            <button
              onClick={unlock}
              disabled={unlocking}
              className="mt-7 w-full rounded-full bg-accent px-6 py-4 text-lg font-semibold text-accent-ink transition hover:brightness-110 disabled:opacity-50"
            >
              {unlocking ? "Unlocking…" : "Unlock the full report"}
            </button>
            <p className="mt-3 text-xs text-ink-3">Payments aren&apos;t live yet: this unlocks for free while we test.</p>
          </div>
        </div>
      )}

      {full && (
        <>
          <Charts data={full.charts} participants={full.participants} />

          <section className="mt-16" aria-labelledby="cast">
            <h2 id="cast" className="font-serif text-3xl font-bold sm:text-4xl">🎭 The cast</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {full.participant_profiles.map((p) => (
                <article key={p.name} className={`rounded-3xl border p-5 ${p.name === full.me ? "border-accent bg-accent-soft" : "border-line bg-card"}`}>
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                    {p.name}
                    {p.name === full.me && " (you)"}
                  </div>
                  <h3 className="mt-1 font-serif text-xl font-bold">{p.role_title}</h3>
                  <Md className="mt-2 [&_p]:text-base">{p.description}</Md>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-16 rounded-3xl bg-ink p-6 text-paper sm:p-8" aria-labelledby="verdict">
            <p className="text-sm font-medium uppercase tracking-widest opacity-60">Final word</p>
            <h2 id="verdict" className="mt-1 font-serif text-3xl font-bold">🔮 The verdict</h2>
            <Md className="mt-4">{full.verdict}</Md>
            <p className="mt-2 text-sm opacity-60">— Max</p>
          </section>

          <FollowUpChat reportId={full.id} suggestions={full.suggested_questions} />
        </>
      )}
    </main>
  );
}
