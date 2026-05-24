export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "support", "help",
  "cabinet", "business", "settings", "login", "register", "logout",
  "signin", "signup", "api", "auth", "user", "users", "me", "you",
  "trientes", "anonymous", "null", "undefined", "owner",
]);

export type UsernameValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "username_too_short" | "username_too_long" | "username_invalid_chars" | "username_reserved" };

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameValidation {
  const value = normalizeUsername(raw);
  if (value.length < 3) return { ok: false, reason: "username_too_short" };
  if (value.length > 32) return { ok: false, reason: "username_too_long" };
  if (!/^[a-z0-9_]+$/.test(value)) return { ok: false, reason: "username_invalid_chars" };
  if (RESERVED_USERNAMES.has(value)) return { ok: false, reason: "username_reserved" };
  return { ok: true, value };
}

export function generateUsernameFromName(name: string | null | undefined): string {
  if (!name) return "user";
  const cleaned = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!cleaned) return "user";
  return cleaned.slice(0, 24);
}
