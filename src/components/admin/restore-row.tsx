"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminRestoreCompany, adminRestorePoint } from "@/app/actions/company-deletion";

/**
 * Восстановление мягко удалённой записи. До этого вернуть удалённое можно было
 * только руками через базу — что на практике означало «нельзя».
 */
export function RestoreRow({
  kind,
  id,
  title,
  subtitle,
  deletedAt,
  label,
}: {
  kind: "company" | "point";
  id: string;
  title: string;
  subtitle: string | null;
  deletedAt: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="bg-card border border-hairline rounded-[16px] p-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate">{subtitle}</div>}
        <div className="num text-[11px] text-muted mt-1">{deletedAt}</div>
        {error && <div className="text-xs text-down mt-1">{error}</div>}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r =
              kind === "company"
                ? await adminRestoreCompany({ companyId: id })
                : await adminRestorePoint({ pointId: id });
            if (r.ok) router.refresh();
            else setError(r.reason ?? "unknown_error");
          })
        }
        className="text-[12px] px-3 py-1.5 rounded-md border border-up text-up font-medium shrink-0 disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
