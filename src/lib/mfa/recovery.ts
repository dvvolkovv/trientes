/**
 * Коды восстановления: потерянный телефон иначе означает потерянный доступ, а
 * снять фактор может только владелец — и у владельца, который и есть
 * потерявший, этого пути нет.
 *
 * В базе лежит только sha256 кода — как у токена сброса пароля. Соли нет и она
 * не нужна: код не придуман человеком, а взят из `randomBytes`, то есть
 * словарём не подбирается.
 */
import { createHash, randomBytes } from "node:crypto";

export const RECOVERY_CODE_COUNT = 10;
/** Четыре группы по четыре знака читаются и набираются вслух лучше одной длинной. */
const GROUPS = 3;
const GROUP_LEN = 4;
// Без похожих знаков: 0/o, 1/l/i — код читают с экрана и набирают руками.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(GROUPS * GROUP_LEN);
    const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
    codes.add(
      Array.from({ length: GROUPS }, (_, g) => chars.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN)).join("-"),
    );
  }
  return [...codes];
}

/** Набранный код — к одному виду: регистр и разделители человеку не принадлежат. */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toLowerCase();
}

export function hashRecoveryCode(raw: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(raw)).digest("hex");
}
