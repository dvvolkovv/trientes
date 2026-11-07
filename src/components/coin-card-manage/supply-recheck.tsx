"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { recheckCardSupply } from "@/app/actions/coin-card-supply";

export type SupplyStatus = {
  chain: string;
  totalSupply: string;
  excludedTotal: string;
  circulating: string;
  partial: boolean;
  excludedCount: number;
  checkedAt: string;
  checkError: string | null;
} | null;

/**
 * Проверенный выпуск в кабинете: что посчиталось, когда и кнопка пересчёта для
 * проекта, который только что дописал адрес казны.
 */
export function SupplyRecheck({
  cardId,
  supply,
  canEdit,
  hasCanonical,
}: {
  cardId: string;
  supply: SupplyStatus;
  canEdit: boolean;
  hasCanonical: boolean;
}) {
  const t = useTranslations("coinCard.supply");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <section id="supply">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("manageTitle")}</h2>
      <p className="text-sm text-muted mb-4">{t("manageSubtitle")}</p>

      <div className="border border-hairline rounded-md p-4 space-y-3 bg-card-alt">
        {!hasCanonical ? (
          <p className="text-sm text-muted">{t("reason.no_canonical_contract")}</p>
        ) : !supply ? (
          <p className="text-sm text-muted">{t("never")}</p>
        ) : supply.checkError ? (
          <p className="text-sm text-down">
            {t(`error.${supply.checkError}`)} · {supply.checkedAt}
          </p>
        ) : (
          <div className="text-sm space-y-1">
            <p className="num">
              {t("circulating")}: <strong>{supply.circulating}</strong>
            </p>
            <p className="num text-xs text-muted">
              {t("calculation", {
                total: supply.totalSupply,
                excluded: supply.excludedTotal,
                count: supply.excludedCount,
              })}
            </p>
            <p className="text-xs text-muted">
              {supply.partial ? `${t("partial")} · ` : ""}
              {supply.checkedAt}
            </p>
          </div>
        )}

        {canEdit && hasCanonical ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setNote(null);
                const r = await recheckCardSupply(cardId);
                if (r.ok) {
                  setNote(t("result", { ok: r.stats.ok, partial: r.stats.partial, failed: r.stats.failed }));
                  router.refresh();
                } else {
                  setError(t(`reason.${r.reason}`));
                }
              })
            }
            className="text-sm px-3 py-1.5 rounded border border-hairline hover:border-accent disabled:opacity-50"
          >
            {pending ? t("rechecking") : t("recheck")}
          </button>
        ) : null}

        {note ? <p className="text-xs text-up">{note}</p> : null}
        {error ? <p className="text-xs text-down">{error}</p> : null}
      </div>
    </section>
  );
}
