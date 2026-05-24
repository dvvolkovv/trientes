import { getTranslations } from "next-intl/server";

export type PointListItem = { id: string; name: string; type: string; status: string; rejectReason: string | null };

export async function PointsList({ points }: { points: PointListItem[] }) {
  const t = await getTranslations("business");
  if (points.length === 0) return <p className="text-muted text-[13px]">{t("noPoints")}</p>;
  const badge = (s: string) =>
    s === "APPROVED" ? "bg-up/15 text-up" : s === "REJECTED" ? "bg-down/15 text-down" : "bg-accent/15 text-accent";
  return (
    <div className="space-y-2">
      {points.map((p) => (
        <div key={p.id} className="bg-card border border-hairline rounded-[14px] p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium truncate">{p.name} <span className="num text-[11px] text-muted">· {t(`type.${p.type}`)}</span></div>
            {p.status === "REJECTED" && p.rejectReason && <div className="text-[12px] text-down">{p.rejectReason}</div>}
          </div>
          <span className={`num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium ${badge(p.status)}`}>
            {t(`status.${p.status}`)}
          </span>
        </div>
      ))}
    </div>
  );
}
