import "server-only";
import { AppError } from "./errors";
import { reports, type ReportJob } from "./store";

export function getJob(id: string): ReportJob {
  const job = reports.get(id);
  if (!job) {
    throw new AppError("NOT_FOUND", "This report has expired or doesn't exist. Reports are kept in memory for 2 hours — upload the chat again to regenerate it.");
  }
  return job;
}

export function getFinishedJob(id: string): ReportJob & { full: NonNullable<ReportJob["full"]> } {
  const job = getJob(id);
  if (job.stage === "error") throw new AppError("LLM_FAILED", job.error?.message ?? "This report failed to generate.");
  if (!job.full) throw new AppError("BAD_REQUEST", "Max is still writing this report.");
  return job as ReportJob & { full: NonNullable<ReportJob["full"]> };
}

export const noStore = { "Cache-Control": "no-store" };
