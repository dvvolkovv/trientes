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

/** Набор монет: непустой у точки сильнее, пустой означает «как у предприятия». */
export function inheritedCoins(point: readonly string[] | null | undefined, company: readonly string[] | null | undefined): string[] {
  const own = (point ?? []).filter((id) => typeof id === "string" && id.length > 0);
  if (own.length > 0) return [...own];
  return [...(company ?? []).filter((id) => typeof id === "string" && id.length > 0)];
}
