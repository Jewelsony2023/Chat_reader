import { getFinishedJob, noStore } from "@/lib/api";
import { toErrorResponse } from "@/lib/errors";

/**
 * STUB paywall. Anyone with the report id can unlock it.
 * TODO(razorpay): create a Razorpay order here and return its id to the client;
 * set job.unlocked only in a webhook/verify endpoint after checking the
 * payment signature (razorpay_order_id|razorpay_payment_id HMAC-SHA256).
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/report/[id]/unlock">) {
  try {
    const job = getFinishedJob((await ctx.params).id);
    job.unlocked = true;
    return Response.json({ unlocked: true }, { headers: noStore });
  } catch (err) {
    return toErrorResponse(err);
  }
}
