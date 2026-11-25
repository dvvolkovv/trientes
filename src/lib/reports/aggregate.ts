/**
 * Сводка продаж — чистая функция над строками чеков (слайс CL, раздел 5 спеки).
 *
 * Почему функция, а не пять запросов `groupBy`: одно правило счёта служит экрану,
 * выгрузке и API, и его видно тесту. Цена — потолок выборки (`REPORT_MAX_SALES`), и
 * усечение названо вслух, а не выдано за полную картину (правило BK «no silent caps»).
 *
 * Два решения, которые нельзя трогать:
 * - **суммы разных валют не складываются** (курса сделки мы не наблюдали — разбор CK);
 * - **отмены из выручки молча не вычитаются**: выручка считается по исполненным чекам,
 *   отмены стоят рядом своим числом. Консультанту нужны оба.
 *
 * Комиссий в сводке нет ни одной: своей комиссии с продажи мы не берём, а нулевой
 * столбец читался бы как измеренный ноль (то же решение, что ставка «0 %» в BD).
 */
import { zonedDayKey } from "@/lib/reports/period";

export type ReportLine = {
  productId: string | null;
  name: string;
  unit: string;
  qty: number;
  listPrice: number;
  price: number;
  cashbackPercent: number | null;
  cashbackAmount: number;
};

export type ReportSale = {
  id: string;
  number: number;
  createdAt: Date;
  currency: string;
  listTotal: number;
  total: number;
  cashbackTotal: number;
  payment: string;
  status: "COMPLETED" | "CANCELLED";
  cancelReason: string | null;
  pointId: string | null;
  pointName: string | null;
  cashierId: string | null;
  cashierName: string | null;
  buyerClaimed: boolean;
  payCoin: string | null;
  payRate: number | null;
  payCoinAmount: number | null;
  lines: ReportLine[];
};

export type Bucket = { key: string; label: string; receipts: number; revenue: number };
export type DayBucket = { day: string; receipts: number; revenue: number };
export type ProductBucket = { key: string; label: string; qty: number; revenue: number; cashback: number };

export type CurrencyReport = {
  currency: string;
  receipts: number;
  revenue: number;
  listTotal: number;
  discount: number;
  cashback: number;
  cancelledCount: number;
  cancelledTotal: number;
  byPayment: Bucket[];
  byPoint: Bucket[];
  byCashier: Bucket[];
  byDay: DayBucket[];
  topProducts: ProductBucket[];
};

export type ReportSummary = {
  currencies: CurrencyReport[];
  /** Чеков всего — число без валюты, поэтому его складывать можно. */
  receipts: number;
  cancelled: number;
  truncated: boolean;
};

/** Копейки: считаем в сотых и округляем от половины вверх — как касса в CK. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Товаров в верхушке — столько, сколько читает человек, не выгрузка. */
export const TOP_PRODUCTS = 10;

function bump(
  map: Map<string, Bucket>,
  key: string,
  label: string,
  revenue: number,
  countReceipt: boolean,
): void {
  const row = map.get(key) ?? { key, label, receipts: 0, revenue: 0 };
  if (countReceipt) row.receipts += 1;
  row.revenue += revenue;
  map.set(key, row);
}

export function aggregateSales(
  sales: readonly ReportSale[],
  tz: string,
  opts: { truncated?: boolean } = {},
): ReportSummary {
  const byCurrency = new Map<
    string,
    {
      report: CurrencyReport;
      payment: Map<string, Bucket>;
      point: Map<string, Bucket>;
      cashier: Map<string, Bucket>;
      day: Map<string, DayBucket>;
      product: Map<string, ProductBucket>;
    }
  >();

  for (const sale of sales) {
    let slot = byCurrency.get(sale.currency);
    if (!slot) {
      slot = {
        report: {
          currency: sale.currency,
          receipts: 0,
          revenue: 0,
          listTotal: 0,
          discount: 0,
          cashback: 0,
          cancelledCount: 0,
          cancelledTotal: 0,
          byPayment: [],
          byPoint: [],
          byCashier: [],
          byDay: [],
          topProducts: [],
        },
        payment: new Map(),
        point: new Map(),
        cashier: new Map(),
        day: new Map(),
        product: new Map(),
      };
      byCurrency.set(sale.currency, slot);
    }

    if (sale.status === "CANCELLED") {
      // Отменённый чек не выручка и не скидка: он не состоялся. Но он и не ноль —
      // консультант должен видеть, сколько чеков отменено и на какую сумму.
      slot.report.cancelledCount += 1;
      slot.report.cancelledTotal += sale.total;
      continue;
    }

    const r = slot.report;
    r.receipts += 1;
    r.revenue += sale.total;
    r.listTotal += sale.listTotal;
    r.cashback += sale.cashbackTotal;

    bump(slot.payment, sale.payment, sale.payment, sale.total, true);
    bump(slot.point, sale.pointId ?? "", sale.pointName ?? "", sale.total, true);
    bump(slot.cashier, sale.cashierId ?? "", sale.cashierName ?? "", sale.total, true);

    const day = zonedDayKey(sale.createdAt, tz);
    const dayRow = slot.day.get(day) ?? { day, receipts: 0, revenue: 0 };
    dayRow.receipts += 1;
    dayRow.revenue += sale.total;
    slot.day.set(day, dayRow);

    for (const line of sale.lines) {
      // Ключ строки — товар, а если его паспорт исчез, то название из снимка чека:
      // чек неизменяем, и строка без паспорта обязана остаться читаемой.
      const key = line.productId ?? `name:${line.name}`;
      const row = slot.product.get(key) ?? { key, label: line.name, qty: 0, revenue: 0, cashback: 0 };
      row.qty += line.qty;
      row.revenue += line.qty * line.price;
      row.cashback += line.cashbackAmount;
      slot.product.set(key, row);
    }
  }

  const currencies: CurrencyReport[] = [];
  for (const slot of byCurrency.values()) {
    const r = slot.report;
    r.revenue = round2(r.revenue);
    r.listTotal = round2(r.listTotal);
    // Скидка выводится вычитанием, а не хранится третьим числом, которое разошлось бы
    // с первыми двумя (решение CK).
    r.discount = round2(r.listTotal - r.revenue);
    r.cashback = round2(r.cashback);
    r.cancelledTotal = round2(r.cancelledTotal);
    const fix = (b: Bucket) => ({ ...b, revenue: round2(b.revenue) });
    r.byPayment = [...slot.payment.values()].map(fix).sort((a, b) => b.revenue - a.revenue);
    r.byPoint = [...slot.point.values()].map(fix).sort((a, b) => b.revenue - a.revenue);
    r.byCashier = [...slot.cashier.values()].map(fix).sort((a, b) => b.revenue - a.revenue);
    r.byDay = [...slot.day.values()]
      .map((d) => ({ ...d, revenue: round2(d.revenue) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    r.topProducts = [...slot.product.values()]
      .map((p) => ({ ...p, qty: Math.round(p.qty * 1000) / 1000, revenue: round2(p.revenue), cashback: round2(p.cashback) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_PRODUCTS);
    currencies.push(r);
  }
  currencies.sort((a, b) => b.revenue - a.revenue);

  return {
    currencies,
    receipts: sales.filter((s) => s.status !== "CANCELLED").length,
    cancelled: sales.filter((s) => s.status === "CANCELLED").length,
    truncated: Boolean(opts.truncated),
  };
}
