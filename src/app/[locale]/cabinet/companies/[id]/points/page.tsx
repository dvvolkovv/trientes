import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { readTop100 } from "@/lib/snapshot";
import { listSelfListedCards } from "@/lib/coin-card-directory";
import { PointForm, type PointFormInitial } from "@/components/business/point-form";
import { parseWeekHours } from "@/lib/opening-hours";
import { PointsList, type PointListItem } from "@/components/business/points-list";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { NOT_DELETED } from "@/lib/soft-delete";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Точки приёма предприятия (слайс BM). Прежде список и форма жили прямо на странице
 * предприятия, под профилем: страница тянула четыре выборки и карту MapLibre, хотя
 * человек пришёл посмотреть, что о нём написано.
 */
export default async function CompanyPointsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ card?: string; edit?: string }>;
}) {
  const { locale, id } = await params;
  const { card: cardParam, edit: editParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company, role, permissions, pointScope } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "points")) notFound();
  const canEditPoints = canEditSection(permissions, "points");

  const [points, coins, cards] = await Promise.all([
    prisma.companyPoint.findMany({
      // Участок сотрудника: пусто — все точки предприятия.
      where: {
        companyId: company.id,
        ...NOT_DELETED,
        ...(pointScope.length > 0 ? { id: { in: pointScope } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    readTop100(),
    // Все одобренные собственные листинги — их пока десятки, не сотни.
    listSelfListedCards(200),
  ]);
  const items: PointListItem[] = points.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    rejectReason: p.rejectReason,
  }));
  const coinOpts = coins.map((c) => ({ id: c.id, symbol: c.symbol, logoUrl: c.logoUrl }));
  const cardOpts = cards.map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl }));
  // Префилл приходит по ссылке с карточки монеты. Непонятный id молча
  // игнорируется — иначе кнопка «я принимаю» могла бы проставить что угодно.
  const prefillCards = cardParam && cardOpts.some((c) => c.id === cardParam) ? [cardParam] : [];

  // Правка существующей точки идёт той же формой: ?edit=<id> наполняет её
  // текущими значениями. Чужой или удалённый id молча игнорируется.
  const editingRow = editParam ? points.find((p) => p.id === editParam) : undefined;
  const editing: PointFormInitial | undefined = editingRow
    ? {
        id: editingRow.id,
        type: editingRow.type,
        name: editingRow.name,
        countryCode: editingRow.countryCode ?? "",
        city: editingRow.city ?? "",
        street: editingRow.street ?? "",
        houseNumber: editingRow.houseNumber ?? "",
        postalCode: editingRow.postalCode ?? "",
        lat: editingRow.lat,
        lon: editingRow.lon,
        acceptedCoinIds: editingRow.acceptedCoinIds,
        acceptedCardIds: editingRow.acceptedCardIds,
        photos: Array.isArray(editingRow.photos)
          ? (editingRow.photos as { url: string; label: string | null }[])
          : [],
        hours: parseWeekHours(editingRow.hours),
        timezone: editingRow.timezone ?? "",
        category: editingRow.category ?? "",
      }
    : undefined;

  const base = `/${locale}/cabinet/companies/${company.id}`;

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-8`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={`${base}/g/showcase`} className="text-[12px] text-muted underline">
          ← {t("groups.showcase")}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">{t("yourPoints")}</h1>
      </div>

      <section>
        <PointsList
          points={items}
          canDelete={canEditPoints}
          canDeleteOutright={role === "OWNER"}
          editHrefBase={canEditPoints ? `${base}/points` : undefined}
        />
      </section>

      {canEditPoints ? (
        <section id="add-point" className="scroll-mt-24">
          <h2 className="mb-4 text-[20px] font-bold tracking-[-0.02em]">
            {editing ? t("editPoint") : t("addPoint")}
          </h2>
          {editing ? (
            <p className="mb-3 text-[12px] text-muted">
              {t("editPointHint")}{" "}
              <a href={`${base}/points#add-point`} className="underline">
                {t("cancelEdit")}
              </a>
            </p>
          ) : null}
          <PointForm
            companyId={company.id}
            companyStatus={company.status}
            coins={coinOpts}
            cards={cardOpts}
            initialCardIds={prefillCards}
            editing={editing}
            companyHours={parseWeekHours(company.hours)}
            companyTimezone={company.timezone}
            companyAddress={{
              countryCode: company.countryCode ?? "",
              city: company.city ?? "",
              street: company.street ?? "",
              houseNumber: company.houseNumber ?? "",
              postalCode: company.postalCode ?? "",
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
