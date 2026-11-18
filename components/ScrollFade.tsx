"use client";

import { useRef, useEffect, useState } from "react";

type Phase = "pre" | "hidden" | "visible";

type Props = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
};

export default function ScrollFade({ children, className = "", delay = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // "pre"     = SSR / before JS (no inline style — content visible)
  // "hidden"  = element not yet in viewport (opacity 0, no transition)
  // "visible" = element entered viewport (opacity 1, transition plays)
  const [phase, setPhase] = useState<Phase>("pre");

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = setTimeout(() => setPhase("visible"), 0);
      return () => clearTimeout(id);
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase("visible");
          io.disconnect();
        } else {
          // Hide only when confirmed out of viewport — avoids flash on in-view elements
          setPhase("hidden");
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style: React.CSSProperties =
    phase === "hidden"
      ? { opacity: 0, transform: "translateY(14px)" }
      : phase === "visible"
        ? {
            opacity: 1,
            transform: "none",
            transition: `opacity 0.55s ease-out ${delay}ms, transform 0.55s ease-out ${delay}ms`,
          }
        : {}; // "pre": no style — renders visible for SSR and no-JS

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
