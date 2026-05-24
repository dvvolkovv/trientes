import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { clientIp } from "@/lib/client-ip";
import { hashPassword } from "@/lib/password";
import { validateUsername } from "@/lib/username";
import { checkRegisterRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { createDatabaseSession } from "@/lib/session";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = await checkRegisterRateLimit(ip);
  if (limit.blocked) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { username?: unknown; password?: unknown; email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const v = validateUsername(String(body.username ?? ""));
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  const password = String(body.password ?? "");
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }
  if (password.length > MAX_PASSWORD) {
    return NextResponse.json({ error: "password_too_long" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const email = emailRaw.length > 0 ? emailRaw : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email_invalid" }, { status: 400 });
  }

  const locale = typeof body.locale === "string" ? body.locale : "en";

  const passwordHash = await hashPassword(password);

  // Record a "registration attempt" first so rate-limit ticks even if the next
  // step errors out (e.g. duplicate username): otherwise an attacker could
  // probe usernames without cost.
  await recordLoginAttempt({ ip, identifier: "__register__", success: true });

  let userId: string;
  try {
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { username: v.value, passwordHash, email, accountType: "INDIVIDUAL" },
      });
      await tx.account.create({
        data: {
          userId: u.id,
          type: "credentials",
          provider: "credentials",
          providerAccountId: u.id,
        },
      });
      return u;
    });
    userId = user.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = (err.meta as { target?: string[] } | undefined)?.target ?? [];
      if (target.includes("username")) {
        return NextResponse.json({ error: "username_taken" }, { status: 409 });
      }
      if (target.includes("email")) {
        return NextResponse.json({ error: "email_taken" }, { status: 409 });
      }
    }
    throw err;
  }

  const cookie = await createDatabaseSession(userId);
  const res = NextResponse.json({ ok: true, redirect: `/${locale}/cabinet` });
  res.cookies.set(cookie);
  return res;
}
