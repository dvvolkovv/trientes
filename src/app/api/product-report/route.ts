import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { requireCaptcha } from "@/lib/captcha-guard";
import { submitProductReport } from "@/lib/products/reports";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_found: 404,
  bad_reason: 400,
  comment_required: 400,
  comment_too_long: 400,
  too_soon: 429,
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_reason" }, { status: 400 });
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  // Вошедший капчу не видит: `requireCaptcha` сам пропускает его.
  const captcha = await requireCaptcha(req, body.captcha);
  if (!captcha.ok) return NextResponse.json({ error: captcha.reason }, { status: 400 });

  const res = await submitProductReport({
    productId: body.productId,
    reason: body.reason,
    comment: body.comment,
    ip: clientIp(req),
    userId,
  });
  if (res.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: res.reason }, { status: STATUS[res.reason] ?? 400 });
}
