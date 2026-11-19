"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cancelMovement, receiveMovement } from "@/app/actions/warehouses";

export type TransitRow = {
  id: string;
  productName: string;
  qty: number;
  fromName: string | null;
  toName: string | null;
  carrierName: string | null;
  trackingCode: string | null;
  expectedAt: string | null;
};

/**
 * Товар у перевозчика. Это третье место, а не остаток склада-получателя: пока груз едет,
 * он не лежит ни на одной полке. Приём зачисляет его получателю, отмена возвращает
 * отправителю встречным движением — запись журнала не удаляется.
 */
export function TransitList({ companyId, rows }: { companyId: string; rows: TransitRow[] }) {
  const t = useTranslations("warehouses");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (rows.length === 0) return <p className="text-sm text-muted">{t("transitEmpty")}</p>;

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="border border-hairline rounded-lg p-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{r.productName}</div>
              <div className="text-[12px] text-muted">
                <span className="num">{r.qty}</span>
                {r.fromName || r.toName ? ` · ${r.fromName ?? "—"} → ${r.toName ?? "—"}` : null}
              </div>
              <div className="text-[12px] text-muted">
                {r.carrierName ?? "—"}
                {r.trackingCode ? <span className="num"> · {r.trackingCode}</span> : null}
                {r.expectedAt ? ` · ${t("expectedShort")} ${r.expectedAt}` : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await receiveMovement(companyId, r.id);
                  if (res.ok) router.refresh();
                  else setError(res.reason);
                });
              }}
              className="h-12 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
            >
              {t("receive")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setCancelling(cancelling === r.id ? null : r.id);
                setReason("");
              }}
              className="h-12 px-4 rounded-md border border-hairline text-sm disabled:opacity-50"
            >
              {t("cancel")}
            </button>
          </div>

          {cancelling === r.id ? (
            <div className="mt-3 space-y-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("cancelReason")}
                className="w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={pending || reason.trim().length < 3}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const res = await cancelMovement(companyId, r.id, reason);
                    if (res.ok) {
                      setCancelling(null);
                      router.refresh();
                    } else {
                      setError(res.reason);
                    }
                  });
                }}
                className="w-full h-12 rounded-md border border-hairline text-sm text-red-500 disabled:opacity-50"
              >
                {t("cancelConfirm")}
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="text-[13px] text-red-500">{t(`error.${error}`)}</p> : null}
    </div>
  );
}
