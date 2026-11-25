/**
 * Выборка для отчётности (слайс CL). Правила счёта — в `aggregate.ts`, здесь только
 * чтение: один источник строк служит экрану, выгрузке и API.
 */
import { prisma } from "@/lib/prisma";
import type { ReportSale } from "@/lib/reports/aggregate";

/**
 * Потолок выборки за период. Пять тысяч чеков — это касса с двумя продажами в минуту
 * целый месяц; усечение названо вслух и на экране, и в выгрузке, и в ответе API.
 */
export const REPORT_MAX_SALES = 5000;

function personName(u: { username: string | null; name: string | null; email: string | null } | null): string {
  if (!u) return "";
  return u.username ?? u.name ?? u.email ?? "";
}

export async function readReportSales(
  companyId: string,
  opts: { from: Date; to: Date; scope?: readonly string[]; take?: number; cursor?: { createdAt: Date; id: string } },
): Promise<{ sales: ReportSale[]; truncated: boolean }> {
  const scope = opts.scope ?? [];
  const take = Math.min(opts.take ?? REPORT_MAX_SALES, REPORT_MAX_SALES);
  const rows = await prisma.sale.findMany({
    where: {
      companyId,
      createdAt: { gte: opts.from, lt: opts.to },
      ...(scope.length > 0 ? { pointId: { in: [...scope] } } : {}),
      ...(opts.cursor
        ? {
            OR: [
              { createdAt: { gt: opts.cursor.createdAt } },
              { createdAt: opts.cursor.createdAt, id: { gt: opts.cursor.id } },
            ],
          }
        : {}),
    },
    // Порядок по возрастанию: так читается выгрузка, и по нему же идёт курсор API.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: take + 1,
    select: {
      id: true,
      number: true,
      createdAt: true,
      currency: true,
      listTotal: true,
      total: true,
      cashbackTotal: true,
      payment: true,
      status: true,
      cancelReason: true,
      payCoin: true,
      payRate: true,
      payCoinAmount: true,
      buyerUserId: true,
      pointId: true,
      point: { select: { name: true } },
      createdById: true,
      createdBy: { select: { username: true, name: true, email: true } },
      lines: {
        select: {
          productId: true,
          name: true,
          unit: true,
          qty: true,
          listPrice: true,
          price: true,
          cashbackPercent: true,
          cashbackAmount: true,
        },
      },
    },
  });

  const truncated = rows.length > take;
  const page = truncated ? rows.slice(0, take) : rows;

  return {
    truncated,
    sales: page.map((r) => ({
      id: r.id,
      number: r.number,
      createdAt: r.createdAt,
      currency: r.currency,
      listTotal: Number(r.listTotal),
      total: Number(r.total),
      cashbackTotal: Number(r.cashbackTotal),
      payment: r.payment,
      status: r.status === "CANCELLED" ? "CANCELLED" : "COMPLETED",
      cancelReason: r.cancelReason,
      pointId: r.pointId,
      pointName: r.point?.name ?? null,
      cashierId: r.createdById,
      cashierName: personName(r.createdBy),
      buyerClaimed: Boolean(r.buyerUserId),
      payCoin: r.payCoin,
      payRate: r.payRate === null ? null : Number(r.payRate),
      payCoinAmount: r.payCoinAmount === null ? null : Number(r.payCoinAmount),
      lines: r.lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        unit: l.unit,
        qty: Number(l.qty),
        listPrice: Number(l.listPrice),
        price: Number(l.price),
        cashbackPercent: l.cashbackPercent === null ? null : Number(l.cashbackPercent),
        cashbackAmount: Number(l.cashbackAmount),
      })),
    })),
  };
}

/**
 * Пояс отчёта. У всех точек один пояс — он; иначе UTC, и это сказано на экране
 * строкой: молчаливый UTC у сети в двух поясах был бы тихой ошибкой (разбор BN).
 */
export async function reportTimezone(companyId: string): Promise<{ tz: string; mixed: boolean }> {
  const points = await prisma.companyPoint.findMany({
    where: { companyId, timezone: { not: null } },
    select: { timezone: true },
    take: 200,
  });
  const zones = new Set(points.map((p) => p.timezone).filter((z): z is string => Boolean(z)));
  if (zones.size === 1) return { tz: [...zones][0], mixed: false };
  return { tz: "UTC", mixed: zones.size > 1 };
}
