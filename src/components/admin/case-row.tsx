import Link from "next/link";
import { SLA_DOT } from "@/lib/admin-ui";
import type { SlaState } from "@/lib/cases/types";

export function CaseRowCard({
  href,
  title,
  statusLabel,
  slaLabel,
  sla,
  assigneeLabel,
  handledLabel,
}: {
  href: string;
  title: string;
  statusLabel: string;
  slaLabel: string;
  sla: SlaState;
  assigneeLabel: string | null;
  handledLabel: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[18px] border border-hairline bg-card p-4 transition-colors hover:border-accent/50"
    >
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <b className="text-[14px] font-semibold leading-tight">{title}</b>
        <span className="shrink-0 rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[sla]}`} />
          {slaLabel}
        </span>
        {assigneeLabel ? <span>· {assigneeLabel}</span> : null}
        <span>· {handledLabel}</span>
      </div>
    </Link>
  );
}
