/**
 * Автозаказ — чистое правило отбора. Спека
 * `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`, раздел 4.
 *
 * Прогон формирует **черновик**, а не отправляет заказ: отправка это обещание купить, и
 * его автором должен быть человек. Отбор чистый ровно затем, чтобы его можно было
 * проверить тестом: живой прогон ходит раз в сутки, и ошибка в нём видна только через
 * сутки.
 */

export type ReorderCandidate = {
  ruleId: string;
  companyId: string;
  warehouseId: string;
  productId: string;
  supplierId: string;
  minQty: number;
  targetQty: number;
  /** Что лежит на складе правила. */
  onHand: number;
  /** Что едет на этот склад: товар в пути уже куплен. */
  inTransit: number;
  /** Что уже заказано у поставщика незакрытым заказом по этой паре. */
  onOrder: number;
  /** По этой паре «склад × товар» есть незакрытый заказ. */
  hasOpenOrder: boolean;
};

export type ReorderLine = {
  ruleId: string;
  productId: string;
  qty: number;
};

/** Черновик на одного поставщика: поставщику приходит заказ, а не пачка по позиции. */
export type ReorderDraft = {
  companyId: string;
  supplierId: string;
  warehouseId: string;
  lines: ReorderLine[];
};

/**
 * Что заказывать. Три охранника, и каждый из них родился из вопроса «что будет завтра»:
 *
 * 1. **Запас в пути считается наравне с остатком** — иначе прогон каждое утро заказывает
 *    то, что уже едет.
 * 2. **Незакрытый заказ по этой паре молчит целиком** — без этого через неделю молчания
 *    кладовщика в очереди лежало бы семь одинаковых черновиков.
 * 3. **Количество округляется вверх до трёх знаков** — заказ на 0,0004 ящика это не заказ.
 */
export function reorderPlan(candidates: readonly ReorderCandidate[]): ReorderDraft[] {
  const drafts = new Map<string, ReorderDraft>();
  for (const c of candidates) {
    if (c.hasOpenOrder) continue;
    const available = c.onHand + c.inTransit + c.onOrder;
    if (available > c.minQty) continue;
    const qty = Number((c.targetQty - available).toFixed(3));
    if (qty <= 0) continue;
    // Склад назначения — склад правила: добирать надо туда, где кончилось. Поэтому
    // ключ черновика — поставщик и склад вместе.
    const key = `${c.companyId}:${c.supplierId}:${c.warehouseId}`;
    const draft = drafts.get(key) ?? {
      companyId: c.companyId,
      supplierId: c.supplierId,
      warehouseId: c.warehouseId,
      lines: [],
    };
    draft.lines.push({ ruleId: c.ruleId, productId: c.productId, qty });
    drafts.set(key, draft);
  }
  return [...drafts.values()];
}

/**
 * Порог достигнут: остатка на складе правила не больше порога (слайс CM).
 *
 * Одно сравнение на два места — число «ниже порога» в сводке и пометка строки в
 * разделе «Поставки». Своей копии не заводим: число сводки обязано быть разбираемо
 * глазом там, куда ведёт плитка, а вторая копия правила однажды разошлась бы
 * (болезнь списка локалей из уборки AU).
 *
 * Запас в пути тут **не учитывается**, в отличие от `reorderPlan`, и это разные
 * вопросы: прогон спрашивает «надо ли заказывать ещё», а человек на экране — «лежит
 * ли на складе меньше, чем я велел держать». Едущий товар на полке не лежит.
 */
export function belowThreshold(row: { onHand: number; minQty: number }): boolean {
  return row.onHand <= row.minQty;
}
