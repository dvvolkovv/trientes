import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";

/**
 * Второй фактор глазами самого сотрудника: заведён ли, сколько кодов
 * восстановления осталось, и как перевести его на другой телефон. Снять фактор
 * себе отсюда нельзя — это право владельца (`/admin/staff`), иначе выманенный
 * пароль снимал бы и фактор.
 */
export async function MfaSection({ locale, userId }: { locale: string; userId: string }) {
  const t = await getTranslations("cabinet.mfa");
  const row = await prisma.staffMfa.findUnique({
    where: { userId },
    select: {
      confirmedAt: true,
      disabledAt: true,
      recoveryCodes: { where: { usedAt: null }, select: { id: true } },
    },
  });
  const on = Boolean(row?.confirmedAt && !row.disabledAt);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <section id="security" className="space-y-4">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      <p className="text-muted">{t("subtitle")}</p>
      <div className="bg-card border border-hairline rounded-[20px] p-5 space-y-2">
        <p className="text-sm">
          {on && row?.confirmedAt ? t("on", { date: day(row.confirmedAt) }) : t("off")}
        </p>
        {on ? (
          <p className="text-xs text-muted">{t("codesLeft", { count: row?.recoveryCodes.length ?? 0 })}</p>
        ) : null}
        <Link
          href={`/${locale}/mfa/setup`}
          className="inline-block border border-hairline rounded-md px-4 py-2 text-sm hover:bg-card-alt transition-colors"
        >
          {on ? t("rotate") : t("enable")}
        </Link>
      </div>
    </section>
  );
}
