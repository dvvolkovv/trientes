/**
 * Правила переписки покупателя с магазином — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-20-customer-messages-design.md`, раздел 2.
 *
 * Это первая дверь снаружи внутрь кабинета мерчанта, поэтому здесь больше
 * ограничителей, чем возможностей (тот же разбор, что у рассылки акций в BG).
 */

/** Вопрос магазину короче обсуждения задачи (`DETAILS_CHARS` = 4000 в BF). */
export const CUSTOMER_BODY_CHARS = 2000;

/**
 * Сообщений в сутки на **покупателя** по всем магазинам. Потолок считается на того,
 * кто пишет, а не на того, кому пишут: иначе один поток закрывал бы дверь честным
 * покупателям того же магазина. Счёт до записи — приём `DAILY_MOVEMENTS` (BC).
 */
export const CUSTOMER_DAILY_MESSAGES = 30;

/**
 * Своих сообщений подряд без ответа магазина. Это замена зазору по времени: зазор
 * мешает дописать «и ещё забыл спросить», а заваливание — именно поток в тишину.
 */
export const CUSTOMER_UNANSWERED = 10;

/** История страницами — столько строк человек читает за раз (как `CHAT_PAGE` в BP). */
export const CUSTOMER_PAGE = 50;

/** Причина блокировки — тот же порог, что у причины отказа во всём проекте. */
export const BLOCK_REASON_CHARS = 3;

export type CustomerSideKey = "CUSTOMER" | "STORE";

export type ThreadGateCompany = {
  status: string;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * Можно ли вообще писать этому предприятию. Дверь снаружи есть только у видимого на
 * витрине: карточка снятого надзором (AR) или неодобренного предприятия отдаёт 404,
 * значит кнопки нет по построению — но серверное действие зовут и прямым запросом.
 */
export function companyAcceptsMessages(company: ThreadGateCompany | null | undefined): boolean {
  if (!company) return false;
  return company.status === "APPROVED" && !company.suspendedAt && !company.deletedAt;
}

type Ok = { ok: true };
type Bad<R extends string> = { ok: false; reason: R };

export type CustomerPostReason =
  | "body_required"
  | "body_too_long"
  | "daily_limit"
  | "unanswered_limit"
  | "blocked"
  | "company_inactive";

/**
 * Проверка сообщения покупателя. Порядок проверок — порядок их силы: блокировка и
 * состояние предприятия старше потолков, потолки старше формы текста (тот же порядок,
 * которым BG проверяет отключения перед квотой).
 */
export function validateCustomerMessage(
  body: string,
  ctx: {
    blocked: boolean;
    companyActive: boolean;
    todayCount: number;
    unansweredCount: number;
  },
): Ok | Bad<CustomerPostReason> {
  if (ctx.blocked) return { ok: false, reason: "blocked" };
  if (!ctx.companyActive) return { ok: false, reason: "company_inactive" };
  const text = body.trim();
  if (!text) return { ok: false, reason: "body_required" };
  if (body.length > CUSTOMER_BODY_CHARS) return { ok: false, reason: "body_too_long" };
  if (ctx.todayCount >= CUSTOMER_DAILY_MESSAGES) return { ok: false, reason: "daily_limit" };
  if (ctx.unansweredCount >= CUSTOMER_UNANSWERED) return { ok: false, reason: "unanswered_limit" };
  return { ok: true };
}

export type StoreReplyReason = "body_required" | "body_too_long" | "company_inactive";

/**
 * Ответ магазина потолками покупателя не связан: магазин отвечает на вопрос, а не
 * начинает разговор. Блокировка ответу тоже не мешает — объяснить блокировку словами
 * магазин вправе (и это честнее молчания).
 */
export function validateStoreReply(
  body: string,
  ctx: { companyActive: boolean },
): Ok | Bad<StoreReplyReason> {
  if (!ctx.companyActive) return { ok: false, reason: "company_inactive" };
  const text = body.trim();
  if (!text) return { ok: false, reason: "body_required" };
  if (body.length > CUSTOMER_BODY_CHARS) return { ok: false, reason: "body_too_long" };
  return { ok: true };
}

export type UnansweredRow = { side: CustomerSideKey };

/**
 * Сколько своих сообщений покупатель послал после последнего ответа магазина. Строки
 * приходят от новых к старым: считаем до первой строки магазина.
 */
export function unansweredCount(rows: readonly UnansweredRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (row.side === "STORE") break;
    n++;
  }
  return n;
}

export type UnreadRow = { side: CustomerSideKey; createdAt: Date; deletedAt: Date | null };

/**
 * Непрочитанное по стороне (§ 2.5). Свои сообщения непрочитанными не бывают никогда,
 * отозванные не считаются: значок с числом обещал бы слова, которых на экране нет.
 */
export function unreadForSide(
  rows: readonly UnreadRow[],
  side: CustomerSideKey,
  lastReadAt: Date | null,
): number {
  return rows.filter((row) => {
    if (row.deletedAt) return false;
    if (row.side === side) return false;
    if (!lastReadAt) return true;
    return row.createdAt.getTime() > lastReadAt.getTime();
  }).length;
}

export type WithdrawTarget = {
  side: CustomerSideKey;
  authorUserId: string | null;
  deletedAt: Date | null;
};

/**
 * Отзыв сообщения. Своё отзывает автор; сообщение магазина — ещё и владелец.
 * **Сообщение покупателя магазин не отзывает**: это чужие слова, и убирать их он не
 * вправе — против потока у него есть блокировка (§ 2.10).
 *
 * Закрытый блокировкой разговор покупатель не правит вовсе: магазин закрыл его из-за
 * сказанного, и стереть сказанное после этого значило бы убрать то, на что магазин
 * ответил блокировкой. Магазин своё слово убрать по-прежнему может — блокировал он.
 */
export function canWithdrawCustomerMessage(
  message: WithdrawTarget,
  viewer: { userId: string; side: CustomerSideKey; isOwner: boolean; threadBlocked?: boolean },
): boolean {
  if (message.deletedAt) return false;
  if (message.side !== viewer.side) return false;
  if (viewer.side === "CUSTOMER" && viewer.threadBlocked) return false;
  if (viewer.side === "STORE" && viewer.isOwner) return true;
  return message.authorUserId !== null && message.authorUserId === viewer.userId;
}

export type BlockReason = "reason_too_short";

/** Блокировка. Причина необязательна, но написанная коротко — не причина. */
export function validateBlock(reason: string | null | undefined): Ok | Bad<BlockReason> {
  if (reason === null || reason === undefined) return { ok: true };
  const text = reason.trim();
  if (!text) return { ok: true };
  if (text.length < BLOCK_REASON_CHARS) return { ok: false, reason: "reason_too_short" };
  return { ok: true };
}

/**
 * Уходит ли сотрудникам уведомление каналами. Только на **начало разговора**: первое
 * сообщение покупателя, когда у магазина нет непрочитанных по этой нитке. Продолжение
 * разговора зажигает значок — правило BP («письмо на каждую фразу — спам, которым мы
 * портим домен»).
 */
export function notifiesStaff(ctx: { storeUnreadBefore: number }): boolean {
  return ctx.storeUnreadBefore === 0;
}
