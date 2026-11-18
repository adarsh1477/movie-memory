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

Centered card (`max-w-md`). Heading "What's your favorite movie?", single text input, Save button. Submit uses a Server Action. Validation hints from the same Zod schema the server uses, shown inline under the input.

### `/dashboard`

Two-column on `md+`: left `Sidebar` (fixed, ~240px), right content stack (`MovieHeroCard` then `FactCard`, both `rounded-2xl`, spaced by `gap-6`). On `< md` the sidebar collapses into a `TopBar` with avatar + name and a menu toggle for sign-out.

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

Two modes.
- **View**: `PosterImage` on the left (see below), large title (`text-2xl font-semibold`) and muted "your favorite movie" label to the right, a small `Edit` button at the top-right that swaps to edit mode.
- **Edit**: input (prefilled, autoselected on open), `Save` (accent) and `Cancel` (`text-muted` outlined). Save triggers an optimistic update via `useMe()` hook — on failure, the input reverts and a toast (`danger`) shows the server message. The poster updates to reflect the new title after the server responds (the new `posterPath` is included in the `MeResponse`).

### `PosterImage`

Props: `{ posterPath: string | null; title: string; className?: string }`.

- If `posterPath` is a non-empty string → render `<Image>` (from `next/image`) with `src` assembled as `https://image.tmdb.org/t/p/w500{posterPath}`. `width={160}` `height={240}` `alt={title}` with `rounded-xl` and a subtle `border border-border`.
- If `posterPath` is null → render a gradient film-frame fallback: a `rounded-xl bg-gradient-to-br from-surface-raised to-border` div of the same dimensions, with a centered `IconFilm` icon in `text-text-muted` and the film-strip tick marks rendered as CSS.
- Both variants are the same outer size so layout does not shift between poster and fallback states.

### `FactCard`

Header: "Fact about *${movieTitle}*". Body: the fact. Footer: "New fact" button + countdown text (`text-muted`). Countdown ticks every 1s; when it hits 0, the button becomes accent-foreground, signaling a truly fresh fact is now possible.

States:
- **Loading (no cached content)**: skeleton — two shimmering lines (`bg-surface-raised` with a slow left-to-right mask animation), muted countdown placeholder.
- **Loading (has cached content)**: show the cached fact; the "New fact" button shows a small spinner in-situ; no skeleton.
- **Error, retriable**: body swaps to a muted "couldn't reach the fact service" message with a "Try again" button (`accent`).
- **Stale served**: show content normally, append a small `text-muted` line: "showing last available fact".
- **Rate-limited (429)**: show the existing fact (if any) + a `text-muted` line "slow down — next fact in Xs" where X is `retryAfterMs / 1000` ceiled.

## Loading / error / empty / missing-photo coverage

| State                  | Where            | Behavior                                                                 |
|------------------------|------------------|--------------------------------------------------------------------------|
| First fact load        | FactCard         | Skeleton for both lines + countdown placeholder                          |
| Movie edit in-flight   | MovieHeroCard    | Input disabled, Save shows spinner, text already updated optimistically  |
| OpenAI down w/ prior   | FactCard         | Prior fact + "showing last available fact" line                          |
| OpenAI down w/o prior  | FactCard         | Error message + retry button                                             |
| Rate limited           | FactCard         | Keep existing content, add muted "slow down" line                        |
| Movie empty on load    | n/a (routing)    | `/dashboard` server redirects to `/onboarding`                           |
| Missing Google photo   | Avatar           | Initials from name; if name null, from email prefix                      |
| Missing Google name    | Sidebar/TopBar   | Fallback to email prefix (`foo` from `foo@bar.com`)                      |
| Session expired mid-use| Any API call     | Typed `UNAUTHORIZED` from `lib/api.ts` → client clears cache → redirect  |
| Poster unavailable     | PosterImage      | Gradient film-frame fallback (same dimensions, no layout shift)          |
| TMDB down at save time | Server action    | `posterPath` saved as `null`; fallback shown; no error surfaced to user  |

## Interaction timings

- Hover color change: 150ms
- Skeleton → content crossfade: 200ms
- Edit mode toggle: 200ms
- Countdown updates: every 1s (`setInterval`); cleared on unmount

## Footer

**Landing page:** Logo + "Movie data from TMDB" (linked, `target="_blank" rel="noopener noreferrer"`; omitted entirely when `posters.length === 0`) + "Built as a take-home project." `text-xs text-text-muted`. Plain text — no TMDB wordmark required for poster attribution.

**Authenticated pages:** Minimal footer with "Movie data from TMDB" link. `text-xs text-text-muted`.

## Accessibility

- All inputs have an associated `<label>` (visible, not just `aria-label` — screen readers and sighted keyboard users both benefit).
- Buttons have discernible text; icon-only buttons add `aria-label`.
- The toast region is `role="status" aria-live="polite"`; errors use `role="alert" aria-live="assertive"`.
- The 1s countdown is NOT read aloud (it would be noise); the time is shown visually only.
