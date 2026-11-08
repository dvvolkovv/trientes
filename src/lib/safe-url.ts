/** Return the URL unchanged iff it parses as absolute http(s); else null. Blocks
 * `javascript:`/`data:` and relative junk before rendering an untrusted link/href. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}
