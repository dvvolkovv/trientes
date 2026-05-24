import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp } from "@/lib/client-ip";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { createDatabaseSession } from "@/lib/session";

export async function POST(req: Request) {
  const ip = clientIp(req);

  let body: { identifier?: unknown; password?: unknown; locale?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const identifier = String(body.identifier ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!identifier || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const limit = await checkLoginRateLimit(ip, identifier);
  if (limit.blocked) {
    // Still pay bcrypt cost so attackers can't distinguish rate-limit from miss.
    await verifyPassword(password, DUMMY_HASH);
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const user = identifier.includes("@")
    ? await prisma.user.findUnique({ where: { email: identifier } })
    : await prisma.user.findUnique({ where: { username: identifier } });

  const ok = await verifyPassword(password, user?.passwordHash ?? null);

  await recordLoginAttempt({ ip, identifier, success: ok, userId: user?.id ?? null });

  if (!ok || !user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const locale = typeof body.locale === "string" ? body.locale : "en";
  const next =
    typeof body.next === "string" && body.next.startsWith("/")
      ? body.next
      : `/${locale}/cabinet`;

  const cookie = await createDatabaseSession(user.id);
  const res = NextResponse.json({ ok: true, redirect: next });
  res.cookies.set(cookie);
  return res;
}
