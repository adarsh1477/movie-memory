export type AppError =
  | { code: "UNAUTHORIZED"; message: string }
  | { code: "VALIDATION"; message: string; fieldErrors?: Record<string, string> }
  | { code: "NOT_FOUND"; message: string }
  | { code: "NO_MOVIE"; message: string }
  | { code: "RATE_LIMITED"; message: string; retryAfterMs: number }
  | { code: "UPSTREAM_FAILED"; message: string }
  | { code: "INTERNAL"; message: string };

export type AppErrorCode = AppError["code"];

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHORIZED: 401,
  VALIDATION: 400,
  NOT_FOUND: 404,
  NO_MOVIE: 400,
  RATE_LIMITED: 429,
  UPSTREAM_FAILED: 502,
  INTERNAL: 500,
};

export class AppErrorException extends Error {
  readonly status: number;

  constructor(public readonly error: AppError) {
    super(error.message);
    this.name = "AppErrorException";
    this.status = HTTP_STATUS[error.code];
  }
}

/** OpenAI failed after the allowed retry, timed out, or returned nothing usable. */
export class OpenAiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenAiError";
  }
}

/** Postgres gave up waiting for the advisory lock (SQLSTATE 55P03). */
export class LockTimeoutError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Timed out waiting for fact lock", options);
    this.name = "LockTimeoutError";
  }
}
