import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { readUserFollows } from "@/lib/promos/read";
import { SubscriptionsControls } from "@/components/cabinet/subscriptions-controls";

/**
 * «Подписки» в кабинете покупателя (ТЗ 4.3): список магазинов, «не писать мне» по
 * каждому и общий выключатель рассылок. Отключение — право человека, поэтому оно живёт
 * там, где он его искать будет, а не в карточке магазина.
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
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>
      <SubscriptionsControls
        locale={locale}
        promosOn={user?.notifyPromos ?? true}
        rows={follows.map((f) => ({
          companyId: f.companyId,
          name: f.company.displayName,
          muted: f.muted,
          // Снятое надзором или нелистованное предприятие в списке остаётся: человек
          // подписывался сам и должен видеть, на что подписан, даже когда витрины нет.
          live: f.company.status === "APPROVED" && !f.company.suspendedAt && !f.company.deletedAt,
        }))}
      />
    </section>
  );
}
