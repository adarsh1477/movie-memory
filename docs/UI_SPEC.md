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

Centered column. Product name, one-line description, `SignInButton`. No footer. Rendered server-side; already-authed users are `redirect()`ed before the page paints.

### `/onboarding`

Centered card (`max-w-md`). Heading "What's your favorite movie?", single text input, Save button. Submit uses a Server Action. Validation hints from the same Zod schema the server uses, shown inline under the input.

### `/dashboard`

Two-column on `md+`: left `Sidebar` (fixed, ~240px), right content stack (`MovieHeroCard` then `FactCard`, both `rounded-2xl`, spaced by `gap-6`). On `< md` the sidebar collapses into a `TopBar` with avatar + name and a menu toggle for sign-out.

## Components

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

Every authenticated page includes a minimal footer with the text "Movie data from TMDB" linking to `https://www.themoviedb.org/` (opens in new tab, `rel="noopener noreferrer"`). Styled `text-xs text-text-muted`; uses the TMDB wordmark only if licensing permits, otherwise plain text.

## Accessibility

- All inputs have an associated `<label>` (visible, not just `aria-label` — screen readers and sighted keyboard users both benefit).
- Buttons have discernible text; icon-only buttons add `aria-label`.
- The toast region is `role="status" aria-live="polite"`; errors use `role="alert" aria-live="assertive"`.
- The 1s countdown is NOT read aloud (it would be noise); the time is shown visually only.
