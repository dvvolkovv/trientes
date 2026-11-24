import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { getViewerCompanyById, canManageMembers, canEditSection, canSeeSection } from "@/lib/business";
import { MembersSection } from "@/components/business/members-section";
import { TeamRoles, type TeamRoleItem } from "@/components/business/team-roles";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

/**
 * Команда мерчанта (ТЗ 6.6, слайс BE). Состав команды, роли и участки правит только
 * владелец: право «выдавать права» означало бы, что приглашённый повышает себя сам.
 * Кадровик (раздел `hiring`, слайс CH) ту же страницу видит, но из действий у него
 * только ссылка-приглашение и её отзыв — звать людей это наём, а не раздача прав.
 */
export default async function CompanyTeamPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetTeam");
  const { userId, company, role, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  const isOwner = canManageMembers(role);
  const canInvite = canEditSection(permissions, "hiring");
  const canSeeInvites = canSeeSection(permissions, "hiring");
  if (!isOwner && !canSeeInvites) notFound();

  const [roleRows, pointRows] = isOwner ? await Promise.all([
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
  ]) : [[], []];
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
        canManage={isOwner}
        canInvite={canInvite}
        canSeeInvites={canSeeInvites}
        viewerRole={role}
        teamRoles={roles.map((r) => ({ id: r.id, name: r.name }))}
        points={pointRows}
      />

      {isOwner ? <TeamRoles companyId={company.id} roles={roles} /> : null}

      <p className="mt-10 text-sm">
        <Link href={`/${locale}/cabinet/companies/${company.id}/journal`} className="underline hover:text-accent">
          {t("journalLink")}
        </Link>
      </p>
    </main>
  );
}
