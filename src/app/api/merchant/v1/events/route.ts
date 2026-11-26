import { prisma } from "@/lib/prisma";
import { apiError, apiJson, authenticateApi } from "@/lib/merchant-api/auth";
import { API_PAGE_DEFAULT, API_PAGE_MAX } from "@/lib/merchant-api/keys";
import { AUTOMATION_EVENTS } from "@/lib/automation/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/merchant/v1/events` — события предприятия тем же ключом, что чеки (слайс CO,
 * ТЗ 6.7 «открытый API и событийная архитектура»).
 *
 * Для того, кто **не может принимать** оповещения: курсор идёт по паре `(createdAt, id)`
 * по возрастанию, внешняя система забирает хвост. Форма записи — та же, что у тела
 * оповещения (`deliveryPayload`): один словарь на опрос и на подписку, второй разошёлся
 * бы с первым.
 *
 * Только чтение. Записи через API нет: чек заводит касса кабинета, остаток склад, и
 * вторая дверь к той же записи означала бы двух авторов (правило BI, решение CL).
 */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.ok) return apiError(auth.status, auth.error);

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? API_PAGE_DEFAULT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), API_PAGE_MAX)
    : API_PAGE_DEFAULT;

  const kind = url.searchParams.get("type");
  if (kind && !(AUTOMATION_EVENTS as readonly string[]).includes(kind)) return apiError(400, "type_unknown");

  let cursor: { createdAt: Date; id: string } | null = null;
  const cursorRaw = url.searchParams.get("cursor");
  if (cursorRaw) {
    const [stamp, id] = cursorRaw.split("|");
    const at = stamp ? new Date(stamp) : new Date("x");
    if (!id || Number.isNaN(at.getTime())) return apiError(400, "cursor_invalid");
    cursor = { createdAt: at, id };
  }

  const rows = await prisma.companyEvent.findMany({
    where: {
      companyId: auth.caller.companyId,
      ...(kind ? { kind } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, kind: true, source: true, subject: true, data: true, createdAt: true },
  });

  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  const last = page[page.length - 1];
  return apiJson({
    company: { id: auth.caller.companyId, name: auth.caller.companyName },
    next_cursor: more && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    events: page.map((e) => ({
      id: e.id,
      type: e.kind,
      // `rule` — следствие действия правила: такое событие правил уже не запускает, и
      // внешняя система должна различать его от факта работы человека.
      source: e.source.toLowerCase(),
      company_id: auth.caller.companyId,
      created_at: e.createdAt.toISOString(),
      subject: e.subject,
      data: e.data ?? {},
    })),
  });
}
