/**
 * Синхронизирующий токен против подделки запроса (CSRF).
 *
 * Серверные действия Next сверяют `Origin` с хостом сами, но действие, меняющее
 * получателя денег, второй преградой пренебрегать не должно (задание, § 2.7).
 *
 * Токен **выводится из сеанса** (`HMAC(secret, sessionToken)`), а не лежит во втором
 * cookie, и это решение: cookie из серверного компонента Next не выставить (их пишут
 * только действия и маршруты), а значение сеанса нападающему неизвестно — он умеет
 * заставить браузер послать cookie, но не прочитать его. Поэтому страница просто
 * печатает токен в скрытое поле, а действие сверяет его с тем сеансом, под которым
 * пришёл запрос.
 *
 * Нет секрета — отказываем (`csrfOk` возвращает `false`), а не пропускаем: тихое
 * «проверки нет» означало бы проверку, которой нет.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authSessionCookieName } from "@/lib/session";

/** Имя скрытого поля формы. Одно на все формы: своя копия имени однажды разошлась бы. */
export const CSRF_FIELD = "csrf";

function secret(): string | null {
  const value = process.env.CSRF_SECRET ?? process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  return value && value.length >= 16 ? value : null;
}

/** Токен для этого сеанса; `null` — нет сеанса или нет секрета. */
export function csrfTokenFor(sessionToken: string | null | undefined): string | null {
  const key = secret();
  if (!key || !sessionToken) return null;
  return createHmac("sha256", key).update(`csrf:${sessionToken}`).digest("hex");
}

/** Сверка. Сравнение постоянного времени — токен выводится из секрета. */
export function csrfOk(sessionToken: string | null | undefined, presented: string | null | undefined): boolean {
  const expected = csrfTokenFor(sessionToken);
  if (!expected || !presented) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Значение cookie сеанса этого запроса. */
export async function currentSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(authSessionCookieName())?.value ?? null;
}

/** Токен для печати в форму. */
export async function csrfToken(): Promise<string | null> {
  return csrfTokenFor(await currentSessionToken());
}

/** Проверка внутри серверного действия. */
export async function checkCsrf(presented: string | null | undefined): Promise<boolean> {
  return csrfOk(await currentSessionToken(), presented);
}
