/**
 * Калитка read-only API предприятия (слайс CL): ключ → предприятие, частота, штамп
 * последнего обращения.
 *
 * Снятое надзором или удалённое предприятие ключом не читается: надзор гасит всё, что
 * смотрит наружу, а выгрузка наружу — это наружу.
 */
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { API_RATE_PER_HOUR, hashApiKey, parseBearer } from "@/lib/merchant-api/keys";

export type ApiCaller = {
  keyId: string;
  companyId: string;
  companyName: string;
};

export type ApiAuthResult =
  | { ok: true; caller: ApiCaller }
  | { ok: false; status: 401 | 403 | 429; error: string };

/**
 * Штамп обращения обновляем не чаще раза в минуту: запись в базу на каждый запрос —
 * лишняя точка отказа на горячем пути (прецедент `rate-gate` в BL).
 */
const TOUCH_EVERY_MS = 60_000;

async function withinRate(keyId: string): Promise<boolean> {
  try {
    const bucket = `mapi:rate:${keyId}:${Math.floor(Date.now() / 3_600_000)}`;
    const used = await redis.incr(bucket);
    if (used === 1) await redis.expire(bucket, 3_600);
    return used <= API_RATE_PER_HOUR;
  } catch (error) {
    // Нет Redis — учётная система мерчанта не должна умирать из-за нашего кэша.
    console.error("merchant_api_rate_unavailable", error);
    return true;
  }
}

export async function authenticateApi(req: Request): Promise<ApiAuthResult> {
  const token = parseBearer(req.headers.get("authorization"));
  if (!token) return { ok: false, status: 401, error: "missing_key" };

  const row = await prisma.merchantApiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    select: {
      id: true,
      revokedAt: true,
      lastUsedAt: true,
      company: { select: { id: true, displayName: true, suspendedAt: true, deletedAt: true } },
    },
  });
  if (!row) return { ok: false, status: 401, error: "invalid_key" };
  if (row.revokedAt) return { ok: false, status: 401, error: "key_revoked" };
  if (row.company.suspendedAt || row.company.deletedAt) {
    return { ok: false, status: 403, error: "company_unavailable" };
  }
  if (!(await withinRate(row.id))) return { ok: false, status: 429, error: "rate_limited" };

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    // Ответа учётной системе не ждём на записи штампа.
    void prisma.merchantApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
      .catch((error) => console.error("merchant_api_touch_failed", row.id, error));
  }

  return {
    ok: true,
    caller: { keyId: row.id, companyId: row.company.id, companyName: row.company.displayName },
  };
}

export function apiError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apiJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
