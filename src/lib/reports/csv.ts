/**
 * Выгрузка для налогового консультанта (слайс CL, раздел 6 спеки).
 *
 * CSV по RFC 4180: запятая, кавычки удваиваются, числа с точкой — это то, что читают
 * учётные системы. **UTF-8 с BOM**: без него Excel ломает кириллицу, а файл несут
 * человеку, а не роботу.
 *
 * Заголовки столбцов — по-английски и теми же именами, что поля в ответе API: один
 * словарь на файл и на интеграцию. Переведённый заголовок сделал бы разбор файла
 * зависящим от языка кабинета.
 */
import type { ReportSale } from "@/lib/reports/aggregate";
import { zonedDayKey } from "@/lib/reports/period";

export const CSV_BOM = "﻿";

export type CsvCell = string | number | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value) : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly CsvCell[][]): string {
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const RECEIPT_COLUMNS = [
  "receipt_number",
  "created_at",
  "local_day",
  "status",
  "currency",
  "list_total",
  "total",
  "discount",
  "cashback_declared",
  "payment_method",
  "pay_coin",
  "pay_rate",
  "pay_coin_amount",
  "point",
  "cashier",
  "lines",
  "buyer_claimed",
  "cancel_reason",
] as const;

export function receiptsCsv(sales: readonly ReportSale[], tz: string): string {
  const rows: CsvCell[][] = [[...RECEIPT_COLUMNS]];
  for (const s of sales) {
    rows.push([
      s.number,
      s.createdAt.toISOString(),
      zonedDayKey(s.createdAt, tz),
      s.status,
      s.currency,
      round2(s.listTotal),
      round2(s.total),
      round2(s.listTotal - s.total),
      round2(s.cashbackTotal),
      s.payment,
      s.payCoin ?? "",
      s.payRate ?? "",
      s.payCoinAmount ?? "",
      s.pointName ?? "",
      s.cashierName ?? "",
      s.lines.length,
      s.buyerClaimed ? "yes" : "no",
      s.cancelReason ?? "",
    ]);
  }
  return toCsv(rows);
}

export const LINE_COLUMNS = [
  "receipt_number",
  "created_at",
  "local_day",
  "status",
  "currency",
  "product",
  "unit",
  "qty",
  "list_price",
  "price",
  "line_list_total",
  "line_total",
  "line_discount",
  "cashback_percent",
  "cashback_declared",
  "point",
  "cashier",
] as const;

export function linesCsv(sales: readonly ReportSale[], tz: string): string {
  const rows: CsvCell[][] = [[...LINE_COLUMNS]];
  for (const s of sales) {
    for (const l of s.lines) {
      const lineList = round2(l.qty * l.listPrice);
      const lineTotal = round2(l.qty * l.price);
      rows.push([
        s.number,
        s.createdAt.toISOString(),
        zonedDayKey(s.createdAt, tz),
        s.status,
        s.currency,
        l.name,
        l.unit,
        l.qty,
        round2(l.listPrice),
        round2(l.price),
        lineList,
        lineTotal,
        round2(lineList - lineTotal),
        l.cashbackPercent ?? "",
        round2(l.cashbackAmount),
        s.pointName ?? "",
        s.cashierName ?? "",
      ]);
    }
  }
  return toCsv(rows);
}

/** Имя файла: предприятие, вид и период — чтобы в папке консультанта их различали. */
export function reportFileName(company: string, kind: "receipts" | "lines", fromDay: string, toDay: string): string {
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "company";
  return `trientes-${slug}-${kind}-${fromDay}-${toDay}.csv`;
}
