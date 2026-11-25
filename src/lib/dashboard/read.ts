/**
 * Чтение сводки рабочего дня (слайс CM). Спека
 * `docs/superpowers/specs/2026-11-25-merchant-dashboard-design.md`.
 *
 * **Ни одного своего числа.** Каждое читается тем же правилом, что рисует раздел:
 * продажи — `readReportSales` + `aggregateSales` (CL), задачи — `visibilityWhere`
 * (BF), ниже порога — `belowThreshold` (CM, то же сравнение в разделе поставок),
 * непрочитанное — `storeUnreadTotal` (BQ), квота рассылки — `quotaLeft` (BG).
 * Своего агрегата и своей таблицы-кэша нет: число, посчитанное вторым способом,
 * однажды разойдётся с экраном раздела (§ 2 спеки).
 *
 * Участок по точкам сужает продажи, задачи и остатки; переписку и акции — нет
 * (покупатель пишет предприятию, акция принадлежит предприятию: решения BQ и BG).
 */
import { prisma } from "@/lib/prisma";
import type { TeamPermissions } from "@/lib/company-team/permissions";
import { dashNeeds } from "@/lib/dashboard/cards";
import { readReportSales, reportTimezone } from "@/lib/reports/read";
import { aggregateSales } from "@/lib/reports/aggregate";
import { resolvePeriod, zonedDayKey } from "@/lib/reports/period";
import { visibilityWhere, type TaskViewer } from "@/lib/company-tasks/read";
import { taskRights } from "@/lib/company-tasks/rules";
import { storeUnreadTotal } from "@/lib/customer-messages/read";
import { companySendState, quotaLeft } from "@/lib/promos/read";
import { runningPromoWhere } from "@/lib/promos/read";
import { belowThreshold } from "@/lib/supply/reorder";
import { readReorderRules } from "@/lib/supply/read";

export type DashMoney = { currency: string; revenue: number };

export type DashSales = {
  /** Чеков за сутки — число без валюты, поэтому оно и стоит крупным (§ 5 спеки). */
  today: number;
  week: number;
  /** Выручка по валютам за сутки: складывать их нельзя (CK, CL). */
  todayMoney: DashMoney[];
  weekMoney: DashMoney[];
  cancelledToday: number;
  /** Период усечён потолком `REPORT_MAX_SALES` — названо вслух, а не молчком (BK). */
  truncated: boolean;
};

export type DashStock = {
  /** Позиции с нулём и меньше **на полках**: на оптовом складе ноль не беда. */
  outOfStock: number;
  belowThreshold: number;
  inTransit: number;
};

export type DashTasks = { open: number; mine: number; overdue: number; onReview: number };

export type DashPromos = {
  running: number;
  /** Сколько рассылок осталось сегодня (BG: `PROMO_SENDS_PER_DAY`). */
  sendsLeft: number;
  adsLive: number;
  adsPending: number;
};

export type DashCustomers = { unread: number; threads: number };

export type Dashboard = {
  tz: string;
  tzMixed: boolean;
  sales: DashSales | null;
  stock: DashStock | null;
  tasks: DashTasks | null;
  promos: DashPromos | null;
  customers: DashCustomers | null;
};

const CLOSED_TASKS = ["DONE", "CANCELLED"] as const;

export async function readDashboard(
  companyId: string,
  viewer: { userId: string; permissions: TeamPermissions; pointScope: readonly string[] },
  opts: { now?: Date } = {},
): Promise<Dashboard> {
  const now = opts.now ?? new Date();
  const needs = dashNeeds(viewer.permissions);
  const { tz, mixed } = await reportTimezone(companyId);

  const [sales, stock, tasks, promos, customers] = await Promise.all([
    needs.sales ? readSales(companyId, viewer.pointScope, tz, now) : Promise.resolve(null),
    needs.stock ? readStock(companyId, viewer.pointScope) : Promise.resolve(null),
    needs.tasks ? readTasks(companyId, viewer, now) : Promise.resolve(null),
    needs.promos ? readPromos(companyId, now) : Promise.resolve(null),
    needs.customers ? readCustomers(companyId) : Promise.resolve(null),
  ]);

  return { tz, tzMixed: mixed, sales, stock, tasks, promos, customers };
}

/**
 * Продажи за семь дней одним чтением, сутки выделяются из разбивки по дням: второй
 * запрос «только сегодня» был бы вторым автором того же числа.
 */
async function readSales(
  companyId: string,
  scope: readonly string[],
  tz: string,
  now: Date,
): Promise<DashSales> {
  const period = resolvePeriod({ range: "week", tz, now });
  const { sales, truncated } = await readReportSales(companyId, {
    from: period.from,
    to: period.to,
    scope,
  });
  const summary = aggregateSales(sales, tz, { truncated });
  const today = zonedDayKey(now, tz);

  const todayMoney: DashMoney[] = [];
  const weekMoney: DashMoney[] = [];
  let todayReceipts = 0;
  for (const c of summary.currencies) {
    const day = c.byDay.find((d) => d.day === today);
    if (day && day.receipts > 0) {
      todayReceipts += day.receipts;
      todayMoney.push({ currency: c.currency, revenue: day.revenue });
    }
    if (c.receipts > 0) weekMoney.push({ currency: c.currency, revenue: c.revenue });
  }

  // Отмены считаются по самим чекам: в разбивке по дням их нет, а выручка их не
  // включает по построению (правило CL «отмены из выручки молча не вычитаются»).
  const cancelledToday = sales.filter(
    (s) => s.status === "CANCELLED" && zonedDayKey(s.createdAt, tz) === today,
  ).length;

  return {
    today: todayReceipts,
    week: summary.receipts,
    todayMoney,
    weekMoney,
    cancelledToday,
    truncated: summary.truncated,
  };
}

async function readStock(companyId: string, scope: readonly string[]): Promise<DashStock> {
  const shelfWhere = {
    companyId,
    kind: "SHELF" as const,
    archivedAt: null,
    ...(scope.length > 0 ? { pointId: { in: [...scope] } } : {}),
  };
  const [outOfStock, inTransit, rules] = await Promise.all([
    prisma.stockBalance.count({ where: { qty: { lte: 0 }, warehouse: shelfWhere } }),
    prisma.stockMovement.count({
      where: {
        companyId,
        status: "IN_TRANSIT",
        ...(scope.length > 0
          ? {
              OR: [
                { toWarehouse: { pointId: { in: [...scope] } } },
                { fromWarehouse: { pointId: { in: [...scope] } } },
              ],
            }
          : {}),
      },
    }),
    readReorderRules(companyId, scope),
  ]);
  return { outOfStock, inTransit, belowThreshold: rules.filter(belowThreshold).length };
}

async function readTasks(
  companyId: string,
  viewer: { userId: string; permissions: TeamPermissions; pointScope: readonly string[] },
  now: Date,
): Promise<DashTasks> {
  // Видимость — то же правило, что у доски: иначе сводка покажет задачи, которых на
  // доске нет, и число не разобрать глазом (§ 7 спеки).
  const taskViewer: TaskViewer = {
    userId: viewer.userId,
    seeAll: taskRights(viewer.permissions).seeAll,
    pointScope: [...viewer.pointScope],
  };
  const visible = visibilityWhere(taskViewer);
  const openWhere = { companyId, status: { notIn: [...CLOSED_TASKS] }, AND: [visible] };
  const [open, mine, overdue, onReview] = await Promise.all([
    prisma.companyTask.count({ where: openWhere }),
    prisma.companyTask.count({
      where: { companyId, status: { notIn: [...CLOSED_TASKS] }, assigneeId: viewer.userId },
    }),
    prisma.companyTask.count({ where: { ...openWhere, dueAt: { lt: now } } }),
    prisma.companyTask.count({ where: { companyId, status: "ON_REVIEW", AND: [visible] } }),
  ]);
  return { open, mine, overdue, onReview };
}

async function readPromos(companyId: string, now: Date): Promise<DashPromos> {
  const [running, state, adsLive, adsPending] = await Promise.all([
    prisma.merchantPromo.count({ where: { companyId, ...runningPromoWhere(now) } }),
    companySendState(companyId, now),
    prisma.companyAd.count({ where: { companyId, status: "PUBLISHED" } }),
    prisma.companyAd.count({ where: { companyId, status: "PENDING" } }),
  ]);
  return { running, sendsLeft: quotaLeft(state), adsLive, adsPending };
}

async function readCustomers(companyId: string): Promise<DashCustomers> {
  const [unread, threads] = await Promise.all([
    storeUnreadTotal(companyId),
    prisma.customerThread.count({ where: { companyId } }),
  ]);
  return { unread, threads };
}
