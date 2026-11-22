import { NextResponse } from "next/server";
import { buildCompanyCard } from "@/lib/company-card/view";
import { pickLocale } from "@/lib/locales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Карточка предприятия для навигатора (слайс BY).
 *
 * Навигатор берёт её **отдельным запросом при открытии точки**, а не через фид bbox:
 * в кадре бывает двести точек, и реклама с реквизитами у каждой раздула бы ответ,
 * который рисует карту.
 *
 * Ответ публичный и повторяет витрину: выключатели «что видят покупатели» читает сама
 * сборка карточки, поэтому спрятанное продавцом сюда не попадает.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const locale = pickLocale(new URL(req.url).searchParams.get("locale"));
  const card = await buildCompanyCard({ companyId: id, locale });
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(
    { card },
    // Карточка меняется правкой в кабинете, а не каждую минуту: короткий кеш снимает
    // повторное чтение при листании страниц карточки туда-сюда.
    { headers: { "cache-control": "public, max-age=30" } },
  );
}
