/**
 * Лестница настройки товара (слайс BM). Просьба владельца голосом: «завели товар,
 * потом с этим товаром начинаем работать, цеплять к нему возможности — и чтобы это
 * было последовательно».
 *
 * Лестница — указатель, а не калитка: все формы остаются доступными, и продавец
 * вправе вписать ставку кэшбэка до цены. Но ступень, которая ни на что не повлияет,
 * говорит это прямо — «обманка хуже отказа» (правило BI), и «кнопка гасла без
 * объяснения» было дефектом живого прогона BG.
 *
 * Лестница одна и та же для онлайна и для полки: товар один, различие прячется
 * внутри третьей ступени, где полка на точке и онлайн-склад равноправны. Две
 * лестницы разошлись бы.
 */

export const LADDER_STEPS = ["passport", "offer", "where", "cashback", "promo", "supply"] as const;
export type LadderStepKey = (typeof LADDER_STEPS)[number];

export type LadderState = "done" | "todo" | "blocked";

export type LadderStep = {
  key: LadderStepKey;
  state: LadderState;
  /** Чего не хватает, чтобы ступень считалась пройденной. */
  missing?: string[];
  /** Почему ступень пока ни на что не повлияет. Только у `blocked`. */
  blockedBy?: LadderStepKey;
};

export type LadderInput = {
  /** Паспорт: пусто — товар ещё не создан. */
  passport: { name: string; category: string; description: string; photoCount: number; gtin: string | null } | null;
  /** Предложение продавца: цена и единица. */
  offer: { price: number; unit: string; active: boolean } | null;
  /** Остаток на полках и онлайн-складах этого продавца. */
  stockQty: number;
  /** Действующая ставка кэшбэка в процентах, откуда бы она ни взялась. */
  cashbackPercent: number | null;
  /** Живые акции, в которые втянут этот товар. */
  promoCount: number;
  /** Правила автозаказа по этому товару. */
  reorderRules: number;
};

/** Сколько знаков описания считаем настоящим описанием, а не заглушкой. */
export const LADDER_DESCRIPTION_CHARS = 40;

function dependent(key: LadderStepKey, fact: boolean, offerDone: boolean): LadderStep {
  if (!offerDone) return { key, state: "blocked", blockedBy: "offer" };
  return { key, state: fact ? "done" : "todo" };
}

export function productLadder(input: LadderInput): LadderStep[] {
  const passportMissing: string[] = [];
  if (!input.passport) passportMissing.push("name");
  else {
    if (!input.passport.name.trim()) passportMissing.push("name");
    if (!input.passport.category.trim()) passportMissing.push("category");
    if (input.passport.description.trim().length < LADDER_DESCRIPTION_CHARS) passportMissing.push("description");
    if (input.passport.photoCount < 1) passportMissing.push("photo");
    if (!input.passport.gtin) passportMissing.push("gtin");
  }
  const passportDone = passportMissing.length === 0;

  // Предложение — настоящая развилка лестницы: без цены покупателю нечего показать,
  // и всё, что ниже, остаётся словами в кабинете.
  const offerDone = Boolean(input.offer && input.offer.price > 0 && input.offer.active);

  const steps: LadderStep[] = [
    { key: "passport", state: passportDone ? "done" : "todo", missing: passportMissing },
    {
      key: "offer",
      // Паспорт не блокирует цену: цену ставят и у товара без фотографии, она
      // работает. Блокирует только настоящая зависимость.
      state: offerDone ? "done" : "todo",
      missing: offerDone ? [] : input.offer ? (input.offer.active ? ["price"] : ["paused"]) : ["offer"],
    },
    // Зависимые ступени: «заблокировано» сильнее «сделано». Ставка кэшбэка у
    // товара без цены существует, но не действует ни для кого — назвать её
    // сделанной значило бы сказать продавцу «всё в порядке», пока покупатель не
    // видит ничего. Поэтому сперва проверяется зависимость, и только потом факт.
    dependent("where", input.stockQty > 0, offerDone),
    dependent("cashback", input.cashbackPercent !== null, offerDone),
    dependent("promo", input.promoCount > 0, offerDone),
    {
      // Поставка живёт сама по себе: заказать товар у поставщика можно и до того,
      // как он выставлен на продажу — склад наполняют раньше витрины.
      key: "supply",
      state: input.reorderRules > 0 ? "done" : "todo",
    },
  ];
  return steps;
}

/** Сколько ступеней пройдено — число для шапки («3 из 6»). */
export function ladderProgress(steps: LadderStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.state === "done").length, total: steps.length };
}
