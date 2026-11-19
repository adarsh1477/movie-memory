// Typed browser client for our API routes. Every failure becomes an
// AppErrorException with a stable `code`; aborts are rethrown untouched.

import { z } from "zod";
import { AppErrorException, type AppError } from "./errors";
import {
  ApiError,
  FactHistoryResponse,
  FactResponse,
  MeResponse,
  MovieSearchResponse,
  type MoviePutBody,
} from "./validation";

export const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
export const UNEXPECTED_RESPONSE_MESSAGE = "Something went wrong. Please try again.";

export async function apiFetch<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let res: Response;
  let json: unknown;
  try {
    res = await fetch(path, { ...init, headers, cache: "no-store" });
    json = await res.json().catch((err: unknown) => {
      if (isAbort(err)) throw err;
      return undefined; // empty or non-JSON body
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AppErrorException({ code: "INTERNAL", message: NETWORK_ERROR_MESSAGE });
  }

  if (res.ok) {
    const success = z.object({ ok: z.literal(true), data: schema }).safeParse(json);
    if (success.success) return success.data.data as z.infer<S>;
  }

  const failure = ErrorEnvelope.safeParse(json);
  throw new AppErrorException(normalize(res, failure.success ? failure.data.error : undefined));
}

const ErrorEnvelope = z.object({ ok: z.literal(false), error: ApiError });

function normalize(res: Response, body: ApiError | undefined): AppError {
  const message = body?.message ?? UNEXPECTED_RESPONSE_MESSAGE;

  if (res.status === 401 || body?.code === "UNAUTHORIZED") {
    return { code: "UNAUTHORIZED", message: body?.message ?? "Your session has ended. Please sign in again." };
  }
  if (res.status === 429 || body?.code === "RATE_LIMITED") {
    return {
      code: "RATE_LIMITED",
      message: body?.message ?? "Too many requests. Please slow down.",
      retryAfterMs: body?.retryAfterMs ?? retryAfterHeaderMs(res) ?? 1_000,
    };
  }
  if (!body || res.ok) return { code: "INTERNAL", message: UNEXPECTED_RESPONSE_MESSAGE };

  switch (body.code) {
    case "VALIDATION":
      return { code: "VALIDATION", message, ...(body.fieldErrors && { fieldErrors: body.fieldErrors }) };
    case "NOT_FOUND":
    case "NO_MOVIE":
    case "UPSTREAM_FAILED":
    case "INTERNAL":
      return { code: body.code, message };
  }
}

function retryAfterHeaderMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export function getMe(signal?: AbortSignal) {
  return apiFetch("/api/me", MeResponse, { signal });
}

export function putMovie(body: MoviePutBody, signal?: AbortSignal) {
  return apiFetch("/api/me/movie", MeResponse, { method: "PUT", body: JSON.stringify(body), signal });
}

export function getFact(signal?: AbortSignal) {
  return apiFetch("/api/fact", FactResponse, { signal });
}

/** One page of fact history. `cursor` = the previous page's nextCursor. */
export function getFactHistory(params: { limit?: number; cursor?: string | null } = {}, signal?: AbortSignal) {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const query = qs.toString();
  return apiFetch(`/api/facts/history${query ? `?${query}` : ""}`, FactHistoryResponse, { signal });
}

export type MovieSearchFn = (query: string, signal: AbortSignal) => Promise<MovieSearchResponse>;

export const searchMovies: MovieSearchFn = (query, signal) =>
  apiFetch(`/api/movies/search?q=${encodeURIComponent(query)}`, MovieSearchResponse, { signal });
