import "server-only";
import { AppError, QUOTA_MESSAGE } from "../errors";
import { REPORT_DEADLINE_MS, isMockLlm } from "../llm/config";
import { LlmBudget } from "../llm/gemini";
import type { ParsedChat } from "../parse/types";
import { computeStats } from "../stats";
import { TTL_MS, newId, reports, type ReportJob } from "../store";
import { extractFacts } from "./extract";
import type { ChatType } from "./persona";
import { buildFullReport } from "./resolve";
import { writeReport } from "./write";

export function createJob(input: { chat: ParsedChat; chatType: ChatType; me: string; context?: string }): ReportJob {
  const now = Date.now();
  const job: ReportJob = {
    id: newId(),
    chatType: input.chatType,
    me: input.me,
    context: input.context,
    chat: input.chat,
    stage: "parsing",
    readingProgress: 0,
    unlocked: false,
    llmCalls: 0,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  reports.set(job.id, job);
  return job;
}

// Real stages take seconds; in mock mode slow down so the loading screen is visible.
const tick = () => new Promise((r) => setTimeout(r, isMockLlm() ? 1500 : 250));

/** Runs the whole pipeline, updating job.stage as it goes. Never throws; gives up after REPORT_DEADLINE_MS. */
export async function runJob(job: ReportJob, deadlineMs = REPORT_DEADLINE_MS): Promise<void> {
  const budget = new LlmBudget();
  const run = { timedOut: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      run.timedOut = true;
      reject(new AppError("QUOTA", QUOTA_MESSAGE));
    }, deadlineMs);
  });
  try {
    await Promise.race([generate(job, budget, run), deadline]);
  } catch (err) {
    job.llmCalls = budget.used;
    job.stage = "error";
    job.error =
      err instanceof AppError
        ? { code: err.code, message: err.message }
        : { code: "INTERNAL", message: "Something went wrong while Max was writing. Please try again." };
    if (!(err instanceof AppError)) console.error("[vibe-check] pipeline error:", err instanceof Error ? err.name : typeof err);
  } finally {
    clearTimeout(timer);
  }
}

async function generate(job: ReportJob, budget: LlmBudget, run: { timedOut: boolean }): Promise<void> {
  {
    job.stage = "parsing";
    await tick(); // parsing already happened at upload; give the UI a beat to show the stage

    job.stage = "counting";
    job.stats = computeStats(job.chat);
    await tick();

    job.stage = "reading";
    const { facts } = await extractFacts(job.chat, {
      chatType: job.chatType,
      budget,
      onChunk: (done, total) => (job.readingProgress = done / total),
    });
    job.facts = facts;
    if (isMockLlm()) await tick();
    job.llmCalls = budget.used;

    if (run.timedOut) return;
    job.stage = "writing";
    const today = new Date().toISOString().slice(0, 10);
    const draft = await writeReport(job.stats, facts, job.chat, { chatType: job.chatType, me: job.me, context: job.context, today }, budget);
    if (isMockLlm()) await tick();
    job.llmCalls = budget.used;
    if (run.timedOut) return; // too late: the user already saw the "busy" message

    job.full = buildFullReport(draft, job.chat, job.stats, facts, {
      id: job.id,
      chatType: job.chatType,
      me: job.me,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
      mock: isMockLlm(),
    });
    job.stage = "done";
  }
}
