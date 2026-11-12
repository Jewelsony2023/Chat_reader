"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartData } from "@/lib/report/types";

const MAX_SERIES = 5;
const SERIES = Array.from({ length: MAX_SERIES }, (_, i) => `var(--series-${i + 1})`);
const OTHER = "var(--ink-3)";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtMonth(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Color follows the person (fixed participant order), never their rank in a given chart. */
function useSeries(participants: string[], data: ChartData) {
  return useMemo(() => {
    const named = participants.slice(0, participants.length > MAX_SERIES ? MAX_SERIES - 1 : MAX_SERIES);
    const hasOther = participants.length > named.length;
    const color = (name: string) => {
      const i = named.indexOf(name);
      return i >= 0 ? SERIES[i] : OTHER;
    };
    const keyOf = (name: string) => (named.includes(name) ? name : "Others");
    const keys = hasOther ? [...named, "Others"] : named;
    const monthly = data.monthly.map((m) => {
      const row: Record<string, number | string> = { month: m.month };
      for (const k of keys) row[k] = 0;
      for (const [name, n] of Object.entries(m.counts)) row[keyOf(name)] = (row[keyOf(name)] as number) + n;
      return row;
    });
    const share = keys.map((k) => {
      const messages = data.people.filter((p) => keyOf(p.name) === k).reduce((a, p) => a + p.messages, 0);
      return { name: k, messages, fill: k === "Others" ? OTHER : color(k) };
    });
    return { keys, color: (k: string) => (k === "Others" ? OTHER : color(k)), monthly, share };
  }, [participants, data]);
}

const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  color: "var(--ink)",
  fontSize: 13,
};

export default function Charts({ data, participants }: { data: ChartData; participants: string[] }) {
  const { keys, color, monthly, share } = useSeries(participants, data);
  const [table, setTable] = useState(false);
  const total = share.reduce((a, s) => a + s.messages, 0) || 1;

  return (
    <section className="mt-16" aria-labelledby="numbers">
      <p className="text-sm font-medium uppercase tracking-widest text-ink-3">The receipts</p>
      <h2 id="numbers" className="mt-1 font-serif text-3xl font-bold sm:text-4xl">📊 The numbers</h2>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <figure className="rounded-3xl border border-line bg-card p-5 lg:col-span-2">
          <figcaption className="font-semibold">Who sends the messages</figcaption>
          <div className="relative h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={share}
                  dataKey="messages"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="92%"
                  paddingAngle={1.5}
                  stroke="var(--card)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [`${Number(v).toLocaleString("en-IN")} (${Math.round((Number(v) / total) * 100)}%)`, "messages"]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-serif text-2xl font-bold">{total.toLocaleString("en-IN")}</div>
              <div className="text-xs text-ink-3">messages</div>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {share.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.fill }} aria-hidden />
                <span className="flex-1">{s.name}</span>
                <span className="tabular-nums text-ink-2">{Math.round((s.messages / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </figure>

        <figure className="rounded-3xl border border-line bg-card p-5 lg:col-span-3">
          <div className="flex items-center justify-between">
            <figcaption className="font-semibold">Messages per month</figcaption>
            <button onClick={() => setTable((t) => !t)} className="text-xs text-ink-3 underline underline-offset-4 hover:text-ink">
              {table ? "Show chart" : "Show as table"}
            </button>
          </div>
          {table ? (
            <div className="mt-3 max-h-64 overflow-auto text-sm">
              <table className="w-full tabular-nums">
                <thead className="sticky top-0 bg-card text-left text-ink-3">
                  <tr>
                    <th className="py-1 font-medium">Month</th>
                    {keys.map((k) => <th key={k} className="py-1 text-right font-medium">{k}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((r) => (
                    <tr key={r.month as string} className="border-t border-line">
                      <td className="py-1">{fmtMonth(r.month as string)}</td>
                      {keys.map((k) => <td key={k} className="py-1 text-right">{r[k] as number}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={fmtMonth} tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tick={{ fill: "var(--ink-3)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtMonth(String(l))} cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} iconType="plainline" />
                  {keys.map((k) => (
                    <Line key={k} type="linear" dataKey={k} stroke={color(k)} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </figure>
      </div>

      <Heatmap heatmap={data.heatmap} />
    </section>
  );
}

function Heatmap({ heatmap }: { heatmap: number[][] }) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const max = Math.max(1, ...heatmap.flat());
  const step = (v: number) => (v === 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999)));
  const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
  const peak = heatmap.flatMap((row, d) => row.map((v, h) => ({ v, d, h }))).sort((a, b) => b.v - a.v)[0];

  return (
    <figure className="mt-6 rounded-3xl border border-line bg-card p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">When you talk (hour of day × weekday)</span>
        <span className="text-sm text-ink-2" aria-live="polite">
          {hover
            ? `${DAYS[hover.d]} ${hourLabel(hover.h)}: ${heatmap[hover.d][hover.h].toLocaleString("en-IN")} messages`
            : peak && `Peak: ${DAYS[peak.d]} around ${hourLabel(peak.h)}`}
        </span>
      </figcaption>
      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "36px repeat(24, minmax(0, 1fr))" }} onMouseLeave={() => setHover(null)}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center text-[10px] text-ink-3">{h % 3 === 0 ? hourLabel(h) : ""}</div>
          ))}
          {heatmap.map((row, d) => (
            <div key={d} className="contents">
              <div className="pr-1 text-right text-[11px] leading-5 text-ink-3">{DAYS[d]}</div>
              {row.map((v, h) => (
                <div
                  key={h}
                  role="img"
                  aria-label={`${DAYS[d]} ${hourLabel(h)}: ${v} messages`}
                  onMouseEnter={() => setHover({ d, h })}
                  className="h-5 rounded-[4px] outline-offset-1 hover:outline hover:outline-2 hover:outline-[var(--ink)]"
                  style={{ background: `var(--seq-${step(v)})` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
        <span>fewer</span>
        {[0, 1, 2, 3, 4, 5].map((s) => <span key={s} className="h-3 w-5 rounded-[3px]" style={{ background: `var(--seq-${s})` }} />)}
        <span>more</span>
      </div>
    </figure>
  );
}
