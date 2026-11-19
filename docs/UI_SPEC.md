# UI Specification

Dark cinematic theme. Original design — no copied branding. The `ui.png` reference was used only for layout and mood (sidebar + hero + content stack). Movie posters are fetched from TMDB and displayed on the dashboard hero card; a generated gradient film-frame serves as the fallback when no poster is available.

## Design tokens

Encoded in `tailwind.config.ts`:

```ts
colors: {
  background:     '#0B0B0F',
  surface:        '#14141A',
  'surface-raised':'#1C1C24',
  border:         '#2A2A35',
  text:           '#F5F5F7',
  'text-muted':   '#9A9AA8',
  accent:         '#F5B841',
  'accent-hover': '#FFC95C',
  danger:         '#EF4444',
  success:        '#34D399',
}
```

Typography: **Inter** via `next/font/google` (`display: swap`, subsets `['latin']`). One font family, three weights (400, 500, 600).

Radius: `rounded-2xl` (24px) for cards; `rounded-lg` (8px) for inputs and buttons.

Transitions: `150ms` for hover/focus states; `200ms` for layout changes (edit mode toggle, skeleton → content). Easing: `ease-out` on enter, `ease-in` on exit.

Focus: every interactive element gets `focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`. No `outline-none` anywhere.

Contrast: `text` on `background` = 16.6:1; `text-muted` on `background` = 7.8:1; `accent` on `background` = 9.5:1. All AA+.

## Pages

### `/` (landing)

Rendered server-side. Authed users are `redirect()`ed before the page paints. Unauthenticated users see a full-page premium landing.

**Background — `PosterBackground` (server component):** Three horizontal marquee rows of TMDB trending posters. Poster height: `clamp(120px, 11vw, 210px)`; width auto via `aspect-ratio: 2/3`. Rows 0 and 2 scroll left, row 1 scrolls right. Overlay stack: (1) 70 % dark base, (2) radial vignette (darkens edges), (3) soft left gradient on `lg+` (behind the headline column only), (4) top/bottom fades (`h-40`). Third row hidden on mobile. `prefers-reduced-motion`: marquee does not play. `< 4` poster paths → no background renders.

**Sticky nav:** Logo + `SignInButton` (nav variant). `bg-background/90 backdrop-blur-sm`, `h-16`, `z-30`.

**Section 1 — Hero:** Two-column on `lg+`. Left: animated eyebrow badge, `h1` headline, subtitle (`text-lg text-text-muted`), CTA `SignInButton` + "Free. Takes 10 seconds." caption; `motion-safe:animate-fade-up` with staggered `animationDelay`. Right: `MockCardPreview` (client — animated card with cycling fact text). Desktop: amber radial gradient behind the right column; left-column gradient darkens the poster wall for readability.

**Section 2 — How it works:** Three `HowStep` items (icon + title + body). `ScrollFade`.

**Section 3 — See it in action:** `FactCarousel` with an amber radial glow wrapper. `bg-surface/30` tint. `ScrollFade`.

**Section 4 — Built with care:** Four `FeatureCard` tiles in a `2 → 4` column responsive grid. `ScrollFade`.

**Section 5 — Final CTA:** Accent glow, repeated headline, `SignInButton`. `ScrollFade`.

**Footer:** Logo + "Movie data from TMDB" (linked to `https://www.themoviedb.org/`, `target="_blank" rel="noopener noreferrer"`; rendered only when `posters.length > 0` so a missing key or TMDB outage shows no broken credit) + "Built as a take-home project." `text-xs text-text-muted`.

### `/onboarding`

Dashboard nav (logo + avatar menu) over the dimmed poster wall (`PosterBackground variant="focus"`, amber glow fallback). A centred glass card (`max-w-lg`, `2xl:max-w-xl`) starting at fixed padding below the nav: eyebrow ("Welcome, <first name>" or "Step 1 of 1"), heading "What's your favorite movie?", subtitle, `MovieSearchCombobox`, selected-movie preview (poster, title, year, "Change"), and an amber **Continue** button (disabled until a title is typed; spinner while saving). Submit uses a Server Action; errors appear under the input with `aria-live`.

### `/dashboard`

Sticky `DashboardNav` (logo + avatar menu with name, email, Sign out), then the full-width `MovieHeroCard` hero: blurred poster backdrop, poster card on the left, and on the right the title row (with inline edit) above the glass `FactCard`. Stacks vertically below `lg`. Minimal footer with the TMDB credit. (`Sidebar` / `TopBar` from the original plan are not used.)

## Components

### `PosterBackground`

Props: `{ posters: string[] }`. Server component — no `'use client'`, no client JS. Returns `null` when `posters.length < 4`. Builds a 40-item tile (base list repeated to reach ≥ 40) and lays out 3 copies per row so `translateX(-33.333%)` = exactly one tile, seamless at any viewport width up to 3840 px. `fixed inset-0 -z-20 overflow-hidden`.

### `ScrollFade`

Props: `{ children, className?, delay? }`. Client component. Three-phase state machine (`"pre"` / `"hidden"` / `"visible"`) so SSR renders content visible — no flash on first paint. IntersectionObserver (threshold 0.1) fires once on first entry and disconnects. `prefers-reduced-motion`: skips animation, renders content visible immediately via `setTimeout(..., 0)` (avoids `react-hooks/set-state-in-effect`).

### `FactCarousel`

Client component. Standalone `FACTS` const (no props). Prev/next arrow buttons positioned `absolute left-2` / `right-2` within the card; card content padded `px-14` to clear them (44 px tap targets). Swipe/drag via pointer events (`onPointerDown/Move/Up`): 8 px threshold to detect intent, 40 px to commit navigation. `transitioningRef` guards against overlapping transitions on rapid clicks. Auto-advance interval resets on `paused` or `reducedMotion` changes. `aria-live="polite" aria-atomic="true"` on fact text.

### `MockCardPreview`

Client component on the landing hero right column. Renders an animated preview of the dashboard card (title, movie, cycling fact text). Purely presentational; no real data or API calls.

### `Sidebar` / `TopBar`

Contains `<Avatar />` + name + email (truncated) + `SignOutButton`. Background `surface`, border-right `border` on desktop; `TopBar` has a bottom border instead. Email uses `text-muted`.

### `Avatar`

Props: `{ src: string | null; name: string | null; email: string; size?: 'sm' | 'md' | 'lg' }`.

- If `src` is a non-empty string **and** has not failed to load in this session → render `<img>`.
- On `onError` → set a local `failed` state, switch to initials.
- Initials derive from `name` (first letters of first two space-separated tokens); if `name` is null, use the email prefix's first letter + the second if present.
- Initials background: `surface-raised`; text: `text`; monospace tabular numerals off, standard Inter.

### `MovieHeroCard`

Client component; the whole dashboard hero (backdrop, poster card, title row, FactCard). Props: `{ userId, movie: { title, tmdbId, year, posterPath } }`.
- **View**: "Your favorite movie" eyebrow, large title with the year in `text-muted`, and an icon-only pencil button (`aria-label="Edit favorite movie"`).
- **Edit**: the title row becomes `MovieSearchCombobox` (prefilled, focused) with **Save** (accent) and **Cancel** (outlined) and a hint "Pick a movie from the list to save it. Esc to cancel." Picking a result saves at once; Enter / Save with no pick sends the typed text (the server only accepts free text when TMDB is degraded or has no match). Escape first closes an open dropdown, then leaves edit mode.
- **Saving (optimistic)**: the new title, year, poster and backdrop show immediately (with a fade); the pencil shows a spinner and is disabled; the FactCard shows its saving skeleton and makes no requests until the server confirms.
- **Failure**: everything reverts and the server's message appears under the title (`role="alert"`, `danger`).
- **Focus**: returns to the pencil after save, cancel or failure.
- **Stacking**: the title area and the FactCard area both use `animate-fade-up`, which leaves a `transform` and so makes each its own stacking context; the later FactCard would paint over the edit dropdown. The title area is `relative z-20` and the FactCard area `relative z-0`. The `<section>` has no `overflow-hidden` (only the backdrop layer is clipped), so the dropdown can extend past the hero on short or narrow screens. The dropdown itself is fully opaque (`bg-[#17171E]`, border, shadow, scrolling list) — no translucency or blur.

### `PosterImage`

Props: `{ posterPath: string | null; title: string; className?: string }`.

- If `posterPath` is a non-empty string → render `<Image>` (from `next/image`) with `src` assembled as `https://image.tmdb.org/t/p/w500{posterPath}`. `width={160}` `height={240}` `alt={title}` with `rounded-xl` and a subtle `border border-border`.
- If `posterPath` is null → render a gradient film-frame fallback: a `rounded-xl bg-gradient-to-br from-surface-raised to-border` div of the same dimensions, with a centered `IconFilm` icon in `text-text-muted` and the film-strip tick marks rendered as CSS.
- Both variants are the same outer size so layout does not shift between poster and fallback states.

### `FactCard`

Props: `{ userId, movieTitle, displayTitle?, pending? }`. Header: "Did you know?" eyebrow + "Fact about *title*". Body: the fact (2–3 sentences). Footer: the countdown on the left; an action button on the right **only when the user can help** (see below).

- **Countdown**: "Next fact in 0:47", counting to `generatedAt + 60s` on the server's clock (`serverNow` correction), ticking every 1s only while the tab is visible. `aria-hidden` — never read aloud. Shows "Next try in 0:30" when showing a stale fact or after a failed refresh.
- **Auto-swap**: at 0:00, if the tab is visible, the next fact is fetched and swapped in with a 200ms fade (`motion-safe`, none under reduced motion); "Getting a fresh fact…" with a spinner meanwhile. Hidden tab → paused; on return it resyncs and fetches at once if overdue.
- **Action button — hidden in the normal state.** Facts refresh on their own at 0:00, and the server's 60s window can't be bypassed, so a permanent button would suggest a control that doesn't exist. It appears only when:
  - **(a) the last load failed** → accent **Try again** (with or without a fact on screen);
  - **(b) the fact shown is a stale fallback** (`stale: true`) → outlined **New fact**;
  - **(c) the countdown passed 0:00 and the new fact hasn't arrived** → outlined **New fact**, shown from 2s after 0:00 (`OVERDUE_GRACE_MS`, so a normal swap never flashes it); clicking replaces the slow automatic request.
  Either button skips only the client cache, is disabled with an in-place spinner while its own request runs, and fades in (`motion-safe`). If a manual load returns the same fact (the server's window isn't over yet), a `role="status"` line reads "Same fact for now. Next fresh fact in Xs." — not an error. Never shown while a movie edit is saving.

States:
- **Loading (no cached content)**: skeleton — three shimmering lines, footer placeholders, New fact disabled.
- **Cache hit** (fetched < 30s ago **and** still inside its server window): the fact renders immediately, no request. An expired entry shows the skeleton and fetches — an old fact is never painted first.
- **Late load** (the tab was hidden past the window): skeleton while loading, not the expired fact; on failure the old fact returns with "Showing the last available fact".
- **Error with nothing to show**: body becomes a `role="alert"` message ("Couldn't reach the fact service", "Slow down a little. Try again in Xs.", …) with an accent **Try again** button.
- **Stale served / refresh failed**: keep the fact, add a `text-muted` line with a clock icon: "Showing the last available fact".
- **Saving (`pending`)**: skeleton labelled "Saving your movie…", no requests.

## Loading / error / empty / missing-photo coverage

| State                  | Where            | Behavior                                                                 |
|------------------------|------------------|--------------------------------------------------------------------------|
| First fact load        | FactCard         | Skeleton lines + footer placeholders; no action button                   |
| Cache hit              | FactCard         | Fetched < 30s ago and inside generatedAt + 60s: shown instantly, no request |
| Expired cache / late load | FactCard      | Skeleton + fetch; the expired fact is never shown as current            |
| Movie edit in-flight   | MovieHeroCard    | New title / year / poster shown optimistically; pencil spinner; FactCard "Saving your movie…" skeleton |
| Movie edit failed      | MovieHeroCard    | Revert to the previous movie + server message under the title           |
| OpenAI down w/ prior   | FactCard         | Prior fact + "Showing the last available fact"; next try in 30s          |
| OpenAI down w/o prior  | FactCard         | Error message + Try again                                                |
| Rate limited           | FactCard         | With a fact: keep it, next try after `retryAfterMs`. Without: "Slow down a little. Try again in Xs." |
| Normal (current fact)  | FactCard         | Fact + countdown; no button — it refreshes by itself at 0:00             |
| Refresh failed         | FactCard         | Last fact + stale hint + **Try again**                                   |
| Stale fallback shown   | FactCard         | Fact + stale hint + **New fact**                                         |
| 0:00 passed, no fact yet | FactCard       | From 0:00 + 2s: **New fact** (replaces the slow request)                 |
| Tab hidden             | FactCard         | Countdown and auto-load paused; resync on return                         |
| Movie empty on load    | n/a (routing)    | `/dashboard` server redirects to `/onboarding`                           |
| Missing Google photo   | Avatar           | Initials from name; if name null, from email prefix                      |
| Missing Google name    | Sidebar/TopBar   | Fallback to email prefix (`foo` from `foo@bar.com`)                      |
| Session expired mid-use| Any API call     | Typed `UNAUTHORIZED` from `lib/api.ts` → redirect to `/`; sign-out clears the fact cache |
| Poster unavailable     | PosterImage      | Gradient film-frame fallback (same dimensions, no layout shift)          |
| TMDB down at save time | Server action    | `posterPath` saved as `null`; fallback shown; no error surfaced to user  |

## Interaction timings

- Hover color change: 150ms
- Skeleton → content crossfade: 200ms (`animate-fade-in`, `motion-safe` only)
- Fact auto-swap and optimistic title / poster change: 200ms fade, `motion-safe` only
- Edit mode toggle: 200ms
- Countdown updates: every 1s (`setInterval`), only while the tab is visible; resyncs immediately on a new target or when the tab returns; cleared on unmount
- Combobox search debounce: 300ms

## Footer

**Landing page:** Logo + "Movie data from TMDB" (linked, `target="_blank" rel="noopener noreferrer"`; omitted entirely when `posters.length === 0`) + "Built as a take-home project." `text-xs text-text-muted`. Plain text — no TMDB wordmark required for poster attribution.

**Authenticated pages:** Minimal footer with "Movie data from TMDB" link. `text-xs text-text-muted`.

## Accessibility

- All inputs have an associated `<label>` (visible, not just `aria-label` — screen readers and sighted keyboard users both benefit).
- Buttons have discernible text; icon-only buttons add `aria-label`.
- The toast region is `role="status" aria-live="polite"`; errors use `role="alert" aria-live="assertive"`.
- The 1s countdown is NOT read aloud (it would be noise); it is `aria-hidden` and shown visually only. New facts are announced via the fact body's `aria-live="polite"`; the "Same fact for now…" hint is a one-off `role="status"`.
- Inline edit: icon-only pencil has `aria-label`; the search box has a (visually hidden) label; Escape and Cancel exit; focus returns to the pencil; save errors are `role="alert"`.
