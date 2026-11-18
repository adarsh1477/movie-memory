"use client";

import { useState } from "react";
import Image from "next/image";

type Size = "sm" | "md" | "lg";

const sizeClasses: Record<Size, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};

const sizePx: Record<Size, number> = {
  sm: 32,
  md: 40,
  lg: 48,
};

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.trim().slice(0, 2).toUpperCase();
  }
  const prefix = email.split("@")[0].replace(/[^a-zA-Z]/g, "");
  return prefix.slice(0, 2).toUpperCase() || "?";
}

export default function Avatar({
  src,
  name,
  email,
  size = "md",
}: {
  src: string | null;
  name: string | null;
  email: string;
  size?: Size;
}) {
  const [failed, setFailed] = useState(false);
  const cls = sizeClasses[size];
  const px = sizePx[size];

  if (src && !failed) {
    return (
      <Image
        src={src}
        alt={name ?? email}
        width={px}
        height={px}
        onError={() => setFailed(true)}
        className={`${cls} flex-shrink-0 rounded-full object-cover ring-2 ring-border`}
      />
    );
  }

  return (
    <div
      aria-label={`${name ?? email} avatar`}
      className={`${cls} flex flex-shrink-0 items-center justify-center rounded-full bg-surface-raised font-medium text-text ring-2 ring-border`}
    >
      {getInitials(name, email)}
    </div>
  );
}
