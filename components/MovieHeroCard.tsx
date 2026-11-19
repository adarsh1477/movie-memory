"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import FactCard from "./FactCard";
import MovieSearchCombobox from "./MovieSearchCombobox";
import { putMovie } from "@/lib/api";
import { factCache } from "@/lib/client-cache";
import { AppErrorException } from "@/lib/errors";
import { posterUrl } from "@/lib/tmdb-image";
import type { MovieSearchResult } from "@/lib/validation";

export type HeroMovie = {
  title: string;
  tmdbId: number | null;
  year: number | null;
  posterPath: string | null;
};

// ─── Utility ─────────────────────────────────────────────────────────────────

const MINOR = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so", "at", "by", "in", "of", "on", "to", "up", "as"]);

function toTitleCase(str: string): string {
  const words = str.toLowerCase().split(" ");
  return words
    .map((word, i) =>
      i === 0 || i === words.length - 1 || !MINOR.has(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/** TMDB titles are canonical ("WALL·E", "M3GAN"); only tidy up free-text ones. */
export function displayTitleOf(movie: HeroMovie): string {
  return movie.tmdbId ? movie.title : toTitleCase(movie.title);
}

const sameMovie = (a: HeroMovie, b: HeroMovie) =>
  a.title === b.title && a.tmdbId === b.tmdbId && a.year === b.year && a.posterPath === b.posterPath;

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconEdit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="7" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
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

// ─── Film-frame fallback (no poster) ─────────────────────────────────────────

function FilmFallback({ title }: { title: string }) {
  return (
    <div
      className="flex h-full w-full flex-col bg-gradient-to-br from-surface-raised via-[#1a1510] to-border"
      role="img"
      aria-label={`No poster available for ${title}`}
    >
      <div className="flex h-7 items-center justify-around bg-black/30 px-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 w-2.5 rounded-sm bg-background/55" />
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <IconFilm className="h-12 w-12 text-text-muted opacity-20" />
      </div>
      <div className="flex h-7 items-center justify-around bg-black/30 px-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 w-2.5 rounded-sm bg-background/55" />
        ))}
      </div>
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

/**
 * Dashboard hero: backdrop, poster, title with inline edit, and the FactCard.
 * Edits are optimistic: the new title, year and poster show at once and revert if
 * PUT /api/me/movie fails. The FactCard follows only server-confirmed movies.
 */
export default function MovieHeroCard({ userId, movie }: { userId: string; movie: HeroMovie }) {
  const router = useRouter();
  const [committed, setCommitted] = useState<HeroMovie>(movie);
  const [optimistic, setOptimistic] = useState<HeroMovie | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(movie.title);

  const pencil = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const saving = optimistic !== null;
  const shown = optimistic ?? committed;
  const displayTitle = displayTitleOf(shown);

  // Focus goes back to the pencil after save, cancel or a failed save.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      pencil.current?.focus();
    }
  });

  function startEditing() {
    setError(null);
    setText(committed.title);
    setEditing(true);
  }

  function stopEditing() {
    returnFocus.current = true;
    setEditing(false);
  }

  async function save(next: HeroMovie) {
    stopEditing();
    if (sameMovie(next, committed)) return;

    const previous = committed;
    setError(null);
    setOptimistic(next);
    try {
      const me = await putMovie({
        title: next.title,
        tmdbId: next.tmdbId,
        year: next.year,
        posterPath: next.posterPath,
      });
      const saved = me.movie ?? next;
      // Facts for the old title are no longer wanted; the FactCard remounts on the new key.
      factCache.deleteMovie(userId, previous.title);
      setCommitted({ title: saved.title, tmdbId: saved.tmdbId, year: saved.year, posterPath: saved.posterPath });
      router.refresh();
    } catch (err) {
      if (err instanceof AppErrorException && err.error.code === "UNAUTHORIZED") {
        router.replace("/");
        return;
      }
      const message =
        err instanceof AppErrorException
          ? err.error.code === "VALIDATION"
            ? (err.error.fieldErrors?.title ?? err.error.message)
            : err.error.message
          : "Couldn't save your movie. Please try again.";
      setError(message);
    } finally {
      setOptimistic(null);
      returnFocus.current = true;
    }
  }

  function onSelect(result: MovieSearchResult | null) {
    if (!result) return;
    void save({ title: result.title, tmdbId: result.tmdbId, year: result.year, posterPath: result.posterPath });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const title = text.trim();
    if (!title) {
      setError("Type a movie title, or pick one from the list.");
      return;
    }
    if (title === committed.title) {
      stopEditing();
      return;
    }
    // Free text: the server only accepts it when TMDB is down or has no match.
    void save({ title, tmdbId: null, year: null, posterPath: null });
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // The combobox calls preventDefault when Escape just closes its list.
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      stopEditing();
    }
  }

  return (
    // No overflow-hidden here: the edit dropdown must be able to extend past the hero.
    // Only the backdrop layer is clipped (the blurred, scaled poster).
    <section className="relative" aria-labelledby="favorite-movie-label">
      {/* ── Backdrop ── */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        {shown.posterPath ? (
          <>
            <div className="absolute inset-0 overflow-hidden">
              <Image
                key={shown.posterPath}
                src={posterUrl(shown.posterPath, "w500")}
                fill
                alt=""
                priority
                className="scale-125 object-cover motion-safe:animate-fade-in"
                style={{ filter: "blur(72px)", opacity: 0.5 }}
                sizes="100vw"
              />
            </div>
            <div className="absolute inset-0 bg-background/55" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 55% at 18% 35%, rgba(90,52,0,0.5) 0%, transparent 55%), " +
                "radial-gradient(ellipse 55% 45% at 75% 25%, rgba(50,28,0,0.4) 0%, transparent 55%), " +
                "radial-gradient(ellipse 90% 60% at 50% 85%, rgba(15,8,0,0.55) 0%, transparent 65%)",
            }}
          />
        )}
        <div
          className="absolute inset-x-0 top-0 h-48"
          style={{ background: "linear-gradient(to bottom, rgba(11,11,15,0.65) 0%, transparent 100%)" }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-72"
          style={{ background: "linear-gradient(to bottom, transparent 0%, rgba(11,11,15,0.88) 55%, #0B0B0F 100%)" }}
        />
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
        <div className="flex flex-col gap-10 pb-24 pt-12 md:pt-16 lg:flex-row lg:items-start lg:gap-16 lg:pt-20 xl:pt-20">
          {/* Poster card */}
          <div className="motion-safe:animate-fade-up flex-shrink-0 self-center lg:self-start" style={{ animationDelay: "0ms" }}>
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{
                width: "clamp(160px, 18vw, 280px)",
                aspectRatio: "2/3",
                boxShadow: shown.posterPath
                  ? "0 32px 80px rgba(0,0,0,0.85), 0 0 56px rgba(245,184,65,0.18)"
                  : "0 32px 80px rgba(0,0,0,0.85)",
              }}
            >
              {shown.posterPath ? (
                <Image
                  key={shown.posterPath}
                  src={posterUrl(shown.posterPath, "w500")}
                  alt={displayTitle}
                  fill
                  priority
                  className="object-cover motion-safe:animate-fade-in"
                  sizes="(max-width: 640px) 160px, (max-width: 1024px) 220px, 280px"
                />
              ) : (
                <FilmFallback title={displayTitle} />
              )}
              <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }} />
            </div>
          </div>

          {/* Info + fact panel */}
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {/* Stacking: the fade-up animation leaves a transform, so this wrapper and the
                FactCard wrapper below are each their own stacking context. Without an
                explicit order the later FactCard paints over this one — and over the
                edit dropdown inside it. z-20 here vs z-0 on the FactCard wrapper fixes that. */}
            <div
              className="relative z-20 motion-safe:animate-fade-up"
              style={{ animationDelay: "80ms" }}
              data-testid="hero-title-area"
            >
              <p id="favorite-movie-label" className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                Your favorite movie
              </p>

              {editing ? (
                <form
                  onSubmit={onSubmit}
                  onKeyDown={onKeyDown}
                  className="mt-3 flex flex-col gap-3 motion-safe:animate-fade-in sm:flex-row sm:items-start"
                  aria-label="Change your favorite movie"
                >
                  <div className="min-w-0 flex-1">
                    <label htmlFor="edit-movie" className="sr-only">
                      Movie title
                    </label>
                    <MovieSearchCombobox
                      id="edit-movie"
                      defaultValue={committed.title}
                      defaultSelection={
                        committed.tmdbId !== null
                          ? { tmdbId: committed.tmdbId, title: committed.title, year: committed.year, posterPath: committed.posterPath }
                          : null
                      }
                      maxLength={120}
                      autoFocus
                      describedBy="edit-movie-hint"
                      onTextChange={setText}
                      onSelectionChange={onSelect}
                    />
                    <p id="edit-movie-hint" className="mt-1.5 text-xs text-text-muted">
                      Pick a movie from the list to save it. Esc to cancel.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={stopEditing}
                      className="rounded-lg border border-white/15 px-4 py-3 text-sm font-medium text-text-muted transition-colors duration-150 hover:border-white/30 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-2 flex items-start gap-3">
                  <h1
                    key={displayTitle}
                    className="flex-1 text-3xl font-semibold leading-tight text-text motion-safe:animate-fade-in sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]"
                  >
                    {displayTitle}
                    {shown.year && (
                      <span className="ml-3 align-middle text-lg font-normal tabular-nums text-text-muted sm:text-xl">
                        {shown.year}
                      </span>
                    )}
                  </h1>
                  <button
                    ref={pencil}
                    type="button"
                    aria-label="Edit favorite movie"
                    onClick={startEditing}
                    disabled={saving}
                    className="mt-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-text-muted backdrop-blur-sm transition-colors duration-150 hover:border-white/20 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-40"
                  >
                    {saving ? (
                      <span
                        className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden="true"
                      />
                    ) : (
                      <IconEdit className="h-4 w-4" />
                    )}
                  </button>
                </div>
              )}

              <div aria-live="polite" className="min-h-0">
                {saving && <p className="sr-only">Saving {displayTitle}…</p>}
              </div>
              {error && !editing && (
                <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-danger motion-safe:animate-fade-in">
                  <IconAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  {error}
                </p>
              )}
              {error && editing && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {error}
                </p>
              )}
            </div>

            {/* Glass fact panel — follows the server-confirmed movie only */}
            <div
              className="relative z-0 motion-safe:animate-fade-up"
              style={{ animationDelay: "160ms" }}
              data-testid="hero-fact-area"
            >
              <FactCard
                key={committed.title}
                userId={userId}
                movieTitle={committed.title}
                displayTitle={displayTitle}
                pending={saving}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
