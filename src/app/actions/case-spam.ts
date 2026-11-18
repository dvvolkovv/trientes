"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireQueue } from "@/lib/authz/guard";
import { queueByKey } from "@/lib/cases/queues";
import { appendCaseEvent } from "@/lib/cases/journal";
import { applyDecision, isAlreadySettled } from "@/lib/cases/decide";
import { isSpamClosable, spamBlockers, SPAM_BATCH_MAX } from "@/lib/cases/spam";
import { isOpen } from "@/lib/cases/types";
import { logAdminAction } from "@/lib/admin/audit";

/**
 * Закрыть выбранные дела очереди как спам.
 *
 * Что происходит с каждым делом: объект отвергается тем же экшеном, которым его
 * отверг бы человек (одна реализация решения), но молча; дело закрывается как
 * `CLOSED` **без решения** — спам не работа комплайнса, и в аналитике труда он
 * не должен выглядеть пачкой решений сотрудника. Лист проверок и вторая подпись
 * не требуются: нечего проверять и нечего утверждать.
 */
export async function closeCasesAsSpam(input: { queue: string; caseIds: string[]; reason: string }) {
  const def = queueByKey(input.queue);
  if (!def) return { ok: false as const, reason: "not_found" as const };
  const admin = await requireQueue(def.key, "APPROVE");
  if (!admin.ok) return { ok: false as const, reason: admin.reason };

  const ids = Array.from(new Set(input.caseIds)).slice(0, SPAM_BATCH_MAX + 1);
  const reason = input.reason.trim();

  const cases = await prisma.complianceCase.findMany({
    where: { id: { in: ids }, subjectType: { in: def.subjectTypes } },
    select: { id: true, subjectType: true, subjectId: true, status: true, title: true },
  });
  if (cases.length !== ids.length) return { ok: false as const, reason: "not_found" as const };

  const bad = spamBlockers({
    caseIds: ids,
    reason,
    subjectTypes: cases.map((c) => c.subjectType),
  });
  if (bad.length > 0) return { ok: false as const, reason: bad[0] };

  const now = new Date();
  let closed = 0;
  const failed: string[] = [];

  for (const c of cases) {
    if (!isOpen(c.status)) continue;
    const applied = await applyDecision({
      subjectType: c.subjectType,
      subjectId: c.subjectId,
      decision: "REJECTED",
      reason,
      silent: true,
    });
    // Объект уже решён вне дела или исчез — дело всё равно должно уйти из
    // очереди: именно это и чинится здесь.
    if (!applied.ok && !isAlreadySettled(applied.reason)) {
      failed.push(c.id);
      continue;
    }
    await prisma.complianceCase.update({
      where: { id: c.id },
      data: { status: "CLOSED", decidedAt: now, clockStoppedAt: null, assigneeId: null },
    });
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "CLOSED_AS_SPAM",
      payload: { reason, ...(applied.ok ? {} : { why: applied.reason }) },
    });
    closed += 1;
  }

  // Строка на всю пачку: массовое действие должно быть видно одной записью, а
  // не только тридцатью одной строкой отказов по объектам.
  if (closed > 0) {
    await logAdminAction({
      actorId: admin.userId,
      action: "CLOSE_CASES_AS_SPAM",
      targetType: "ComplianceCase",
      targetId: def.key,
      details: { queue: def.key, closed, reason, caseIds: cases.map((c) => c.id) },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true as const, closed, failed: failed.length };
}

/** Можно ли в этой очереди закрывать спам (страница не рисует лишних кнопок). */
export async function queueAllowsSpam(queue: string): Promise<boolean> {
  const def = queueByKey(queue);
  return !!def && def.subjectTypes.every(isSpamClosable);
}
