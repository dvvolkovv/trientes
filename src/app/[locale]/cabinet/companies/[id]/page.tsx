import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById } from "@/lib/business";
import { readTop100 } from "@/lib/snapshot";
import { CompanyProfileForm } from "@/components/business/company-profile-form";
import { PointForm } from "@/components/business/point-form";
import { PointsList, type PointListItem } from "@/components/business/points-list";

export const dynamic = "force-dynamic";

export default async function CompanyManagementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("business");
  const { userId, company } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const [points, coins] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    readTop100(),
  ]);
  const items: PointListItem[] = points.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    rejectReason: p.rejectReason,
  }));
  const coinOpts = coins.map((c) => ({ id: c.id, symbol: c.symbol }));

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <section>
        <h1 className="text-[36px] font-bold tracking-[-0.03em] mb-1">{company.displayName}</h1>
        <p className="text-muted mb-6">{t("profileIntro")}</p>
        <CompanyProfileForm
          companyId={company.id}
          initial={{
            legalName: company.legalName, displayName: company.displayName,
            description: company.description ?? "", website: company.website ?? "",
            logoUrl: company.logoUrl ?? "", address: company.address ?? "",
            phone: company.phone ?? "", email: company.email ?? "", country: company.country ?? "",
          }}
        />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("yourPoints")}</h2>
        <PointsList points={items} />
      </section>
      <section>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("addPoint")}</h2>
        <PointForm companyId={company.id} coins={coinOpts} />
      </section>
    </main>
  );
}
