"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { fetchMovieSearch, type MovieSearchFn } from "@/lib/movie-search-client";
import { posterUrl } from "@/lib/tmdb-image";
import { SEARCH_MAX_CHARS, SEARCH_MIN_CHARS, type MovieSearchResult } from "@/lib/validation";

export const SEARCH_DEBOUNCE_MS = 300;

type Status = "idle" | "loading" | "ready" | "unavailable";

export type MovieSearchComboboxProps = {
  id: string;
  /** When set, the text input uses this name and hidden tmdbId/year/posterPath inputs are rendered. */
  name?: string;
  defaultValue?: string;
  defaultSelection?: MovieSearchResult | null;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onTextChange?: (text: string) => void;
  onSelectionChange?: (selection: MovieSearchResult | null) => void;
  /** Injectable for tests. Defaults to GET /api/movies/search. */
  searchFn?: MovieSearchFn;
};

/**
 * Accessible movie autocomplete (WAI-ARIA 1.2 combobox + listbox).
 * Used by onboarding; built to drop into the Stage 7 inline edit unchanged.
 */
export default function MovieSearchCombobox({
  id,
  name,
  defaultValue = "",
  defaultSelection = null,
  maxLength = 120,
  placeholder = "Search for a movie…",
  disabled,
  autoFocus,
  invalid,
  describedBy,
  onTextChange,
  onSelectionChange,
  searchFn = fetchMovieSearch,
}: MovieSearchComboboxProps) {
  const [text, setText] = useState(defaultValue);
  const [selection, setSelection] = useState<MovieSearchResult | null>(defaultSelection);
  const [results, setResults] = useState<MovieSearchResult[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [resultsQuery, setResultsQuery] = useState("");

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);

  const listId = useId();
  const statusId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  function cancelPending() {
    clearTimeout(timer.current);
    inFlight.current?.abort();
    inFlight.current = null;
  }

  function scheduleSearch(value: string) {
    cancelPending();
    const query = value.trim();
    setActive(-1);

    if (query.length < SEARCH_MIN_CHARS || query.length > SEARCH_MAX_CHARS) {
      setResults([]);
      setStatus("idle");
      setOpen(false);
      return;
    }

    setStatus("loading");
    setOpen(true);
    timer.current = setTimeout(() => {
      const controller = new AbortController();
      inFlight.current = controller;
      searchFn(query, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setResults(res.results);
          setResultsQuery(query);
          setStatus(res.degraded ? "unavailable" : "ready");
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus("unavailable");
        });
    }, SEARCH_DEBOUNCE_MS);
  }

  function updateSelection(next: MovieSearchResult | null) {
    setSelection(next);
    onSelectionChange?.(next);
  }

  function handleChange(value: string) {
    setText(value);
    onTextChange?.(value);
    if (selection) updateSelection(null);
    scheduleSearch(value);
  }

  function choose(result: MovieSearchResult) {
    cancelPending();
    setText(result.title);
    onTextChange?.(result.title);
    updateSelection(result);
    setOpen(false);
    setActive(-1);
    setStatus("idle");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    switch (e.key) {
      case "ArrowDown":
        if (count === 0) return;
        e.preventDefault();
        setOpen(true);
        setActive((i) => (!open || i >= count - 1 ? 0 : i + 1));
        break;
      case "ArrowUp":
        if (count === 0) return;
        e.preventDefault();
        setOpen(true);
        setActive((i) => (!open || i <= 0 ? count - 1 : i - 1));
        break;
      case "Enter":
        // Pick the highlighted option instead of submitting the form.
        if (open && active >= 0 && active < count) {
          e.preventDefault();
          choose(results[active]);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  const showList = open && status === "ready" && results.length > 0;
  const announcement =
    status === "loading"
      ? "Searching…"
      : status === "unavailable"
        ? "Movie search is unavailable. You can save the title as typed."
        : status === "ready"
          ? results.length
            ? `${results.length} result${results.length === 1 ? "" : "s"}. Use the up and down arrows to choose.`
            : "No matches."
          : "";

  return (
    <div className="relative">
      <div className="relative">
        <input
          id={id}
          name={name}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={[describedBy, statusId].filter(Boolean).join(" ")}
          aria-invalid={invalid || undefined}
          value={text}
          maxLength={maxLength}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!selection && results.length > 0) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          className={[
            "w-full rounded-lg bg-surface-raised py-3 pl-4 pr-24 text-base text-text placeholder:text-text-muted",
            "border outline-none transition-colors duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            invalid ? "border-danger" : "border-border hover:border-text-muted focus-visible:border-accent",
          ].join(" ")}
        />

        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2">
          {status === "loading" && (
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-text-muted border-t-transparent"
              aria-hidden="true"
            />
          )}
          {selection && (
            <span className="flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
              <IconCheck className="h-3 w-3" />
              {selection.year ?? "Selected"}
            </span>
          )}
        </div>
      </div>

      {name && (
        <>
          <input type="hidden" name="tmdbId" value={selection?.tmdbId ?? ""} />
          <input type="hidden" name="year" value={selection?.year ?? ""} />
          <input type="hidden" name="posterPath" value={selection?.posterPath ?? ""} />
        </>
      )}

      <p id={statusId} className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {open && status !== "idle" && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-surface-raised/95 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-md motion-safe:animate-fade-up"
          style={{ animationDuration: "150ms" }}
        >
          {status === "loading" && results.length === 0 && (
            <div className="flex flex-col gap-1 p-2" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <div className="h-12 w-8 flex-shrink-0 rounded bg-white/5" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-3 w-2/3 rounded bg-white/5" />
                    <div className="h-2.5 w-10 rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {status === "ready" && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-text-muted">
              No matches for <span className="text-text">“{resultsQuery}”</span>. You can save it as typed.
            </p>
          )}

          {status === "unavailable" && (
            <p className="px-4 py-3 text-sm text-text-muted">
              Movie search is unavailable right now. You can save the title as typed.
            </p>
          )}

          <ul
            id={listId}
            role="listbox"
            aria-label="Movie suggestions"
            hidden={!(results.length > 0 && (status === "ready" || status === "loading"))}
            className={`max-h-80 overflow-y-auto p-1.5 transition-opacity duration-150 ${status === "loading" ? "opacity-60" : ""}`}
          >
            {results.map((r, i) => (
              <li
                key={r.tmdbId}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // Keep focus in the input so blur doesn't close the list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r)}
                onMouseEnter={() => setActive(i)}
                className={[
                  "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150",
                  i === active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                ].join(" ")}
              >
                <Thumb posterPath={r.posterPath} />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${i === active ? "text-accent" : "text-text"}`}>
                    {r.title}
                  </p>
                  <p className="text-xs tabular-nums text-text-muted">{r.year ?? "Year unknown"}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Thumb({ posterPath }: { posterPath: string | null }) {
  if (posterPath) {
    return (
      <Image
        src={posterUrl(posterPath, "w92")}
        alt=""
        width={32}
        height={48}
        className="h-12 w-8 flex-shrink-0 rounded object-cover ring-1 ring-white/10"
      />
    );
  }
  return (
    <div className="flex h-12 w-8 flex-shrink-0 items-center justify-center rounded bg-gradient-to-br from-surface to-border ring-1 ring-white/10">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 text-text-muted opacity-40">
        <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
