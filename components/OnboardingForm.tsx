"use client";

import Image from "next/image";
import { useActionState, useRef, useState } from "react";
import { saveMovie, type SaveMovieState } from "@/app/onboarding/actions";
import MovieSearchCombobox, { type MovieSearchComboboxHandle } from "@/components/MovieSearchCombobox";
import { posterUrl } from "@/lib/tmdb-image";
import type { MovieSearchResult } from "@/lib/validation";

const MAX = 120;
const initial: SaveMovieState = {};

export default function OnboardingForm() {
  const [state, formAction, isPending] = useActionState(saveMovie, initial);
  const [text, setText] = useState("");
  const [selection, setSelection] = useState<MovieSearchResult | null>(null);
  // Hide a server error once the user starts fixing it; show the next one on submit.
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  const combobox = useRef<MovieSearchComboboxHandle>(null);

  const error = !editedSinceSubmit ? state.error : undefined;
  const canSubmit = text.trim().length > 0 && !isPending;

  return (
    <form action={formAction} onSubmit={() => setEditedSinceSubmit(false)} noValidate>
      <label htmlFor="movie-title" className="text-sm font-medium text-text">
        Movie title
      </label>

      <div className="mt-2">
        <MovieSearchCombobox
          ref={combobox}
          id="movie-title"
          name="title"
          maxLength={MAX}
          autoFocus
          disabled={isPending}
          invalid={Boolean(error)}
          describedBy="title-message"
          placeholder="Search, e.g. Interstellar"
          onTextChange={(value) => {
            setText(value);
            setEditedSinceSubmit(true);
          }}
          onSelectionChange={setSelection}
        />
      </div>

      <div className="mt-2 flex min-h-[1.25rem] items-start justify-between gap-3">
        <p id="title-message" aria-live="polite" className="text-xs leading-5">
          {error ? (
            <span className="flex items-start gap-1.5 text-danger">
              <IconAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </span>
          ) : (
            <span className="text-text-muted">
              {selection ? "Great pick. Hit Continue when you're ready." : "Start typing, then pick your movie from the list."}
            </span>
          )}
        </p>
        <span
          aria-hidden="true"
          className={`shrink-0 text-xs leading-5 tabular-nums ${text.length >= MAX - 10 ? "text-accent" : "text-text-muted/60"}`}
        >
          {text.length}/{MAX}
        </span>
      </div>

      {selection && (
        <SelectedMovie
          key={selection.tmdbId}
          movie={selection}
          disabled={isPending}
          onChange={() => combobox.current?.clearSelection()}
        />
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        aria-disabled={!canSubmit}
        className="group mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-background shadow-[0_8px_24px_rgba(245,184,65,0.22)] transition-all duration-150 hover:bg-accent-hover hover:shadow-[0_10px_32px_rgba(245,184,65,0.32)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-accent/40 disabled:text-background/70 disabled:shadow-none"
      >
        {isPending ? (
          <>
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent"
              aria-hidden="true"
            />
            Saving…
          </>
        ) : (
          <>
            Continue
            <IconArrow className="h-4 w-4 transition-transform duration-150 motion-safe:group-enabled:group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}

function SelectedMovie({
  movie,
  disabled,
  onChange,
}: {
  movie: MovieSearchResult;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div
      className="mt-4 flex items-center gap-4 rounded-xl border border-accent/20 bg-accent/[0.05] p-3 motion-safe:animate-fade-in"
      aria-label="Selected movie"
      role="group"
    >
      <div className="relative h-[84px] w-14 flex-shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 shadow-[0_8px_20px_rgba(0,0,0,0.5)]">
        {movie.posterPath ? (
          <Image src={posterUrl(movie.posterPath, "w342")} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-raised to-border">
            <IconFilm className="h-5 w-5 text-text-muted opacity-40" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">Selected</p>
        <p className="mt-0.5 truncate text-base font-semibold text-text" title={movie.title}>
          {movie.title}
        </p>
        <p className="text-sm tabular-nums text-text-muted">{movie.year ?? "Year unknown"}</p>
      </div>

      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className="flex-shrink-0 self-start rounded-md px-2 py-1 text-xs font-medium text-text-muted underline-offset-4 transition-colors duration-150 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        Change
      </button>
    </div>
  );
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.85" fill="currentColor" />
    </svg>
  );
}

function IconArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
