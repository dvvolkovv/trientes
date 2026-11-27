/**
 * Код в названии ссылки (задание, § 2.3) — доказательство, что ссылкой управляет тот
 * же человек, что правит карточку.
 *
 * Зачем он вообще, если менять ссылку и так может только владелец: смену делает
 * «владелец» и в случае захвата аккаунта, и в случае «вставьте вот эту ссылку, она для
 * подключения». Код выдаёт **наша** страница, а вписать его можно только в кабинете
 * оплаты, где правка названия подписывается кошельком магазина. У уговорившего нашего
 * кода нет, у захватившего аккаунт нет кошелька магазина — закрыты оба пути разом.
 */
import { randomBytes } from "node:crypto";
import { stripInvisible, TITLE_MAX } from "@/lib/pay-link/text";

/**
 * Алфавит без похожих друг на друга знаков: код диктуют глазами с экрана в чужое
 * окно, и `0`/`O`, `1`/`I` в нём стоили бы владельцу лишней попытки.
 */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
/** Код живёт полчаса: столько занимает «открыть кабинет, найти ссылку, вписать». */
export const CODE_TTL_MS = 30 * 60 * 1000;

/**
 * Новый код. Алфавит ровно 32 знака, то есть пять бит на знак — поэтому байт
 * раскладывается по алфавиту без перекоса и без выбрасывания значений.
 */
export function newPairingCode(source: Uint8Array = randomBytes(CODE_LENGTH)): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[(source[i] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Есть ли код в названии ссылки.
 *
 * Три решения, каждое из живого замысла задания:
 * - ищем в **полном** названии (до 200 знаков) — до обрезки до 80 для показа: иначе
 *   код, дописанный в конец длинного названия, не нашёлся бы;
 * - но **после** вырезания невидимых знаков: код, разбитый знаком нулевой ширины,
 *   выглядит в кабинете целым, и отказывать за невидимое нельзя;
 * - **без учёта регистра**: код из заглавных, а владелец набирает как набирает.
 */
export function titleHasCode(title: string | null | undefined, code: string): boolean {
  if (!title || !code) return false;
  const haystack = stripInvisible(title.slice(0, TITLE_MAX)).toUpperCase();
  return haystack.includes(code.toUpperCase());
}

/** Годен ли код по сроку и одноразовости. Чужая карточка отсекается самим запросом. */
export function codeUsable(
  row: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date,
): boolean {
  if (!row) return false;
  if (row.usedAt !== null) return false;
  return row.expiresAt.getTime() > now.getTime();
}
