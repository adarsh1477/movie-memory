// Development-only console logging. In production builds Next.js replaces
// process.env.NODE_ENV with "production", so every call is a no-op (and the
// branch is removed by the minifier). To drop the logging entirely, delete this
// file and its call sites.
//
// Callers must never pass fact text, user ids, emails or other personal data.

export function devLog(scope: string, message: string): void {
  if (process.env.NODE_ENV !== "development") return;
  console.debug(`[${scope}] ${message}`);
}
