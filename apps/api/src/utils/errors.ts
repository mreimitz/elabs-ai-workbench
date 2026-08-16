export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

// `code` is an OPTIONAL machine-readable error code (e.g. REPO_NOT_BOUND) surfaced additively by the
// central error handler alongside the human message. Backward-compatible: omitting it changes nothing.
export function httpError(statusCode: number, message: string, code?: string) {
  const error = new Error(message) as Error & { statusCode: number; code?: string };
  error.statusCode = statusCode;
  if (code !== undefined) error.code = code;
  return error;
}
