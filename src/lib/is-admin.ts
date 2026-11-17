import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/authz/guard";

export type AdminCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauth" | "no_access" };

/**
 * Общая калитка в админку. Раньше она отвечала на единственный вопрос «ты админ
 * или нет» и этим же решала всё; теперь это только «вошёл, сотрудник или
 * владелец, доступ не отозван» — что именно человеку можно, спрашивают
 * `requireQueue` / `requireSubject` / `requireOwner` в `src/lib/authz/guard.ts`.
 */
export async function checkAdmin(): Promise<AdminCheckResult> {
  const r = await requireStaff();
  return r.ok ? { ok: true, userId: r.userId } : { ok: false, reason: r.reason };
}

export async function requireAdmin(redirectLocale: string): Promise<string> {
  const r = await checkAdmin();
  if (!r.ok) redirect(`/${redirectLocale}/login`);
  return r.userId;
}
