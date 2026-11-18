import { NextResponse } from "next/server";
import { HTTP_STATUS, type AppError } from "./errors";

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
