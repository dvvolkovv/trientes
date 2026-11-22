import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canEditSection, canManageMembers } from "@/lib/business";
import { CompanyProfileForm } from "@/components/business/company-profile-form";
import { CompanyCard } from "@/components/business/company-card";
import { DeletionRequestsSection } from "@/components/business/deletion-requests-section";
import { DeleteCompanyBlock } from "@/components/business/delete-buttons";
import { KybSection } from "@/components/business/kyb-section";
import { CabinetTile, TILE_GRID } from "@/components/cabinet/cabinet-tile";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { parseChanges } from "@/lib/company-edit";
import { visibleGroups, visibleTiles, GROUP_ICONS } from "@/lib/cabinet/company-nav";
import { NOT_DELETED, LIVE_POINT } from "@/lib/soft-delete";
import { CompanyDocsSection } from "@/components/business/company-docs-section";
import { PublicFieldsForm } from "@/components/business/public-fields-form";
import { parsePublicFields } from "@/lib/company-public-fields";
import { parseWeekHours } from "@/lib/opening-hours";
import { industry as industryOf } from "@/lib/industries";

export const dynamic = "force-dynamic";

/**
 * Страница предприятия в кабинете (слайс BM): карточка «только чтение» плюс три
 * плитки групп. Прежде здесь лежала всегда открытая форма из четырнадцати полей и
 * лента из восьми ссылок-пилюль — владелец назвал это «очень тяжёлым».
 *
 * Правка открывается по `?edit=1`, документы проверки — по `?kyb=1`: своих адресов
 * им не заводим, это состояния одной страницы, и возврат должен быть один.
 */
export default async function CompanyManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ edit?: string; kyb?: string }>;
}) {
  const { locale, id } = await params;
  const { edit: editParam, kyb: kybParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company, role, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  const editable = canEditSection(permissions, "card");
  const isOwner = canManageMembers(role);
  const base = `/${locale}/cabinet/companies/${company.id}`;

  const pending = await prisma.companyRevision.findFirst({
    where: { companyId: company.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const pendingChanges = pending ? parseChanges(pending.changes) : [];

  const editing = editParam === "1" && editable;
  const kybOpen = kybParam === "1" && isOwner;

  const officeHours = parseWeekHours(company.hours);

  const gate = { permissions, isOwner };
  const groups = visibleGroups(gate);
  const counts = groups.length > 0 ? await countsFor(company.id) : null;

  // Публичные документы и умолчание точного адреса (слайс BU). Умолчание зависит
  // от того, есть ли у предприятия физические точки: у онлайн-предприятия адрес
  // часто домашний.
  const [docs, physicalPoints] = editable
    ? await Promise.all([
        prisma.companyDocument.findMany({
          where: { companyId: company.id },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
        prisma.companyPoint.count({
          where: { companyId: company.id, type: { not: "ONLINE" }, status: "APPROVED", ...LIVE_POINT },
        }),
      ])
    : [[], 0];

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-8`}>
      {company.suspendedAt && (
        // Снятое предприятие не видно на витрине, и владелец должен узнать об
        // этом здесь, а не по пропавшим точкам.
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-1 text-xs uppercase tracking-wider text-red-400">{t("suspended.title")}</div>
          <div className="text-sm text-red-300">{company.suspendReason ?? t("suspended.noReason")}</div>
          <div className="mt-1 text-xs text-muted">{t("suspended.hint")}</div>
        </div>
      )}
      {company.status === "REJECTED" && company.rejectionReason && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-1 text-xs uppercase tracking-wider text-red-400">{t("rejectionReasonLabel")}</div>
          <div className="text-sm text-red-300">{company.rejectionReason}</div>
        </div>
      )}

      {editing ? (
        <section className="space-y-4">
          <h1 className="text-[24px] font-bold tracking-[-0.03em]">{t("editCard")}</h1>
          <CompanyProfileForm
            companyId={company.id}
            moderated={company.status === "APPROVED"}
            backHref={base}
            initialHours={officeHours}
            initialTimezone={company.timezone}
            initial={{
              legalName: company.legalName, displayName: company.displayName,
              description: company.description ?? "", website: company.website ?? "",
              logoUrl: company.logoUrl ?? "", address: company.address ?? "",
              phone: company.phone ?? "", email: company.email ?? "", country: company.country ?? "",
              countryCode: company.countryCode ?? "", city: company.city ?? "",
              street: company.street ?? "", houseNumber: company.houseNumber ?? "",
              postalCode: company.postalCode ?? "",
              category: company.category ?? "",
              returnPolicy: company.returnPolicy ?? "",
              returnDays: company.returnDays === null ? "" : String(company.returnDays),
              industry: company.industry ?? "",
              industryCustom: company.industryCustom ?? "",
              logoShape: company.logoShape ?? "",
              logoFit: company.logoFit ?? "",
            }}
          />
        </section>
      ) : (
        <>
          <CompanyCard
            locale={locale}
            editable={editable}
            isOwner={isOwner}
            pendingChanges={pendingChanges}
            editHref={`${base}?edit=1`}
            kybHref={`${base}?kyb=1`}
            company={{
              id: company.id,
              displayName: company.displayName,
              status: company.status,
              kybStatus: company.kybStatus,
              kybRejectionReason: company.kybRejectionReason,
              logoUrl: company.logoUrl,
              logoShape: company.logoShape,
              logoFit: company.logoFit,
              hours: officeHours,
              timezone: company.timezone,
              legalName: company.legalName,
              description: company.description,
              website: company.website,
              phone: company.phone,
              email: company.email,
              country: company.country,
              city: company.city,
              street: company.street,
              houseNumber: company.houseNumber,
              postalCode: company.postalCode,
              // Вид заведения — словами, а не ключом реестра: карточку читает человек.
              category: company.category ? t(`category.${company.category}`) : null,
              // Отрасль — словами, как и вид: ключ реестра читает код, а не человек.
              industry: industryOf(company.industry) ? t(`industryKind.${company.industry}`) : null,
              industryCustom: company.industryCustom,
              returnPolicy: company.returnPolicy,
              returnDays: company.returnDays === null ? null : String(company.returnDays),
            }}
          />

          {editable ? (
            <>
              <CompanyDocsSection
                companyId={company.id}
                canEdit={editable}
                docs={docs.map((d) => ({
                  id: d.id,
                  kind: d.kind,
                  title: d.title,
                  url: d.url,
                  published: d.publishedAt !== null,
                }))}
              />
              <PublicFieldsForm
                companyId={company.id}
                initial={parsePublicFields(company.publicFields, { hasPhysicalPoints: physicalPoints > 0 })}
              />
            </>
          ) : null}

          {kybOpen ? (
            <section className="space-y-3">
              <Link href={base} className="text-[12px] text-muted underline">
                ← {t("backToCard")}
              </Link>
              <KybSection
                companyId={company.id}
                status={company.kybStatus}
                documents={company.kybDocuments}
                rejectionReason={company.kybRejectionReason}
                canManage={isOwner}
              />
            </section>
          ) : null}

          {groups.length > 0 && counts ? (
            <section className="space-y-3">
              <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("groups.heading")}</h2>
              <div className={TILE_GRID}>
                {groups.map((group) => {
                  const tiles = visibleTiles(group, gate);
                  return (
                    <CabinetTile
                      key={group}
                      href={`${base}/g/${group}`}
                      icon={GROUP_ICONS[group]}
                      label={t(`groups.${group}`)}
                      value={null}
                      hint={tiles.map((tile) => t(`tiles.${tile.key}`)).join(" · ")}
                      badge={group === "showcase" && counts.pendingPoints > 0
                        ? t("tileBadge.moderation", { count: counts.pendingPoints })
                        : null}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          <DeletionRequestsSection companyId={company.id} viewerId={userId} viewerRole={role} />

          {isOwner ? (
            <DeleteCompanyBlock
              companyId={company.id}
              displayName={company.displayName}
              canDeleteOutright={role === "OWNER"}
            />
          ) : null}
        </>
      )}
    </main>
  );
}

async function countsFor(companyId: string) {
  const pendingPoints = await prisma.companyPoint.count({
    where: { companyId, status: "PENDING", ...NOT_DELETED },
  });
  return { pendingPoints };
}
