/**
 * Что сделать с просьбой поставить или сменить ссылку оплаты (задание, § 2.6) — чистое
 * правило, без Prisma и без запросов наружу.
 *
 * Правило отвечает за единственный вопрос, от которого зависят деньги покупателей:
 * включить новую ссылку сейчас или дать владельцу сутки на то, чтобы заметить подмену.
 * Поэтому оно одно и проверяется тестом: вторая копия такого правила — это второй
 * ответ на тот же вопрос.
 */

/** Ссылка другого магазина ждёт сутки: столько нужно, чтобы владелец заметил письмо. */
export const CHANGE_DELAY_MS = 24 * 60 * 60 * 1000;
/**
 * Смена канала связи замораживает ссылку на те же сутки. Иначе захватчик сначала
 * заменит Telegram и почту на свои, и отложенная смена пройдёт в тишине — сообщение
 * о ней уйдёт ему же.
 */
export const CONTACT_FREEZE_MS = 24 * 60 * 60 * 1000;
/** Свежий вход: четверть часа. Украденный cookie этого не даёт. */
export const FRESH_LOGIN_MS = 15 * 60 * 1000;

export type PayLinkRef = { linkId: string; merchantId: string };

export type PlanInput = {
  /** Что стоит в карточке сейчас; `null` — ссылки нет. */
  current: PayLinkRef | null;
  /** Что просят поставить. */
  next: PayLinkRef;
  now: Date;
  /** Когда в этом сеансе последний раз подтверждали личность; `null` — неизвестно. */
  freshLoginAt: Date | null;
  /** Когда у записи сменился канал связи. */
  contactChangedAt: Date | null;
  hasTelegram: boolean;
  hasEmail: boolean;
  /** Нашёлся ли наш код в названии ссылки. */
  codeOk: boolean;
};

export type PlanDenial =
  | "stale_login"
  | "code_required"
  | "contact_frozen"
  | "no_channel"
  | "same_link";

export type PayLinkPlan =
  /** Первая установка — сразу. Задержки нет: уводить пока нечего. */
  | { kind: "install" }
  /** Ссылка того же магазина — сразу. Кошелёк получателя не меняется. */
  | { kind: "same" }
  /** Ссылка другого магазина — через сутки; старая всё это время работает. */
  | { kind: "delayed"; effectiveAt: Date }
  | { kind: "deny"; reason: PlanDenial };

const within = (at: Date | null, ms: number, now: Date): boolean =>
  at !== null && now.getTime() - at.getTime() < ms;

/** Нужен ли код: при первой установке и при смене на другой магазин (§ 2.3). */
export function codeRequired(current: PayLinkRef | null, next: PayLinkRef): boolean {
  return current === null || current.merchantId !== next.merchantId;
}

/**
 * Решение по просьбе. Порядок проверок — это порядок, в котором человеку надо
 * объяснять отказ: сперва «войдите заново», потом «подождите сутки после смены
 * почты», потом «впишите код», и только потом разговор о самой ссылке.
 */
export function planPayLinkChange(input: PlanInput): PayLinkPlan {
  const { current, next, now } = input;

  // Свежий вход нужен и установке, и смене: украденный cookie живёт месяц, а
  // подтверждение личности — четверть часа.
  if (!within(input.freshLoginAt, FRESH_LOGIN_MS, now)) return { kind: "deny", reason: "stale_login" };

  if (within(input.contactChangedAt, CONTACT_FREEZE_MS, now)) {
    return { kind: "deny", reason: "contact_frozen" };
  }

  if (codeRequired(current, next) && !input.codeOk) {
    return { kind: "deny", reason: "code_required" };
  }

  if (current === null) return { kind: "install" };

  // Тот же номер — делать нечего: это не смена, а повторное нажатие.
  if (current.linkId === next.linkId) return { kind: "deny", reason: "same_link" };

  // Смена существующей ссылки обязана быть замеченной, а замечают её по каналу связи.
  // Нет ни Telegram, ни почты — смена запрещена: иначе подмена прошла бы молча.
  if (!input.hasTelegram && !input.hasEmail) return { kind: "deny", reason: "no_channel" };

  if (current.merchantId === next.merchantId) return { kind: "same" };
  return { kind: "delayed", effectiveAt: new Date(now.getTime() + CHANGE_DELAY_MS) };
}

/** Свежесть входа как её видит страница: по чему считаем и сколько осталось. */
export function loginFresh(freshLoginAt: Date | null, now: Date): boolean {
  return within(freshLoginAt, FRESH_LOGIN_MS, now);
}

/** Заморозка после смены канала: когда кончится; `null` — не заморожено. */
export function contactFreezeUntil(contactChangedAt: Date | null, now: Date): Date | null {
  if (!within(contactChangedAt, CONTACT_FREEZE_MS, now)) return null;
  return new Date(contactChangedAt!.getTime() + CONTACT_FREEZE_MS);
}
