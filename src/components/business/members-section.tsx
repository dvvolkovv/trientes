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
  viewerRole,
}: {
  companyId: string;
  viewerId: string;
  canManage: boolean;
  viewerRole: CompanyRole | null;
}) {
  const t = await getTranslations("business.members");
  const members = await prisma.companyMember.findMany({
    where: { companyId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
    },
  });

  // Only owners manage links, so skip the query entirely for everyone else.
  const invites: InviteListItem[] = canManage
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
        {canManage ? t("subtitleOwner") : t("subtitleViewer", { role: viewerRole ? t(`role.${viewerRole}`) : "" })}
      </p>

      {canManage ? <InviteMemberForm companyId={companyId} /> : null}
      {canManage ? <InviteLinks companyId={companyId} invites={invites} /> : null}

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
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
