import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireCabinetUser } from "@/lib/cabinet/viewer";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { CreateCompanyForm } from "@/components/cabinet/create-company-form";

export const dynamic = "force-dynamic";

/**
 * Заведение предприятия на своём адресе (слайс BV). Прежде форма из двух полей
 * всегда стояла под списком и занимала экран телефона у того, кто пришёл войти в
 * своё предприятие; теперь сюда ведёт плитка «+».
 *
 * Параметр `?card=` (человек пришёл с карточки монеты заводить точку) переносится
 * сюда целиком: терять его по дороге нельзя — это живой путь.
 */
export default async function CreateCompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { locale } = await params;
  const { card } = await searchParams;
  setRequestLocale(locale);
  await requireCabinetUser(locale, "/cabinet/companies/new");
  const t = await getTranslations();

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("cabinet.kicker")}
      title={t("cabinet.companies.add")}
      backLabel={t("cabinet.companies.title")}
      backHref={`/${locale}/cabinet/companies`}
    >
      <CreateCompanyForm nextCard={card} />
    </CabinetSectionShell>
  );
}
