import type { Quote } from "@/lib/report/types";

function fmtWhen(at: string) {
  const d = new Date(at.replace(" ", "T") + ":00Z");
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function body(q: Quote) {
  if (q.kind === "media") return <span className="italic opacity-70">📎 media</span>;
  if (q.kind === "deleted") return <span className="italic opacity-70">🚫 this message was deleted</span>;
  if (q.kind === "call") return <span className="italic opacity-80">📞 {q.text}</span>;
  return q.text;
}

/** Exact chat lines rendered as WhatsApp-ish bubbles: you on the right. */
export default function Bubbles({ quotes, showNames }: { quotes: Quote[]; showNames: boolean }) {
  if (quotes.length === 0) return null;
  const firstDate = fmtWhen(quotes[0].at);
  return (
    <figure className="my-4 rounded-2xl p-3 sm:p-4" style={{ background: "var(--chat-bg)" }}>
      <figcaption className="mb-2 text-center text-[11px] font-medium uppercase tracking-wider text-ink-3">{firstDate}</figcaption>
      <ul className="flex flex-col gap-1.5">
        {quotes.map((q, i) => {
          const prev = quotes[i - 1];
          const sameAsPrev = prev && prev.sender === q.sender;
          return (
            <li key={q.id} className={`flex ${q.mine ? "justify-end" : "justify-start"} ${sameAsPrev ? "" : "mt-1"}`}>
              <div
                className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[15px] leading-snug shadow-sm"
                style={{
                  background: q.mine ? "var(--bubble-me)" : "var(--bubble-them)",
                  color: q.mine ? "var(--bubble-me-ink)" : "var(--bubble-them-ink)",
                  borderTopRightRadius: q.mine && !sameAsPrev ? 6 : undefined,
                  borderTopLeftRadius: !q.mine && !sameAsPrev ? 6 : undefined,
                }}
              >
                {showNames && !q.mine && !sameAsPrev && <div className="text-xs font-semibold text-accent">{q.sender}</div>}
                {body(q)}
                <span className="ml-2 align-bottom text-[10px] opacity-50">{q.at.slice(11)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
