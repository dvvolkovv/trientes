import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/authz/guard";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { buildStaffStats, type StaffCaseRow } from "@/lib/cases/staff-stats";
import { formatHandled } from "@/lib/cases/time";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { QUEUES } from "@/lib/cases/queues";
import { STAFF_PRESETS, presetGrants } from "@/lib/staff/presets";
import { StaffAccessRow, type StaffRow } from "@/components/admin/staff-access";
import { StaffInviteForm } from "@/components/admin/staff-invite-form";
import type { MatrixValue } from "@/components/admin/staff-grant-matrix";

export const dynamic = "force-dynamic";

type Window = "30d" | "90d" | "all";

const WINDOW_DAYS: Record<Window, number | null> = { "30d": 30, "90d": 90, all: null };

function asWindow(raw: string | undefined): Window {
  return raw === "90d" || raw === "all" ? raw : "30d";
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export default async function AdminStaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const { locale } = await params;
  const { w } = await searchParams;
  setRequestLocale(locale);
  // Управление системой, а не работа по заявке: только владелец.
  const owner = await requireOwner();
  if (!owner.ok) redirect(`/${locale}/admin/queues`);
  const viewerId = owner.userId;
  const t = await getTranslations("admin");

  const win = asWindow(w);
  const days = WINDOW_DAYS[win];
  const since = days === null ? null : new Date(Date.now() - days * 86400000);
  const decidedFilter = since ? { gte: since } : { not: null };

  const [cases, resubmitRows] = await Promise.all([
    prisma.complianceCase.findMany({
      // Только настоящие решения. Дело, закрытое потому, что объект решили вне
      // дела, решением сотрудника не является и в его числа не идёт.
      where: { decidedAt: decidedFilter, decision: { not: null } },
      select: {
        reviewedById: true,
        assigneeId: true,
        approvedById: true,
        decision: true,
        soleSignOff: true,
        handledSeconds: true,
        openedAt: true,
        firstResponseAt: true,
        decidedAt: true,
        dueAt: true,
      },
    }),
    prisma.caseDocument.groupBy({
      by: ["verdictById"],
      where: { verdict: "RESUBMIT", verdictAt: decidedFilter },
      _count: { _all: true },
    }),
  ]);

  const resubmitsByUser = new Map<string, number>();
  for (const row of resubmitRows) {
    if (row.verdictById) resubmitsByUser.set(row.verdictById, row._count._all);
  }

  const { stats, unattributed } = buildStaffStats(cases as StaffCaseRow[], resubmitsByUser);

  const people = await prisma.user.findMany({
    where: { id: { in: stats.map((s) => s.userId) } },
    select: { id: true, name: true, username: true, email: true },
  });
  const nameById = new Map(
    people.map((p) => [p.id, p.name ?? p.username ?? p.email ?? p.id.slice(0, 6)]),
  );

  // Раздел доступа. Сотрудник есть в нём и без решённых дел: право выдано —
  // значит, строка должна быть видна, иначе отозвать её негде.
  const now = new Date();
  const [members, invites] = await Promise.all([
    prisma.staffMember.findMany({
      orderBy: [{ revokedAt: "asc" }, { startedAt: "asc" }],
      select: {
        userId: true,
        title: true,
        accessReviewAt: true,
        revokedAt: true,
        revokeReason: true,
        user: {
          select: {
            name: true,
            username: true,
            email: true,
            staffGrants: { select: { queue: true, level: true } },
            mfa: {
              select: {
                confirmedAt: true,
                disabledAt: true,
                recoveryCodes: { where: { usedAt: null }, select: { id: true } },
              },
            },
          },
        },
      },
      take: 200,
    }),
    prisma.staffInvite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, identifier: true, expiresAt: true },
    }),
  ]);

  const day = (d: Date) => d.toISOString().slice(0, 10);

  /**
   * Состояние второго фактора одной строкой: дату форматирует сервер, как и
   * срок пересмотра — браузер сотрудника в чужом часовом поясе показал бы
   * другой день.
   */
  const mfaLine = (
    mfa: { confirmedAt: Date | null; disabledAt: Date | null; recoveryCodes: { id: string }[] } | null,
  ): string => {
    if (!mfa || mfa.disabledAt) {
      return mfa?.disabledAt
        ? `${t("staff.mfa.off")} · ${t("staff.mfa.disabledOn", { date: day(mfa.disabledAt) })}`
        : t("staff.mfa.off");
    }
    if (!mfa.confirmedAt) return t("staff.mfa.off");
    return `${t("staff.mfa.on", { date: day(mfa.confirmedAt) })} · ${t("staff.mfa.codesLeft", { count: mfa.recoveryCodes.length })}`;
  };
  const emptyMatrix = Object.fromEntries(QUEUES.map((q) => [q.key, null])) as MatrixValue;

  const accessRows: StaffRow[] = members.map((m) => ({
    userId: m.userId,
    who: m.user.name ?? m.user.username ?? m.user.email ?? m.userId.slice(0, 6),
    title: m.title,
    levels: {
      ...emptyMatrix,
      ...Object.fromEntries(m.user.staffGrants.map((g) => [g.queue, g.level])),
    } as MatrixValue,
    reviewLine:
      !m.revokedAt && m.accessReviewAt.getTime() <= now.getTime()
        ? t("staff.access.reviewOverdue", { date: day(m.accessReviewAt) })
        : t("staff.access.reviewAt", { date: day(m.accessReviewAt) }),
    reviewOverdue: !m.revokedAt && m.accessReviewAt.getTime() <= now.getTime(),
    revokedLine: m.revokedAt ? t("staff.access.revoked", { date: day(m.revokedAt) }) : null,
    revokeReasonLine: m.revokeReason
      ? t("staff.access.revokedReason", { reason: m.revokeReason })
      : null,
    mfaLine: mfaLine(m.user.mfa),
    // Снять фактор может только владелец, и только у заведённого; себе — нельзя.
    mfaResettable: m.userId !== viewerId && Boolean(m.user.mfa?.confirmedAt),
  }));

  const errors: Record<string, string> = Object.fromEntries(
    [
      "unauth",
      "no_access",
      "not_found",
      "not_staff",
      "not_revoked",
      "self_grant",
      "owner_target",
      "reason_too_short",
      "empty",
      "unknown_queue",
      "unknown_level",
      "bad_date",
      "duplicate_queue",
      "too_many",
      "invalid",
      "self_target",
      "not_enrolled",
      "failed",
    ].map((key) => [key, t(`errors.${key}`)]),
  );

  const matrixLabels = {
    queues: Object.fromEntries(QUEUES.map((q) => [q.key, t(`queues.names.${q.key}`)])),
    levels: {
      VIEW: t("staff.access.levels.VIEW"),
      HANDLE: t("staff.access.levels.HANDLE"),
      APPROVE: t("staff.access.levels.APPROVE"),
    },
    noneLevel: t("staff.access.levels.none"),
    presetsLabel: t("staff.access.presets.label"),
    presets: {
      readOnly: t("staff.access.presets.readOnly"),
      reviewer: t("staff.access.presets.reviewer"),
      senior: t("staff.access.presets.senior"),
      kybOfficer: t("staff.access.presets.kybOfficer"),
    },
    presetsHint: t("staff.access.presets.hint"),
  };

  const accessLabels = {
    noTitle: t("staff.access.noTitle"),
    queues: t("staff.access.queues"),
    none: t("staff.access.none"),
    save: t("staff.access.save"),
    saved: t("staff.access.saved"),
    revoke: t("staff.access.revoke"),
    revokePlaceholder: t("staff.access.revokePlaceholder"),
    restore: t("staff.access.restore"),
    passReview: t("staff.access.passReview"),
    edit: t("staff.access.edit"),
    cancel: t("staff.access.cancel"),
    matrix: matrixLabels,
    errors,
    mfa: {
      heading: t("staff.mfa.heading"),
      reasonLabel: t("staff.mfa.reasonLabel"),
      disable: t("staff.mfa.disable"),
      hint: t("staff.mfa.hint"),
    },
  };

  const inviteLabels = {
    titleField: t("staff.invite.titleField"),
    titlePlaceholder: t("staff.invite.titlePlaceholder"),
    dutiesField: t("staff.invite.dutiesField"),
    dutiesPlaceholder: t("staff.invite.dutiesPlaceholder"),
    expiresField: t("staff.invite.expiresField"),
    expiresHint: t("staff.invite.expiresHint"),
    byLink: t("staff.invite.byLink"),
    byIdentifier: t("staff.invite.byIdentifier"),
    identifierField: t("staff.invite.identifierField"),
    identifierHint: t("staff.invite.identifierHint"),
    create: t("staff.invite.create"),
    grant: t("staff.invite.grant"),
    granted: t("staff.invite.granted"),
    linkOnce: t("staff.invite.linkOnce"),
    copy: t("staff.invite.copy"),
    copied: t("staff.invite.copied"),
    expiresIn: t("staff.invite.expiresIn"),
    activeTitle: t("staff.invite.activeTitle"),
    activeEmpty: t("staff.invite.activeEmpty"),
    revokeInvite: t("staff.invite.revokeInvite"),
    matrix: matrixLabels,
    errors,
  };

  const presets = STAFF_PRESETS.map((p) => ({
    key: p.key,
    levels: presetGrants(p.key) as MatrixValue,
  }));

  const handledUnits = { h: t("case.handledUnits.h"), m: t("case.handledUnits.m") };

  const cols = (s: (typeof stats)[number]) => [
    { label: t("staff.cols.decided"), value: String(s.decided) },
    { label: t("staff.cols.approved"), value: String(s.approved) },
    { label: t("staff.cols.rejected"), value: String(s.rejected) },
    { label: t("staff.cols.rejectShare"), value: s.decided > 0 ? pct(s.rejectShare) : "—" },
    { label: t("staff.cols.avgHandled"), value: s.decided > 0 ? formatHandled(s.avgHandledSeconds, handledUnits) : "—" },
    {
      label: t("staff.cols.avgFirstResponse"),
      value: s.avgFirstResponseSeconds === null ? "—" : formatHandled(s.avgFirstResponseSeconds, handledUnits),
    },
    { label: t("staff.cols.overdue"), value: String(s.overdue) },
    { label: t("staff.cols.secondSignatures"), value: String(s.secondSignatures) },
    { label: t("staff.cols.soleSignOffs"), value: String(s.soleSignOffs) },
    { label: t("staff.cols.resubmits"), value: String(s.resubmits) },
  ];

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="staff" />
      <header className="mb-6 text-center">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">
          {t("tabs.staff")}
        </div>
        <h1 className="mb-1 text-[32px] font-bold tracking-[-0.03em]">{t("staff.title")}</h1>
        <p className="text-sm text-muted">
          {t("staff.subtitle", { window: t(`staff.windows.${win}`) })}
        </p>
      </header>

      <div className="mb-5 flex justify-center gap-2">
        {(["30d", "90d", "all"] as const).map((key) => (
          <Link
            key={key}
            href={key === "30d" ? "?" : `?w=${key}`}
            className={
              win === key
                ? "rounded-full bg-foreground px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-bg"
                : "rounded-full border border-hairline bg-card px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"
            }
          >
            {t(`staff.windows.${key}`)}
          </Link>
        ))}
      </div>

      {stats.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("staff.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {stats.map((s) => (
            <div key={s.userId} className="rounded-[20px] border border-hairline bg-card p-4">
              <b className="mb-3 block text-[15px] font-semibold">{nameById.get(s.userId)}</b>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 md:grid-cols-5">
                {cols(s).map((col) => (
                  <div key={col.label}>
                    <div className="text-[9.5px] uppercase tracking-[0.15em] text-muted">
                      {col.label}
                    </div>
                    <div className="text-[14px] font-semibold">{col.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] leading-snug text-muted">{t("staff.hint")}</p>
      {unattributed > 0 ? (
        <p className="mt-1.5 text-center text-[11px] leading-snug text-muted">
          {t("staff.unattributed", { count: unattributed })}
        </p>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-1 text-[22px] font-bold tracking-[-0.02em]">
          {t("staff.access.title")}
        </h2>
        <p className="mb-4 text-[13px] leading-snug text-muted">{t("staff.access.subtitle")}</p>

        {accessRows.length === 0 ? (
          <div className="rounded-[20px] border border-hairline bg-card p-6 text-center text-muted">
            {t("staff.access.empty")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {accessRows.map((row) => (
              <StaffAccessRow key={row.userId} row={row} labels={accessLabels} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 mb-10">
        <h2 className="mb-1 text-[22px] font-bold tracking-[-0.02em]">
          {t("staff.invite.title")}
        </h2>
        <p className="mb-4 text-[13px] leading-snug text-muted">{t("staff.invite.subtitle")}</p>
        <StaffInviteForm
          presets={presets}
          empty={emptyMatrix}
          invites={invites.map((inv) => ({
            id: inv.id,
            line: inv.identifier
              ? `${day(inv.expiresAt)} · ${t("staff.invite.forWhom", { identifier: inv.identifier })}`
              : day(inv.expiresAt),
          }))}
          labels={inviteLabels}
          inviteOrigin={process.env.PUBLIC_ORIGIN ?? "https://trientes.org"}
          locale={locale}
        />
      </section>
    </div>
  );
}
