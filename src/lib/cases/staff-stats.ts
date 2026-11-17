/**
 * Аналитика по сотрудникам: чистая арифметика над решёнными делами.
 *
 * Дело считается на того, кто его **вёл** (первая подпись, а без неё — взявший
 * в работу), а вторая подпись считается отдельным числом. Сложи их в одну
 * колонку — и утвердивший чужое дело за минуту выглядел бы как закрывший его.
 */

export type StaffCaseRow = {
  reviewedById: string | null;
  assigneeId: string | null;
  approvedById: string | null;
  decision: "APPROVED" | "REJECTED" | null;
  soleSignOff: boolean;
  handledSeconds: number;
  openedAt: Date;
  firstResponseAt: Date | null;
  decidedAt: Date | null;
  dueAt: Date;
};

export type StaffStat = {
  userId: string;
  decided: number;
  approved: number;
  rejected: number;
  /** Доля отказов среди решённых, 0..1. */
  rejectShare: number;
  handledSeconds: number;
  avgHandledSeconds: number;
  /** Среднее время до первого ответа заявителю; null — ни разу не писал. */
  avgFirstResponseSeconds: number | null;
  overdue: number;
  secondSignatures: number;
  soleSignOffs: number;
  /** Сколько раз просил присылать документ заново. */
  resubmits: number;
};

export function ownerOf(row: StaffCaseRow): string | null {
  return row.reviewedById ?? row.assigneeId ?? null;
}

type Acc = {
  decided: number;
  approved: number;
  rejected: number;
  handledSeconds: number;
  frSum: number;
  frCount: number;
  overdue: number;
  secondSignatures: number;
  soleSignOffs: number;
};

function blank(): Acc {
  return {
    decided: 0,
    approved: 0,
    rejected: 0,
    handledSeconds: 0,
    frSum: 0,
    frCount: 0,
    overdue: 0,
    secondSignatures: 0,
    soleSignOffs: 0,
  };
}

export function buildStaffStats(
  rows: StaffCaseRow[],
  resubmitsByUser: Map<string, number> = new Map(),
): { stats: StaffStat[]; unattributed: number } {
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    const existing = acc.get(id);
    if (existing) return existing;
    const fresh = blank();
    acc.set(id, fresh);
    return fresh;
  };

  let unattributed = 0;
  for (const row of rows) {
    const owner = ownerOf(row);
    if (!owner) {
      unattributed += 1;
    } else {
      const a = get(owner);
      a.decided += 1;
      if (row.decision === "APPROVED") a.approved += 1;
      if (row.decision === "REJECTED") a.rejected += 1;
      a.handledSeconds += Math.max(0, row.handledSeconds);
      if (row.firstResponseAt) {
        a.frSum += Math.max(0, Math.round((row.firstResponseAt.getTime() - row.openedAt.getTime()) / 1000));
        a.frCount += 1;
      }
      if (row.decidedAt && row.decidedAt.getTime() > row.dueAt.getTime()) a.overdue += 1;
      if (row.soleSignOff) a.soleSignOffs += 1;
    }
    // Вторая подпись: утвердил дело, которое вёл не он.
    if (row.approvedById && row.approvedById !== owner) get(row.approvedById).secondSignatures += 1;
  }

  // Сотрудник мог только просить документы заново и ничего не решить —
  // в таблице он всё равно должен быть виден.
  for (const userId of resubmitsByUser.keys()) get(userId);

  const stats: StaffStat[] = [...acc.entries()].map(([userId, a]) => ({
    userId,
    decided: a.decided,
    approved: a.approved,
    rejected: a.rejected,
    rejectShare: a.decided > 0 ? a.rejected / a.decided : 0,
    handledSeconds: a.handledSeconds,
    avgHandledSeconds: a.decided > 0 ? Math.round(a.handledSeconds / a.decided) : 0,
    avgFirstResponseSeconds: a.frCount > 0 ? Math.round(a.frSum / a.frCount) : null,
    overdue: a.overdue,
    secondSignatures: a.secondSignatures,
    soleSignOffs: a.soleSignOffs,
    resubmits: resubmitsByUser.get(userId) ?? 0,
  }));

  stats.sort((x, y) => y.decided - x.decided || y.secondSignatures - x.secondSignatures);
  return { stats, unattributed };
}
