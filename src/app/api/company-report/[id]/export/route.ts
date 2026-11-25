import { NextResponse } from "next/server";
import { getViewerCompanyById } from "@/lib/business";
import { can } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { readReportSales, reportTimezone } from "@/lib/reports/read";
import { linesCsv, receiptsCsv, reportFileName } from "@/lib/reports/csv";
import { resolvePeriod } from "@/lib/reports/period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Выгрузка отчёта файлом (слайс CL, ТЗ 6.4 «экспорт отчётов для налогового
 * консультанта»). Два вида: чеки и позиции.
 *
 * Право — `reports: EDIT`, а не `VIEW`: вынос данных за пределы платформы это другое
 * действие, чем взгляд на экран, и каждая выгрузка ложится в журнал предприятия.
 * Участок сотрудника сужает выгрузку так же, как экран: он не вправе унести чеки
 * чужой точки.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "lines" ? "lines" : "receipts";

  const { userId, company, permissions, pointScope } = await getViewerCompanyById(id);
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

  const { sales, truncated } = await readReportSales(company.id, {
    from: period.from,
    to: period.to,
    scope: pointScope,
  });

  const body = kind === "lines" ? linesCsv(sales, tz) : receiptsCsv(sales, tz);
  const name = reportFileName(company.displayName, kind, period.fromDay, period.toDay);

  await logCompanyAction({
    companyId: company.id,
    actorUserId: userId,
    action: "REPORT_EXPORTED",
    subject: `${kind} ${period.fromDay}…${period.toDay}`,
    meta: { kind, from: period.fromDay, to: period.toDay, rows: sales.length, truncated },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      // Усечение названо заголовком, а строкой в файл его не дописываем: строка не
      // того вида сломала бы разбор у учётной системы. На экране про потолок сказано
      // словами — молчаливый потолок читался бы как «выгружено всё» (правило BK).
      ...(truncated ? { "x-trientes-truncated": "1" } : {}),
      "cache-control": "no-store",
    },
  });
}
