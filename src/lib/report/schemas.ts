import { Type, type Schema } from "@google/genai";
import { z } from "zod";

// ---------------------------------------------------------------- helpers
const str = z.string().trim();
const ids = z.array(z.coerce.number().int().nonnegative()).default([]);
const date = str.max(40); // the model is asked for YYYY-MM-DD, kept lenient
const S = (description?: string): Schema => ({ type: Type.STRING, ...(description ? { description } : {}) });
const INT_ARRAY = (description: string): Schema => ({ type: Type.ARRAY, items: { type: Type.INTEGER }, description });
const obj = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: Type.OBJECT,
  properties,
  required,
  propertyOrdering: Object.keys(properties),
});
const arr = (items: Schema, description?: string): Schema => ({ type: Type.ARRAY, items, ...(description ? { description } : {}) });

// ---------------------------------------------------------------- Step A: fact sheet
export const FactSheetZ = z.object({
  episodes: z
    .array(
      z.object({
        date,
        title: str,
        what_happened: str,
        who_helped_whom: str.default(""),
        funny_score: z.coerce.number().transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
        quote_ids: ids,
      }),
    )
    .default([]),
  life_milestones: z.array(z.object({ date, event: str })).default([]),
  people_mentioned: z.array(z.object({ name: str, relation_guess: str.default("") })).default([]),
  places: z.array(str).default([]),
  recurring_jokes_and_nicknames: z
    .array(z.object({ phrase: str, meaning: str, example_ids: ids }))
    .default([]),
  favours_ledger: z.array(z.object({ date, from: str, to: str, favour: str })).default([]),
  money_events: z.array(z.object({ date, amount: z.coerce.number(), context: str })).default([]),
  tensions: z.array(z.object({ date, what: str, how_resolved: str.default("") })).default([]),
  unspoken_pattern_candidates: z.array(str).default([]),
});
export type FactSheet = z.infer<typeof FactSheetZ>;

export const FACT_SHEET_SCHEMA: Schema = obj({
  episodes: arr(
    obj({
      date: S("YYYY-MM-DD"),
      title: S("short punchy title"),
      what_happened: S("2-3 factual sentences"),
      who_helped_whom: S("e.g. 'Rahul helped Anjali' or '' if not applicable"),
      funny_score: { type: Type.INTEGER, description: "1-5", minimum: 1, maximum: 5 },
      quote_ids: INT_ARRAY("ids of the 1-6 consecutive-ish messages that best show this episode"),
    }),
    "15-30 concrete, dated episodes across the whole timeline",
  ),
  life_milestones: arr(obj({ date: S("YYYY-MM-DD"), event: S() }), "exams, birthdays, moving, trips, jobs, results"),
  people_mentioned: arr(obj({ name: S(), relation_guess: S() })),
  places: arr(S()),
  recurring_jokes_and_nicknames: arr(
    obj({ phrase: S(), meaning: S(), example_ids: INT_ARRAY("2-4 message ids where it appears") }),
  ),
  favours_ledger: arr(obj({ date: S("YYYY-MM-DD"), from: S("participant name"), to: S("participant name"), favour: S() })),
  money_events: arr(obj({ date: S("YYYY-MM-DD"), amount: { type: Type.NUMBER }, context: S("who paid/owes whom and why") })),
  tensions: arr(obj({ date: S("YYYY-MM-DD"), what: S(), how_resolved: S() })),
  unspoken_pattern_candidates: arr(S(), "3-6 hypotheses about patterns neither person names, phrased tentatively"),
});

// ---------------------------------------------------------------- Step B: report
export const ReportDraftZ = z.object({
  title: str.min(3),
  subtitle: str,
  cold_open: z.object({
    date,
    quote_ids: ids,
    reaction_markdown: str,
  }),
  context_paragraph: str,
  promise_line: str,
  sections: z
    .array(
      z.object({
        emoji: str.max(16),
        heading: str,
        intro_markdown: str,
        evidence: z
          .array(z.object({ date, point: str, quote_ids: ids }))
          .default([]),
        closing_markdown: str.default(""),
        coined_pattern_name: str.optional(),
      }),
    )
    .min(3),
  participant_profiles: z.array(z.object({ name: str, role_title: str, description: str })).default([]),
  verdict: str,
  suggested_questions: z.array(str).min(1).transform((q) => q.slice(0, 3)),
});
export type ReportDraft = z.infer<typeof ReportDraftZ>;

export const REPORT_SCHEMA: Schema = obj(
  {
    title: S("three oddly specific concrete details from the chat, comma-separated, e.g. '₹40 Chai, a Borrowed Charger, and Your Sister's Exam Hall'"),
    subtitle: S("one wry line"),
    cold_open: obj({
      date: S("YYYY-MM-DD of the scene"),
      quote_ids: INT_ARRAY("3-8 message ids that play the scene line by line, in order"),
      reaction_markdown: S("Max's honest reaction, 1-2 short paragraphs"),
    }),
    context_paragraph: S(),
    promise_line: S("one line promising what the rest of the report reveals"),
    sections: arr(
      obj(
        {
          emoji: S(),
          heading: S(),
          intro_markdown: S("opens with a contrast or claim; weaves exact numbers into prose"),
          evidence: arr(
            obj({
              date: S("YYYY-MM-DD"),
              point: S("one evidence bullet in Max's voice"),
              quote_ids: INT_ARRAY("0-4 message ids to show as chat bubbles"),
            }),
            "3-6 dated evidence bullets",
          ),
          closing_markdown: S("1-2 sentences landing the point"),
          coined_pattern_name: S("catchy name for a behaviour, e.g. 'the Grumble-Then-Deliver'"),
        },
        ["emoji", "heading", "intro_markdown", "evidence", "closing_markdown", "coined_pattern_name"],
      ),
    ),
    participant_profiles: arr(obj({ name: S(), role_title: S(), description: S() })),
    verdict: S("Max's closing verdict, markdown, 1-2 paragraphs"),
    suggested_questions: arr(S(), "exactly 3 follow-up questions the user might ask Max"),
  },
);
