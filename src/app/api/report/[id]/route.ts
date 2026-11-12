import { getFinishedJob, noStore } from "@/lib/api";
import { isCreator } from "@/lib/creator";
import { toErrorResponse } from "@/lib/errors";
import { toFreeReport } from "@/lib/report/resolve";

/** Free portion only. Paid content is never included here, unlocked or not. */
export async function GET(req: Request, ctx: RouteContext<"/api/report/[id]">) {
  try {
    const job = getFinishedJob((await ctx.params).id);
    const creator = isCreator(req);
    return Response.json(
      { report: toFreeReport(job.full), unlocked: job.unlocked || creator, creator },
      { headers: noStore },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
