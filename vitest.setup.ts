// Provide dummy env values so lib/env.ts passes its Zod parse during tests.
// env.test.ts overrides these via vi.resetModules() + delete process.env.X.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.OPENAI_API_KEY = "test-openai-api-key";
// Tests expect the default model unless they set one explicitly (see env.test.ts).
delete process.env.OPENAI_MODEL;
delete process.env.MODEL_KNOWLEDGE_CUTOFF;
// NODE_ENV is set to "test" automatically by vitest

// ── Network guard ─────────────────────────────────────────────────────────────
// Tests must never reach OpenAI or TMDB (locally or in CI). Any fetch to those hosts
// that isn't intercepted by a test's own mock fails loudly. Tests that stub `fetch`
// (vi.stubGlobal) replace this for their duration; vi.unstubAllGlobals() restores it.
export const BLOCKED_TEST_HOSTS = ["api.openai.com", "api.themoviedb.org"];

const realFetch = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // relative URL: not an external call
  }
  if (BLOCKED_TEST_HOSTS.includes(host)) {
    return Promise.reject(new Error(`Blocked real network call to ${host} in tests — mock it instead.`));
  }
  return realFetch(input, init);
}) as typeof fetch;
