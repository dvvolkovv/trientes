// A revision is a diff, not a form submission: it is stored, shown to signers
// and to a moderator days later, then applied. So the diff must be plain JSON
// and must survive a round trip through the database.

export type DiffEntry = {
  path: string;
  before: unknown;
  after: unknown;
};

/** Dates arrive as Date on the server and as ISO strings out of JSONB. */
function canonical(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Key order must not create a phantom change.
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * Compares the section's current values against what the normalizer produced.
 * Paths absent from `after` were not touched by this section and never appear
 * in the diff — otherwise every save would claim it cleared the rest.
 */
export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const [path, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const prev = before[path];
    if (same(prev, next)) continue;
    out.push({ path, before: canonical(prev), after: canonical(next) });
  }
  return out;
}

export function diffPaths(diff: readonly DiffEntry[]): string[] {
  return diff.map((e) => e.path);
}

export type CardUpdate = {
  /** Columns to write on CoinCard. */
  data: Record<string, unknown>;
  /** Present only when the diff replaces the child table. */
  contracts?: Record<string, unknown>[];
  markets?: Record<string, unknown>[];
};

/**
 * Turns a stored diff back into writes. Child tables are replaced wholesale —
 * the diff holds the whole array, which is also what the editor submits.
 */
export function diffToCardUpdate(diff: readonly DiffEntry[]): CardUpdate {
  const out: CardUpdate = { data: {} };
  for (const e of diff) {
    if (e.path === "contracts") {
      out.contracts = (e.after as Record<string, unknown>[]) ?? [];
    } else if (e.path === "markets") {
      out.markets = (e.after as Record<string, unknown>[]) ?? [];
    } else if (e.path === "launchDate") {
      out.data.launchDate = e.after ? new Date(String(e.after)) : null;
    } else {
      out.data[e.path] = e.after;
    }
  }
  return out;
}
