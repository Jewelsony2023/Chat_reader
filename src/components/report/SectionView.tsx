import ReactMarkdown from "react-markdown";
import type { Section } from "@/lib/report/types";
import Bubbles from "./Bubbles";

export function Md({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`prose-max ${className}`}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

function fmtDay(d: string) {
  const t = Date.parse(d + "T00:00:00Z");
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function Callouts({ items }: { items: Section["callouts"] }) {
  if (!items.length) return null;
  return (
    <div className="my-6 grid gap-3 sm:grid-cols-2">
      {items.map((c) => (
        <div key={c.label} className="rounded-2xl border border-line bg-card px-5 py-4">
          <div className="font-serif text-3xl font-bold text-accent">{c.value}</div>
          <div className="mt-1 text-sm text-ink-2">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function SectionView({ section, index, showNames }: { section: Section; index: number; showNames: boolean }) {
  return (
    <section className="mt-16" aria-labelledby={`s${index}`}>
      <p className="text-sm font-medium uppercase tracking-widest text-ink-3">Part {index + 1}</p>
      <h2 id={`s${index}`} className="mt-1 font-serif text-3xl font-bold leading-tight sm:text-4xl">
        <span className="mr-2">{section.emoji}</span>
        {section.heading}
      </h2>
      {section.coined_pattern_name && (
        <p className="mt-3 inline-block rounded-full bg-accent-soft px-3 py-1 text-sm">
          Coined: <b>{section.coined_pattern_name}</b>
        </p>
      )}
      <Md className="mt-5">{section.intro_markdown}</Md>
      <Callouts items={section.callouts} />
      {section.evidence.length > 0 && (
        <ul className="mt-2 space-y-6">
          {section.evidence.map((e, i) => (
            <li key={i} className="border-l-2 border-line pl-4">
              <time className="text-xs font-semibold uppercase tracking-wider text-accent">{fmtDay(e.date)}</time>
              <Md className="mt-1 [&_p]:mb-0">{e.point}</Md>
              <Bubbles quotes={e.quotes} showNames={showNames} />
            </li>
          ))}
        </ul>
      )}
      {section.closing_markdown && <Md className="mt-6">{section.closing_markdown}</Md>}
    </section>
  );
}
