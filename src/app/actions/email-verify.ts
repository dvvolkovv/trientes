"use server";

import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

export async function requestEmailVerification(input?: { locale?: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user) return { ok: false as const, reason: "unauth" as const };
  if (!user.email) return { ok: false as const, reason: "no_email" as const };
  if (user.emailVerified) return { ok: false as const, reason: "already_verified" as const };

  const token = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_MS);

  // Clean up older tokens for the same email so the link list doesn't grow.
  await prisma.verificationToken.deleteMany({ where: { identifier: user.email } });
  await prisma.verificationToken.create({
    data: { identifier: user.email, token, expires },
  });

  const locale = input?.locale ?? "en";
  const link = `${SITE_ORIGIN}/api/auth/verify-email?token=${token}&locale=${encodeURIComponent(locale)}`;
  const r = await sendEmail({
    to: user.email,
    subject: "Verify your Trientes email",
    text: `Click to verify your email:\n${link}\n\nThe link expires in 24 hours.`,
  });
  if (!r.ok) {
    // Most likely "email_not_configured" — surface a non-blocking warning so
    // the user can ask the operator to check the SMTP settings.
    return { ok: false as const, reason: "send_failed" as const };
  }
  return { ok: true as const };
}
