/**
 * Потолок проверок `/link/` (задание, § 2.2): не больше 10 в час на пользователя и на
 * адрес. Без него сайт стал бы прокси для перебора номеров ссылок — у нас-то запрос
 * идёт из серверного действия, то есть нашим адресом, а не адресом перебирающего.
 *
 * Счёт — по тем же строкам `LoginAttempt` с приставкой в поле `identifier`: прецедент
 * `__register__` и `__reset__`, и своей таблицы под один счётчик мы не заводим (то же
 * решение, что `run:coinpaprika` в ключе Redis вместо таблицы).
 */
import { prisma } from "@/lib/prisma";

export const LINK_CHECK_WINDOW_MS = 60 * 60 * 1000;
export const LINK_CHECKS_PER_HOUR = 10;
/** Приставка строки счётчика: по ней же считается расход адреса целиком. */
export const LINK_CHECK_PREFIX = "__paylink__";

export const linkCheckIdentifier = (userId: string): string => `${LINK_CHECK_PREFIX}${userId}`;

export function evalLinkCheckLimit(c: { byIp: number; byUser: number }): { blocked: boolean } {
  return { blocked: c.byIp >= LINK_CHECKS_PER_HOUR || c.byUser >= LINK_CHECKS_PER_HOUR };
}

/** Проверка до запроса наружу: отказ не должен стоить чужой службе ни одного вызова. */
export async function checkLinkRateLimit(ip: string, userId: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - LINK_CHECK_WINDOW_MS);
  const [byIp, byUser] = await Promise.all([
    prisma.loginAttempt.count({
      where: { ip, identifier: { startsWith: LINK_CHECK_PREFIX }, createdAt: { gte: since } },
    }),
    prisma.loginAttempt.count({
      where: { identifier: linkCheckIdentifier(userId), createdAt: { gte: since } },
    }),
  ]);
  return evalLinkCheckLimit({ byIp, byUser });
}

/**
 * Запись расхода. Пишется **до** запроса наружу (приём BC и BG): иначе сорвавшийся
 * запрос не считался бы, и перебор шёл бы бесплатно.
 */
export async function recordLinkCheck(ip: string, userId: string): Promise<void> {
  try {
    await prisma.loginAttempt.create({
      data: { ip, identifier: linkCheckIdentifier(userId), success: true, userId },
    });
  } catch (error) {
    // Строка счётчика дороже отказа человеку не бывает, но и молчать нельзя.
    console.error("pay_link_check_count_failed", userId, error);
  }
}
