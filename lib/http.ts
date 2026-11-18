import { NextResponse } from "next/server";
import { auth } from "./auth";
import { AppErrorException, HTTP_STATUS, type AppError } from "./errors";
import { logger } from "./logger";

// Every authed response is per-user data: never let a browser or CDN cache it.
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, headers: NO_STORE });
}

export function jsonError(error: AppError): NextResponse {
  const headers: Record<string, string> = { ...NO_STORE };
  if (error.code === "RATE_LIMITED") {
    headers["Retry-After"] = String(Math.ceil(error.retryAfterMs / 1000));
  }
  return NextResponse.json({ ok: false, error }, { status: HTTP_STATUS[error.code], headers });
}

/**
 * The real auth guard for route handlers (proxy.ts is UX only).
 * Returns the session's userId, or throws UNAUTHORIZED.
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new AppErrorException({ code: "UNAUTHORIZED", message: "Sign in required" });
  return userId;
}

/**
 * Runs a route body and turns failures into the standard error envelope.
 * Unexpected errors are logged and returned as a generic INTERNAL so internal
 * messages never reach the client.
 */
export async function handle(route: string, fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppErrorException) return jsonError(err.error);
    logger.error({ event: "api.unhandled_error", route, err });
    return jsonError({ code: "INTERNAL", message: "Something went wrong. Please try again." });
  }
}
