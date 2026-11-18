"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFact } from "./api";
import { AppErrorException, type AppError } from "./errors";
import type { FactResponse } from "./validation";

export type FactState = {
  status: "loading" | "ready" | "error";
  /** Last fact we successfully received; kept while retrying or after a later error. */
  fact: FactResponse | null;
  error: AppError | null;
};

const INITIAL: FactState = { status: "loading", fact: null, error: null };

/**
 * Loads GET /api/fact for the current user. Remount (key by movie title) to reset.
 * Stage 8 adds the 30s client cache and "New fact" here.
 */
export function useFact(options: { onUnauthorized: () => void }) {
  const [state, setState] = useState<FactState>(INITIAL);
  const [attempt, setAttempt] = useState(0);

  // Read the latest callback without making it an effect dependency:
  // a new function identity must never trigger a refetch.
  const onUnauthorized = useRef(options.onUnauthorized);
  useEffect(() => {
    onUnauthorized.current = options.onUnauthorized;
  });

  useEffect(() => {
    const controller = new AbortController();

    getFact(controller.signal)
      .then((fact) => setState({ status: "ready", fact, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error: AppError =
          err instanceof AppErrorException
            ? err.error
            : { code: "INTERNAL", message: "Something went wrong. Please try again." };
        if (error.code === "UNAUTHORIZED") onUnauthorized.current();
        setState((prev) => ({ status: "error", fact: prev.fact, error }));
      });

    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => {
    setState((prev) => ({ ...prev, status: "loading" }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, retry };
}
