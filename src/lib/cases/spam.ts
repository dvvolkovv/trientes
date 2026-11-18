import type { CaseSubjectType } from "@prisma/client";

/**
 * Закрытие пачки дел как спама.
 *
 * Повод: живой прогон слайса AN нашёл в очереди бирж 31 заявку от ботов с
 * мусорными именами. Капча слайса AR закрыла дверь, но лежащее никуда не ушло,
 * а решать это по правилам — значит провести тридцать одно дело через лист
 * проверок и две подписи. Пока они лежат, плитка очереди, возраст старейшей
 * заявки и колокольчики врут.
 */

/**
 * Спамом закрывается заявка, пришедшая от незнакомца с улицы.
 *
 * `KYB` не входит: его подаёт уже заведённое предприятие, и «спам» тут означал
 * бы «мы не смотрели документы». `POINT_REPORT` не входит: жалобу подтверждают
 * или отклоняют, у её решения свои слова, и анонимная жалоба уже ограничена
 * порогом трёх независимых заявителей.
 */
export const SPAM_CLOSABLE: CaseSubjectType[] = [
  "COIN_CARD",
  "COMPANY",
  "POINT",
  "EXCHANGE",
  "FINTECH",
  "COIN_REQUEST",
];

export function isSpamClosable(subjectType: CaseSubjectType): boolean {
  return SPAM_CLOSABLE.includes(subjectType);
}

/** Причина обязательна, порог тот же, что у отказа по делу. */
export const SPAM_REASON_MIN = 3;

/**
 * Пачка ограничена: действие необратимо, а промах по «выбрать все» на пяти
 * сотнях дел — не то, что стоит разрешать одним нажатием.
 */
export const SPAM_BATCH_MAX = 50;

export type SpamBlocker = "empty" | "too_many" | "reason_too_short" | "not_spam_closable";

export function spamBlockers(input: {
  caseIds: string[];
  reason: string;
  subjectTypes: CaseSubjectType[];
}): SpamBlocker[] {
  const out: SpamBlocker[] = [];
  if (input.caseIds.length === 0) out.push("empty");
  if (input.caseIds.length > SPAM_BATCH_MAX) out.push("too_many");
  if (input.reason.trim().length < SPAM_REASON_MIN) out.push("reason_too_short");
  if (input.subjectTypes.some((t) => !isSpamClosable(t))) out.push("not_spam_closable");
  return out;
}
