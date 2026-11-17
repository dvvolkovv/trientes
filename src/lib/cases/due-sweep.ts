import type { PrismaClient } from "@prisma/client";
import { raiseAndNotify } from "./admin-notify";
import { alreadyRaised, dueNotificationFor, raisedKey } from "./notifications";
import { OPEN_STATUSES } from "./types";

export type DueSweepStats = { checked: number; raised: number; skipped: number };

/**
 * Часовой прогон сроков. Он нужен потому, что часы срока — не событие: никто
 * не «нажимает» просрочку, её надо заметить самому.
 *
 * Дела без взявшего пропускаются (см. dueNotificationFor): безадресный звонок
 * будил бы всех админов по каждому делу.
 */
export async function runCaseDueSweep(
  db: Pick<PrismaClient, "complianceCase" | "caseMessage" | "adminNotification">,
  now: Date = new Date(),
): Promise<DueSweepStats> {
  const cases = await db.complianceCase.findMany({
    where: { status: { in: OPEN_STATUSES }, assigneeId: { not: null } },
    select: { id: true, title: true, status: true, assigneeId: true, dueAt: true, clockStoppedAt: true },
    take: 500,
  });
  if (cases.length === 0) return { checked: 0, raised: 0, skipped: 0 };

  const ids = cases.map((c) => c.id);

  // Последнее наше сообщение по делу — отсчёт молчания заявителя.
  const lastStaff = new Map<string, Date>();
  const msgs = await db.caseMessage.findMany({
    where: { caseId: { in: ids }, side: "STAFF" },
    select: { caseId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const m of msgs) lastStaff.set(m.caseId, m.createdAt);

  const raisedRows = await db.adminNotification.findMany({
    where: { caseId: { in: ids } },
    select: { userId: true, kind: true, caseId: true },
  });
  const seen = new Set(raisedRows.map((r) => raisedKey(r.userId, r.kind, r.caseId ?? "")));

  let raised = 0;
  let skipped = 0;
  for (const c of cases) {
    const kind = dueNotificationFor(
      {
        status: c.status,
        assigneeId: c.assigneeId,
        dueAt: c.dueAt,
        clockStoppedAt: c.clockStoppedAt,
        lastStaffMessageAt: lastStaff.get(c.id) ?? null,
      },
      now,
    );
    if (!kind || !c.assigneeId) continue;
    if (alreadyRaised(seen, c.assigneeId, kind, c.id)) {
      skipped += 1;
      continue;
    }
    await raiseAndNotify({ userId: c.assigneeId, kind, caseId: c.id, title: c.title });
    seen.add(raisedKey(c.assigneeId, kind, c.id));
    raised += 1;
  }

  return { checked: cases.length, raised, skipped };
}
