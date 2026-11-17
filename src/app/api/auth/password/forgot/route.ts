// Просьба о сбросе пароля: человек называет ящик, на который заводил кабинет,
// и получает письмо с одноразовой ссылкой.
//
// Ответ всегда один и тот же — `{ ok: true }`. Сказать «такого ящика у нас
// нет» значило бы отдать любому желающему список наших пользователей, поэтому
// отличить «письмо ушло» от «ящик не наш» снаружи нельзя.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/client-ip";
import { sendEmail } from "@/lib/email";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/locales";
import { checkResetRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import {
  buildResetUrl,
  generateResetToken,
  hashResetToken,
  normalizeEmail,
  resetExpiry,
  resetIdentifier,
} from "@/lib/password-reset";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

function pickLocale(value: unknown): Locale {
  return SUPPORTED_LOCALES.includes(value as Locale) ? (value as Locale) : DEFAULT_LOCALE;
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: { email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  // Негодный адрес отвергаем вслух: это не говорит, есть ли у нас такой ящик.
  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "email_invalid" }, { status: 400 });
  }

  const limit = await checkResetRateLimit(ip, email);
  if (limit.blocked) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Считаем просьбу до работы: иначе сбой отправки открывал бы путь мимо
  // ограничения — чужой ящик можно было бы засыпать письмами.
  await recordLoginAttempt({ ip, identifier: resetIdentifier(email), success: true });

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, username: true, name: true, preferredLocale: true },
  });

  if (user) {
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
    const who = user.username ?? user.name ?? email;
    const text = [t("greeting", { username: who }), t("body"), url, t("ignore")].join("\n\n");

    const sent = await sendEmail({ to: email, subject: t("subject"), text });
    if (!sent.ok) {
      // Снаружи это по-прежнему `ok: true` — иначе сбой почты выдавал бы,
      // что ящик наш.
      console.error("[password-reset] email failed", { reason: sent.reason, userId: user.id });
    }

    // Попутная уборка: просроченные ссылки больше суток никому не нужны.
    await prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  }

  return NextResponse.json({ ok: true });
}
