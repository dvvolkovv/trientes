/**
 * Лестница уровней клиента — одна на всю сеть, в коде. Спека
 * `docs/superpowers/specs/2026-11-19-loyalty-rates-levels-design.md`, раздел 4.
 *
 * Уровень — свойство платформы, а не магазина: кэшбэк тратится по всей сети, и своя
 * лестница у каждого магазина означала бы, что покупатель не может назвать свой уровень,
 * не открыв тридцать карточек. Правила в коде, состояние в базе — тем же решением, что
 * лист проверок комплайнса (слайс AP); экрана правки нет, строк всего четыре.
 *
 * Уровень даёт **надбавку платформы** в процентных пунктах, а не множитель к ставке
 * продавца: множитель — чужие деньги, за «×1,2» платил бы тот, кого не спросили.
 *
 * Оборот пока не считает никто: он появится с оплатой через кошелёк платформы. Поэтому
 * `levelFor` принимает `null` и отвечает «не измерено» — ноль значил бы, что посчитали.
 */
export type LoyaltyLevel = {
  key: "base" | "silver" | "gold" | "platinum";
  /** Оборот в сети, с которого уровень достигнут, в долларах. */
  minTurnoverUsd: number;
  /** Надбавка платформы к ставке продавца, в процентных пунктах. */
  platformBonusPercent: number;
};

export const LOYALTY_LEVELS: readonly LoyaltyLevel[] = [
  { key: "base", minTurnoverUsd: 0, platformBonusPercent: 0 },
  { key: "silver", minTurnoverUsd: 500, platformBonusPercent: 0.25 },
  { key: "gold", minTurnoverUsd: 5_000, platformBonusPercent: 0.5 },
  { key: "platinum", minTurnoverUsd: 25_000, platformBonusPercent: 1 },
];

export type LevelStanding = {
  level: LoyaltyLevel;
  /** Следующая ступень, если она есть. */
  next: LoyaltyLevel | null;
  /**
   * Считали ли мы оборот вообще. `false` — пока нет эквайринга: экран обязан сказать
   * «оборот ещё не считается», а не «$0», иначе мы заявляем измерение, которого не было.
   */
  measured: boolean;
};

export function levelFor(turnoverUsd: number | null): LevelStanding {
  const measured = typeof turnoverUsd === "number" && Number.isFinite(turnoverUsd) && turnoverUsd >= 0;
  const turnover = measured ? (turnoverUsd as number) : 0;
  let index = 0;
  for (let i = 0; i < LOYALTY_LEVELS.length; i += 1) {
    if (turnover >= LOYALTY_LEVELS[i].minTurnoverUsd) index = i;
  }
  return {
    level: LOYALTY_LEVELS[index],
    next: LOYALTY_LEVELS[index + 1] ?? null,
    measured,
  };
}
