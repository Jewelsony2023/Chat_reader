"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ChatTypeKey = "romantic" | "friend_group" | "one_friend" | "family" | "work" | "other";

const TYPES: { key: ChatTypeKey; label: string; emoji: string; hint: string }[] = [
  { key: "romantic", label: "Romantic", emoji: "💘", hint: "partner, situationship, crush" },
  { key: "friend_group", label: "Friend group", emoji: "🫂", hint: "the group chat" },
  { key: "one_friend", label: "One friend", emoji: "🤝", hint: "best friend, close friend" },
  { key: "family", label: "Family", emoji: "🏠", hint: "parents, siblings, cousins" },
  { key: "work", label: "Work / Team", emoji: "💼", hint: "colleagues, project team" },
  { key: "other", label: "Other", emoji: "✨", hint: "Max will figure it out" },
];

interface UploadInfo {
  uploadId: string;
  participants: { name: string; messages: number }[];
  messageCount: number;
  firstDate: string;
  lastDate: string;
  suggestedMe: string | null;
  suggestedType: ChatTypeKey | null;
}

type Step = "landing" | "type" | "upload" | "who";

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j.error ?? "Something went wrong.";
  } catch {
    return "Something went wrong. Check your connection and try again.";
  }
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function Flow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [chatType, setChatType] = useState<ChatTypeKey | null>(null);
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  async function sendUpload(body: FormData | { demo: string }) {
    setError(null);
    setBusy(body instanceof FormData ? "Reading your chat…" : "Loading the demo chat…");
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        ...(body instanceof FormData
          ? { body }
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const info = (await res.json()) as UploadInfo;
      setUpload(info);
      if (info.suggestedType) setChatType(info.suggestedType);
      setMe(info.suggestedMe);
      go("who");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!upload || !me || !chatType) return;
    setError(null);
    setBusy("Waking Max up…");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uploadId: upload.uploadId, chatType, me, context: context.trim() || undefined }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const { reportId } = await res.json();
      router.push(`/report/${reportId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the report.");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-10 flex items-center justify-between">
        <button onClick={() => go("landing")} className="font-serif text-xl font-bold tracking-tight">
          Vibe Check<span className="text-accent">.</span>
        </button>
        {step !== "landing" && (
          <ol className="flex gap-1.5" aria-label="Progress">
            {(["type", "upload", "who"] as Step[]).map((s, i) => (
              <li
                key={s}
                aria-current={s === step ? "step" : undefined}
                className={`h-1.5 w-8 rounded-full ${["type", "upload", "who"].indexOf(step) >= i ? "bg-accent" : "bg-line"}`}
              />
            ))}
          </ol>
        )}
      </header>

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {step === "landing" && <Landing onStart={() => go("type")} onDemo={(d) => sendUpload({ demo: d })} busy={busy} />}

      {step === "type" && (
        <section className="fade-up">
          <h1 className="font-serif text-3xl font-bold sm:text-4xl">Who&apos;s in this chat?</h1>
          <p className="mt-2 text-ink-2">Max reads a family chat very differently from a situationship.</p>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setChatType(t.key);
                  go("upload");
                }}
                className={`rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-accent ${
                  chatType === t.key ? "border-accent bg-accent-soft" : "border-line bg-card"
                }`}
              >
                <div className="text-2xl">{t.emoji}</div>
                <div className="mt-2 font-semibold">{t.label}</div>
                <div className="text-sm text-ink-3">{t.hint}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === "upload" && <UploadStep busy={busy} onFile={(f) => { const fd = new FormData(); fd.append("file", f); sendUpload(fd); }} onBack={() => go("type")} />}

      {step === "who" && upload && (
        <section className="fade-up">
          <p className="text-sm font-medium uppercase tracking-widest text-ink-3">
            {upload.messageCount.toLocaleString("en-IN")} messages · {fmtDate(upload.firstDate)} – {fmtDate(upload.lastDate)}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-bold sm:text-4xl">Which one is you?</h1>
          <p className="mt-2 text-ink-2">Max writes the report to you, so pick yourself.</p>
          <div className="mt-6 grid gap-2" role="radiogroup" aria-label="Which participant are you">
            {upload.participants.map((p) => (
              <button
                key={p.name}
                role="radio"
                aria-checked={me === p.name}
                onClick={() => setMe(p.name)}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  me === p.name ? "border-accent bg-accent-soft" : "border-line bg-card hover:border-ink-3"
                }`}
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-ink-3">{p.messages.toLocaleString("en-IN")} messages</span>
              </button>
            ))}
          </div>

          {!chatType && (
            <div className="mt-6">
              <label className="text-sm font-medium">Chat type</label>
              <select
                className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2"
                value=""
                onChange={(e) => setChatType(e.target.value as ChatTypeKey)}
              >
                <option value="" disabled>Choose…</option>
                {TYPES.map((t) => <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>)}
              </select>
            </div>
          )}

          <label htmlFor="ctx" className="mt-8 block text-sm font-medium">
            Anything Max should know? <span className="text-ink-3">(optional)</span>
          </label>
          <input
            id="ctx"
            maxLength={200}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. she's my best friend's girlfriend, we're in final year"
            className="mt-1 w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-accent"
          />

          <button
            disabled={!me || !chatType || !!busy}
            onClick={start}
            className="mt-8 w-full rounded-full bg-accent px-6 py-4 text-lg font-semibold text-accent-ink transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            {busy ?? "Let Max read it →"}
          </button>
          <p className="mt-3 text-center text-xs text-ink-3">
            Takes about a minute. Your chat stays in memory only and is forgotten after 2 hours.
          </p>
        </section>
      )}
    </main>
  );
}

function Landing({ onStart, onDemo, busy }: { onStart: () => void; onDemo: (d: "pair" | "group") => void; busy: string | null }) {
  return (
    <section className="fade-up">
      <p className="text-sm font-medium uppercase tracking-widest text-accent">Your chat, read by an AI with opinions</p>
      <h1 className="mt-3 font-serif text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
        Your chat has been keeping notes on you.
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
        Upload a WhatsApp export and Max reads every message, then writes you a long, weirdly specific story about the
        relationship: who really does the work, the running jokes, the eras, the fights, and the thing neither of you says.
      </p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button onClick={onStart} className="rounded-full bg-accent px-7 py-4 text-lg font-semibold text-accent-ink transition hover:brightness-110">
          Upload a chat
        </button>
        <button
          onClick={() => onDemo("pair")}
          disabled={!!busy}
          className="rounded-full border border-line bg-card px-7 py-4 text-lg font-medium transition hover:border-ink-3 disabled:opacity-50"
        >
          {busy ?? "Try with a demo chat"}
        </button>
      </div>
      <button onClick={() => onDemo("group")} disabled={!!busy} className="mt-3 text-sm text-ink-3 underline underline-offset-4 hover:text-ink">
        or try the 5-person hostel group demo
      </button>

      <figure className="mt-14 rounded-3xl border border-line bg-card p-6 sm:p-8">
        <p className="text-xs font-medium uppercase tracking-widest text-ink-3">From a real-looking report</p>
        <blockquote className="mt-3 font-serif text-2xl font-semibold leading-snug sm:text-3xl">
          “₹40 Chai, a Borrowed Charger, and Your Sister&apos;s Exam Hall”
        </blockquote>
        <figcaption className="mt-4 text-ink-2">
          <span className="font-medium text-ink">Max:</span> “You sent 58% of the messages and started 63% of the conversations. My
          read? You&apos;re not the friend. You&apos;re the infrastructure.”
        </figcaption>
      </figure>

      <div className="mt-10 grid gap-4 text-sm text-ink-2 sm:grid-cols-3">
        <div><div className="text-xl">🔒</div><p className="mt-1"><b className="text-ink">Private by design.</b> Read in memory, never written to disk or logs, gone after 2 hours.</p></div>
        <div><div className="text-xl">🧾</div><p className="mt-1"><b className="text-ink">Receipts, not vibes.</b> Every quote is pulled word-for-word from your chat.</p></div>
        <div><div className="text-xl">🗣️</div><p className="mt-1"><b className="text-ink">Speaks Manglish.</b> And Hinglish, and whatever your chat is in.</p></div>
      </div>
    </section>
  );
}

function UploadStep({ onFile, onBack, busy }: { onFile: (f: File) => void; onBack: () => void; busy: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [os, setOs] = useState<"android" | "iphone">("android");
  return (
    <section className="fade-up">
      <button onClick={onBack} className="text-sm text-ink-3 hover:text-ink">← Back</button>
      <h1 className="mt-2 font-serif text-3xl font-bold sm:text-4xl">Upload your WhatsApp export</h1>
      <p className="mt-2 text-ink-2">The <code>.txt</code> or <code>.zip</code> that WhatsApp&apos;s “Export chat” gives you. Choose <b>Without media</b>.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={`mt-6 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? "border-accent bg-accent-soft" : "border-line bg-card"
        }`}
      >
        <div className="text-4xl">📥</div>
        <p className="mt-3 font-medium">{busy ?? "Drop the file here"}</p>
        <button
          disabled={!!busy}
          onClick={() => input.current?.click()}
          className="mt-4 rounded-full bg-accent px-6 py-3 font-semibold text-accent-ink disabled:opacity-50"
        >
          Choose file
        </button>
        <input
          ref={input}
          type="file"
          accept=".txt,.zip,text/plain,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-paper-2 p-5">
        <div className="flex gap-2" role="tablist">
          {(["android", "iphone"] as const).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={os === k}
              onClick={() => setOs(k)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${os === k ? "bg-ink text-paper" : "text-ink-2"}`}
            >
              {k === "android" ? "Android" : "iPhone"}
            </button>
          ))}
        </div>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          {os === "android" ? (
            <>
              <li>Open the chat in WhatsApp.</li>
              <li>Tap <b>⋮</b> (top right) → <b>More</b> → <b>Export chat</b>.</li>
              <li>Choose <b>Without media</b>.</li>
              <li>Save it to Files / Drive (or email it to yourself), then upload the <code>.txt</code> here.</li>
            </>
          ) : (
            <>
              <li>Open the chat in WhatsApp.</li>
              <li>Tap the contact or group name at the top.</li>
              <li>Scroll down and tap <b>Export Chat</b> → <b>Without Media</b>.</li>
              <li>Choose <b>Save to Files</b>, then upload the <code>.zip</code> here (no need to unzip).</li>
            </>
          )}
        </ol>
        <p className="mt-4 text-xs text-ink-3">🔒 Max reads your chat in memory to write the report. Nothing is saved to disk, and it&apos;s forgotten after 2 hours.</p>
      </div>
    </section>
  );
}
