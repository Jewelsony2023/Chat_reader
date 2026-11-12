import { after } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { noStore } from "@/lib/api";
import { CHAT_TYPE_KEYS } from "@/lib/report/persona";
import { createJob, runJob } from "@/lib/report/pipeline";
import { uploads } from "@/lib/store";

const Body = z.object({
  uploadId: z.string().min(1),
  chatType: z.enum(CHAT_TYPE_KEYS as [string, ...string[]]),
  me: z.string().min(1),
  context: z.string().max(200).optional(),
});

/** Starts report generation; the pipeline runs after the response is sent. Poll /status. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("BAD_REQUEST", "Missing chat type or participant.");
    const { uploadId, chatType, me, context } = parsed.data;
    const upload = uploads.get(uploadId);
    if (!upload) throw new AppError("NOT_FOUND", "That upload has expired. Please upload the chat again.");
    if (!upload.chat.participants.includes(me)) throw new AppError("BAD_REQUEST", "Pick one of the people in the chat.");

    const job = createJob({ chat: upload.chat, chatType: chatType as (typeof CHAT_TYPE_KEYS)[number], me, context: context?.trim() || undefined });
    after(() => runJob(job));
    return Response.json({ reportId: job.id }, { headers: noStore });
  } catch (err) {
    return toErrorResponse(err);
  }
}
