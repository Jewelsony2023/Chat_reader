import { z } from "zod";
import { getFinishedJob } from "@/lib/api";
import { isCreator } from "@/lib/creator";
import { AppError, toErrorResponse } from "@/lib/errors";
import { isMockLlm } from "@/lib/llm/config";
import { streamText } from "@/lib/llm/gemini";
import { buildFollowupSystem, searchMessages } from "@/lib/report/followup";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) }))
    .min(1)
    .max(40),
});

const MAX_TURNS_PER_REPORT = 30;
const turns = new Map<string, number>();

/** Streams Max's answer as plain text. Requires the report to be unlocked. */
export async function POST(req: Request, ctx: RouteContext<"/api/report/[id]/chat">) {
  try {
    const { id } = await ctx.params;
    const job = getFinishedJob(id);
    if (!job.unlocked && !isCreator(req)) throw new AppError("LOCKED", "Unlock the full report to chat with Max.");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Ask Max a question (max 2,000 characters).");
    const history = parsed.data.messages.slice(-12);
    const last = history[history.length - 1];
    if (last.role !== "user") throw new AppError("BAD_REQUEST", "The last message must be your question.");
    const used = turns.get(id) ?? 0;
    if (used >= MAX_TURNS_PER_REPORT) throw new AppError("QUOTA", "Max has answered a lot of questions on this report. Take a break and come back later.");
    turns.set(id, used + 1);

    const encoder = new TextEncoder();
    let gen: AsyncGenerator<string>;
    if (isMockLlm()) {
      const hits = searchMessages(job.chat, last.text, 3, 0);
      gen = (async function* () {
        const lines = [
          "(Offline mock mode, so no real opinions today.) ",
          hits.length
            ? `Here's what the chat says about that: ${hits.map((h) => `“${h.text}” (${h.sender})`).join("; ")}.`
            : "I couldn't find messages matching that question.",
        ];
        for (const l of lines) for (const word of l.split(/(?<= )/)) yield word;
      })();
    } else {
      // Kick off the request before streaming so quota/config errors become proper HTTP errors.
      const system = buildFollowupSystem(job, last.text);
      const it = streamText({
        system,
        history: history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.text })),
      });
      const first = await it.next();
      gen = (async function* () {
        if (!first.done) yield first.value;
        yield* it;
      })();
    }

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await gen.next();
          if (done) controller.close();
          else controller.enqueue(encoder.encode(value));
        } catch (err) {
          const msg = err instanceof AppError ? err.message : "Max lost the thread. Try asking again.";
          controller.enqueue(encoder.encode(`\n\n_${msg}_`));
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
