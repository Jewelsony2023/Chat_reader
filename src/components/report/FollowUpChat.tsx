"use client";

import { useRef, useState } from "react";
import { Md } from "./SectionView";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

export default function FollowUpChat({ reportId, suggestions }: { reportId: string; suggestions: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || streaming) return;
    const history: Msg[] = [...msgs, { role: "user", text: question }];
    setMsgs([...history, { role: "assistant", text: "" }]);
    setInput("");
    setStreaming(true);
    const append = (t: string) =>
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1].text + t };
        return copy;
      });
    try {
      const res = await fetch(`/api/report/${reportId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        append(`_${j.error ?? "Max couldn't answer that right now."}_`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        append(dec.decode(value, { stream: true }));
        endRef.current?.scrollIntoView({ block: "nearest" });
      }
    } catch {
      append("_Connection dropped. Try again?_");
    } finally {
      setStreaming(false);
    }
  }

  const unused = suggestions.filter((s) => !msgs.some((m) => m.role === "user" && m.text === s));

  return (
    <section className="mt-16 rounded-3xl border border-line bg-card p-5 sm:p-7" aria-labelledby="ask">
      <h2 id="ask" className="font-serif text-2xl font-bold sm:text-3xl">💬 Ask Max anything</h2>
      <p className="mt-1 text-sm text-ink-2">Max has the stats, the notes, and can search the chat. Same voice, same receipts.</p>

      {msgs.length > 0 && (
        <div className="mt-6 space-y-4">
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-accent px-4 py-2 text-accent-ink">{m.text}</div>
            ) : (
              <div key={i} className="max-w-[95%]">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">Max</div>
                {m.text ? <Md className="[&_p]:text-base">{m.text}</Md> : <span className="animate-pulse text-ink-3">Max is scrolling back through your chat…</span>}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
      )}

      {unused.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {unused.map((s) => (
            <button
              key={s}
              disabled={streaming}
              onClick={() => ask(s)}
              className="rounded-full border border-line bg-paper px-4 py-2 text-left text-sm transition hover:border-accent disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Who apologises first?"
          aria-label="Ask Max a question"
          className="min-w-0 flex-1 rounded-full border border-line bg-paper px-4 py-3 outline-none focus:border-accent"
        />
        <button disabled={streaming || !input.trim()} className="rounded-full bg-accent px-5 py-3 font-semibold text-accent-ink disabled:opacity-40">
          Ask
        </button>
      </form>
    </section>
  );
}
