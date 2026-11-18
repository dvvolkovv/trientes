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
  if (!mfaRequiredForRole(input.role)) return "ok";
  // Начатое, но не подтверждённое заведение фактором не считается: по такому
  // ключу человек ни разу не показал код, то есть приложение может быть не
  // заведено вовсе.
  if (!input.mfa || input.mfa.disabledAt || !input.mfa.confirmedAt) return "setup";
  return input.sessionMfaAt ? "ok" : "verify";
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
