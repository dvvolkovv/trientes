import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canEditCompany, canManageMembers } from "@/lib/business";
import { readTop100 } from "@/lib/snapshot";
import { listSelfListedCards } from "@/lib/coin-card-directory";
import { CompanyProfileForm } from "@/components/business/company-profile-form";
import { PointForm } from "@/components/business/point-form";
import { PointsList, type PointListItem } from "@/components/business/points-list";
import { MembersSection } from "@/components/business/members-section";
import { KybSection } from "@/components/business/kyb-section";

export const dynamic = "force-dynamic";

export default async function CompanyManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { locale, id } = await params;
  const { card: cardParam } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  const editable = canEditCompany(role);
  const canManage = canManageMembers(role);

  const [points, coins, cards] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { companyId: company.id },
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
  const cardOpts = cards.map((c) => ({
    id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl,
  }));
  // Префилл приходит по ссылке с карточки монеты. Непонятный id молча
  // игнорируется — иначе кнопка «я принимаю» могла бы проставить что угодно.
  const prefillCards = cardParam && cardOpts.some((c) => c.id === cardParam) ? [cardParam] : [];

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <section>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-[36px] font-bold tracking-[-0.03em]">{company.displayName}</h1>
          <span className={`text-xs px-2 py-1 rounded ${
            company.status === "APPROVED" ? "bg-green-500/15 text-green-500" :
            company.status === "REJECTED" ? "bg-red-500/15 text-red-500" :
            "bg-yellow-500/15 text-yellow-500"
          }`}>
            {t(`statusBadge.${company.status}`)}
          </span>
          {company.status === "APPROVED" ? (
            <a
              href={`/${locale}/companies/${company.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] underline text-muted hover:text-foreground"
            >
              {t("viewPublic")} ↗
            </a>
          ) : null}
        </div>
        <p className="text-muted mb-6">{t("profileIntro")}</p>
        {company.status === "REJECTED" && company.rejectionReason && (
          <div className="mb-6 p-4 rounded-md border border-red-500/30 bg-red-500/10">
            <div className="text-xs uppercase tracking-wider text-red-400 mb-1">{t("rejectionReasonLabel")}</div>
            <div className="text-sm text-red-300">{company.rejectionReason}</div>
          </div>
        )}
        <CompanyProfileForm
          companyId={company.id}
          initial={{
            legalName: company.legalName, displayName: company.displayName,
            description: company.description ?? "", website: company.website ?? "",
            logoUrl: company.logoUrl ?? "", address: company.address ?? "",
            phone: company.phone ?? "", email: company.email ?? "", country: company.country ?? "",
            countryCode: company.countryCode ?? "", city: company.city ?? "",
            street: company.street ?? "", houseNumber: company.houseNumber ?? "",
            postalCode: company.postalCode ?? "",
          }}
        />
      </section>
      <section id="your-points" className="scroll-mt-24">
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("yourPoints")}</h2>
        <PointsList points={items} />
      </section>
      {editable ? (
        <section id="add-point" className="scroll-mt-24">
          <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("addPoint")}</h2>
          <PointForm
            companyId={company.id}
            coins={coinOpts}
            cards={cardOpts}
            initialCardIds={prefillCards}
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

      <MembersSection companyId={company.id} viewerId={userId} canManage={canManage} viewerRole={role} />

      <KybSection
        companyId={company.id}
        status={company.kybStatus}
        documents={company.kybDocuments}
        rejectionReason={company.kybRejectionReason}
        canManage={canManage}
      />
    </main>
  );
}
