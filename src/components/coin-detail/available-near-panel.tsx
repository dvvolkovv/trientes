"use client";

/**
 * Что принимает криптовалюту в этой стране — полосой НАД картой.
 *
 * Прежде это был блок, лежавший поверх карты справа, и он показывал только
 * финтех. На телефоне он закрывал собой ровно ту часть карты, ради которой её
 * и открыли. Теперь полоса стоит над картой и держит три перечня: точки
 * приёма (счётчики того, что видно сейчас — их считает сама карта), биржи
 * каталога и финтех.
 *
 * Формулировки у бирж и финтеха разные не случайно: у финтеха `availableIn[]`
 * — это заявление компании о доступности, а у биржи в каталоге записана
 * страна регистрации, и выдавать её за доступность нельзя.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { POI_LAYERS, LAYER_COLOR, type PoiLayer } from "@/lib/poi-layers";

type ExchangeRow = { id: string; name: string; logoUrl: string | null };
type FintechRow = { id: string; slug: string; displayName: string; logoUrl: string | null };

export function AvailableNearPanel({
  cc,
  counts,
}: {
  /** Код страны центра карты — его определяет навигатор обратным геокодированием. */
  cc: string | null;
  counts: Record<PoiLayer, number>;
}) {
  const t = useTranslations("cryptoMap");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exchanges, setExchanges] = useState<ExchangeRow[]>([]);
  const [fintechs, setFintechs] = useState<FintechRow[]>([]);
  const loadedCcRef = useRef<string | null>(null);
  // Код страны человеку ничего не говорит: «AT» в заголовке — это не язык,
  // на котором он читает. Имя страны даёт сам браузер на языке страницы,
  // переводить его своими руками не нужно.
  const country = useMemo(() => {
    if (!cc) return "";
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(cc) ?? cc;
    } catch {
      return cc;
    }
  }, [cc, locale]);

  // Запрос каталога — только когда полосу раскрыли: свёрнутая полоса ничего
  // из него не показывает, и тянуть его при каждом сдвиге карты незачем.
  useEffect(() => {
    if (!open || !cc || loadedCcRef.current === cc) return;
    loadedCcRef.current = cc;
    setLoading(true);
    fetch(`/api/crypto-map/available?cc=${cc}`)
      .then((r) => (r.ok ? r.json() : { exchanges: [], fintechs: [] }))
      .then((j: { exchanges?: ExchangeRow[]; fintechs?: FintechRow[] }) => {
        setExchanges(j.exchanges ?? []);
        setFintechs(j.fintechs ?? []);
      })
      .catch(() => {
        setExchanges([]);
        setFintechs([]);
      })
      .finally(() => setLoading(false));
  }, [open, cc]);

  if (!cc) return null;
  const visiblePoints = POI_LAYERS.filter((l) => counts[l] > 0);

  return (
    <div className="rounded-xl border border-hairline bg-card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="text-[13px] font-medium text-foreground">{t("available.title", { country })}</span>
        <span aria-hidden className="text-[13px] text-muted">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-hairline px-3 py-3">
          <section>
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("available.points")}</h4>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
              {visiblePoints.length === 0 ? (
                <span className="text-muted">{t("available.noPoints")}</span>
              ) : (
                visiblePoints.map((layer) => (
                  // Кружок — цвет пульса слоя: то же, что дышит в середине
                  // булавки на карте (каёмка означает источник, см. poi-brand).
                  <span key={layer} className="flex items-center gap-1.5 text-foreground">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: LAYER_COLOR[layer] }}
                    />
                    {t(`layer_${layer}`)}
                    <span className="num text-muted">{counts[layer]}</span>
                  </span>
                ))
              )}
            </div>
          </section>

          <section>
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t("available.exchanges", { country })}
            </h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {loading ? (
                <span className="text-[12px] text-muted">{t("available.loading")}</span>
              ) : exchanges.length === 0 ? (
                <span className="text-[12px] text-muted">{t("available.noExchanges")}</span>
              ) : (
                exchanges.map((ex) => (
                  <Link
                    key={ex.id}
                    href={`/${locale}/exchanges/${ex.id}`}
                    className="flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-[12px] text-foreground hover:border-accent"
                  >
                    {ex.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ex.logoUrl} alt="" className="h-4 w-4 rounded" loading="lazy" />
                    ) : (
                      <span className="h-4 w-4 rounded bg-bg-tint" />
                    )}
                    <span className="truncate max-w-[140px]">{ex.name}</span>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section>
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-muted">
              {t("available.fintech", { country })}
            </h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {loading ? (
                <span className="text-[12px] text-muted">{t("available.loading")}</span>
              ) : fintechs.length === 0 ? (
                <span className="text-[12px] text-muted">{t("available.noFintech")}</span>
              ) : (
                fintechs.map((f) => (
                  <Link
                    key={f.id}
                    href={`/${locale}/fintech/${f.slug}`}
                    className="flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-[12px] text-foreground hover:border-accent"
                  >
                    {f.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.logoUrl} alt="" className="h-4 w-4 rounded" loading="lazy" />
                    ) : (
                      <span className="h-4 w-4 rounded bg-bg-tint" />
                    )}
                    <span className="truncate max-w-[140px]">{f.displayName}</span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
