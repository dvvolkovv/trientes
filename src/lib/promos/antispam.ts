/**
 * Антиспам рассылок — чистые правила. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-promos-antispam-design.md`, раздел 4.
 *
 * ТЗ 4.3 называет лимиты «настраиваемыми платформой» — значит это константы в коде, как
 * лестница уровней в BD и лист проверок в AP, а не настройка мерчанта: магазин,
 * настраивающий себе потолок рассылок, потолка не имеет.
 */

/**
 * Рассылок в сутки на предприятие. ТЗ даёт вилку 1–5; берём нижнюю границу: поднять
 * число по просьбе легко, а вернуть человека, отписавшегося из-за пяти сообщений в
 * день, — нельзя.
 */
export const PROMO_SENDS_PER_DAY = 1;

/** Зазор между рассылками одного предприятия. Без него «одна в сутки» = 23:59 и 00:01. */
export const PROMO_MIN_GAP_HOURS = 20;

/**
 * Сколько сообщений от **всех** магазинов человек получает за сутки. Потолок
 * принадлежит человеку, а не магазину: десять магазинов по одной рассылке — это десять
 * сообщений, и ни один из них правила не нарушил.
 */
export const PROMO_RECEIVES_PER_DAY = 5;

export type CompanySendState = {
  /** Рассылок этого предприятия за последние сутки. Считается по факту отправленного. */
  sentToday: number;
  lastSentAt: Date | null;
};

export type SendGate = { ok: true } | { ok: false; reason: "daily_cap" | "too_soon" };

export function companySendGate(state: CompanySendState, now: Date): SendGate {
  if (state.sentToday >= PROMO_SENDS_PER_DAY) return { ok: false, reason: "daily_cap" };
  if (state.lastSentAt) {
    const gap = now.getTime() - state.lastSentAt.getTime();
    if (gap < PROMO_MIN_GAP_HOURS * 60 * 60 * 1000) return { ok: false, reason: "too_soon" };
  }
  return { ok: true };
}

export type SkipOutcome = "SKIPPED_MUTED" | "SKIPPED_OFF" | "SKIPPED_CAP";

export type RecipientState = {
  /** «Следить, но не писать мне» — отключение по магазину. */
  muted: boolean;
  /** Общий выключатель рассылок магазинов (ТЗ 4.3). */
  notifyPromos: boolean;
  receivedToday: number;
};

/**
 * Писать ли этому подписчику. `null` — писать. Отключения разной силы, и порядок
 * проверки — порядок их силы: общий выключатель человека старше отключения по магазину,
 * а оба старше потолка (потолок — наше правило, а не воля человека, и в числах мерчанта
 * он должен выглядеть именно потолком).
 */
export function recipientGate(state: RecipientState): SkipOutcome | null {
  if (!state.notifyPromos) return "SKIPPED_OFF";
  if (state.muted) return "SKIPPED_MUTED";
  if (state.receivedToday >= PROMO_RECEIVES_PER_DAY) return "SKIPPED_CAP";
  return null;
}

export type DeliveryPlan = {
  followers: number;
  send: string[];
  skip: { userId: string; outcome: SkipOutcome }[];
};

/**
 * План рассылки: кому пишем и кого пропускаем с причиной. Пропущенный человек рассылку
 * не роняет — «не ушло» с причиной мерчант видит в числах, и это честнее, чем молчание.
 */
export function planDeliveries(followers: readonly (RecipientState & { userId: string })[]): DeliveryPlan {
  const plan: DeliveryPlan = { followers: followers.length, send: [], skip: [] };
  for (const follower of followers) {
    const skip = recipientGate(follower);
    if (skip) plan.skip.push({ userId: follower.userId, outcome: skip });
    else plan.send.push(follower.userId);
  }
  return plan;
}
