import { NextResponse } from "next/server";
import { signIn } from "@/auth";
import { verifyTelegramAuth } from "@/lib/telegram-auth";

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

  await signIn("telegram", {
    redirect: false,
    ...payload,
  });

  return NextResponse.redirect(new URL("/", req.url));
}
