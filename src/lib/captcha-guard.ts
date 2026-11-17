import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { checkTiming, isSolved } from "@/lib/captcha";
import { consume, hashIp, parseToken } from "@/lib/captcha-store";

export type CaptchaVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Одна проверка на три анонимные двери (регистрация, сброс пароля, жалоба на
 * точку). Вошедший проходит мимо: он уже прошёл дверь, и лишняя загадка на
 * каждое действие — налог на честного человека.
 */
export async function requireCaptcha(req: Request, raw: unknown): Promise<CaptchaVerdict> {
  const session = await auth();
  if ((session?.user as { id?: string } | undefined)?.id) return { ok: true };

  const body = (raw ?? {}) as { token?: unknown; x?: unknown; y?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const x = Number(body.x);
  const y = Number(body.y);
  if (!token || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, reason: "captcha_required" };
  }

  const payload = parseToken(token);
  if (!payload) return { ok: false, reason: "captcha_invalid" };
  // Выданную на одном адресе не предъявить с другого: иначе одну решённую
  // задачу раздавали бы по ботнету.
  if (payload.ipHash !== hashIp(clientIp(req))) return { ok: false, reason: "captcha_invalid" };

  const timing = checkTiming(payload.issuedAt, Date.now());
  if (timing) return { ok: false, reason: timing };

  if (!isSolved(payload.home, { x, y })) return { ok: false, reason: "captcha_invalid" };
  // Гасим в самом конце: негодный ответ не должен съедать задачу, иначе
  // человек, промахнувшийся мимо допуска, оставался бы без неё.
  if (!(await consume(payload.nonce))) return { ok: false, reason: "captcha_invalid" };
  return { ok: true };
}
