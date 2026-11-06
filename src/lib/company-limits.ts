// Пределы на число компаний у одного аккаунта. Уникальный индекс по владельцу
// снят (миграция 20261106200000_company_multi_owner), и он случайно держал
// спам — теперь это делают явные лимиты. Чисто, без Prisma, чтобы каждая
// граница была проверена тестом.

export const MAX_COMPANIES_PER_USER = 10;
export const MAX_PENDING_COMPANIES_PER_USER = 3;

export type CompanyLimitResult =
  | { ok: true }
  | { ok: false; reason: "too_many_companies" | "too_many_pending_companies" };

/**
 * `owned` — во сколько компаний пользователь входит как OWNER (считается по
 * CompanyMember, а не по Company.ownerUserId: переданное владение тоже
 * расходует лимит). `pending` — сколько из них ещё на модерации.
 *
 * Общий предел проверяется первым: он строже, и сообщать про очередь модерации
 * человеку, который упёрся в потолок вообще, значит путать.
 */
export function checkCompanyLimits(input: { owned: number; pending: number }): CompanyLimitResult {
  if (input.owned >= MAX_COMPANIES_PER_USER) {
    return { ok: false, reason: "too_many_companies" };
  }
  if (input.pending >= MAX_PENDING_COMPANIES_PER_USER) {
    return { ok: false, reason: "too_many_pending_companies" };
  }
  return { ok: true };
}
