import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { pickLocale } from "@/lib/locales";
import { promoVisible } from "@/lib/promos/rules";

/**
 * Единственный переход акции — наша ссылка. Он же счётчик: показов не считаем вовсе
 * (честно считает их только счётчик в браузере, которого у нас нет), а переход — факт.
 *
 * Ведём туда, куда акция привязана: товар → паспорт, точка → карта с этой точкой,
 * иначе витрина предприятия. Негодная или снятая акция — на витрину предприятия, а не
 * в 404: человек пришёл по ссылке из сообщения, и пустая страница ему ничего не скажет.
 */
/**
 * Адрес берём из окружения, а не из `req.url`: за nginx запрос приходит на localhost,
 * и склеенный с ним `Location` уводил браузер на несуществующий адрес (поймано живым
 * прогоном слайса; тот же приём, что в подтверждении почты и гео-оповещениях).
 */
const SITE_ORIGIN = (process.env.PUBLIC_ORIGIN ?? "https://trientes.org").replace(/\/+$/, "");

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ locale: string; id: string }> },
) {
  const { locale: rawLocale, id } = await ctx.params;
  const locale = pickLocale(rawLocale);
  const promo = await prisma.merchantPromo.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      startsAt: true,
      endsAt: true,
      archivedAt: true,
      product: { select: { slug: true, suspendedAt: true, mergedIntoId: true } },
      point: { select: { id: true, status: true, suspendedAt: true } },
      company: { select: { id: true, status: true, suspendedAt: true, deletedAt: true } },
    },
  });
  if (!promo) return NextResponse.redirect(`${SITE_ORIGIN}/${locale}/companies`);

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  // Переход считаем и у негодной акции: нажатие было, и в числах мерчанта оно должно
  // быть видно. Сбой записи переход не роняет — человека важнее довести до страницы.
  try {
    await prisma.promoClick.create({ data: { promoId: promo.id, userId } });
  } catch (error) {
    console.error("promo_click_failed", promo.id, error);
  }

  const live = promoVisible({ company: promo.company, promo }, new Date());
  const product = promo.product && !promo.product.suspendedAt && !promo.product.mergedIntoId ? promo.product : null;
  const point = promo.point && promo.point.status === "APPROVED" && !promo.point.suspendedAt ? promo.point : null;

  const target = !live
    ? `/${locale}/companies/${promo.companyId}`
    : product
      ? `/${locale}/product/${product.slug}`
      : point
        ? `/${locale}/crypto-map?point=${point.id}`
        : `/${locale}/companies/${promo.companyId}`;
  return NextResponse.redirect(`${SITE_ORIGIN}${target}`);
}
