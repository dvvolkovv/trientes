export type ProvenanceKind =
  | "SELF_REPORTED" | "VERIFIED_ONCHAIN" | "AGGREGATED" | "ADMIN_SET";

export type ProvenanceEntry = {
  kind: ProvenanceKind;
  /** Chain id, exchange count, moderator — whatever qualifies the kind. */
  source: string | null;
  /** ISO timestamp. */
  at: string;
};

export type ProvenanceMap = Record<string, ProvenanceEntry>;

/**
 * Trust ranking. A weaker source must never silently downgrade a stronger
 * one — that is how a verified number turns back into a mere claim.
 */
const RANK: Record<ProvenanceKind, number> = {
  SELF_REPORTED: 0,
  AGGREGATED: 1,
  VERIFIED_ONCHAIN: 2,
  ADMIN_SET: 3,
};

export const PROVENANCE_EPOCH = new Date(0).toISOString();

const DEFAULT_ENTRY: ProvenanceEntry = {
  kind: "SELF_REPORTED",
  source: null,
  at: PROVENANCE_EPOCH,
};

function asMap(raw: unknown): ProvenanceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProvenanceMap;
}

export function getProvenance(raw: unknown, path: string): ProvenanceEntry {
  const m = asMap(raw);
  const e = m[path];
  if (!e || typeof e !== "object" || !(e.kind in RANK)) return DEFAULT_ENTRY;
  return e;
}

export function markSelfReported(
  raw: unknown,
  paths: readonly string[],
  at: Date,
): ProvenanceMap {
  const next = { ...asMap(raw) };
  for (const p of paths) {
    next[p] = { kind: "SELF_REPORTED", source: null, at: at.toISOString() };
  }
  return next;
}

export function mergeProvenance(raw: unknown, incoming: ProvenanceMap): ProvenanceMap {
  const next = { ...asMap(raw) };
  for (const [path, entry] of Object.entries(incoming)) {
    const cur = next[path];
    if (!cur || RANK[entry.kind] >= RANK[cur.kind]) next[path] = entry;
  }
  return next;
}
