import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { issueChallenge, tooManyIssues } from "@/lib/captcha-store";

export const dynamic = "force-dynamic";

/**
 * Вошедшему капча не показывается никогда, и клиент о сеансе ничего не знает:
 * проще спросить здесь, чем прокидывать свойство через полстраницы навигатора.
 */
export async function GET(req: Request) {
  const session = await auth();
  if ((session?.user as { id?: string } | undefined)?.id) {
    return NextResponse.json({ needed: false });
  }
  const ip = clientIp(req);
  if (await tooManyIssues(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const challenge = await issueChallenge(ip);
  return NextResponse.json({ needed: true, ...challenge });
}
