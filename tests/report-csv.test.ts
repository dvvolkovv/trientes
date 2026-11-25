import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, linesCsv, receiptsCsv, reportFileName, toCsv } from "@/lib/reports/csv";
import type { ReportSale } from "@/lib/reports/aggregate";
import { RECEIPT_COLUMNS, LINE_COLUMNS } from "@/lib/reports/csv";
import { API_PAGE_MAX } from "@/lib/merchant-api/keys";

const sale: ReportSale = {
  id: "s1",
  number: 7,
  createdAt: new Date("2026-11-25T12:00:00Z"),
  currency: "EUR",
  listTotal: 100,
  total: 90,
  cashbackTotal: 4.5,
  payment: "CASH",
  status: "COMPLETED",
  cancelReason: null,
  pointId: "p1",
  pointName: 'Shop "Centre", Prague',
  cashierId: "u1",
  cashierName: "anna",
  buyerClaimed: true,
  payCoin: null,
  payRate: null,
  payCoinAmount: null,
  lines: [
    { productId: "pr1", name: "Tea\nGreen", unit: "pcs", qty: 2, listPrice: 50, price: 45, cashbackPercent: 5, cashbackAmount: 4.5 },
  ],
};

describe("выгрузка CSV", () => {
  it("поле с кавычкой, запятой или переводом строки берётся в кавычки", () => {
    expect(csvCell('Shop "Centre", Prague')).toBe('"Shop ""Centre"", Prague"');
    expect(csvCell("Tea\nGreen")).toBe('"Tea\nGreen"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("файл начинается с BOM — иначе Excel ломает кириллицу", () => {
    const csv = toCsv([["имя"], ["значение"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("имя\r\nзначение");
  });

  it("у чека столько столбцов, сколько объявлено, и скидка выведена вычитанием", () => {
    const rows = receiptsCsv([sale], "UTC").replace(CSV_BOM, "").trim().split("\r\n");
    expect(rows[0].split(",")).toEqual([...RECEIPT_COLUMNS]);
    // Разбор строки с кавычками делаем грубо: важно, что скидка 10 и день местный.
    expect(rows[1]).toContain("100,90,10,4.5,CASH");
    expect(rows[1]).toContain("2026-11-25");
    expect(rows[1]).toContain('"Shop ""Centre"", Prague"');
  });

  it("строки чека выгружаются отдельным файлом с номером чека", () => {
    const rows = linesCsv([sale], "UTC").replace(CSV_BOM, "").trim().split("\r\n");
    expect(rows[0].split(",")).toEqual([...LINE_COLUMNS]);
    const body = rows.slice(1).join("\r\n");
    expect(body.startsWith("7,")).toBe(true);
    // 2 × 50 витринных против 2 × 45 фактических: 100, 90 и скидка 10.
    expect(body).toContain("2,50,45,100,90,10,5,4.5");
  });

  it("имя файла несёт предприятие, вид и период", () => {
    expect(reportFileName("Čaj & Co", "receipts", "2026-11-01", "2026-11-30")).toBe(
      "trientes-aj-co-receipts-2026-11-01-2026-11-30.csv",
    );
    expect(reportFileName("", "lines", "2026-11-01", "2026-11-01")).toBe(
      "trientes-company-lines-2026-11-01-2026-11-01.csv",
    );
  });

  it("страница API не бывает выгрузкой: сотня и есть потолок", () => {
    expect(API_PAGE_MAX).toBe(100);
  });
});
