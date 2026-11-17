import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { loadViewerAccess } from "@/lib/authz/guard";
import { visibleQueues } from "@/lib/authz/policy";
import { AdminNav } from "@/components/admin/nav";
import { QueueTileCard } from "@/components/admin/queue-tile";
import { buildTiles, queueOfSubject, type CaseRow } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { OPEN_STATUSES } from "@/lib/cases/types";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

export default async function AdminQueuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const now = new Date();

  const rows = (await prisma.complianceCase.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: {
      id: true,
      subjectType: true,
      status: true,
      openedAt: true,
      dueAt: true,
      slaSeconds: true,
      clockStoppedAt: true,
    },
  })) as CaseRow[];

  const unreadRows = await prisma.caseMessage.groupBy({
    by: ["caseId"],
    where: { caseId: { in: rows.map((r) => r.id) }, side: "APPLICANT", readByStaffAt: null },
    _count: { _all: true },
  });
  const unreadByCase = new Map(unreadRows.map((r) => [r.caseId, r._count._all]));

  // Плитки — только выданные очереди: число непрочитанного по чужой очереди
  // выдавало бы её содержимое.
  const access = await loadViewerAccess();
  const allowed = new Set(access ? visibleQueues(access, now) : []);
  const tiles = buildTiles(rows, now, unreadByCase).filter((tile) => allowed.has(tile.key));
  const totalOpen = tiles.reduce((sum, x) => sum + x.open, 0);

  // Худший остаток по очереди — для подписи под точкой срока.
  const worstLeft = new Map<string, number>();
  for (const tile of tiles) {
    const mine = rows.filter((r) => queueOfSubject(r.subjectType)?.key === tile.key);
    let min = Number.POSITIVE_INFINITY;
    for (const r of mine) {
      const { remainingSeconds } = slaState({
        now,
        dueAt: r.dueAt,
        slaSeconds: r.slaSeconds,
        clockStoppedAt: r.clockStoppedAt,
      });
      min = Math.min(min, remainingSeconds);
    }
    if (Number.isFinite(min)) worstLeft.set(tile.key, min);
  }

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      <header className="mb-6 text-center">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">
          {t("tabs.queues")}
        </div>
        <h1 className="mb-1 text-[32px] font-bold tracking-[-0.03em]">{t("queues.title")}</h1>
        <p className="text-sm text-muted">{t("queues.subtitle", { count: totalOpen })}</p>
      </header>

      {tiles.length === 0 ? (
        <p className="text-center text-sm text-muted">{t("errors.no_access")}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const left = worstLeft.get(tile.key);
          const d = Math.floor((left ?? 0) / 86400);
          const h = Math.floor(((left ?? 0) % 86400) / 3600);
          return (
            <QueueTileCard
              key={tile.key}
              tile={tile}
              label={t(`queues.names.${tile.key}`)}
              href={`/${locale}/admin/queues/${tile.key}`}
              ageLabel={
                tile.oldestOpenedAt
                  ? t("queues.oldest", { days: daysBetween(tile.oldestOpenedAt, now) })
                  : null
              }
              slaLabel={
                tile.worst === "late"
                  ? t("queues.late")
                  : tile.worst === "paused"
                    ? t("queues.paused")
                    : left !== undefined
                      ? t("queues.left", { d, h })
                      : null
              }
              emptyLabel={t("queues.empty")}
              unreadLabel={tile.unread > 0 ? t("queues.unread", { count: tile.unread }) : null}
            />
          );
        })}
      </div>
    </div>
  );
}
