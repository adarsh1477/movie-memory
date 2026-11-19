// Server-only: production notes from a film's English Wikipedia article, used as an
// extra grounding SOURCE for grounded-mode facts. Public MediaWiki API, no key.
// Wikipedia text is CC BY-SA: the app credits Wikipedia (README, dashboard footer).

import { z } from "zod";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
// Wikimedia asks API clients to identify themselves. Generic, no personal data.
const USER_AGENT = "MovieMemory/1.0 (movie fun-fact dashboard; server-side fact grounding)";
export const WIKIPEDIA_TIMEOUT_MS = 2_000;
export const WIKIPEDIA_MAX_CHARS = 3_000;
export const WIKIPEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1_000;

export type WikipediaNotes = {
  /** The article the notes came from, e.g. "Dune: Part Two". */
  pageTitle: string;
  /** Plain text from production-type sections, ≤ WIKIPEDIA_MAX_CHARS. */
  text: string;
};

/**
 * ok: the lookup ran to a definite answer (found, or definitely no usable page).
 * !ok: a transient failure (timeout, network, HTTP error, malformed response).
 */
export type WikipediaResult = { ok: boolean; notes: WikipediaNotes | null };

export type WikipediaQuery = { title: string; year: number | null; director: string | null };

// ── Response shapes ───────────────────────────────────────────────────────────

const SearchResponse = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string(), pageid: z.number() })),
  }),
});

const ExtractResponse = z.object({
  query: z.object({
    pages: z.array(z.object({ pageid: z.number().optional(), title: z.string(), extract: z.string().optional() })),
  }),
});

// ── Matching ──────────────────────────────────────────────────────────────────

/** Lowercase, strip accents and punctuation: "Spider-Man: Brand New Day" → "spider man brand new day". */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Dune: Part Two (2024 film)" → { base: "Dune: Part Two", qualifier: "2024 film" }. */
function splitPageTitle(pageTitle: string): { base: string; qualifier: string | null } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(pageTitle);
  return m ? { base: m[1], qualifier: m[2] } : { base: pageTitle, qualifier: null };
}

/**
 * Candidate pages whose title IS the film's title, best first:
 * "(<year> film)" > "(film)" > no qualifier. Anything else ("(novel)", "(soundtrack)",
 * "(2021 film)" for a different year) is rejected.
 */
export function rankCandidates(pageTitles: string[], q: WikipediaQuery): string[] {
  const want = normalizeTitle(q.title);
  const scored: Array<{ title: string; score: number }> = [];
  for (const title of pageTitles) {
    const { base, qualifier } = splitPageTitle(title);
    if (normalizeTitle(base) !== want) continue;
    if (qualifier === null) scored.push({ title, score: 2 });
    else if (/^film$/i.test(qualifier.trim())) scored.push({ title, score: 1 });
    else {
      const m = /^(\d{4}) film$/i.exec(qualifier.trim());
      if (m && (q.year === null || Number(m[1]) === q.year)) scored.push({ title, score: 0 });
    }
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.title);
}

/** The article is that film if its lead mentions the release year or the director. */
export function confirmsFilm(lead: string, q: WikipediaQuery): boolean {
  const text = lead.toLowerCase();
  if (q.year !== null && new RegExp(`\\b${q.year}\\b`).test(text)) return true;
  if (q.director) {
    const name = q.director.toLowerCase();
    const surname = name.split(/\s+/).pop() ?? name;
    if (text.includes(name) || (surname.length > 2 && new RegExp(`\\b${escapeRegExp(surname)}\\b`).test(text))) {
      return true;
    }
  }
  return false;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Section extraction ────────────────────────────────────────────────────────

const WANTED = /\b(production|development|pre-production|casting|filming|principal photography|cinematography|visual effects|special effects|design|stunts?|locations?|post-production|music|score)\b/i;
const UNWANTED = /\b(plot|synopsis|premise|cast|release|reception|box office|accolades|awards|references|external links|notes|see also|marketing|home media|soundtrack|track listing|legacy|sequel|future)\b/i;

/**
 * Keeps only production-type sections of a plain-text extract (headings like "== Production ==").
 * A subsection counts if its own heading or its parent's is wanted and neither is unwanted
 * (so "Production > Casting" is kept, "Cast" and "Plot" are not).
 */
export function extractProductionNotes(extract: string): string {
  const parts: string[] = [];
  let parent = "";
  let current: { heading: string; keep: boolean } | null = null;
  let body: string[] = [];

  const flush = () => {
    if (current?.keep) {
      const text = body.join(" ").replace(/\s+/g, " ").trim();
      if (text) parts.push(`${current.heading}: ${text}`);
    }
    body = [];
  };

  for (const line of extract.split("\n")) {
    const h = /^(={2,6})\s*(.+?)\s*\1\s*$/.exec(line.trim());
    if (h) {
      flush();
      const level = h[1].length;
      const heading = h[2];
      if (level === 2) parent = heading;
      const parentKept = WANTED.test(parent) && !UNWANTED.test(parent);
      // Top level: wanted and not unwanted. Subsection: not unwanted itself, and either
      // under a kept section or wanted on its own (under a section that isn't unwanted).
      const keep =
        level === 2
          ? parentKept
          : !UNWANTED.test(heading) && (parentKept || (WANTED.test(heading) && !UNWANTED.test(parent)));
      current = { heading: level === 2 ? heading : `${parent} – ${heading}`, keep };
    } else if (current) {
      body.push(line);
    }
  }
  flush();
  return capText(parts.join("\n"), WIKIPEDIA_MAX_CHARS);
}

/** Cap at a sentence end when one is reasonably close, else a word boundary + "…". */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  if (end >= max * 0.6) return cut.slice(0, end + 1);
  const space = cut.lastIndexOf(" ", max - 1);
  return `${cut.slice(0, space > max / 2 ? space : max - 1).trimEnd()}…`;
}

// ── Fetching ──────────────────────────────────────────────────────────────────

async function getJson(params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const url = new URL(WIKI_API);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", ...params }).toString();
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, Accept: "application/json" },
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  return res.json();
}

const MISS: WikipediaResult = { ok: true, notes: null };
const FAILED: WikipediaResult = { ok: false, notes: null };

/**
 * Finds the film's English Wikipedia article and returns its production notes.
 * Never throws. Returns notes: null when unsure (no title match, page doesn't confirm the
 * year or director, no production sections). One 2s deadline covers both requests.
 */
export async function fetchWikipediaNotes(q: WikipediaQuery): Promise<WikipediaResult> {
  if (!q.title.trim() || (q.year === null && !q.director)) return MISS; // nothing to verify a match with
  const signal = AbortSignal.timeout(WIKIPEDIA_TIMEOUT_MS);

  try {
    const search = SearchResponse.safeParse(
      await getJson(
        { action: "query", list: "search", srsearch: `${q.title} ${q.year ?? ""} film`.trim(), srlimit: "5", srprop: "" },
        signal,
      ),
    );
    if (!search.success) return FAILED;

    const [best] = rankCandidates(
      search.data.query.search.map((r) => r.title),
      q,
    );
    if (!best) return MISS;

    const page = ExtractResponse.safeParse(
      await getJson(
        { action: "query", prop: "extracts", explaintext: "1", exsectionformat: "wiki", redirects: "1", titles: best },
        signal,
      ),
    );
    if (!page.success) return FAILED;

    const extract = page.data.query.pages[0]?.extract ?? "";
    const lead = extract.split(/\n==/)[0];
    if (!extract || !confirmsFilm(lead, q)) return MISS;

    const text = extractProductionNotes(extract);
    return text ? { ok: true, notes: { pageTitle: page.data.query.pages[0].title, text } } : MISS;
  } catch {
    return FAILED; // timeout, network, HTTP error, bad JSON
  }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export type WikipediaLoader = (q: WikipediaQuery) => Promise<WikipediaResult>;

/**
 * In-memory, per-process cache for 24h, keyed by title + year + director, with shared
 * in-flight requests. Definite answers are cached, including misses ("no usable page"),
 * so a film without an article doesn't cost a lookup on every fact. Transient failures
 * (ok: false) are not cached, so the next request tries again.
 */
export function createWikipediaLoader(
  opts: {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
    fetchNotes?: (q: WikipediaQuery) => Promise<WikipediaResult>;
  } = {},
): WikipediaLoader {
  const ttlMs = opts.ttlMs ?? WIKIPEDIA_TTL_MS;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  const fetchNotes = opts.fetchNotes ?? fetchWikipediaNotes;
  type Entry = { value: Promise<WikipediaResult>; expiresAt: number };
  const cache = new Map<string, Entry>();

  return (q) => {
    const key = `${normalizeTitle(q.title)}\u0000${q.year ?? ""}\u0000${(q.director ?? "").toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;

    const value = fetchNotes(q).catch(() => FAILED);
    const entry: Entry = { value, expiresAt: now() + ttlMs };
    void value.then((result) => {
      if (!result.ok && cache.get(key) === entry) cache.delete(key);
    });

    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return value;
  };
}

export const getWikipediaNotes: WikipediaLoader = createWikipediaLoader();
