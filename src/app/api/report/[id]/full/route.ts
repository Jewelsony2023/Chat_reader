import { getFinishedJob, noStore } from "@/lib/api";
import { isCreator } from "@/lib/creator";
import { AppError, toErrorResponse } from "@/lib/errors";

/** The full report: only after the unlock flag is set server-side (or for the creator). */
export async function GET(req: Request, ctx: RouteContext<"/api/report/[id]/full">) {
  try {
    const job = getFinishedJob((await ctx.params).id);
    if (!job.unlocked && !isCreator(req)) throw new AppError("LOCKED", "Unlock the full report to read the rest.");
    return Response.json({ report: job.full }, { headers: noStore });
  } catch (err) {
    return toErrorResponse(err);
  }
}
