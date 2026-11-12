import { getJob, noStore } from "@/lib/api";
import { toErrorResponse } from "@/lib/errors";

export async function GET(_req: Request, ctx: RouteContext<"/api/report/[id]/status">) {
  try {
    const job = getJob((await ctx.params).id);
    return Response.json(
      { stage: job.stage, readingProgress: job.readingProgress, error: job.error ?? null },
      { headers: noStore },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
