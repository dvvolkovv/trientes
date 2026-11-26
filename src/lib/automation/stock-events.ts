/**
 * Пересечение порога остатка (слайс CO) — чистое правило.
 *
 * Событие «кончается» рождается **на пересечении**, а не на каждом расходе: иначе десять
 * продаж кончившегося товара дают десять задач кладовщику. Числа «до» и «после» даёт
 * `applyDeltas` — он единственный автор остатка (правило BI) и возвращает получившееся
 * количество, поэтому второго запроса в базу нет.
 *
 * Порог берётся из правила автозаказа (`ReorderRule.minQty`, BI). Второго места для
 * порога не заводим; правила нет — порог ноль, и тогда работает только «кончился».
 */

export type StockChange = {
  warehouseId: string;
  productId: string;
  /** Остаток до движения и после него. */
  before: number;
  after: number;
  /** Порог правила автозаказа на этой паре «склад × товар»; нет правила — ноль. */
  minQty: number;
};

export type StockCrossing = {
  kind: "STOCK_LOW" | "STOCK_OUT";
  warehouseId: string;
  productId: string;
  onHand: number;
  minQty: number;
};

/**
 * Что пересекли. «Кончился» и «кончается» — разные события, и у кончившегося товара
 * сообщается только первое: две строки об одном факте человек читает как две беды.
 */
export function crossedThresholds(changes: readonly StockChange[]): StockCrossing[] {
  const out: StockCrossing[] = [];
  for (const c of changes) {
    if (c.after >= c.before) continue; // приход порога не пересекает
    const base = { warehouseId: c.warehouseId, productId: c.productId, onHand: c.after, minQty: c.minQty };
    if (c.before > 0 && c.after <= 0) {
      out.push({ kind: "STOCK_OUT", ...base });
      continue;
    }
    if (c.minQty > 0 && c.before > c.minQty && c.after <= c.minQty) {
      out.push({ kind: "STOCK_LOW", ...base });
    }
  }
  return out;
}
