import { NextResponse } from "next/server";
import { getViewerCompanyById } from "@/lib/business";
import { can } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { readLedgerOps, readLedgerReceipts } from "@/lib/crypto-ledger/read";
import { cryptoFileName, cryptoOpsCsv, cryptoReceiptsCsv } from "@/lib/crypto-ledger/csv";
import { reportTimezone } from "@/lib/reports/read";
import { resolvePeriod } from "@/lib/reports/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Выгрузка книги криптоучёта (слайс CR, ТЗ 6.8 «экспорт для налогового консультанта»).
 *
 * Право — `reports: EDIT`, дословно правило CL: взгляд на экран и вынос данных за
 * пределы платформы — разные действия, и каждая выгрузка ложится в журнал.
 *
 * Участок сотрудника книгу **не сужает** (в отличие от выгрузки чеков): монета приходит
 * предприятию, а не полке, и у строки операции точки нет вовсе.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "receipts" ? "receipts" : "operations";

  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (!company) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(permissions, "reports", "EDIT")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { tz } = await reportTimezone(company.id);
  const period = resolvePeriod({
    range: url.searchParams.get("range"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    tz,
  });

  let body: string;
  let truncated = false;
  let rows = 0;
  if (kind === "receipts") {
    const read = await readLedgerReceipts(company.id, { from: period.from, to: period.to });
    body = cryptoReceiptsCsv(read.receipts);
    truncated = read.truncated;
    rows = read.receipts.length;
  } else {
    const read = await readLedgerOps(company.id, { from: period.from, to: period.to });
    body = cryptoOpsCsv(read.ops);
    truncated = read.truncated;
    rows = read.ops.length;
  }

  const name = cryptoFileName(company.displayName, kind, period.fromDay, period.toDay);

  await logCompanyAction({
    companyId: company.id,
    actorUserId: userId,
    action: "CRYPTO_EXPORTED",
    subject: `${kind} ${period.fromDay}…${period.toDay}`,
    meta: { kind, from: period.fromDay, to: period.toDay, rows, truncated },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      ...(truncated ? { "x-trientes-truncated": "1" } : {}),
      "cache-control": "no-store",
    },
  });
}
