"use client";

import { useState, useEffect, useRef } from "react";

const FACTS = [
  {
    movie: "Inception",
    fact: "Christopher Nolan spent nearly a decade developing the concept, wanting the film's internal rules to feel airtight before a single word of dialogue was written.",
  },
  {
    movie: "The Dark Knight",
    fact: "Heath Ledger kept a personal journal during production, filling it with character notes and references that helped him stay rooted in the role between takes.",
  },
  {
    movie: "Parasite",
    fact: "Director Bong Joon-ho pre-visualised almost every shot with hand-drawn storyboards before a single frame was filmed — over a thousand panels in total.",
  },
  {
    movie: "Interstellar",
    fact: "The team's simulation of the black hole was physically accurate enough for the results to contribute findings to a peer-reviewed astrophysics paper.",
  },
];

const TRANSITION_MS = 300;
const AUTO_ADVANCE_MS = 4500;

export default function FactCarousel() {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const transitioningRef = useRef(false);
  const dragStartX = useRef<number | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    const id = setTimeout(() => setReducedMotion(mq.matches), 0);
    return () => {
      mq.removeEventListener("change", handler);
      clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const id = setInterval(() => {
      if (transitioningRef.current) return;
      transitioningRef.current = true;
      setFading(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % FACTS.length);
        setFading(false);
        transitioningRef.current = false;
      }, TRANSITION_MS);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [paused, reducedMotion]);

  function navigate(dir: 1 | -1) {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    if (reducedMotion) {
      setIndex((i) => (i + dir + FACTS.length) % FACTS.length);
      transitioningRef.current = false;
      return;
    }
    setFading(true);
    setTimeout(() => {
      setIndex((i) => (i + dir + FACTS.length) % FACTS.length);
      setFading(false);
      transitioningRef.current = false;
    }, TRANSITION_MS);
  }

  function goTo(target: number) {
    if (target === index || transitioningRef.current) return;
    transitioningRef.current = true;
    if (reducedMotion) {
      setIndex(target);
      transitioningRef.current = false;
      return;
    }
    setFading(true);
    setTimeout(() => {
      setIndex(target);
      setFading(false);
      transitioningRef.current = false;
    }, TRANSITION_MS);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStartX.current = e.clientX;
    didDragRef.current = false;
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartX.current !== null && Math.abs(e.clientX - dragStartX.current) > 8) {
      didDragRef.current = true;
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartX.current === null) return;
    const dx = e.clientX - dragStartX.current;
    dragStartX.current = null;
    if (Math.abs(dx) > 40) {
      navigate(dx < 0 ? 1 : -1);
    }
  }

  function handleCardClick() {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    navigate(1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") { e.preventDefault(); navigate(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); navigate(1); }
  }

  const fact = FACTS[index];

  return (
    <div
      className="relative mx-auto max-w-sm rounded-2xl outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      role="region"
      aria-label="Fact carousel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        const related = e.relatedTarget;
        if (!(related instanceof Node) || !e.currentTarget.contains(related)) {
          setPaused(false);
        }
      }}
    >
      {/* Card — click advances, drag/swipe navigates */}
      <div
        className="cursor-pointer select-none rounded-2xl border border-border bg-surface px-14 py-6 transition-opacity duration-300"
        style={{ opacity: fading ? 0 : 1 }}
        onClick={handleCardClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragStartX.current = null; }}
      >
        {/* Movie label */}
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Fact about
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-snug text-text">
            {fact.movie}
          </p>
        </div>

        <div className="mb-4 h-px bg-border" />

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
          Did you know?
        </p>

        {/* aria-live wraps only the changing content */}
        <div aria-live="polite" aria-atomic="true">
          <p className="min-h-[4.5rem] text-sm leading-relaxed text-text">
            {fact.fact}
          </p>
        </div>

        {/* Dot nav + counter */}
        <div className="mt-5 flex items-center justify-between">
          <div role="tablist" aria-label="Fact navigation" className="flex items-center">
            {FACTS.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Go to fact ${i + 1} of ${FACTS.length}`}
                onClick={(e) => { e.stopPropagation(); goTo(i); }}
                className="group flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                <span
                  className={`block rounded-full transition-all duration-200 ${
                    i === index
                      ? "h-2.5 w-5 bg-accent"
                      : "h-2.5 w-2.5 bg-border group-hover:bg-text-muted"
                  }`}
                />
              </button>
            ))}
          </div>
          <span className="text-xs text-text-muted" aria-hidden="true">
            {index + 1} / {FACTS.length}
          </span>
        </div>
      </div>

      {/* Prev arrow */}
      <button
        type="button"
        aria-label="Previous fact"
        onClick={(e) => { e.stopPropagation(); navigate(-1); }}
        className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
          <path
            d="M12 5l-5 5 5 5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Next arrow */}
      <button
        type="button"
        aria-label="Next fact"
        onClick={(e) => { e.stopPropagation(); navigate(1); }}
        className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
          <path
            d="M8 5l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
