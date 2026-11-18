// Provide dummy env values so lib/env.ts passes its Zod parse during tests.
// env.test.ts overrides these via vi.resetModules() + delete process.env.X.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.OPENAI_API_KEY = "test-openai-api-key";
// NODE_ENV is set to "test" automatically by vitest
