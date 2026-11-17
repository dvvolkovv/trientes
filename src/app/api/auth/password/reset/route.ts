// Смена пароля по ссылке из письма. Ссылка — единственное доказательство, что
// человек владеет ящиком, поэтому она срабатывает один раз и сразу сжигается.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { createDatabaseSession } from "@/lib/session";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/locales";
import { hashResetToken, resetTokenState } from "@/lib/password-reset";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export async function POST(req: Request) {
  let body: { token?: unknown; password?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!token || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: "password_too_long" }, { status: 400 });
  }

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!row) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  const state = resetTokenState(row);
  if (state !== "valid") {
    return NextResponse.json({ error: `${state}_token` }, { status: 400 });
  }

  // Гасим ссылку условным обновлением: два одновременных перехода по одной
  // ссылке не должны оба сменить пароль — второй получит нулевой счёт.
  const burned = await prisma.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (burned.count === 0) {
    return NextResponse.json({ error: "used_token" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });

    // У пришедшего через Google пароля раньше не было, значит нет и строки
    // входа по паролю — без неё новый пароль был бы записан впустую.
    await tx.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "credentials",
          providerAccountId: row.userId,
        },
      },
      update: {},
      create: {
        userId: row.userId,
        type: "credentials",
        provider: "credentials",
        providerAccountId: row.userId,
      },
    });

    // Прочие невостребованные ссылки больше не нужны.
    await tx.passwordResetToken.deleteMany({
      where: { userId: row.userId, usedAt: null },
    });

    // Прежние сеансы закрываем: сброс пароля затем и нужен, чтобы выгнать
    // того, кто мог сидеть в кабинете.
    await tx.session.deleteMany({ where: { userId: row.userId } });
  });

  const locale: Locale = SUPPORTED_LOCALES.includes(body.locale as Locale)
    ? (body.locale as Locale)
    : DEFAULT_LOCALE;

  // Пароль сменён — впускаем сразу, чтобы человеку не набирать его снова.
  const cookie = await createDatabaseSession(row.userId);
  const res = NextResponse.json({ ok: true, redirect: `/${locale}/cabinet` });
  res.cookies.set(cookie);
  return res;
}
