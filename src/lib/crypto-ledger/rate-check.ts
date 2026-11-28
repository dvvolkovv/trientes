/**
 * Сверка заявленного курса с нашей ценой того часа (слайс CR, раздел 5.2 спеки).
 *
 * ТЗ § 6.8 просит «курсы запрашиваются из источника котировок постоянно» — у нас такой
 * источник свой, и это единственное место слайса, где мы не верим продавцу на слово, а
 * **сверяем**. Сверка ничего не правит: курс сделки законно отличается от индекса
 * (спред, минута, пара), поэтому расхождение — это строка на экране, а не отказ.
 *
 * Три охранника, каждый против своей беды (разбор спеки): тикер-двойник (опорой
 * становится только единственное совпадение в каталоге — правило CJ), отсутствие цены в
 * окне («не сверено», а не «расходится») и допуск 25 % (тот же, что у охранника
 * тикера-двойника в слайсе X).
 *
 * Чего в сверке честно нет: **исторического курса фиата**. Мы его не храним, поэтому
 * валюта чека приводится к доллару по сегодняшнему курсу, и на экране это сказано. Для
 * сверки порядка величины этого достаточно, для бухгалтерии — нет, и мы не делаем вид,
 * что достаточно.
 */

/** Допуск, при котором расхождение считается обычным (спред, время, пара). */
export const RATE_TOLERANCE_PCT = 25;

export type RateUnchecked =
  | "no_rate"
  | "coin_unknown"
  | "ticker_ambiguous"
  | "no_price"
  | "no_fx";

export type RateVerdict =
  | { state: "unchecked"; reason: RateUnchecked }
  | { state: "ok" | "off"; declaredUsd: number; ourUsd: number; deltaPct: number };

export type RateCheckInput = {
  /** Заявленный курс: сколько единиц валюты за одну монету. */
  rate: number | null;
  /** Сколько долларов в одной единице валюты чека. `null` — курса фиата нет. */
  usdPerUnit: number | null;
  /** Наша цена монеты в долларах на час операции. */
  ourUsd: number | null;
  /** Почему цены нет, если её нет: беду надо назвать своим словом. */
  priceReason?: Extract<RateUnchecked, "coin_unknown" | "ticker_ambiguous" | "no_price">;
};

export function compareRate(input: RateCheckInput): RateVerdict {
  if (input.rate === null || input.rate <= 0) return { state: "unchecked", reason: "no_rate" };
  if (input.usdPerUnit === null || input.usdPerUnit <= 0) {
    return { state: "unchecked", reason: "no_fx" };
  }
  if (input.ourUsd === null || input.ourUsd <= 0) {
    return { state: "unchecked", reason: input.priceReason ?? "no_price" };
  }

  const declaredUsd = input.rate * input.usdPerUnit;
  const deltaPct = ((declaredUsd - input.ourUsd) / input.ourUsd) * 100;
  const rounded = Math.round(deltaPct * 10) / 10;
  return {
    state: Math.abs(deltaPct) > RATE_TOLERANCE_PCT ? "off" : "ok",
    declaredUsd,
    ourUsd: input.ourUsd,
    deltaPct: rounded,
  };
}

/** Окно поиска нашей цены вокруг часа операции. */
export const PRICE_WINDOW_MS = 6 * 3600_000;

export type PricePoint = { at: Date; usd: number };

/**
 * Ближайшая к мгновению точка цены в пределах окна. Вне окна цены **нет**: цена
 * вчерашнего дня опорой для сегодняшней сделки не является (тот же порог свежести, что
 * у опоры посева рынков в слайсе X).
 */
export function nearestPrice(points: readonly PricePoint[], at: Date): number | null {
  let best: PricePoint | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const p of points) {
    const gap = Math.abs(p.at.getTime() - at.getTime());
    if (gap <= PRICE_WINDOW_MS && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best ? best.usd : null;
}
