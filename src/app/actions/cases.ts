"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { requireSubject } from "@/lib/authz/guard";
import { caseConflict } from "@/lib/authz/conflict";
import { appendCaseEvent } from "@/lib/cases/journal";
import { beatPatch, closePatch, IDLE_MS, isStale } from "@/lib/cases/time";

export async function claimCase(input: { caseId: string }) {
  // Сначала дело, потом право: по коду отказа не должно быть видно, какие дела
  // существуют.
  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false as const, reason: "not_found" as const };

  const admin = await requireSubject(c.subjectType, "HANDLE");
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const conflict = await caseConflict({
    caseId: c.id,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    applicantUserId: c.applicantUserId,
    userId: admin.userId,
  });
  if (conflict) return { ok: false as const, reason: conflict };

  if (c.assigneeId && c.assigneeId !== admin.userId) return { ok: false as const, reason: "taken" as const };

  await prisma.complianceCase.update({
    where: { id: c.id },
    data: { assigneeId: admin.userId, status: c.status === "NEW" ? "IN_REVIEW" : c.status },
  });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "CLAIMED" });
  if (c.status === "NEW") {
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: "NEW", to: "IN_REVIEW" },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Отпустить дело можно всегда: право отбирают, а брошенное дело не вредит. */
export async function releaseCase(input: { caseId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  if (c.assigneeId !== admin.userId) return { ok: false as const, reason: "not_yours" as const };

  await closeOpenEntries(c.id, admin.userId);
  await prisma.complianceCase.update({ where: { id: c.id }, data: { assigneeId: null } });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "RELEASED" });
  await recomputeHandled(c.id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Биение страницы дела. Открытый сеанс продлевается, протухший закрывается
 * задним числом последним биением — простой работой не считается.
 */
export async function caseHeartbeat(input: { caseId: string }) {
  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    select: { subjectType: true },
  });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  // Сеанс времени открывается только тому, кто дело ведёт: смотрящему
  // засчитывать труд не за что.
  const admin = await requireSubject(c.subjectType, "HANDLE");
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const now = new Date();

  const open = await prisma.caseTimeEntry.findFirst({
    where: { caseId: input.caseId, userId: admin.userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (open && !isStale({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }, now, IDLE_MS)) {
    const patch = beatPatch({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }, now);
    await prisma.caseTimeEntry.update({ where: { id: open.id }, data: patch });
    await recomputeHandled(input.caseId);
    return { ok: true as const, seconds: patch.seconds };
  }

  if (open) {
    await prisma.caseTimeEntry.update({
      where: { id: open.id },
      data: closePatch({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }),
    });
  }
  await prisma.caseTimeEntry.create({
    data: { caseId: input.caseId, userId: admin.userId, startedAt: now, lastBeatAt: now, seconds: 0 },
  });
  await recomputeHandled(input.caseId);
  return { ok: true as const, seconds: 0 };
}

export async function adjustCaseTime(input: { caseId: string; minutes: number; note: string }) {
  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    select: { id: true, subjectType: true, subjectId: true, applicantUserId: true },
  });
  if (!c) return { ok: false as const, reason: "not_found" as const };
  const admin = await requireSubject(c.subjectType, "HANDLE");
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const conflict = await caseConflict({
    caseId: c.id,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    applicantUserId: c.applicantUserId,
    userId: admin.userId,
  });
  if (conflict) return { ok: false as const, reason: conflict };
  const note = input.note.trim();
  // Тихая правка обессмыслила бы показатель: причина обязательна.
  if (note.length < 3) return { ok: false as const, reason: "note_too_short" as const };
  if (!Number.isFinite(input.minutes) || input.minutes === 0) {
    return { ok: false as const, reason: "bad_minutes" as const };
  }

  const now = new Date();
  await prisma.caseTimeEntry.create({
    data: {
      caseId: input.caseId,
      userId: admin.userId,
      startedAt: now,
      lastBeatAt: now,
      endedAt: now,
      seconds: Math.round(input.minutes * 60),
      source: "MANUAL",
      note,
    },
  });
  await appendCaseEvent({
    caseId: input.caseId,
    actorId: admin.userId,
    kind: "TIME_ADJUSTED",
    payload: { minutes: input.minutes, note },
  });
  await recomputeHandled(input.caseId);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

async function closeOpenEntries(caseId: string, userId: string) {
  const open = await prisma.caseTimeEntry.findMany({ where: { caseId, userId, endedAt: null } });
  for (const e of open) {
    await prisma.caseTimeEntry.update({
      where: { id: e.id },
      data: closePatch({ startedAt: e.startedAt, lastBeatAt: e.lastBeatAt }),
    });
  }
}

async function recomputeHandled(caseId: string) {
  const agg = await prisma.caseTimeEntry.aggregate({ where: { caseId }, _sum: { seconds: true } });
  await prisma.complianceCase.update({
    where: { id: caseId },
    data: { handledSeconds: agg._sum.seconds ?? 0 },
  });
}
