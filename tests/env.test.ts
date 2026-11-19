// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ChatClient } from "@/lib/openai";

// lib/env.ts parses process.env at import time, so each case resets modules and re-imports.
const saved = new Map<string, string | undefined>();

async function loadEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("@/lib/env");
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  vi.resetModules();
});

describe("lib/env", () => {
  it("throws a readable error naming a missing OPENAI_API_KEY", async () => {
    await expect(loadEnv({ OPENAI_API_KEY: undefined })).rejects.toThrow(/OPENAI_API_KEY/);
  });

  describe("OPENAI_MODEL", () => {
    it("defaults to gpt-4.1-mini when unset", async () => {
      const { env, DEFAULT_OPENAI_MODEL } = await loadEnv({ OPENAI_MODEL: undefined });
      expect(DEFAULT_OPENAI_MODEL).toBe("gpt-4.1-mini");
      expect(env.OPENAI_MODEL).toBe("gpt-4.1-mini");
    });

    it("defaults when set but blank", async () => {
      const { env } = await loadEnv({ OPENAI_MODEL: "   " });
      expect(env.OPENAI_MODEL).toBe("gpt-4.1-mini");
    });

    it("uses and trims a configured model", async () => {
      const { env } = await loadEnv({ OPENAI_MODEL: "  gpt-4o-mini " });
      expect(env.OPENAI_MODEL).toBe("gpt-4o-mini");
    });

    it.each(["ft:gpt-4.1-mini:acme:facts:abc123", "gpt-4.1-2025-04-14"])("accepts the model id %s", async (id) => {
      const { env } = await loadEnv({ OPENAI_MODEL: id });
      expect(env.OPENAI_MODEL).toBe(id);
    });

    it.each(["gpt 4.1", '"gpt-4.1-mini"', "-gpt"])("rejects the malformed value %j at startup", async (value) => {
      await expect(loadEnv({ OPENAI_MODEL: value })).rejects.toThrow(/OPENAI_MODEL/);
    });

    it("AUTH_TRUST_HOST is optional: unset and \"true\" both parse without error", async () => {
      await expect(loadEnv({ AUTH_TRUST_HOST: undefined })).resolves.toBeTruthy();
      const set = await loadEnv({ AUTH_TRUST_HOST: "true" });
      expect(set.env.AUTH_TRUST_HOST).toBe("true");
    });

    it("TMDB_API_KEY is optional: unset and empty both parse without error", async () => {
      await expect(loadEnv({ TMDB_API_KEY: undefined })).resolves.toBeTruthy();
      const empty = await loadEnv({ TMDB_API_KEY: "" });
      expect(empty.env.TMDB_API_KEY).toBe("");
    });

    it("MODEL_KNOWLEDGE_CUTOFF defaults to 2024-01-01 when unset or blank", async () => {
      const unset = await loadEnv({ MODEL_KNOWLEDGE_CUTOFF: undefined });
      expect(unset.DEFAULT_MODEL_KNOWLEDGE_CUTOFF).toBe("2024-01-01");
      expect(unset.env.MODEL_KNOWLEDGE_CUTOFF).toBe("2024-01-01");
      const blank = await loadEnv({ MODEL_KNOWLEDGE_CUTOFF: " " });
      expect(blank.env.MODEL_KNOWLEDGE_CUTOFF).toBe("2024-01-01");
    });

    it("MODEL_KNOWLEDGE_CUTOFF accepts and trims a YYYY-MM-DD date", async () => {
      const { env } = await loadEnv({ MODEL_KNOWLEDGE_CUTOFF: " 2025-01-31 " });
      expect(env.MODEL_KNOWLEDGE_CUTOFF).toBe("2025-01-31");
    });

    it.each(["2024-6-1", "June 2024", "2024-02-30", "2024-13-01"])(
      "MODEL_KNOWLEDGE_CUTOFF rejects %j at startup",
      async (value) => {
        await expect(loadEnv({ MODEL_KNOWLEDGE_CUTOFF: value })).rejects.toThrow(/MODEL_KNOWLEDGE_CUTOFF/);
      },
    );

    // Re-imports the whole OpenAI SDK after vi.resetModules(): ~0.5s alone, but well over
    // the default 5s under a full parallel run or a slow CI runner.
    it("is the model lib/openai.ts sends to OpenAI", { timeout: 15_000 }, async () => {
      await loadEnv({ OPENAI_MODEL: "gpt-4o-mini" });
      const { generateFact, OPENAI_MODEL } = await import("@/lib/openai");
      const create = vi.fn().mockResolvedValue({
        choices: [{ message: { content: "Heat was shot on more than 95 real Los Angeles locations, with no studio sets." } }],
      });

      await generateFact(
        { title: "Heat", year: 1995 },
        [],
        AbortSignal.timeout(8_000),
        { chat: { completions: { create } } } as unknown as ChatClient,
      );

      expect(OPENAI_MODEL).toBe("gpt-4o-mini");
      expect(create.mock.calls[0][0].model).toBe("gpt-4o-mini");
    });
  });
});
