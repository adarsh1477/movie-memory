import Avatar from "./Avatar";
import SignOutButton from "./SignOutButton";

type UserProps = {
  name: string | null;
  email: string;
  image: string | null;
};

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="7" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="8.75" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="13.5" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="4" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="8.75" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="13.5" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function Sidebar({ user }: { user: UserProps }) {
  const displayName = user.name ?? user.email.split("@")[0];

  return (
    <aside className="sticky top-0 hidden h-screen w-60 flex-shrink-0 flex-col border-r border-border bg-surface md:flex">
      {/* Logo */}
      <div className="flex h-16 flex-shrink-0 items-center border-b border-border px-5">
        <div className="flex items-center gap-2.5" aria-label="Movie Memory">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <IconFilm className="h-5 w-5" />
          </span>
          <span className="text-base font-semibold text-text">Movie Memory</span>
        </div>
      </div>

      {/* Nav area */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-5">
        {/* User profile card */}
        <div className="rounded-xl border border-border bg-surface-raised p-3.5">
          <div className="flex items-center gap-3">
            <Avatar src={user.image} name={user.name} email={user.email} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text" title={displayName}>
                {displayName}
              </p>
              <p className="truncate text-xs text-text-muted" title={user.email}>
                {user.email}
              </p>
            </div>
          </div>
        </div>

        {/* Divider label */}
        <p className="mt-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted opacity-50">
          Account
        </p>
      </div>

      {/* Footer — sign out */}
      <div className="flex-shrink-0 border-t border-border px-4 py-4">
        <SignOutButton />
      </div>
    </aside>
  );
}
