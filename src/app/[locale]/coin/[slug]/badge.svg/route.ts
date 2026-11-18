import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { LIVE_CARD_COMPANY } from "@/lib/company-visibility";
import { buildAcceptBadgeSvg } from "@/lib/coin-card-badge";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
) {
  const { locale, slug } = await params;

  // Бейдж есть и у собственного листинга, и у обычной монеты — ставят его на
  // свой сайт продавцы, а не только проекты.
  const card = await prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED", ...LIVE_CARD_COMPANY },
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
      // Час, а не сутки: бейдж стоит на чужих страницах, и починённая разметка
      // должна доезжать до них в тот же день, а не на следующий. Запрос раз в
      // час к статичному SVG дешевле суток заведомо неверной картинки.
      "cache-control": "public, max-age=3600",
    },
  });
}
