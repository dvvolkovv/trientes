import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

function redirect(locale: string, params: URLSearchParams) {
  const url = new URL(`${SITE_ORIGIN}/${locale}/cabinet?${params.toString()}#profile`);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const locale = (url.searchParams.get("locale") ?? "en").replace(/[^a-zA-Z\-]/g, "").slice(0, 8) || "en";

  if (!token) return redirect(locale, new URLSearchParams({ verify: "invalid" }));

  const row = await prisma.verificationToken.findUnique({ where: { token } });
  if (!row) return redirect(locale, new URLSearchParams({ verify: "invalid" }));
  if (row.expires.getTime() < Date.now()) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return redirect(locale, new URLSearchParams({ verify: "expired" }));
  }

  const email = row.identifier;
  await prisma.$transaction([
    prisma.user.updateMany({ where: { email }, data: { emailVerified: new Date() } }),
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
  ]);

  return redirect(locale, new URLSearchParams({ verify: "ok" }));
}
