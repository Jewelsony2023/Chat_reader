import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, toErrorResponse } from "@/lib/errors";
import { noStore } from "@/lib/api";
import { MAX_UPLOAD_BYTES, parseText, parseUpload } from "@/lib/parse";
import { isoDate } from "@/lib/stats";
import { newId, uploads } from "@/lib/store";

const DEMOS: Record<string, { file: string; me: string }> = {
  pair: { file: "whatsapp-anjali-rahul.txt", me: "Anjali" },
  group: { file: "whatsapp-hostel-group.txt", me: "Meera" },
};

/**
 * Accepts multipart/form-data with a `file`, or JSON { demo: "pair" | "group" }.
 * The chat is parsed in memory and kept only in the 2-hour in-memory store.
 */
export async function POST(req: Request) {
  try {
    let chat;
    let demo: string | null = null;
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as { demo?: string };
      const d = body.demo ? DEMOS[body.demo] : undefined;
      if (!d) throw new AppError("BAD_REQUEST", "Unknown demo chat.");
      demo = body.demo!;
      chat = parseText(await readFile(join(process.cwd(), "fixtures", d.file), "utf8"), d.file);
    } else {
      const len = Number(req.headers.get("content-length") ?? 0);
      if (len > MAX_UPLOAD_BYTES + 1024 * 1024) {
        throw new AppError("FILE_TOO_LARGE", "That file is over 40 MB. Export the chat without media.");
      }
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!file || typeof file === "string") throw new AppError("BAD_REQUEST", "No file received. Pick your exported chat and try again.");
      chat = await parseUpload(new Uint8Array(await file.arrayBuffer()), file.name);
    }

    const uploadId = newId();
    uploads.set(uploadId, { chat, demo: demo !== null });
    const real = chat.messages.filter((m) => m.kind === "text" || m.kind === "media" || m.kind === "deleted");
    const counts = new Map<string, number>();
    for (const m of real) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);

    return Response.json(
      {
        uploadId,
        participants: chat.participants.map((name) => ({ name, messages: counts.get(name) ?? 0 })),
        messageCount: real.length,
        firstDate: isoDate(real[0].ts),
        lastDate: isoDate(real[real.length - 1].ts),
        suggestedMe: demo ? DEMOS[demo].me : null,
        suggestedType: demo === "group" ? "friend_group" : demo === "pair" ? "one_friend" : null,
      },
      { headers: noStore },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
