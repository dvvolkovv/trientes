/**
 * Выгрузка книги криптоучёта для налогового консультанта (слайс CR, раздел 7 спеки).
 *
 * Формат и правила — те же, что у выгрузки чеков в CL (`src/lib/reports/csv.ts`): CSV по
 * RFC 4180, UTF-8 с BOM, заголовки столбцов по-английски. Своего формата не изобретаем:
 * консультант получает от одного предприятия два файла, и разный их вид был бы его
 * лишней работой.
 */
import { toCsv, type CsvCell } from "@/lib/reports/csv";
import type { LedgerOp, LedgerReceipt } from "@/lib/crypto-ledger/aggregate";

export const CRYPTO_OP_COLUMNS = [
  "kind",
  "happened_at",
  "coin",
  "amount",
  "rate",
  "currency",
  "fiat_amount",
  "address",
  "tx_hash",
  "note",
] as const;

export const CRYPTO_RECEIPT_COLUMNS = [
  "receipt_number",
  "created_at",
  "status",
  "coin",
  "coin_amount",
  "rate",
  "currency",
  "fiat_total",
  "address",
  "tx_hash",
] as const;

function iso(at: Date): string {
  return at.toISOString();
}

export function cryptoOpsCsv(ops: readonly LedgerOp[]): string {
  const rows: CsvCell[][] = [[...CRYPTO_OP_COLUMNS]];
  for (const o of ops) {
    rows.push([
      o.kind,
      iso(o.happenedAt),
      o.coin,
      o.amount,
      o.rate,
      o.currency,
      o.fiatAmount,
      o.address,
      o.txHash,
      o.note,
    ]);
  }
  return toCsv(rows);
}

/**
 * Крипто-приходы из кассы. Отменённый чек в файле **остаётся** со своим статусом:
 * консультанту нужны оба числа, и молчаливое вычитание отмен было бы той же неправдой,
 * от которой отказался CL.
 */
export function cryptoReceiptsCsv(receipts: readonly LedgerReceipt[]): string {
  const rows: CsvCell[][] = [[...CRYPTO_RECEIPT_COLUMNS]];
  for (const r of receipts) {
    rows.push([
      r.number,
      iso(r.at),
      r.cancelled ? "CANCELLED" : "COMPLETED",
      r.coin,
      r.coinAmount,
      r.rate,
      r.currency,
      r.total,
      r.address,
      r.txHash,
    ]);
  }
  return toCsv(rows);
}

export function cryptoFileName(
  companyName: string,
  kind: "operations" | "receipts",
  fromDay: string,
  toDay: string,
): string {
  const slug =
    companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "company";
  return `trientes-${slug}-crypto-${kind}-${fromDay}-${toDay}.csv`;
}
