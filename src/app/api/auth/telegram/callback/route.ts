import { NextResponse } from "next/server";
import { verifyTelegramAuth } from "@/lib/telegram-auth";
import { prisma } from "@/lib/prisma";
import { isAdminWhitelisted, parseAdminWhitelist } from "@/lib/admin-whitelist";
import { createDatabaseSession } from "@/lib/session";

const adminWhitelist = parseAdminWhitelist(process.env.ADMIN_WHITELIST);

// Auth.js v5 Credentials providers always use JWT even when session.strategy is
// "database", so they cannot populate session.user.id/role from the DB. Instead
// of using signIn("telegram"), we upsert the user and create a real database
// session ourselves, then set the same session-token cookie Auth.js reads.
export async function POST(req: Request) {
  const formData = await req.formData();
  const payload: Record<string, string> = {};
  for (const [k, v] of formData.entries()) payload[k] = String(v);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 503 });
  }
  const result = verifyTelegramAuth(payload, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  const providerAccountId = result.telegramId;
  const name =
    [result.firstName, result.lastName].filter(Boolean).join(" ") ||
    result.username ||
    `Telegram ${result.telegramId}`;

  // Find or create user via the linked Account record.
  const existingAccount = await prisma.account.findFirst({
    where: { provider: "telegram", providerAccountId },
    include: { user: true },
  });

  let userId: string;
  if (existingAccount) {
    userId = existingAccount.userId;
    await prisma.user.update({
      where: { id: userId },
      data: { name, image: result.photoUrl ?? undefined },
    });
  } else {
    const user = await prisma.user.create({
      data: { name, image: result.photoUrl ?? null },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        type: "credentials",
        provider: "telegram",
        providerAccountId,
      },
    });
    userId = user.id;

    const matched = isAdminWhitelisted(adminWhitelist, {
      telegramId: providerAccountId,
    });
    if (matched) {
      await prisma.user.update({
        where: { id: userId },
        data: { role: "ADMIN" },
      });
    }
  }

  // Create a proper database session that Auth.js will recognise.
  const cookie = await createDatabaseSession(userId);

  const redirectTo = req.headers.get("referer")
    ? new URL("/", new URL(req.headers.get("referer")!))
    : new URL("/", req.url);

  const response = NextResponse.redirect(redirectTo);
  response.cookies.set(cookie);
  return response;
}
