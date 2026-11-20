"use client";

/**
 * «По пути» — места на построенном маршруте, подобранные по интересам человека
 * (ТЗ 4.4, слайс BK). Порядок — по расстоянию вдоль маршрута: это и есть сравнение
 * «заправка через сто километров или через сто пятьдесят», его не нужно изобретать
 * отдельной таблицей.
 *
 * Панель принадлежит маршруту, а не точке, поэтому живёт под картой, рядом со сводкой
 * маршрута, а не страницей в карточке места.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Poi, RouteMode } from "@/lib/crypto-map";
import { LAYER_COLOR } from "@/lib/poi-layers";
import type { InterestKey } from "@/lib/interests";

export type StopRow = {
  poi: Poi;
  interest: InterestKey;
  alongMeters: number;
  offsetMeters: number;
  cashbackPercent: number | null;
  cashbackUpTo: boolean;
  offer: { price: number; currency: string; unit: string } | null;
};

type Answer = { stops: StopRow[]; hidden: number; truncated: boolean; alertMeters: number };

function dist(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km` : `${Math.round(meters)} m`;
}

export function RouteStopsPanel({
  coords,
  mode,
  product,
  destId,
  marked,
  onToggleMark,
  onStops,
  onOpen,
}: {
  coords: [number, number][];
  mode: RouteMode;
  product: string | null;
  destId: string | null;
  marked: readonly string[];
  onToggleMark: (stop: StopRow) => void;
  /** Отмеченные точки нужны голосу ведения — он живёт в навигаторе. */
  onStops: (stops: StopRow[], alertMeters: number) => void;
  onOpen: (poi: Poi) => void;
}) {
  const t = useTranslations("cryptoMap.stops");
  const tAxis = useTranslations("cabinetInterests.axis");
  // Состояние одной записью, и в ней лежит ключ запроса: «идёт чтение» тогда считается,
  // а не ставится руками в эффекте — иначе каждый ответ маршрутизатора давал бы лишний
  // проход отрисовки (правило `react-hooks/set-state-in-effect`).
  const [state, setState] = useState<{ key: string; answer?: Answer; failed?: boolean }>({ key: "" });
  const [attempt, setAttempt] = useState(0);

  // Ключ запроса — сама линия, режим и товар. Пересчёт маршрута на ходу меняет линию
  // мало, поэтому округляем: иначе каждый отсчёт GPS означал бы новый запрос.
  const key = `${mode}|${product ?? ""}|${coords.length}|${coords[0]?.map((n) => n.toFixed(3)).join(",")}|${coords[coords.length - 1]?.map((n) => n.toFixed(3)).join(",")}`;

  useEffect(() => {
    // Транспорт и слишком короткая линия сюда не доходят: панель их не рисует вовсе,
    // а гасить состояние из эффекта незачем — ключ запроса меняется вместе с режимом.
    if (mode === "transit" || coords.length < 2) return;
    const controller = new AbortController();
    // Линию прореживаем здесь: ответ маршрутизатора несёт десятки тысяч точек, и
    // отправлять их целиком значило бы гонять мегабайты ради трёх километров полосы.
    const sampled = coords.filter((_, i) => i % Math.max(1, Math.ceil(coords.length / 1500)) === 0);
    if (sampled[sampled.length - 1] !== coords[coords.length - 1]) sampled.push(coords[coords.length - 1]);
    fetch("/api/crypto-map/along-route", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coords: sampled, mode, product, exclude: destId ? [destId] : [] }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((res: Answer) => {
        setState({ key, answer: res });
        onStops(res.stops ?? [], res.alertMeters ?? 1500);
      })
      .catch((e: unknown) => {
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        // Сбой чтения и «ничего по пути» — разные состояния, и панель их не путает.
        setState({ key, failed: true });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, destId]);

  if (mode === "transit") return null;

  const answer = state.key === key ? (state.answer ?? null) : null;
  const failed = state.key === key && state.failed === true;
  const loading = state.key !== key;

  return (
    <div className="border-t border-hairline pt-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[14px] font-semibold">{t("title")}</h3>
        <span className="text-[11px] text-muted">{t("cryptoOnly")}</span>
      </div>

      {loading && !answer ? <p className="text-[12px] text-muted">{t("loading")}</p> : null}

      {failed ? (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] text-muted">{t("failed")}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="min-h-[36px] rounded-xl border border-hairline px-3 text-[12px] hover:border-accent"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {answer && !failed ? (
        answer.stops.length === 0 ? (
          <p className="text-[12px] text-muted">{t("empty")}</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {answer.stops.map((stop) => {
                const on = marked.includes(stop.poi.id);
                return (
                  <li
                    key={stop.poi.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-3 py-2 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: LAYER_COLOR[stop.poi.layer] }}
                        />
                        <button
                          type="button"
                          onClick={() => onOpen(stop.poi)}
                          className="truncate text-[13px] font-medium text-left hover:text-accent"
                          title={t("open")}
                        >
                          {stop.poi.name}
                        </button>
                      </div>
                      <div className="text-[11px] text-muted">
                        {tAxis(stop.interest)} ·{" "}
                        {/* «Через 0 м» — это не расстояние, а округление: место стоит у
                            самого начала пути, и так про него и написано. */}
                        {stop.alongMeters < 250
                          ? t("atStart")
                          : t("along", { distance: dist(stop.alongMeters) })}{" "}
                        · {t("offset", { distance: dist(stop.offsetMeters) })}
                      </div>
                      {stop.offer || stop.cashbackPercent !== null ? (
                        <div className="num text-[11px] text-foreground">
                          {stop.offer
                            ? `${stop.offer.price} ${stop.offer.currency}/${stop.offer.unit}`
                            : null}
                          {stop.offer && stop.cashbackPercent !== null ? " · " : null}
                          {stop.cashbackPercent !== null
                            ? stop.cashbackUpTo
                              ? t("cashbackUpTo", { percent: stop.cashbackPercent })
                              : t("cashback", { percent: stop.cashbackPercent })
                            : null}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleMark(stop)}
                      aria-pressed={on}
                      className={
                        "min-h-[44px] rounded-xl border px-3 text-[12px] font-medium " +
                        (on ? "border-accent text-accent" : "border-hairline text-muted hover:border-accent")
                      }
                    >
                      {on ? t("marked") : t("mark")}
                    </button>
                  </li>
                );
              })}
            </ul>
            {answer.hidden > 0 ? (
              <p className="text-[11px] text-muted">{t("more", { count: answer.hidden })}</p>
            ) : null}
            {answer.truncated ? <p className="text-[11px] text-muted">{t("truncated")}</p> : null}
            <p className="text-[11px] text-muted">{t("markHint")}</p>
          </>
        )
      ) : null}
    </div>
  );
}
