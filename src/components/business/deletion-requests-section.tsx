import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { DeletionVoteButtons } from "@/components/business/delete-buttons";
import { canVoteOnDeletion } from "@/lib/company-deletion";
import type { CompanyRole } from "@prisma/client";

/**
 * Висящие запросы на удаление. Раздел появляется только когда есть что
 * решать — пустой блок здесь ничего не сообщает.
 */
export async function DeletionRequestsSection({
  companyId,
  viewerId,
  viewerRole,
}: {
  companyId: string;
  viewerId: string;
  viewerRole: CompanyRole | null;
}) {
  const t = await getTranslations("business.delete");
  const requests = await prisma.companyDeletionRequest.findMany({
    where: { companyId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      requestedBy: { select: { username: true, name: true } },
      approvals: { select: { vote: true } },
    },
  });
  if (requests.length === 0) return null;

  // Названия точек подтягиваем одним запросом — в списке их единицы.
  const pointIds = requests.map((r) => r.pointId).filter((id): id is string => Boolean(id));
  const points = pointIds.length
    ? await prisma.companyPoint.findMany({
        where: { id: { in: pointIds } },
        select: { id: true, name: true },
      })
    : [];
  const pointName = new Map(points.map((p) => [p.id, p.name]));

  return (
    <section id="deletion-requests" className="space-y-3">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("requestsTitle")}</h2>
      <ul className="space-y-2">
        {requests.map((r) => {
          const approvals = r.approvals.filter((a) => a.vote === "APPROVE").length;
          const who = r.requestedBy.username ?? r.requestedBy.name ?? "—";
          const target = r.kind === "COMPANY" ? t("targetCompany") : (pointName.get(r.pointId ?? "") ?? t("targetPoint"));
          return (
            <li key={r.id} className="border border-hairline rounded-md p-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="font-medium">{target}</div>
                <div className="num text-[12px] text-muted">
                  {t("votes", { have: approvals, need: r.thresholdAt })}
                </div>
              </div>
              <div className="text-[12px] text-muted">
                {t("requestedBy", { who })} · {r.createdAt.toISOString().slice(0, 10)}
                {" · "}
                {t("expires", { date: r.expiresAt.toISOString().slice(0, 10) })}
              </div>
              {r.reason && <p className="text-[13px]">{r.reason}</p>}
              <DeletionVoteButtons
                requestId={r.id}
                canVote={canVoteOnDeletion({ role: viewerRole, userId: viewerId, requestedById: r.requestedById })}
                isRequester={r.requestedById === viewerId}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
