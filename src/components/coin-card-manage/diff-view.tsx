import type { DiffEntry } from "@/lib/coin-card-diff";

function render(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v, null, 1);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

/** "before → after", one row per path. Shared by the cabinet and the admin queue. */
export function DiffView({ diff }: { diff: readonly DiffEntry[] }) {
  return (
    <ul className="space-y-2">
      {diff.map((e) => (
        <li key={e.path} className="text-xs border border-hairline rounded-md p-2 bg-bg-tint">
          <div className="num uppercase tracking-[0.12em] text-[10px] text-muted mb-1">{e.path}</div>
          <div className="grid md:grid-cols-2 gap-2">
            <pre className="whitespace-pre-wrap break-words text-red-400/90">{render(e.before)}</pre>
            <pre className="whitespace-pre-wrap break-words text-green-400/90">{render(e.after)}</pre>
          </div>
        </li>
      ))}
    </ul>
  );
}
