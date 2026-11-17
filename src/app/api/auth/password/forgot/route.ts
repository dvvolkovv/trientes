// Просьба о сбросе пароля: человек называет ящик или имя входа, и на почту
// кабинета уходит письмо с одноразовой ссылкой.
//
// Ответ всегда один и тот же — `{ ok: true }`. Сказать «такого у нас нет»
// значило бы отдать любому желающему список наших пользователей, поэтому
// отличить «письмо ушло» от «не нашли» снаружи нельзя. Цена этого решения —
// опечатка в адресе выглядит точно как успех, поэтому страница показывает
// человеку то, что он набрал: опечатку должно быть видно глазом.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/client-ip";
import { sendEmail } from "@/lib/email";
import { pickLocale } from "@/lib/locales";
import { checkResetRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import {
  RESET_MAX_BY_IP_IDENT,
  RESET_WINDOW_MS,
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  parseResetIdentifier,
  resetExpiry,
  resetIdentifier,
} from "@/lib/password-reset";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: { identifier?: unknown; email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Негодное имя или сломанный адрес отвергаем вслух: это ничего не говорит
  // о том, есть ли у нас такой кабинет.
  const asked = parseResetIdentifier(body.identifier ?? body.email);
  if (!asked) {
    return NextResponse.json({ error: "identifier_invalid" }, { status: 400 });
  }

  // Счёт ведётся по набранному: он проверяется до поиска, иначе отказ
  // «слишком часто» выдавал бы, что кабинет существует.
  const limit = await checkResetRateLimit(ip, asked.value);
  if (limit.blocked) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const user =
    asked.kind === "email"
      ? await prisma.user.findUnique({
          where: { email: asked.value },
          select: { id: true, username: true, name: true, email: true, preferredLocale: true },
        })
      : await prisma.user.findUnique({
          where: { username: asked.value },
          select: { id: true, username: true, name: true, email: true, preferredLocale: true },
        });

  // Строку счёта пишем на найденный ящик, а не на набранное: иначе один и тот
  // же ящик можно было бы засыпать письмами, называя его то адресом, то
  // именем входа. Запись до отправки — сбой почты не должен открывать путь
  // мимо ограничения.
  const counted = user?.email ?? asked.value;
  await recordLoginAttempt({ ip, identifier: resetIdentifier(counted), success: true });

  if (user?.email) {
    // Второй, молчаливый порог — на сам ящик. Молчаливый потому, что громкий
    // отказ здесь говорил бы, что ящик наш.
    const lettersToMailbox = await prisma.loginAttempt.count({
      where: {
        identifier: resetIdentifier(user.email),
        createdAt: { gte: new Date(Date.now() - RESET_WINDOW_MS) },
      },
    });
    if (lettersToMailbox > RESET_MAX_BY_IP_IDENT) {
      console.warn("[password-reset] mailbox cap reached", { userId: user.id });
      return NextResponse.json({ ok: true });
    }

    // Старые невостребованные ссылки гасим: работает только последняя.
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const token = generateResetToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: resetExpiry(),
        requestIp: ip,
      },
    });

    // Письмо на языке кабинета, а не страницы: человек мог открыть сайт на
    // чужом языке с чужого устройства.
    const locale = pickLocale(user.preferredLocale ?? body.locale);
    const t = await getTranslations({ locale, namespace: "reset.mail" });
    const url = buildResetUrl(SITE_ORIGIN, locale, token);
    const who = user.username ?? user.name ?? user.email;
    const text = [t("greeting", { username: who }), t("body"), url, t("ignore")].join("\n\n");

    const sent = await sendEmail({ to: user.email, subject: t("subject"), text });
    if (!sent.ok) {
      // Снаружи это по-прежнему `ok: true` — иначе сбой почты выдавал бы,
      // что кабинет есть.
      console.error("[password-reset] email failed", { reason: sent.reason, userId: user.id });
    }

    // Попутная уборка: просроченные ссылки больше суток никому не нужны.
    await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  } else if (user) {
    // Кабинет есть, а почты у него нет — писать некуда. Снаружи молчим.
    console.warn("[password-reset] account has no email", { userId: user.id });
  }

  return NextResponse.json({ ok: true });
}
