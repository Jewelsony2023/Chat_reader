export type ErrorCode =
  | "WRONG_FILE"
  | "UNPARSEABLE"
  | "TOO_FEW_MESSAGES"
  | "FILE_TOO_LARGE"
  | "QUOTA"
  | "LLM_JSON"
  | "LLM_CONFIG"
  | "LLM_FAILED"
  | "NOT_FOUND"
  | "LOCKED"
  | "BAD_REQUEST";

const STATUS: Record<ErrorCode, number> = {
  WRONG_FILE: 415,
  UNPARSEABLE: 422,
  TOO_FEW_MESSAGES: 422,
  FILE_TOO_LARGE: 413,
  QUOTA: 429,
  LLM_JSON: 502,
  LLM_CONFIG: 500,
  LLM_FAILED: 502,
  NOT_FOUND: 404,
  LOCKED: 402,
  BAD_REQUEST: 400,
};

/** An error whose message is safe and friendly enough to show to the user. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export const QUOTA_MESSAGE =
  "Max needs a breather — the AI is getting a lot of requests right now. Give it a minute and try again.";

export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  // Never echo raw errors: they could contain chat content.
  console.error("[vibe-check] unexpected error:", err instanceof Error ? err.name : typeof err);
  return Response.json(
    { error: "Something went wrong on our side. Please try again.", code: "INTERNAL" },
    { status: 500 },
  );
}
