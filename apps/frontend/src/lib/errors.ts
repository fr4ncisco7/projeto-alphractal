export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function messageFrom(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof Error && cause.name === "AbortError") return fallback;
  return fallback;
}
