"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { revertProductEdit } from "@/app/actions/products";

export type HistoryRow = {
  id: string;
  field: string;
  author: string;
  createdAt: string;
  isRevert: boolean;
};

/**
 * История правок: кто, что и когда. Откат — новая запись «вернуть как было», поэтому
 * строка не исчезает и после него: кто что написал, должно читаться и через год.
 */
export function ProductHistory({
  companyId,
  rows,
  canRevert,
}: {
  companyId: string;
  rows: HistoryRow[];
  canRevert: boolean;
}) {
  const t = useTranslations("cabinetProducts");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 text-sm border-b border-hairline py-2 last:border-0">
            <span className="text-muted num text-[11px] w-[132px] shrink-0">
              {new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")}
            </span>
            <span className="flex-1 min-w-0 truncate">
              {r.isRevert ? `${t("reverted")} ` : ""}
              {t(`field.${r.field}`)}
            </span>
            <span className="text-muted text-[12px] truncate max-w-[160px]">{r.author}</span>
            {canRevert && !r.isRevert && r.field !== "created" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await revertProductEdit(companyId, r.id);
                    if (res.ok) router.refresh();
                    else setError(res.reason);
                  });
                }}
                className="h-12 px-3 rounded-md border border-hairline text-[12px] shrink-0"
              >
                {t("revert")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p className="text-red-500 text-[13px] mt-2">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
