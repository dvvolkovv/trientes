// Post-auth redirect targets come from the query string, so they are attacker
// controlled. Only same-origin absolute paths are allowed: "//evil.com" and
// "/\evil.com" are read as protocol-relative URLs by browsers and would turn
// the login form into an open redirect.
export function safeNext(next: unknown, locale: string): string {
  const fallback = `/${locale}/cabinet`;
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
