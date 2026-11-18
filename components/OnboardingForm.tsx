"use client";

import { useActionState, useState } from "react";
import { saveMovie, type SaveMovieState } from "@/app/onboarding/actions";

const MAX = 120;
const initial: SaveMovieState = {};

export default function OnboardingForm() {
  const [state, formAction, isPending] = useActionState(saveMovie, initial);
  const [count, setCount] = useState(0);

  return (
    <form action={formAction} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="movie-title" className="text-sm font-medium text-text">
          Movie title
        </label>
        <input
          id="movie-title"
          name="title"
          type="text"
          maxLength={MAX}
          autoComplete="off"
          autoFocus
          disabled={isPending}
          onChange={(e) => setCount(e.target.value.length)}
          aria-describedby={state.error ? "title-error" : "title-hint"}
          aria-invalid={state.error ? true : undefined}
          placeholder="e.g. Interstellar"
          className={[
            "w-full rounded-lg bg-surface-raised px-4 py-3 text-base text-text placeholder:text-text-muted",
            "border outline-none transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            state.error
              ? "border-danger"
              : "border-border hover:border-text-muted focus-visible:border-accent",
          ].join(" ")}
        />
        <div className="flex min-h-[1.25rem] items-center justify-between gap-2">
          <div>
            {state.error ? (
              <p
                id="title-error"
                role="alert"
                aria-live="assertive"
                className="text-sm text-danger"
              >
                {state.error}
              </p>
            ) : (
              <span id="title-hint" className="sr-only">
                Enter your favorite movie title, up to 120 characters.
              </span>
            )}
          </div>
          <span
            aria-hidden="true"
            className={`shrink-0 text-xs tabular-nums ${count >= MAX - 10 ? "text-accent" : "text-text-muted"}`}
          >
            {count}/{MAX}
          </span>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending && (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent"
            aria-hidden="true"
          />
        )}
        {isPending ? "Saving…" : "Save my movie"}
      </button>
    </form>
  );
}
