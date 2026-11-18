import OpenAI, { APIError } from "openai";
import { env } from "./env";
import { OpenAiError } from "./errors";
import type { MovieDetails } from "./tmdb";
import {
  FACT_ANGLES,
  buildUserMessage,
  chooseFactMode,
  strictSystemPrompt,
  systemPrompt,
  type FactAngle,
  type FactMode,
  type FactPromptInput,
} from "./fact-prompt";

export type { FactMode, FactAngle } from "./fact-prompt";

// From OPENAI_MODEL (default gpt-4.1-mini). The request below uses `max_tokens` and
// `temperature`, so this must be a non-reasoning chat model. See docs/DECISIONS.md.
export const OPENAI_MODEL = env.OPENAI_MODEL;
export const OPENAI_DEADLINE_MS = 8_000;
export const MAX_TOKENS = 200;
export const MAX_FACT_CHARS = 450;
export const MIN_FACT_CHARS = 20;

export type FactMovie = {
  title: string;
  year: number | null;
  /** TMDB data; null for free-text titles or when TMDB was unavailable. */
  details?: MovieDetails | null;
  /** YYYY-MM-DD, so the model can tell whether the film is out yet. Defaults to now. */
  today?: string;
  /** Chosen by the caller (see chooseFactMode). Defaults to chooseFactMode with MODEL_KNOWLEDGE_CUTOFF. */
  mode?: FactMode;
  /** Suggested topic. Defaults to the first angle. */
  angle?: FactAngle;
};

export type GeneratedFact = {
  content: string;
  /** The mode whose prompt produced `content` (a knowledge reply may fall back to grounded). */
  mode: FactMode;
};

export type ChatClient = Pick<OpenAI, "chat">;

let defaultClient: OpenAI | undefined;
function getClient(): ChatClient {
  // maxRetries: 0 — we own the retries so they stay inside our deadline.
  defaultClient ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 0 });
  return defaultClient;
}

/**
 * A 2–3 sentence "did you know?" fact about `movie`. `signal` is the whole
 * deadline: it covers every call below.
 *
 * - Prompt: systemPrompt(mode) + JSON user message (see lib/fact-prompt.ts).
 * - Transport: one retry on 429/5xx with 200–500ms jitter (once per generateFact).
 * - Content: if the reply is empty, too short or looks like a refusal, retry once —
 *   in grounded mode when a knowledge-mode reply failed and TMDB details exist,
 *   otherwise with the stricter prompt for the same mode. A refusal is never returned.
 *
 * Throws OpenAiError on any failure.
 */
export async function generateFact(
  movie: FactMovie,
  avoid: string[],
  signal: AbortSignal,
  client: ChatClient = getClient(),
): Promise<GeneratedFact> {
  const today = movie.today ?? new Date().toISOString().slice(0, 10);
  const details = movie.details ?? null;
  const mode = movie.mode ?? chooseFactMode(details, env.MODEL_KNOWLEDGE_CUTOFF, today);
  const input: FactPromptInput = {
    title: movie.title,
    year: movie.year,
    today,
    angle: movie.angle ?? FACT_ANGLES[0],
    details,
    avoid,
  };
  let transportRetryUsed = false;

  const ask = async (system: string, attemptMode: FactMode): Promise<string> => {
    const request = () =>
      client.chat.completions.create(
        {
          model: OPENAI_MODEL,
          max_tokens: MAX_TOKENS,
          temperature: 0.8,
          messages: [
            { role: "system", content: system },
            { role: "user", content: buildUserMessage(attemptMode, input) },
          ],
        },
        { signal },
      );

    let completion;
    try {
      completion = await request();
    } catch (err) {
      if (transportRetryUsed || !isRetryable(err) || signal.aborted) {
        throw new OpenAiError("OpenAI request failed", { cause: err });
      }
      transportRetryUsed = true;
      try {
        await sleep(200 + Math.random() * 300, signal);
        completion = await request();
      } catch (retryErr) {
        throw new OpenAiError("OpenAI request failed after retry", { cause: retryErr });
      }
    }
    return cleanFact(completion?.choices?.[0]?.message?.content);
  };

  const first = await ask(systemPrompt(mode), mode);
  if (isUsableFact(first)) return { content: first, mode };

  if (signal.aborted) {
    throw new OpenAiError(`OpenAI reply rejected (${rejectReason(first)}), no time left to retry`);
  }

  // Knowledge failed but we have data: fall back to writing from the data alone.
  const retryMode: FactMode = mode === "knowledge" && details ? "grounded" : mode;
  const retryPrompt = retryMode !== mode ? systemPrompt(retryMode) : strictSystemPrompt(mode);
  const second = await ask(retryPrompt, retryMode);
  if (isUsableFact(second)) return { content: second, mode: retryMode };

  throw new OpenAiError(`OpenAI reply rejected twice (${rejectReason(second)})`);
}

// ── Reply checks ──────────────────────────────────────────────────────────────

const APOSTROPHE = "['’]";
const REFUSAL_PATTERNS: RegExp[] = [
  /\bNO_FACT\b/,
  new RegExp(`\\bI${APOSTROPHE}?m sorry\\b`, "i"),
  /\bI am sorry\b/i,
  /\bsorry,? but\b/i,
  /\bI apologi[sz]e\b/i,
  new RegExp(`\\bI can${APOSTROPHE}?t\\b`, "i"),
  /\bI cannot\b/i,
  new RegExp(`\\bI(?:${APOSTROPHE}m| am) (?:not able|unable) to\\b`, "i"),
  /\bunable to provide\b/i,
  /\bas an AI\b/i,
  /\b(?:AI|large) language model\b/i,
  /\btraining data\b/i,
  /\bknowledge cut-?off\b/i,
  /\bas of my (?:last|latest) (?:update|training)\b/i,
  new RegExp(`\\bI (?:do not|don${APOSTROPHE}?t) have (?:any )?(?:specific |reliable |current |up-to-date )?(?:information|details|data)\\b`, "i"),
  /\bbeyond my (?:knowledge|training)\b/i,
];

/** True if the text reads like the model declining rather than stating a fact. */
export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

export function isUsableFact(text: string): boolean {
  return text.length >= MIN_FACT_CHARS && !looksLikeRefusal(text);
}

function rejectReason(text: string): string {
  if (!text) return "empty";
  if (looksLikeRefusal(text)) return "refusal";
  return "too short";
}

/**
 * Trim, collapse whitespace, drop wrapping quotes and a "Fun fact:" preamble,
 * then cap at MAX_FACT_CHARS — at a sentence end if one is reasonably close,
 * otherwise at a word boundary with an ellipsis.
 */
export function cleanFact(raw: string | null | undefined): string {
  let text = (raw ?? "").replace(/\s+/g, " ").trim();
  text = text.replace(/^["“'](.*)["”']$/, "$1").trim();
  text = text.replace(/^(?:fun fact|did you know)\s*[:!?.\-–—]\s*/i, "").trim();
  if (text.length <= MAX_FACT_CHARS) return text;

  const cut = text.slice(0, MAX_FACT_CHARS);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentenceEnd >= MAX_FACT_CHARS * 0.5) return cut.slice(0, sentenceEnd + 1);

  const wordCut = cut.slice(0, MAX_FACT_CHARS - 1);
  const lastSpace = wordCut.lastIndexOf(" ");
  return `${(lastSpace > MAX_FACT_CHARS / 2 ? wordCut.slice(0, lastSpace) : wordCut).trimEnd()}…`;
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof APIError) || typeof err.status !== "number") return false;
  return err.status === 429 || err.status >= 500;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
