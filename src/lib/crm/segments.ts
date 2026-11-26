/**
 * Сегменты покупателей — чистые правила, без Prisma. Слайс CN, спека
 * `docs/superpowers/specs/2026-11-26-merchant-crm-segments-design.md`, раздел 4.
 *
 * Набор сегментов пришпилен в коде, как лестница уровней в BD, лист проверок в AP и ось
 * интересов в BK. Свой конструктор сегментов у каждого магазина означал бы, что слово
 * «постоянный покупатель» значит в тридцати магазинах тридцать разных вещей.
 */

export const CRM_SEGMENTS = [
  "buyers",
  "regulars",
  "newcomers",
  "dormant",
  "followersNoPurchase",
  "talkers",
] as const;
export type CrmSegment = (typeof CRM_SEGMENTS)[number];

/** «Не покупал 30 дней» — число из самого ТЗ 6.7. */
export const DORMANT_DAYS = 30;
/** Окно, в котором считается постоянство: полгода — два квартала работы магазина. */
export const REGULAR_WINDOW_DAYS = 180;
export const REGULAR_PURCHASES = 3;
/** Новый — тот, у кого покупка пока одна, и она свежая. */
export const NEWCOMER_DAYS = 30;
/** «Активность» ТЗ: писал магазину. Квартал — срок, за который разговор ещё помнят. */
export const TALKER_DAYS = 90;

export type Money = Record<string, number>;

/**
 * Факты об одном человеке, из которых выводятся признаки. Чеки — только **привязанные
 * покупателем** (CK): чек без покупателя остаётся анонимным, и человеком он не является
 * (правило ТЗ 6.8 «голый адрес не считается клиентом», применённое к чеку).
 */
export type CustomerFacts = {
  userId: string;
  username: string | null;
  name: string | null;
  /** Подписка (`CompanyFollow`, BG) — то самое «избранное» ТЗ и единственное согласие. */
  follows: boolean;
  muted: boolean;
  notifyPromos: boolean;
  /** Исполненных чеков всего и за окно постоянства. */
  purchases: number;
  purchasesInWindow: number;
  /** Отменённые чеки покупкой не считаются, но в истории видны с причиной. */
  cancelled: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  /** Последнее сообщение **покупателя** в переписке с магазином (BQ). */
  lastMessageAt: Date | null;
  /** Оборот и посчитанный кэшбэк по валютам: суммы разных валют не складываются (CK, CL). */
  turnover: Money;
  cashback: Money;
};

const DAY = 24 * 60 * 60 * 1000;

function olderThan(at: Date | null, days: number, now: Date): boolean {
  return at !== null && now.getTime() - at.getTime() > days * DAY;
}

function newerThan(at: Date | null, days: number, now: Date): boolean {
  return at !== null && now.getTime() - at.getTime() <= days * DAY;
}

/** Попадает ли человек в сегмент. Сегменты **пересекаются**: это признаки, не состояния. */
export function inSegment(f: CustomerFacts, segment: CrmSegment, now: Date): boolean {
  switch (segment) {
    case "buyers":
      return f.purchases > 0;
    case "regulars":
      return f.purchasesInWindow >= REGULAR_PURCHASES;
    case "newcomers":
      return f.purchases === 1 && newerThan(f.lastPurchaseAt, NEWCOMER_DAYS, now);
    case "dormant":
      return f.purchases > 0 && olderThan(f.lastPurchaseAt, DORMANT_DAYS, now);
    case "followersNoPurchase":
      return f.follows && f.purchases === 0;
    case "talkers":
      return newerThan(f.lastMessageAt, TALKER_DAYS, now);
  }
}

export function segmentsFor(f: CustomerFacts, now: Date): CrmSegment[] {
  return CRM_SEGMENTS.filter((s) => inSegment(f, s, now));
}

/**
 * Писать ли этому человеку вообще. Это **не** решение рассылки (его принимает
 * `recipientGate` в BG со своим суточным потолком получателя, который меняется в
 * течение дня), а число для плитки сегмента: «в сегменте 12 · написать можно четырём».
 * Без него «сценарий удержания» обещал бы охват, которого нет: покупка согласием на
 * рекламу не является, и спящему без подписки мы не пишем.
 */
export function reachable(f: CustomerFacts): boolean {
  return f.follows && !f.muted && f.notifyPromos;
}

export type SegmentCount = { total: number; reachable: number };

export function segmentCounts(list: readonly CustomerFacts[], now: Date): Record<CrmSegment, SegmentCount> {
  const out = {} as Record<CrmSegment, SegmentCount>;
  for (const segment of CRM_SEGMENTS) {
    let total = 0;
    let reach = 0;
    for (const f of list) {
      if (!inSegment(f, segment, now)) continue;
      total += 1;
      if (reachable(f)) reach += 1;
    }
    out[segment] = { total, reachable: reach };
  }
  return out;
}

export function isCrmSegment(value: unknown): value is CrmSegment {
  return typeof value === "string" && (CRM_SEGMENTS as readonly string[]).includes(value);
}

/** Как человек подписан в списке: `@логин`, иначе имя. Почты и телефона тут нет (BT). */
export function customerLabel(f: Pick<CustomerFacts, "username" | "name">): string {
  if (f.username) return `@${f.username}`;
  return f.name ?? "—";
}

/** Сумма по валютам — складывать её в одно число нечем (CK, CL). */
export function addMoney(into: Money, currency: string, amount: number): void {
  into[currency] = (into[currency] ?? 0) + amount;
}
