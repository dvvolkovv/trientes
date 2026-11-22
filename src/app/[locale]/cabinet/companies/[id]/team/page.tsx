import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { MembersSection } from "@/components/business/members-section";
import { TeamRoles, type TeamRoleItem } from "@/components/business/team-roles";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/**
 * Команда мерчанта (ТЗ 6.6, слайс BE). Страницу видит владелец: право «выдавать права»
 * в конструкторе прав означало бы, что приглашённый повышает себя сам.
 */
export default async function CompanyTeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetTeam");
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canManageMembers(role)) notFound();

  const [roleRows, pointRows] = await Promise.all([
    prisma.companyTeamRole.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        permissions: true,
        _count: { select: { members: true } },
      },
    }),
    prisma.companyPoint.findMany({
      where: { companyId: company.id, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const roles: TeamRoleItem[] = roleRows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: (r.permissions ?? {}) as Record<string, string>,
    members: r._count.members,
  }));

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-10">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="text-xs text-muted mb-6">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h1>
        <p className="text-muted text-sm">{t("subtitle")}</p>
      </header>

      <MembersSection
        companyId={company.id}
        viewerId={userId}
        canManage
        viewerRole={role}
        teamRoles={roles.map((r) => ({ id: r.id, name: r.name }))}
        points={pointRows}
      />

      <TeamRoles companyId={company.id} roles={roles} />

      <p className="mt-10 text-sm">
        <Link href={`/${locale}/cabinet/companies/${company.id}/journal`} className="underline hover:text-accent">
          {t("journalLink")}
        </Link>
      </p>
    </main>
  );
}
