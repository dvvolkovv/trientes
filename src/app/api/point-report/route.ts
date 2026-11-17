import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { submitPointReport } from "@/lib/points/reports";

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

  // Вошедший считается по учётной записи, а не по адресу (independentReporters).
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const res = await submitPointReport({
    pointId: body.pointId,
    reason: body.reason,
    comment: body.comment,
    ip: clientIp(req),
    userId,
  });
  if (res.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: res.reason }, { status: STATUS[res.reason] ?? 400 });
}
