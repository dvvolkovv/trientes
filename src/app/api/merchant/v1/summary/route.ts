import { apiError, apiJson, authenticateApi } from "@/lib/merchant-api/auth";
import { aggregateSales } from "@/lib/reports/aggregate";
import { readReportSales, reportTimezone } from "@/lib/reports/read";
import { resolvePeriod } from "@/lib/reports/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/merchant/v1/summary` — та же сводка, что на экране, и тем же кодом
 * (`aggregateSales`): второе правило счёта разошлось бы с первым в первый же месяц.
 *
 * Суммы по валютам раздельно: курса сделки мы не наблюдали, и складывать разные валюты
 * значило бы придумать число (разбор CK про `payRate`).
 */
export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (!auth.ok) return apiError(auth.status, auth.error);

  const url = new URL(req.url);
  const { tz, mixed } = await reportTimezone(auth.caller.companyId);
  const period = resolvePeriod({
    range: url.searchParams.get("from") ? "custom" : "month",
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    tz,
  });

  const { sales, truncated } = await readReportSales(auth.caller.companyId, {
    from: period.from,
    to: period.to,
  });
  const summary = aggregateSales(sales, tz, { truncated });

  return apiJson({
    company: { id: auth.caller.companyId, name: auth.caller.companyName },
    period: { from: period.fromDay, to: period.toDay, timezone: tz, timezone_mixed: mixed },
    receipts: summary.receipts,
    cancelled: summary.cancelled,
    truncated: summary.truncated,
    currencies: summary.currencies.map((c) => ({
      currency: c.currency,
      receipts: c.receipts,
      revenue: c.revenue,
      list_total: c.listTotal,
      discount: c.discount,
      cashback_declared: c.cashback,
      cancelled_count: c.cancelledCount,
      cancelled_total: c.cancelledTotal,
      by_payment_method: c.byPayment.map((b) => ({ payment_method: b.key, receipts: b.receipts, revenue: b.revenue })),
      by_point: c.byPoint.map((b) => ({ point: b.label, receipts: b.receipts, revenue: b.revenue })),
      by_cashier: c.byCashier.map((b) => ({ cashier: b.label, receipts: b.receipts, revenue: b.revenue })),
      by_day: c.byDay,
      top_products: c.topProducts.map((p) => ({ product: p.label, qty: p.qty, revenue: p.revenue, cashback_declared: p.cashback })),
    })),
    notes: {
      fees: "platform takes no fee on sales; payment happens outside the platform",
      cashback: "declared, not credited: the platform has no wallet",
      refunds: "a cancelled receipt is the only kind of refund recorded",
    },
  });
}
