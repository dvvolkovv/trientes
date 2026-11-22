/**
 * Кому фактор нужен и что с человеком делать — чистые правила. Охранник
 * (`src/lib/authz/guard.ts`) только подаёт им факты из базы.
 */
import { isStaffRole, type ViewerRole } from "@/lib/authz/policy";

export type MfaState = { confirmedAt: Date | null; disabledAt: Date | null } | null;

/**
 * Требование привязано к роли, а не к уровню на очереди: сотрудник с `HANDLE`
 * пишет заявителям от имени проекта и видит их документы — это тот же
 * привилегированный доступ, что и право утверждать.
 */
export function mfaRequiredForRole(role: string): boolean {
  return isStaffRole(role as ViewerRole);
}

export type MfaGate = "ok" | "setup" | "verify";

export function mfaGate(input: {
  role: string;
  mfa: MfaState;
  sessionMfaAt: Date | null;
}): MfaGate {
  // Начатое, но не подтверждённое заведение фактором не считается: по такому
  // ключу человек ни разу не показал код, то есть приложение может быть не
  // заведено вовсе.
  const enrolled = Boolean(input.mfa && !input.mfa.disabledAt && input.mfa.confirmedAt);
  // Заведённый фактор спрашивается у всех — и у посетителя, который завёл его
  // себе сам (слайс BT). Иначе добровольный фактор был бы украшением: ключ в
  // базе есть, а код никто не спрашивает.
  if (enrolled) return input.sessionMfaAt ? "ok" : "verify";
  // Не заведён: сотрудника отправляем заводить, посетителя не принуждаем —
  // навязанный фактор запер бы живые учётные записи, а первый потерянный
  // телефон стоил бы владельцу разбора.
  return mfaRequiredForRole(input.role) ? "setup" : "ok";
}

/**
 * Может ли человек снять фактор себе сам.
 *
 * У сотрудника — нет: это право владельца (слайс BA), иначе выманенный пароль
 * снимал бы и фактор. У посетителя владельца нет вовсе, и запрет означал бы,
 * что добровольный фактор нельзя отключить никогда.
 */
export function selfDisableAllowed(input: { role: string; gate: MfaGate }): boolean {
  if (mfaRequiredForRole(input.role)) return false;
  // Снятие — то же условие, что перевод на другой телефон: код в этом сеансе
  // показан. Украденного пароля для снятия фактора не хватает.
  return input.gate === "ok";
}

/**
 * Можно ли этому человеку заводить фактор прямо сейчас.
 *
 * «Фактор уже есть, но код в этом сеансе не показан» — нельзя: иначе украденного
 * пароля хватало бы, чтобы завести сеанс и перезаписать ключ своим, то есть
 * обойти фактор через дверь его же заведения. Экран это и так не покажет, но
 * серверное действие вызывается прямым запросом.
 */
export function enrollmentAllowedFor(gate: MfaGate): boolean {
  return gate === "setup" || gate === "ok";
}
