"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import Logo from "./Logo";
import { signOutAction } from "@/lib/auth-actions";

type UserProps = {
  name: string | null;
  email: string;
  image: string | null;
};

function IconLogOut({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M13 13l3-3-3-3M16 10H7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardNav({ user }: { user: UserProps }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const displayName = user.name ?? user.email.split("@")[0];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (
        menuRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
        <Logo />

        {/* Avatar button */}
        <div className="relative">
          <button
            ref={buttonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Open user menu"
            onClick={() => setOpen((p) => !p)}
            className="rounded-full transition-all duration-150 hover:ring-2 hover:ring-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <Avatar
              src={user.image}
              name={user.name}
              email={user.email}
              size="sm"
            />
          </button>

          {/* Dropdown */}
          {open && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="User menu"
              className="absolute right-0 top-[calc(100%+10px)] w-64 overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
              style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)" }}
            >
              {/* User info */}
              <div className="border-b border-border p-4">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={user.image}
                    name={user.name}
                    email={user.email}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-semibold text-text"
                      title={displayName}
                    >
                      {displayName}
                    </p>
                    <p
                      className="truncate text-xs text-text-muted"
                      title={user.email}
                    >
                      {user.email}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sign out */}
              <div className="p-1.5">
                <form action={signOutAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]"
                  >
                    <IconLogOut className="h-4 w-4 flex-shrink-0" />
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
