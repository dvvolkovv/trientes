"use server";

/**
 * Подтверждение личности внутри сеанса — «свежий вход» (слайс CP).
 *
 * Зачем отдельная дверь, а не «выйдите и войдите снова»: смена ссылки оплаты требует
 * входа не старше 15 минут, а выход гасит сеанс со всей начатой работой. Поэтому
 * человек подтверждает себя тем, что у него есть: кодом второго фактора (если фактор
 * заведён) или паролем. У записи без пароля и без фактора (вошёл через Google или
 * Telegram) остаётся честный путь — выйти и войти снова: новый сеанс свеж по
 * построению, и это сказано на экране словами.
 *
 * Попытки считаются теми же строками `LoginAttempt` с приставкой `__reauth__`:
 * прецедент `__register__` и `__reset__`, своей таблицы под счётчик не заводим.
 */

import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { checkCode } from "@/lib/mfa/service";
import { checkCsrf } from "@/lib/csrf";
import { clientIp } from "@/lib/client-ip";
import { stampReauth } from "@/lib/session-fresh";

const REAUTH_PREFIX = "__reauth__";
const REAUTH_WINDOW_MS = 15 * 60 * 1000;
const REAUTH_MAX_FAILS = 10;

export type ReauthResult = { ok: true } | { ok: false; reason: string };

export async function confirmIdentity(input: {
  password?: string;
  code?: string;
  csrf: string;
}): Promise<ReauthResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { ok: false, reason: "unauth" };
  if (!(await checkCsrf(input.csrf))) return { ok: false, reason: "csrf" };

  const h = await headers();
  const ip = clientIp(new Request("https://trientes.org", { headers: h }));
  const identifier = `${REAUTH_PREFIX}${userId}`;
  const since = new Date(Date.now() - REAUTH_WINDOW_MS);
  const fails = await prisma.loginAttempt.count({
    where: { identifier, success: false, createdAt: { gte: since } },
  });
  if (fails >= REAUTH_MAX_FAILS) return { ok: false, reason: "too_many_attempts" };

  const [user, mfa] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    prisma.staffMfa.findUnique({
      where: { userId },
      select: { confirmedAt: true, disabledAt: true },
    }),
  ]);

  const record = (success: boolean) =>
    prisma.loginAttempt.create({ data: { ip, identifier, success, userId } }).catch(() => {});

  // Второй фактор старше пароля: он доказывает, что телефон у человека сейчас.
  if (mfa?.confirmedAt && !mfa.disabledAt) {
    const code = (input.code ?? "").trim();
    if (code === "") return { ok: false, reason: "code_required" };
    const verdict = await checkCode({ userId, code });
    if (!verdict.ok) {
      await record(false);
      return { ok: false, reason: verdict.reason };
    }
    await record(true);
    await stampReauth();
    return { ok: true };
  }

  if (!user?.passwordHash) return { ok: false, reason: "no_password_set" };
  const password = input.password ?? "";
  if (password === "") return { ok: false, reason: "password_required" };
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    await record(false);
    return { ok: false, reason: "invalid_credentials" };
  }
  await record(true);
  await stampReauth();
  return { ok: true };
}

/** Чем человеку подтверждать себя: это решает экран, а не догадка браузера. */
export async function reauthMethod(): Promise<"code" | "password" | "signout" | "unauth"> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return "unauth";
  const [user, mfa] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    prisma.staffMfa.findUnique({
      where: { userId },
      select: { confirmedAt: true, disabledAt: true },
    }),
  ]);
  if (mfa?.confirmedAt && !mfa.disabledAt) return "code";
  if (user?.passwordHash) return "password";
  return "signout";
}
