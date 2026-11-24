import type { CompanyRole } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { InviteMemberForm } from "@/components/business/invite-member-form";
import { MemberRow } from "@/components/business/member-row";
import { InviteLinks, type InviteListItem } from "@/components/business/invite-links";

export async function MembersSection({
  companyId,
  viewerId,
  canManage,
  canInvite = false,
  canSeeInvites = false,
  viewerRole,
  teamRoles = [],
  points = [],
}: {
  companyId: string;
  viewerId: string;
  canManage: boolean;
  /// Кадровик (слайс CH): выпускает и отзывает ссылки, состав команды не трогает.
  canInvite?: boolean;
  canSeeInvites?: boolean;
  viewerRole: CompanyRole | null;
  /// Свои роли предприятия (слайс BE) и точки, из которых собирается участок.
  teamRoles?: { id: string; name: string }[];
  points?: { id: string; name: string }[];
}) {
  const t = await getTranslations("business.members");
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
      points: { select: { pointId: true } },
    },
  });

  // Ссылки видит владелец и кадровик; остальным запрос не нужен вовсе.
  const invites: InviteListItem[] = canSeeInvites || canManage
    ? (
        await prisma.companyInvite.findMany({
          where: {
            companyId,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, token: true, role: true, expiresAt: true },
        })
      ).map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))
    : [];

  return (
    <section>
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">
        {canManage
          ? t("subtitleOwner")
          : canInvite
            ? t("subtitleHiring")
            : t("subtitleViewer", { role: viewerRole ? t(`role.${viewerRole}`) : "" })}
      </p>

      {canManage ? <InviteMemberForm companyId={companyId} /> : null}
      {canSeeInvites || canManage ? (
        <InviteLinks
          companyId={companyId}
          invites={invites}
          canEdit={canInvite || canManage}
          canInviteOwner={canManage}
        />
      ) : null}

      <ul className="space-y-2 mt-4">
        {members.map((m) => (
          <li key={m.id}>
            <MemberRow
              companyId={companyId}
              userId={m.user.id}
              isSelf={m.user.id === viewerId}
              displayLabel={
                [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
                m.user.username ||
                m.user.email ||
                m.user.id.slice(0, 6)
              }
              handle={m.user.username ?? m.user.email ?? null}
              role={m.role}
              canManage={canManage}
              teamRoles={teamRoles}
              teamRoleId={m.roleId}
              points={points}
              memberPointIds={m.points.map((p) => p.pointId)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
