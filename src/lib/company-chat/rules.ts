/**
 * Правила общего чата команды — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-20-merchant-team-chat-design.md`, раздел 2.
 *
 * Главные решения слайса живут здесь: комната принадлежит команде (нового раздела прав
 * нет — право, умеющее только замолчать человека, это управление, а не доступ);
 * непрочитанное считается **на человека**, а не на сторону, как в делах комплайнса;
 * уведомление каналами уходит только по упоминанию члена этой же команды.
 */

/** Длина сообщения — та же, что у подробностей задачи (`DETAILS_CHARS`, BF). */
export const CHAT_BODY_CHARS = 4000;
/** Сообщений в сутки на предприятие; счёт до записи — приём `DAILY_MOVEMENTS` (BC). */
export const CHAT_DAILY_MESSAGES = 1000;
/** История страницами: столько строк человек читает за раз. */
export const CHAT_PAGE = 50;

export type ChatRights = {
  /** Читать комнату. Член команды — читает; не член не видит её вовсе. */
  read: boolean;
  /** Писать. Снятое надзором или удалённое предприятие разговор не продолжает. */
  post: boolean;
};

export type ChatGateCompany = {
  suspendedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * Права на комнату. Раздела прав у чата нет намеренно (§ 2.2): читают и пишут все члены,
 * включая `VIEWER` — наблюдатель, который не может задать вопрос, не наблюдатель.
 * Листинга чат не требует: это внутренняя работа (правило BF § 2.9).
 */
export function chatRightsFor(company: ChatGateCompany | null | undefined): ChatRights {
  if (!company) return { read: false, post: false };
  const active = !company.suspendedAt && !company.deletedAt;
  return { read: true, post: active };
}

type Ok = { ok: true };
type Bad<R extends string> = { ok: false; reason: R };

export type ChatReason = "body_required" | "body_too_long" | "daily_limit";

export function validateMessage(body: string, ctx: { todayCount: number }): Ok | Bad<ChatReason> {
  const text = body.trim();
  if (!text) return { ok: false, reason: "body_required" };
  if (body.length > CHAT_BODY_CHARS) return { ok: false, reason: "body_too_long" };
  if (ctx.todayCount >= CHAT_DAILY_MESSAGES) return { ok: false, reason: "daily_limit" };
  return { ok: true };
}

export type ChatMember = { userId: string; username: string | null };

/**
 * Кого можно позвать по имени. Класс знаков тот же, что у логина
 * (`src/lib/username.ts`: `[a-z0-9_]`), и это **одно правило на две стороны**: чип
 * подстановки в комнате и разбор на сервере. Разойдись они — чип вставлял бы
 * `@логин`, который никого не зовёт, и подсказка «он получит уведомление» лгала бы.
 */
export function isMentionable(username: string | null | undefined): boolean {
  return Boolean(username && /^[a-zA-Z0-9_]{1,64}$/.test(username));
}

/**
 * Упоминания разбираются **на сервере** по списку членов команды, а не доверяются
 * браузеру: уведомление каналами — это письмо живому человеку. Чужой логин остаётся
 * просто текстом, `@all` и `@все` не заводим (§ 2.4), себя не зовём.
 */
export function parseMentions(
  body: string,
  members: readonly ChatMember[],
  authorUserId: string | null,
): string[] {
  const byName = new Map<string, string>();
  for (const member of members) {
    if (!isMentionable(member.username) || !member.username) continue;
    if (member.userId === authorUserId) continue;
    byName.set(member.username.toLowerCase(), member.userId);
  }
  if (byName.size === 0) return [];

  const out: string[] = [];
  // Граница слева — начало строки или не-словесный знак: `mail@marina.ru` упоминанием
  // не является. Логин у нас `[a-z0-9_]` (`src/lib/username.ts`).
  const re = /(^|[^\p{L}\p{N}_@])@([a-zA-Z0-9_]{1,64})/gu;
  for (const match of body.matchAll(re)) {
    const userId = byName.get(match[2].toLowerCase());
    if (userId && !out.includes(userId)) out.push(userId);
  }
  return out;
}

export type WithdrawTarget = { authorUserId: string | null; deletedAt: Date | null };

/**
 * Отзыв сообщения (§ 2.5). Правки нет — она меняет смысл сказанного под ней; строка
 * остаётся, текст на экране заменяется словами «сообщение удалено». Чужие слова убирает
 * только владелец: он отвечает за предприятие.
 */
export function canWithdraw(
  message: WithdrawTarget,
  viewer: { userId: string; isOwner: boolean },
): boolean {
  if (message.deletedAt) return false;
  if (viewer.isOwner) return true;
  return message.authorUserId !== null && message.authorUserId === viewer.userId;
}

export type UnreadRow = {
  authorUserId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

/**
 * Число непрочитанных. Свои сообщения непрочитанными не бывают никогда, отозванные не
 * считаются: значок с числом обещал бы слова, которых на экране нет.
 */
export function unreadFrom(
  rows: readonly UnreadRow[],
  viewer: { userId: string; lastReadAt: Date | null },
): number {
  return rows.filter((row) => {
    if (row.deletedAt) return false;
    if (row.authorUserId === viewer.userId) return false;
    if (!viewer.lastReadAt) return true;
    return row.createdAt.getTime() > viewer.lastReadAt.getTime();
  }).length;
}
