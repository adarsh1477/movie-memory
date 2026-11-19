import { z } from "zod";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
// Deliberately earlier than the model's real training cutoff: films released close to it
// are where knowledge mode states false trivia (see docs/DECISIONS.md). Update with OPENAI_MODEL.
export const DEFAULT_MODEL_KNOWLEDGE_CUTOFF = "2024-01-01";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const isoDate = (name: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${name} must be a date like 2024-01-01`)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, `${name} must be a real calendar date`);

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  // Optional. Auth.js reads it from process.env itself; listed here so it's documented and
  // typed. Needed for `pnpm start` locally or behind a proxy; not in dev; automatic on Vercel.
  AUTH_TRUST_HOST: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  // Optional. Must be a non-reasoning chat model: lib/openai.ts sends
  // `max_tokens` and `temperature` to Chat Completions. A blank value means the default.
  OPENAI_MODEL: z.preprocess(
    blankToUndefined,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "OPENAI_MODEL must be a model id such as gpt-4.1-mini")
      .default(DEFAULT_OPENAI_MODEL),
  ),
  // Optional. Roughly when OPENAI_MODEL's training data ends (YYYY-MM-DD). Films released
  // before it use the model's own knowledge; later/unreleased films use TMDB data only.
  MODEL_KNOWLEDGE_CUTOFF: z.preprocess(
    blankToUndefined,
    isoDate("MODEL_KNOWLEDGE_CUTOFF").default(DEFAULT_MODEL_KNOWLEDGE_CUTOFF),
  ),
  TMDB_API_KEY: z.string().optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

export const env = envSchema.parse(process.env);
