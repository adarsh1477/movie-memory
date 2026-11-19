import { z } from "zod";

export const movieTitleSchema = z
  .string()
  .trim()
  .min(1, "Movie title is required")
  .max(120, "Movie title must be 120 characters or fewer");

// ── Movie search (shared by the route, the client and the server actions) ─────

export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 100;
export const SEARCH_MAX_RESULTS = 6;

export const movieSearchQuerySchema = z
  .string()
  .trim()
  .min(SEARCH_MIN_CHARS, `Type at least ${SEARCH_MIN_CHARS} characters`)
  .max(SEARCH_MAX_CHARS, `Search must be ${SEARCH_MAX_CHARS} characters or fewer`);

// TMDB poster paths look like "/kOVEVeHjdlkdLVgGsUgd6sT8AJr.jpg". Strict, because the
// value ends up in an image URL and can arrive from the client on save.
export const posterPathSchema = z.string().regex(/^\/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/);

export const tmdbIdSchema = z.number().int().positive().max(2_147_483_647);
export const yearSchema = z.number().int().min(1870).max(2100);

export const MovieSearchResult = z.object({
  tmdbId: tmdbIdSchema,
  title: z.string().trim().min(1).max(200),
  year: yearSchema.nullable(),
  posterPath: posterPathSchema.nullable(),
});
export type MovieSearchResult = z.infer<typeof MovieSearchResult>;

export const MovieSearchResponse = z.object({
  results: z.array(MovieSearchResult).max(SEARCH_MAX_RESULTS),
  degraded: z.boolean(),
});
export type MovieSearchResponse = z.infer<typeof MovieSearchResponse>;

// ── Saving a movie from a form (onboarding now, inline edit in Stage 7) ───────

const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

/**
 * `title` is always required. `tmdbId`, `year` and `posterPath` are present only
 * when the user picked a search result; they arrive as strings from hidden inputs.
 */
export const MovieFormInput = z.object({
  title: movieTitleSchema,
  tmdbId: z.preprocess(emptyToUndefined, z.coerce.number().pipe(tmdbIdSchema).optional()),
  year: z.preprocess(emptyToUndefined, z.coerce.number().pipe(yearSchema).optional()),
  posterPath: z.preprocess(emptyToUndefined, posterPathSchema.optional()),
});
export type MovieFormInput = z.infer<typeof MovieFormInput>;

export function parseMovieForm(formData: FormData) {
  return MovieFormInput.safeParse({
    title: formData.get("title") ?? "",
    tmdbId: formData.get("tmdbId"),
    year: formData.get("year"),
    posterPath: formData.get("posterPath"),
  });
}

/** What the movie service accepts, from either the form or the JSON API. */
export type MovieSaveInput = MovieFormInput;

// ── API contracts (shared by route handlers and lib/api.ts) ───────────────────

const nullishToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? undefined);

/** PUT /api/me/movie body. Unknown keys (e.g. a client-sent userId) are stripped. */
export const MoviePutBody = z.object({
  title: movieTitleSchema,
  tmdbId: nullishToUndefined(tmdbIdSchema),
  year: nullishToUndefined(yearSchema),
  posterPath: nullishToUndefined(posterPathSchema),
});
export type MoviePutBody = z.input<typeof MoviePutBody>;

export const MeResponse = z.object({
  user: z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    image: z.string().nullable(),
  }),
  movie: z
    .object({
      title: z.string(),
      tmdbId: z.number().int().nullable(),
      year: z.number().int().nullable(),
      posterPath: z.string().nullable(),
      updatedAt: z.string(), // ISO
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const FactResponse = z.object({
  content: z.string(),
  movieTitle: z.string(),
  generatedAt: z.string(), // ISO
  // ISO server time when the response was built. The client uses it to correct for its
  // own clock drift, so the countdown to generatedAt + 60s matches the server's window.
  serverNow: z.string(),
  stale: z.boolean(),
});
export type FactResponse = z.infer<typeof FactResponse>;

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "VALIDATION",
  "NOT_FOUND",
  "NO_MOVIE",
  "RATE_LIMITED",
  "UPSTREAM_FAILED",
  "INTERNAL",
] as const;

export const ApiError = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string(),
  retryAfterMs: z.number().nonnegative().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** First message per top-level field, for `fieldErrors` in a VALIDATION response. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.errors) {
    const key = String(issue.path[0] ?? "_");
    out[key] ??= issue.message;
  }
  return out;
}
