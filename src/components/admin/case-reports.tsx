/**
 * Список жалоб в деле. Это чтение, а не действие: решение по жалобе принимается
 * в разделе «Решение» — две двери к одному решению означают, что правила нет.
 */
export type CaseReportItem = {
  id: string;
  reasonLabel: string;
  comment: string | null;
  who: string;
  createdAt: Date;
};

export function CaseReports({ items, emptyLabel }: { items: CaseReportItem[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="text-[12px] text-muted">{emptyLabel}</p>;
  return (
    <ul className="flex flex-col">
      {items.map((r) => (
        <li key={r.id} className="border-b border-hairline py-2.5 last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold">{r.reasonLabel}</span>
            <span className="num text-[10.5px] text-muted">
              {r.createdAt.toISOString().slice(0, 10)}
            </span>
          </div>
          <div className="text-[11px] text-muted">{r.who}</div>
          {r.comment && <p className="mt-1 text-[12px] leading-relaxed">{r.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
