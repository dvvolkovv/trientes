import { coinsToNumber } from "./coin-card-supply";

export type CirculatingView = { coins: number; verified: boolean };

/**
 * Сколько монет в обороте — число, которое стоит под ценой вместо
 * капитализации. Капитализацию в долларах карточка больше не показывает:
 * у монеты, которой торгует один маркетмейкер, она целиком следует из его цены
 * и читается как утверждение о размере рынка, которого нет.
 *
 * Проверенный сетью выпуск, если он прочитан без ошибки; иначе заявление
 * проекта, и тогда это видно по метке. `supply_share` сюда не попадает по
 * общему правилу: при нём у записи стоит ошибка, а число относится к одной
 * сети, а не к монете.
 */
export function circulatingCoins(card: {
  tokenomics: unknown;
  supply: { circulating: string; checkError: string | null } | null;
}): CirculatingView | null {
  if (card.supply && !card.supply.checkError) {
    const coins = coinsToNumber(card.supply.circulating);
    if (coins != null && coins > 0) return { coins, verified: true };
  }
  const claimed = (card.tokenomics ?? {}) as { circulating?: number | null };
  return typeof claimed.circulating === "number" && claimed.circulating > 0
    ? { coins: claimed.circulating, verified: false }
    : null;
}
