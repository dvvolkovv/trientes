import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readUserFollows } from "@/lib/promos/read";
import { SubscriptionsControls } from "@/components/cabinet/subscriptions-controls";

/**
 * «Подписки» в кабинете покупателя (ТЗ 4.3): магазины, на которые человек подписан,
 * «не писать мне» по каждому и общий выключатель рассылок. Отключение — право
 * человека, поэтому оно живёт там, где он его искать будет, а не в карточке магазина.
 *
 * Слайс BX. Предприятие рисуется **той же плиткой**, какой его видит собственный
 * владелец (`companies-section.tsx`): знак, витринное имя, юридическое лицо. Человек
 * узнаёт магазин в лицо, а не читает подчёркнутую ссылку, — и это та же вещь на
 * экране, что и в кабинете владельца, а не вторая её запись.
 *
 * Своего заголовка секция не печатает: его печатает `CabinetSectionShell`, и две
 * «Подписки» подряд — ровно то, что владелец увидел глазом.
 */
export async function SubscriptionsSection({ locale }: { locale: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return null;

  const [t, follows, user] = await Promise.all([
    getTranslations("promos.subscriptions"),
    readUserFollows(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { notifyPromos: true } }),
  ]);

  return (
    <section id="subscriptions">
      <p className="mb-4 text-sm text-muted">{t("subtitle")}</p>
      <SubscriptionsControls
        locale={locale}
        promosOn={user?.notifyPromos ?? true}
        rows={follows.map((f) => ({
          companyId: f.companyId,
          name: f.company.displayName,
          legalName: f.company.legalName,
          logoUrl: f.company.logoUrl,
          logoShape: f.company.logoShape,
          logoFit: f.company.logoFit,
          muted: f.muted,
          // Снятое надзором или нелистованное предприятие в списке остаётся: человек
          // подписывался сам и должен видеть, на что подписан, даже когда витрины нет.
          live: f.company.status === "APPROVED" && !f.company.suspendedAt && !f.company.deletedAt,
        }))}
      />
    </section>
  );
}
