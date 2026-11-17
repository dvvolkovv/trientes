/** Раскрывающийся раздел дела. `details` — без JS, работает и до гидрации. */
export function CaseSection({
  n,
  title,
  summary,
  open = false,
  children,
}: {
  n: string;
  title: string;
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="overflow-hidden rounded-[20px] border border-hairline bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-card-alt text-[11.5px] font-bold text-muted-strong">
          {n}
        </span>
        <span className="flex-1">
          <b className="block text-[14px] font-semibold">{title}</b>
          <span className="text-[11px] text-muted">{summary}</span>
        </span>
        <span className="text-[12px] text-muted">▾</span>
      </summary>
      <div className="border-t border-hairline px-4 pb-4 pt-3.5">{children}</div>
    </details>
  );
}
