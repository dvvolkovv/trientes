import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isBotUserAgent } from "@/lib/bot-detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_COOKIE = "ta_sid";
const SESSION_TTL_DAYS = 30;
const MAX_PATH = 240;
const MAX_REFERRER = 240;

// Paths we never log — admin / cabinet / auth flows. Public detail pages and
// indexes are all fair game.
const BLOCKED_PREFIXES = ["/api/", "/admin", "/cabinet", "/login", "/register"];

const bodySchema = z.object({
  path: z.string().min(1).max(MAX_PATH),
  referrer: z.string().max(MAX_REFERRER).optional().nullable(),
  locale: z.string().max(10).optional().nullable(),
});

// All app routes carry a locale prefix (/en/…, /ru/…). Strip a 2-8-char ASCII
// locale before matching against BLOCKED_PREFIXES so /en/admin counts as
// /admin and is dropped.
function stripLocale(path: string): string {
  const m = path.match(/^\/[a-zA-Z\-]{2,8}(\/.*|$)/);
  return m ? m[1] || "/" : path;
}

function shouldSkip(path: string): boolean {
  for (const candidate of [path, stripLocale(path)]) {
    if (BLOCKED_PREFIXES.some((p) => candidate === p || candidate.startsWith(p + "/"))) {
      return true;
    }
    if (BLOCKED_PREFIXES.includes(candidate)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const { path, referrer, locale } = parsed.data;
  if (shouldSkip(path)) return NextResponse.json({ ok: true, skipped: "blocked" });

  const ua = req.headers.get("user-agent");
  const isBot = isBotUserAgent(ua);
  if (isBot) return NextResponse.json({ ok: true, skipped: "bot" });

  // Anonymous rolling session — UUID set as httpOnly cookie. Lets us count
  // unique visitors without storing IP/email.
  const existingSid = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`))?.[1] ?? null;
  const sessionId = existingSid ?? randomBytes(16).toString("hex");

  // CF-IPCountry / X-Vercel-IP-Country are set by edges that resolve the
  // visitor's country; otherwise we just leave it null.
  const country =
    req.headers.get("cf-ipcountry") ??
    req.headers.get("x-vercel-ip-country") ??
    null;

  const session = await auth().catch(() => null);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // Drop a trailing query string from the referrer (no need to keep tracking ids).
  let cleanReferrer: string | null = null;
  if (referrer && /^https?:\/\//i.test(referrer)) {
    try {
      const u = new URL(referrer);
      cleanReferrer = `${u.origin}${u.pathname}`.slice(0, MAX_REFERRER);
    } catch { /* ignore */ }
  }

  await prisma.pageView.create({
    data: {
      path: path.slice(0, MAX_PATH),
      locale: locale?.slice(0, 10) ?? null,
      sessionId,
      userId,
      referrer: cleanReferrer,
      country: country && /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : null,
      isBot: false,
    },
  });

  const res = NextResponse.json({ ok: true });
  if (!existingSid) {
    res.cookies.set({
      name: SESSION_COOKIE,
      value: sessionId,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });
  }
  return res;
}
