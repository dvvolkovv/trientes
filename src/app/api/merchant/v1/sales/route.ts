import { apiError, apiJson, authenticateApi } from "@/lib/merchant-api/auth";
import { API_PAGE_DEFAULT, API_PAGE_MAX } from "@/lib/merchant-api/keys";
import { readReportSales, reportTimezone } from "@/lib/reports/read";
import { resolvePeriod } from "@/lib/reports/period";
import { zonedDayKey } from "@/lib/reports/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/merchant/v1/sales` — чеки предприятия со строками (слайс CL, ТЗ 6.4 «API
 * для интеграции с кассами и учётными системами мерчанта»).
 *
 * Только чтение. Записи через API нет: чек заводит касса кабинета, а вторая дверь к той
 * же записи означала бы двух авторов остатка и двух авторов нумерации (правило BI).
 *
 * Имена полей — те же, что столбцы выгрузки CSV: один словарь на файл и на интеграцию.
 * Курсор идёт по паре `(createdAt, id)`, порядок — по возрастанию: учётная система
 * забирает хвост, а не перечитывает всё.
 */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.ok) return apiError(auth.status, auth.error);

  const url = new URL(req.url);
  const { tz } = await reportTimezone(auth.caller.companyId);
  const period = resolvePeriod({
    range: url.searchParams.get("from") ? "custom" : "month",
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    tz,
  });

  const limitRaw = Number(url.searchParams.get("limit") ?? API_PAGE_DEFAULT);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), API_PAGE_MAX) : API_PAGE_DEFAULT;

  let cursor: { createdAt: Date; id: string } | undefined;
  const cursorRaw = url.searchParams.get("cursor");
  if (cursorRaw) {
    const [stamp, id] = cursorRaw.split("|");
    const at = stamp ? new Date(stamp) : new Date("x");
    if (!id || Number.isNaN(at.getTime())) return apiError(400, "cursor_invalid");
    cursor = { createdAt: at, id };
  }

  const { sales, truncated } = await readReportSales(auth.caller.companyId, {
    from: period.from,
    to: period.to,
    take: limit,
    cursor,
  });

  const last = sales[sales.length - 1];
  return apiJson({
    company: { id: auth.caller.companyId, name: auth.caller.companyName },
    period: { from: period.fromDay, to: period.toDay, timezone: tz },
    // «Ещё есть» — это свойство страницы, а не сбой: `truncated` у выборки с курсором
    // означает ровно «следующая страница существует».
    next_cursor: truncated && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    sales: sales.map((s) => ({
      id: s.id,
      receipt_number: s.number,
      created_at: s.createdAt.toISOString(),
      local_day: zonedDayKey(s.createdAt, tz),
      status: s.status,
      currency: s.currency,
      list_total: s.listTotal,
      total: s.total,
      discount: Math.round((s.listTotal - s.total) * 100) / 100,
      cashback_declared: s.cashbackTotal,
      payment_method: s.payment,
      pay_coin: s.payCoin,
      pay_rate: s.payRate,
      pay_coin_amount: s.payCoinAmount,
      point: s.pointName,
      cashier: s.cashierName,
      buyer_claimed: s.buyerClaimed,
      cancel_reason: s.cancelReason,
      lines: s.lines.map((l) => ({
        product: l.name,
        product_id: l.productId,
        unit: l.unit,
        qty: l.qty,
        list_price: l.listPrice,
        price: l.price,
        cashback_percent: l.cashbackPercent,
        cashback_declared: l.cashbackAmount,
      })),
    })),
    // Комиссий в ответе нет ни одной: своей комиссии с продажи мы не берём, оплата идёт
    // мимо платформы. Нулевое поле читалось бы как измеренный ноль.
    notes: {
      fees: "platform takes no fee on sales; payment happens outside the platform",
      cashback: "declared, not credited: the platform has no wallet",
      refunds: "a cancelled receipt is the only kind of refund recorded",
    },
  });
}
