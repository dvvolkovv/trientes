import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { buildAcceptBadgeSvg } from "@/lib/coin-card-badge";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
) {
  const { locale, slug } = await params;

  // Бейдж есть и у собственного листинга, и у обычной монеты — ставят его на
  // свой сайт продавцы, а не только проекты.
  const card = await prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED" },
    select: { symbol: true },
  });
  const symbol =
    card?.symbol ??
    (await prisma.coin.findUnique({ where: { slug }, select: { symbol: true } }))?.symbol ??
    null;
  if (!symbol) return new Response("not found", { status: 404 });

  const t = await getTranslations({ locale, namespace: "coinCard.acceptance" });
  const svg = buildAcceptBadgeSvg({ label: t("badgeLabel"), symbol });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
