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
}: {
  tile: Tile;
  label: string;
  href: string;
  ageLabel: string | null;
  slaLabel: string | null;
  emptyLabel: string;
}) {
  const hot = tile.worst === "late" || tile.worst === "warn";
  return (
    <Link
      href={href}
      className={`${ADMIN_TILE} ${hot ? "border-accent/45" : ""} transition-colors hover:border-accent/60`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-card-alt text-base">
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
