import type { ReactNode } from "react";

export const inputCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
export const labelCls =
  "text-[12px] uppercase tracking-[0.15em] text-muted mb-2 block";
export const btnCls =
  "w-full sm:w-auto bg-accent text-accent-foreground glow-accent rounded-md px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className="text-muted text-xs mt-1">{hint}</p>}
    </div>
  );
}
