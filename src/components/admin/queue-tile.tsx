import Link from "next/link";
import { ADMIN_TILE, SLA_DOT } from "@/lib/admin-ui";
import type { QueueTile as Tile } from "@/lib/cases/queues";

export function QueueTileCard({
  tile,
  label,
  href,
  ageLabel,
  slaLabel,
  emptyLabel,
  unreadLabel,
  colorHex,
}: {
  tile: Tile;
  label: string;
  href: string;
  ageLabel: string | null;
  slaLabel: string | null;
  emptyLabel: string;
  unreadLabel: string | null;
  colorHex?: string | null;
}) {
  const hot = tile.worst === "late" || tile.worst === "warn";
  // Срок важнее личного цвета: горящая очередь красит контур сама, а цвет
  // оператора виден, пока в очереди спокойно.
  const tint = !hot && colorHex ? colorHex : null;
  return (
    <Link
      href={href}
      style={tint ? { borderColor: tint } : undefined}
      className={`${ADMIN_TILE} ${hot ? "border-accent/45" : ""} transition-colors hover:border-accent/60`}
    >
      {tile.unread > 0 && unreadLabel ? (
        <span
          title={unreadLabel}
          className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground"
        >
          🔔 {tile.unread}
        </span>
      ) : null}
      <div
        style={tint ? { backgroundColor: `${tint}26` } : undefined}
        className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-card-alt text-base"
      >
        {tile.icon}
      </div>
      <div>
        <div
          className={
            tile.open > 0
              ? "text-[34px] font-bold leading-none tracking-[-0.04em]"
              : "text-[26px] font-semibold leading-none text-muted"
          }
        >
          {tile.open}
        </div>
        <div className="mt-1 text-[13px] font-semibold leading-tight">{label}</div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-muted">
          {tile.open > 0 ? ageLabel : emptyLabel}
        </div>
        {tile.worst && slaLabel ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted">
            <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[tile.worst]}`} />
            {slaLabel}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
