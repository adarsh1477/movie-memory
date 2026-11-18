"use client";

import { useState, useEffect, useRef } from "react";

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    // setTimeout defers the initial read so setState isn't called synchronously
    // in the effect body — the 0ms delay is imperceptible in practice.
    const id = setTimeout(() => setReduced(mq.matches), 0);
    return () => {
      mq.removeEventListener("change", handler);
      clearTimeout(id);
    };
  }, []);
  return reduced;
}

export default function MockCardPreview() {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  // Collapse on outside pointer or touch
  useEffect(() => {
    if (!expanded) return;
    function onOutside(e: MouseEvent | TouchEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, [expanded]);

  function toggle() {
    if (!expanded) setHovered(false); // clear hover glow on expand
    setExpanded((p) => !p);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
    if (e.key === "Escape" && expanded) {
      e.preventDefault();
      setExpanded(false);
    }
  }

  // ── Visual state ──────────────────────────────────────────────────────────
  const active = hovered || focused;

  const rotation = reducedMotion ? -3 : expanded ? 0 : active ? -1.5 : -3;
  const scale = reducedMotion ? 1 : expanded ? 1.2 : active ? 1.04 : 1;

  const glowOpacity = expanded ? 0.95 : active ? 0.65 : 0.44;

  const shadow = expanded
    ? "0 40px 100px rgba(0,0,0,0.82), 0 0 80px rgba(245,184,65,0.22)"
    : active
      ? "0 28px 72px rgba(0,0,0,0.72), 0 0 60px rgba(245,184,65,0.15)"
      : "0 24px 64px rgba(0,0,0,0.65), 0 0 56px rgba(245,184,65,0.09)";

  const borderColor = expanded
    ? "rgba(245,184,65,0.42)"
    : active
      ? "rgba(245,184,65,0.22)"
      : "#2A2A35";

  const transition = reducedMotion
    ? "none"
    : "transform 0.35s cubic-bezier(0.34,1.3,0.64,1), box-shadow 0.3s ease, border-color 0.3s ease";

  return (
    // z-20 when expanded so the scaled card clears page content
    <div className={`relative${expanded ? " z-20" : ""}`}>
      {/* Glow — transitions opacity on hover / expand */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 70% at 50% 50%, rgba(245,184,65,0.26) 0%, transparent 65%)",
          opacity: glowOpacity,
          transition: reducedMotion ? "none" : "opacity 0.35s ease",
        }}
      />

      {/* Interactive card */}
      <div
        ref={cardRef}
        role="button"
        tabIndex={0}
        aria-pressed={expanded}
        aria-label={
          expanded ? "Collapse product preview" : "Expand product preview"
        }
        className="relative z-10 w-72 cursor-pointer select-none rounded-2xl border bg-surface p-6 sm:w-80 2xl:w-[26rem] 2xl:p-8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4"
        style={{
          borderColor,
          transform: `rotate(${rotation}deg) scale(${scale})`,
          boxShadow: shadow,
          transition,
        }}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => !expanded && setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => !expanded && setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {/* Movie label */}
        <div className="mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
            Fact about
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-snug text-text">
            The Shawshank Redemption
          </p>
        </div>

        {/* Divider */}
        <div className="mb-4 h-px bg-border" />

        {/* Fact */}
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-accent">
          Did you know?
        </p>
        <p className="text-sm leading-relaxed text-text">
          The script went through eleven drafts before filming — an unusually
          long development for a studio release of that era.
        </p>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1.5 text-xs text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Next fact in 0:47
          </span>
          <span className="text-xs text-text-muted opacity-60">
            New fact →
          </span>
        </div>
      </div>
    </div>
  );
}
