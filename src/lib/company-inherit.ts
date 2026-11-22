/**
 * Что точка берёт у своего предприятия (слайс BX).
 *
 * Правило BN — «часы принадлежат месту: у сети с десятью точками общих часов не
 * бывает» — остаётся верным и здесь не отменяется: **своё у точки всегда сильнее**.
 * Меняется только смысл пустоты. Прежде пустые часы точки означали «часов нет
 * вовсе», и живой случай показал цену этого: у предприятия Arcon часы заполнены,
 * у единственной его точки пусты, и карточка с карты молчала о часах, хотя
 * продавец их задал. Теперь пустота означает «как у предприятия».
 *
 * Пояс наследуется **вместе с часами**, а не сам по себе: расписание без пояса
 * состояние «открыто сейчас» не считает (правило BN), и часы предприятия с поясом
 * точки показали бы швейцарское расписание по чужому времени.
 *
 * Монеты — тот же разбор. Пустой список точки это «как у предприятия», а не «не
 * принимаем ничего»: точка, которая действительно не принимает ничего, на карте
 * приёма криптовалют не стоит.
 */

import { isEmptyWeek, parseWeekHours, type WeekHours } from "@/lib/opening-hours";

export type InheritedHours = {
  hours: WeekHours | null;
  timezone: string | null;
  /** Откуда взято. Нужно кабинету: продавец должен понимать, чьё расписание видит. */
  from: "point" | "company" | null;
};

/**
 * Часы и пояс одной парой. Разбирать их по отдельности нельзя: это два конца
 * одного утверждения, и разойдясь они дают расписание по чужому времени.
 */
export function inheritedHours(
  point: { hours: unknown; timezone: string | null },
  company: { hours: unknown; timezone: string | null },
): InheritedHours {
  const own = parseWeekHours(point.hours);
  if (!isEmptyWeek(own)) {
    return { hours: own, timezone: point.timezone ?? null, from: "point" };
  }
  const theirs = parseWeekHours(company.hours);
  if (!isEmptyWeek(theirs)) {
    return { hours: theirs, timezone: company.timezone ?? null, from: "company" };
  }
  return { hours: null, timezone: null, from: null };
}

export type CoinSets = { coins: string[]; cards: string[] };
export type InheritedCoins = CoinSets & { from: "point" | "company" | null };

function clean(list: readonly string[] | null | undefined): string[] {
  return (list ?? []).filter((id) => typeof id === "string" && id.length > 0);
}

/**
 * Набор монет точки. Наследование — **всё или ничего**, а не по списку в
 * отдельности: точка, назвавшая хоть одну монету, говорит за себя целиком.
 * Иначе заведение, выбравшее у точки только свой листинг, молча получило бы к
 * нему ещё и биткойн с эфиром предприятия — то есть заявление о приёме, которого
 * никто не делал.
 */
export function inheritedCoins(point: Partial<CoinSets>, company: Partial<CoinSets>): InheritedCoins {
  const ownCoins = clean(point.coins);
  const ownCards = clean(point.cards);
  if (ownCoins.length > 0 || ownCards.length > 0) {
    return { coins: ownCoins, cards: ownCards, from: "point" };
  }
  const theirCoins = clean(company.coins);
  const theirCards = clean(company.cards);
  if (theirCoins.length > 0 || theirCards.length > 0) {
    return { coins: theirCoins, cards: theirCards, from: "company" };
  }
  return { coins: [], cards: [], from: null };
}
