"use client";

import { useActionState, useState } from "react";
import { saveMovie, type SaveMovieState } from "@/app/onboarding/actions";
import MovieSearchCombobox from "@/components/MovieSearchCombobox";
import type { MovieSearchResult } from "@/lib/validation";

const MAX = 120;
const initial: SaveMovieState = {};

export default function OnboardingForm() {
  const [state, formAction, isPending] = useActionState(saveMovie, initial);
  const [count, setCount] = useState(0);
  const [selection, setSelection] = useState<MovieSearchResult | null>(null);

  return (
    <form action={formAction} noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="movie-title" className="text-sm font-medium text-text">
          Movie title
        </label>
        <MovieSearchCombobox
          id="movie-title"
          name="title"
          maxLength={MAX}
          autoFocus
          disabled={isPending}
          invalid={Boolean(state.error)}
          describedBy={state.error ? "title-error" : "title-hint"}
          placeholder="Search, e.g. Interstellar"
          onTextChange={(text) => setCount(text.length)}
          onSelectionChange={setSelection}
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
              <p id="title-hint" className="text-xs text-text-muted">
                {selection
                  ? `${selection.title}${selection.year ? ` (${selection.year})` : ""} selected`
                  : "Start typing, then pick your movie from the list."}
              </p>
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
