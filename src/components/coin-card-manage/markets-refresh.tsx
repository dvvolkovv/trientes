"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { refreshCardMarkets } from "@/app/actions/coin-card-markets";

export type MarketStatus = {
  id: string;
  exchangeName: string;
  pair: string;
  priceUsd: number | null;
  checkedAt: string | null;
  checkError: string | null;
  isOutlier: boolean;
  confirmed: boolean;
};

export type IndexStatus = {
  priceUsd: number;
  marketCount: number;
  confidence: string;
  computedAt: string;
} | null;

/**
 * Сводка по рынкам и кнопка «Обновить рынки» в кабинете карточки: проект,
 * только что добавивший листинг, не должен ждать прогона воркера.
 */
export function MarketsRefresh({
  cardId,
  markets,
  index,
  canEdit,
}: {
  cardId: string;
  markets: MarketStatus[];
  index: IndexStatus;
  canEdit: boolean;
}) {
  const t = useTranslations("coinCard.index");
  const tm = useTranslations("coinCard.market");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (markets.length === 0) return null;

  return (
    <section id="markets-sync">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("manageTitle")}</h2>
      <p className="text-sm text-muted mb-4">{t("manageSubtitle")}</p>

      <div className="border border-hairline rounded-md p-4 space-y-3 bg-card-alt">
        {index ? (
          <p className="text-sm num">
            ${index.priceUsd} ·{" "}
            <span className="text-muted">
              {t("fromMarkets", { count: index.marketCount })} ·{" "}
              {t(`confidence.${index.confidence}`)} · {index.computedAt}
            </span>
          </p>
        ) : (
          <p className="text-sm text-muted">{t("none")}</p>
        )}

        <ul className="space-y-1">
          {markets.map((m) => (
            <li key={m.id} className="text-sm">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted">
                {m.exchangeName}
              </span>{" "}
              <span className="num text-xs">{m.pair}</span>
              <span className="text-xs ml-2">
                {m.checkError ? (
                  <span
                    className={
                      m.checkError === "pair_not_found" || m.checkError === "base_mismatch"
                        ? "text-down"
                        : "text-muted"
                    }
                  >
                    {tm(`error.${m.checkError}`)}
                  </span>
                ) : m.confirmed ? (
                  <span className={m.isOutlier ? "text-muted" : "text-up"}>
                    {m.isOutlier ? tm("outlier") : tm("confirmed")}
                    {m.priceUsd != null ? ` · $${m.priceUsd}` : ""}
                  </span>
                ) : (
                  <span className="text-muted">{tm("claimed")}</span>
                )}
                {m.checkedAt ? <span className="text-muted"> · {m.checkedAt}</span> : null}
              </span>
            </li>
          ))}
        </ul>

        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setNote(null);
                const r = await refreshCardMarkets(cardId);
                if (r.ok) {
                  setNote(
                    t("result", {
                      checked: r.stats.marketsChecked,
                      confirmed: r.stats.confirmed,
                      failed: r.stats.failed,
                    }),
                  );
                  router.refresh();
                } else {
                  setError(t(`reason.${r.reason}`));
                }
              })
            }
            className="text-sm px-3 py-1.5 rounded border border-hairline hover:border-accent disabled:opacity-50"
          >
            {pending ? t("refreshing") : t("refresh")}
          </button>
        ) : null}

        {note ? <p className="text-xs text-up">{note}</p> : null}
        {error ? <p className="text-xs text-down">{error}</p> : null}
      </div>
    </section>
  );
}
