/** Shapes sent to the browser. FreeReport is all the browser gets until unlock. */

export interface Quote {
  id: number;
  sender: string;
  at: string; // "YYYY-MM-DD HH:mm"
  text: string;
  kind: "text" | "media" | "deleted" | "call";
  mine: boolean;
}

export interface StatCallout {
  value: string;
  label: string;
}

export interface Evidence {
  date: string;
  point: string;
  quotes: Quote[];
}

export interface Section {
  emoji: string;
  heading: string;
  intro_markdown: string;
  evidence: Evidence[];
  closing_markdown: string;
  coined_pattern_name?: string;
  callouts: StatCallout[];
}

export interface ChartData {
  people: { name: string; messages: number; share: number }[];
  monthly: { month: string; counts: Record<string, number> }[];
  heatmap: number[][];
}

export interface ReportHeader {
  id: string;
  chatType: string;
  chatTypeLabel: string;
  me: string;
  participants: string[];
  createdAt: number;
  expiresAt: number;
  mock: boolean;
  title: string;
  subtitle: string;
  cold_open: { date: string; quotes: Quote[]; reaction_markdown: string };
  context_paragraph: string;
  promise_line: string;
  totals: { messages: number; spanYears: number; firstDate: string; lastDate: string };
}

export interface FullReport extends ReportHeader {
  sections: Section[];
  participant_profiles: { name: string; role_title: string; description: string }[];
  verdict: string;
  suggested_questions: string[];
  charts: ChartData;
}

export interface FreeReport extends ReportHeader {
  locked: true;
  /** Section 1, cut after its first evidence bullets. */
  preview_section: Section;
  /** Teaser only: headings of what's behind the paywall. */
  locked_sections: { emoji: string; heading: string }[];
}
