export type AdminEntry =
  | { type: "email"; value: string }
  | { type: "telegram"; value: string }
  | { type: "github"; value: string };

export type AdminIdentity = {
  email?: string | null;
  telegramId?: string | null;
  githubLogin?: string | null;
};

const KNOWN_PREFIXES = ["email", "telegram", "github"] as const;
type KnownPrefix = (typeof KNOWN_PREFIXES)[number];

function normalize(type: KnownPrefix, raw: string): string {
  const v = raw.trim();
  if (type === "telegram") return v;
  return v.toLowerCase();
}

export function parseAdminWhitelist(
  raw: string | undefined | null,
): AdminEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(":");
      if (idx === -1) return null;
      const prefix = entry.slice(0, idx).trim().toLowerCase();
      const value = entry.slice(idx + 1);
      if (!KNOWN_PREFIXES.includes(prefix as KnownPrefix)) return null;
      const type = prefix as KnownPrefix;
      const normalized = normalize(type, value);
      if (!normalized) return null;
      return { type, value: normalized } as AdminEntry;
    })
    .filter((x): x is AdminEntry => x !== null);
}

export function isAdminWhitelisted(
  list: AdminEntry[],
  identity: AdminIdentity,
): boolean {
  for (const entry of list) {
    if (entry.type === "email" && identity.email) {
      if (entry.value === identity.email.toLowerCase()) return true;
    } else if (entry.type === "telegram" && identity.telegramId) {
      if (entry.value === identity.telegramId) return true;
    } else if (entry.type === "github" && identity.githubLogin) {
      if (entry.value === identity.githubLogin.toLowerCase()) return true;
    }
  }
  return false;
}
