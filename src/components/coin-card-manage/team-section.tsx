import { getTranslations } from "next-intl/server";
import type { CoinCardRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CardMemberRow } from "./member-row";
import { CardInviteMemberForm } from "./invite-member-form";
import { CardInviteLinks, type CardInviteItem } from "./invite-links";

export async function CardTeamSection({
  cardId,
  viewerId,
  viewerRole,
  canManage,
}: {
  cardId: string;
  viewerId: string;
  viewerRole: CoinCardRole;
  canManage: boolean;
}) {
  const t = await getTranslations("coinCard.team");
  const isOwner = viewerRole === "OWNER";

  const members = await prisma.coinCardMember.findMany({
    where: { cardId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
    },
  });

  // Only managers see links, so skip the query entirely for everyone else.
  const invites: CardInviteItem[] = canManage
    ? (
        await prisma.coinCardInvite.findMany({
          where: { cardId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, token: true, role: true, isSigner: true, expiresAt: true },
        })
      ).map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))
    : [];

  return (
    <section id="members">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">
        {canManage ? t("subtitleManager") : t("subtitleViewer", { role: t(`role.${viewerRole}`) })}
      </p>

      {canManage ? <CardInviteMemberForm cardId={cardId} canAssignOwner={isOwner} /> : null}
      {canManage ? (
        <CardInviteLinks cardId={cardId} invites={invites} canAssignOwner={isOwner} />
      ) : null}

      <ul className="space-y-2 mt-4">
        {members.map((m) => (
          <li key={m.id}>
            <CardMemberRow
              cardId={cardId}
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
              sections={m.sections}
              isSigner={m.isSigner}
              canManage={canManage}
              canManageSigners={isOwner}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
