# Vibe Check

Upload an exported WhatsApp chat, pick the relationship type, and get a long-form,
story-driven report about the relationship, written by **Max**, an opinionated AI
narrator. The first part is free; the rest sits behind a (stubbed) paywall. Then you
can ask Max follow-up questions.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in GEMINI_API_KEY
npm run dev                  # http://localhost:3000
npm test                     # vitest: parser, stats, LLM pipeline (Gemini mocked)
```

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google Gemini key. Read server-side only and never sent to the browser. |
| `GEMINI_MODEL` | Optional model override. The default (latest Gemini Flash) is set in one place: `src/lib/llm/config.ts`. |
| `VIBE_MOCK_LLM=1` | Optional offline mode: reports are built from the stats alone, with no API calls. Useful for UI work. Mock reports show a banner. |

"Try with a demo chat" uses the fake exports in `/fixtures`. To regenerate them
(the generator is seeded, so the output is deterministic), run `npm run fixtures`.

## Architecture

```
upload (.txt/.zip) ─► parse/ ─► in-memory store (uploadId, 2h TTL)
                                   │
POST /api/report ──► pipeline (runs via next/server `after`) ──► reports store (reportId, 2h TTL)
   1. Parsing   (already done at upload)
   2. Counting  stats.ts: pure functions, no LLM
   3. Reading   Step A: fact extraction  ── 1 Gemini call (or 2 time-chunks for huge chats)
   4. Writing   Step B: report writing   ── 1 Gemini call
                quote ids ─► exact text pulled from the parsed chat (resolve.ts)

GET  /api/report/:id/status   progress for the loading screen
GET  /api/report/:id          FREE portion only (allow-listed in toFreeReport)
POST /api/report/:id/unlock   STUB: sets the unlock flag (TODO Razorpay)
GET  /api/report/:id/full     402 until unlocked, then the full report
POST /api/report/:id/chat     streamed follow-up answers (402 until unlocked)
```

### Code map

- `src/lib/parse/`: the `ChatParser` interface (`types.ts`) and a registry (`index.ts`, which also handles zip files). `whatsapp.ts` covers:
  - Android and iOS line formats, 12h/24h clocks, 2- or 4-digit years
  - dd/mm vs mm/dd detected from the data (with a chronology fallback)
  - multi-line messages
  - system, media, deleted and call events (call events are kept)

  To add Instagram or Telegram, implement `ChatParser` and add it to `PARSERS`.
- `src/lib/stats.ts` computes:
  - per-person share, words, media and calls
  - initiations (first message after a gap of 6h or more), median reply time, double-texts, question ratio
  - hour × weekday heatmap and monthly volume
  - silences and busiest days
  - emojis, n-gram phrases, and ₹/rs/rupees amounts
- `src/lib/llm/`:
  - `config.ts`: the model name, call budget and chunk size
  - `gemini.ts`:
    - structured output (`responseMimeType` + `responseSchema`), validated with zod and retried once on invalid JSON
    - 429/quota backoff: at most 3 tries, then "Max needs a breather"
    - `LlmBudget`: at most **4 calls per report**. Only calls that returned a response count, since quota-rejected attempts aren't billed. A JSON retry never uses up the call reserved for a later step.
- `src/lib/report/`:
  - `persona.ts`: Max's voice and section plan
  - `compact.ts`: `id|YYYY-MM-DD HH:mm|Sender|text` lines, phone/email/UPI masking, token estimate, and time-chunking above ~600k tokens
  - `extract.ts`: Step A, plus a deterministic merge of chunk results, so map-reduce costs no extra LLM call
  - `write.ts`: Step B
  - `resolve.ts`: quote resolution and the free/paid split
  - `followup.ts`: keyword search used to ground the chat
- `src/components/`: the upload wizard (`Flow.tsx`) and the report UI (`report/`). Charts use recharts; share-as-image uses html-to-image.

### Privacy

- Uploads are parsed from memory (`File.arrayBuffer()`). Nothing is written to disk.
- Errors are logged only as error names or status codes, never as message text.
- Parsed chats and reports live in a `Map` with a 2-hour TTL. A restart wipes them.
- The browser only ever receives the free portion until the server-side unlock flag is set. Paid content is never sent and hidden with CSS.

### Paywall (stub)

`POST /api/report/:id/unlock` currently unlocks for anyone. To make it real:
1. Create a Razorpay order in that route.
2. Open Razorpay Checkout in `ReportView.unlock()`.
3. Set `job.unlocked` only after verifying the payment signature server-side.

This is a paid service, so it hasn't been added yet.

### Limits

- The in-memory store only works with a single server process. If you scale out, use a shared TTL cache such as Redis.
- The token estimate is a heuristic: Latin text counts at about 3.6 chars per token, other scripts and emoji at 1 per char.
- Chats larger than about 1.2M tokens are evenly sampled down to fit two chunks.
