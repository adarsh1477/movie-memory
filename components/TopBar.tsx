"use client";

import { useState } from "react";
import Avatar from "./Avatar";

type UserProps = {
  name: string | null;
  email: string;
  image: string | null;
};

function IconMenu({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function TopBar({
  user,
  children,
}: {
  user: UserProps;
  children?: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const displayName = user.name ?? user.email.split("@")[0];

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface md:hidden">
      {/* Main bar */}
      <div className="flex h-14 items-center justify-between px-4">
        {/* Logo + user */}
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <IconFilm className="h-4 w-4" />
          </span>
          <div className="flex items-center gap-2.5">
            <Avatar src={user.image} name={user.name} email={user.email} size="sm" />
            <span className="text-sm font-medium text-text">{displayName}</span>
          </div>
        </div>

        {/* Menu toggle */}
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((p) => !p)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-muted transition-colors duration-150 hover:border-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {menuOpen ? <IconClose className="h-4 w-4" /> : <IconMenu className="h-4 w-4" />}
        </button>
      </div>

      {/* Collapsible menu */}
      {menuOpen && (
        <div className="border-t border-border bg-surface-raised px-4 py-4">
          <p
            className="mb-3 truncate text-xs text-text-muted"
            title={user.email}
          >
            {user.email}
          </p>
          {children}
        </div>
      )}
    </header>
  );
}
