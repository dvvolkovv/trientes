"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { decideRevision } from "@/app/actions/products";

export type RevisionRow = {
  id: string;
  companyName: string;
  patch: { field: string; after: unknown }[];
  createdAt: string;
};

/**
 * Входящие предложения правок у хозяина паспорта. Решает он, а не администратор
 * платформы: это спор двух предприятий о свойствах их товара. Отказ требует причины —
 * «нет» без слов через год не значит ничего.
 */
export function RevisionsInbox({ companyId, rows }: { companyId: string; rows: RevisionRow[] }) {
  const t = useTranslations("cabinetProducts");
  const router = useRouter();
  const [reason, setReason] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(id: string, accept: boolean) {
    setError(null);
    start(async () => {
      const res = await decideRevision(companyId, id, accept, reason[id] ?? "");
      if (res.ok) router.refresh();
      else setError(res.reason);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.id} className="border border-hairline rounded-lg p-3">
          <div className="text-[12px] text-muted mb-2">
            {r.companyName} · {new Date(r.createdAt).toISOString().slice(0, 10)}
          </div>
          <ul className="text-sm mb-3 list-disc list-inside">
            {r.patch.map((p) => (
              <li key={p.field}>
                {t(`field.${p.field}`)}: <span className="text-muted">{String(p.after).slice(0, 120)}</span>
              </li>
            ))}
          </ul>
          <input
            value={reason[r.id] ?? ""}
            onChange={(e) => setReason((prev) => ({ ...prev, [r.id]: e.target.value }))}
            placeholder={t("rejectReason")}
            className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm mb-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(r.id, true)}
              className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium"
            >
              {t("acceptRevision")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => decide(r.id, false)}
              className="h-12 px-4 rounded-md border border-hairline text-sm"
            >
              {t("rejectRevision")}
            </button>
          </div>
        </div>
      ))}
      {error ? <p className="text-red-500 text-[13px]">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
