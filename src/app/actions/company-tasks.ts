"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { logCompanyAction } from "@/lib/company-team/journal";
import { notifyTaskEvent } from "@/lib/company-tasks/notify";
import {
  MAX_COMMENTS,
  REASON_CHARS,
  canTransition,
  dueFromDate,
  isClosed,
  isTaskPriority,
  isTaskStatus,
  taskRightsFor,
  validateComment,
  validateTask,
  type TaskStatus,
} from "@/lib/company-tasks/rules";

type Fail = { ok: false; reason: string };
const fail = (reason: string): Fail => ({ ok: false, reason });

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

function touch(companyId: string, taskId?: string) {
  revalidatePath(`/[locale]/cabinet/companies/${companyId}/tasks`, "page");
  if (taskId) revalidatePath(`/[locale]/cabinet/companies/${companyId}/tasks/${taskId}`, "page");
}

export type TaskFormInput = {
  title: string;
  details: string | null;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  pointId: string | null;
  productId: string | null;
  warehouseId: string | null;
};

/**
 * Проверка привязок: каждая должна принадлежать этому предприятию, а точка — лежать в
 * участке постановщика. Иначе задача указывала бы на чужую полку.
 */
async function checkTargets(
  companyId: string,
  scope: readonly string[],
  input: { pointId: string | null; productId: string | null; warehouseId: string | null },
): Promise<string | null> {
  if (input.pointId) {
    if (!pointScopeAllows(scope, input.pointId)) return "point_forbidden";
    const point = await prisma.companyPoint.count({ where: { id: input.pointId, companyId, deletedAt: null } });
    if (point === 0) return "point_unknown";
  }
  if (input.warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: input.warehouseId, companyId },
      select: { pointId: true },
    });
    if (!warehouse) return "warehouse_unknown";
    if (!pointScopeAllows(scope, warehouse.pointId)) return "warehouse_forbidden";
  }
  if (input.productId) {
    const product = await prisma.product.count({ where: { id: input.productId, deletedAt: null } });
    if (product === 0) return "product_unknown";
  }
  return null;
}

/**
 * Назначение за пределы участка отвергается вслух: задача с привязкой к точке,
 * назначенная тому, кто этой точки не видит, была бы задачей-невидимкой (§ 2.4).
 */
async function checkAssignee(
  companyId: string,
  assigneeId: string,
  pointId: string | null,
): Promise<string | null> {
  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId: assigneeId } },
    select: { points: { select: { pointId: true } } },
  });
  if (!member) return "assignee_unknown";
  const scope = member.points.map((p) => p.pointId);
  if (pointId && !pointScopeAllows(scope, pointId)) return "assignee_out_of_scope";
  return null;
}

export async function createTask(companyId: string, input: TaskFormInput) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  const rights = taskRightsFor(gate);
  if (!rights.manage) return fail("forbidden");
  if (!isTaskPriority(input.priority)) return fail("priority_invalid");

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [openCount, todayCount] = await Promise.all([
    prisma.companyTask.count({ where: { companyId, status: { notIn: ["DONE", "CANCELLED"] } } }),
    prisma.companyTask.count({ where: { companyId, createdAt: { gte: startOfDay } } }),
  ]);
  const v = validateTask(
    { title: input.title, details: input.details, dueDate: input.dueDate },
    { openCount, todayCount, now: new Date() },
  );
  if (!v.ok) return fail(v.reason);

  const bad = await checkTargets(companyId, gate!.pointScope, input);
  if (bad) return fail(bad);
  if (input.assigneeId) {
    const assigneeBad = await checkAssignee(companyId, input.assigneeId, input.pointId);
    if (assigneeBad) return fail(assigneeBad);
  }

  const task = await prisma.companyTask.create({
    data: {
      companyId,
      title: input.title.trim(),
      details: input.details?.trim() || null,
      priority: input.priority,
      dueAt: dueFromDate(input.dueDate),
      createdById: userId,
      assigneeId: input.assigneeId || null,
      assignedAt: input.assigneeId ? new Date() : null,
      pointId: input.pointId || null,
      productId: input.productId || null,
      warehouseId: input.warehouseId || null,
    },
    select: { id: true, title: true },
  });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "TASK_CREATED",
    subject: task.title,
    meta: { assigneeId: input.assigneeId ?? null, priority: input.priority },
  });
  if (input.assigneeId && input.assigneeId !== userId) {
    await notifyTaskEvent({
      kind: "assigned",
      userIds: [input.assigneeId],
      companyId,
      companyName: gate!.displayName,
      taskId: task.id,
      taskTitle: task.title,
    });
  }
  touch(companyId);
  return { ok: true as const, id: task.id };
}

/** Переназначение и правка срока с приоритетом — дело того, кто ставит задачи. */
export async function updateTask(
  companyId: string,
  taskId: string,
  input: { assigneeId?: string | null; priority?: string; dueDate?: string | null },
) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  const rights = taskRightsFor(gate);
  if (!rights.manage) return fail("forbidden");

  const task = await prisma.companyTask.findFirst({
    where: { id: taskId, companyId },
    select: { id: true, title: true, status: true, assigneeId: true, pointId: true },
  });
  if (!task) return fail("not_found");
  if (isClosed(task.status)) return fail("task_closed");

  const data: Record<string, unknown> = {};
  if (input.priority !== undefined) {
    if (!isTaskPriority(input.priority)) return fail("priority_invalid");
    data.priority = input.priority;
  }
  if (input.dueDate !== undefined) {
    const raw = (input.dueDate ?? "").trim();
    if (raw) {
      const due = dueFromDate(raw);
      if (!due) return fail("due_invalid");
      data.dueAt = due;
    } else {
      data.dueAt = null;
    }
  }
  let notifyAssignee: string | null = null;
  if (input.assigneeId !== undefined) {
    const next = input.assigneeId || null;
    if (next) {
      const bad = await checkAssignee(companyId, next, task.pointId);
      if (bad) return fail(bad);
    }
    data.assigneeId = next;
    data.assignedAt = next ? new Date() : null;
    if (next && next !== task.assigneeId && next !== userId) notifyAssignee = next;
  }
  if (Object.keys(data).length === 0) return fail("nothing_to_save");

  await prisma.companyTask.update({ where: { id: taskId }, data });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "TASK_UPDATED",
    subject: task.title,
    meta: data as Record<string, unknown>,
  });
  if (notifyAssignee) {
    await notifyTaskEvent({
      kind: "assigned",
      userIds: [notifyAssignee],
      companyId,
      companyName: gate!.displayName,
      taskId,
      taskTitle: task.title,
    });
  }
  touch(companyId, taskId);
  return { ok: true as const };
}

/**
 * Переход статуса. Правило — чистая `canTransition`; здесь только то, что нужно базе:
 * кто взял, кто сдал, кто закрыл и когда. Условие по прежнему статусу стоит в `where`,
 * поэтому два одновременных нажатия не закроют задачу дважды.
 */
export async function moveTask(
  companyId: string,
  taskId: string,
  to: string,
  reason?: string | null,
) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  const rights = taskRightsFor(gate);
  if (!rights.seeOwn || !rights.active) return fail("forbidden");
  if (!isTaskStatus(to)) return fail("status_invalid");

  const task = await prisma.companyTask.findFirst({
    where: { id: taskId, companyId },
    select: {
      id: true,
      title: true,
      status: true,
      createdById: true,
      assigneeId: true,
      takenById: true,
      submittedById: true,
      pointId: true,
    },
  });
  if (!task) return fail("not_found");
  // Чужую задачу вне участка нельзя даже взять: её человек и не видит.
  if (task.assigneeId !== userId && !rights.seeAll) return fail("forbidden");
  if (!pointScopeAllows(gate!.pointScope, task.pointId) && task.assigneeId !== userId) {
    if (task.pointId) return fail("forbidden");
  }

  const verdict = canTransition(
    {
      status: task.status,
      createdById: task.createdById,
      assigneeId: task.assigneeId,
      takenById: task.takenById,
      submittedById: task.submittedById,
    },
    to as TaskStatus,
    { userId, manage: rights.manage },
  );
  if (!verdict.ok) return fail(verdict.reason);

  const trimmed = (reason ?? "").trim();
  if (to === "CANCELLED" && trimmed.length < REASON_CHARS) return fail("reason_required");

  const now = new Date();
  const data: Record<string, unknown> = { status: to };
  if (to === "IN_PROGRESS" && task.status === "NEW") {
    data.takenById = userId;
    data.takenAt = now;
    // Задача без исполнителя: взявший им и становится, а пустой `assignedAt` остаётся
    // следом того, что лично её никто не поручал.
    if (!task.assigneeId) data.assigneeId = userId;
  }
  if (to === "IN_PROGRESS" && task.status === "ON_REVIEW") {
    data.submittedById = null;
    data.submittedAt = null;
  }
  if (to === "ON_REVIEW") {
    data.submittedById = userId;
    data.submittedAt = now;
  }
  if (to === "DONE" || to === "CANCELLED") {
    data.closedById = userId;
    data.closedAt = now;
    if (to === "CANCELLED") data.cancelReason = trimmed.slice(0, 500);
  }

  const updated = await prisma.companyTask.updateMany({
    where: { id: taskId, companyId, status: task.status },
    data,
  });
  if (updated.count === 0) return fail("status_changed");

  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: to === "CANCELLED" ? "TASK_CANCELLED" : "TASK_STATUS_SET",
    subject: task.title,
    meta: { from: task.status, to, ...(to === "CANCELLED" ? { reason: trimmed.slice(0, 200) } : {}) },
  });

  const kind =
    to === "ON_REVIEW" ? "submitted" :
    to === "DONE" ? "accepted" :
    to === "CANCELLED" ? "cancelled" :
    task.status === "ON_REVIEW" ? "returned" : null;
  if (kind) {
    // Сдачу читает постановщик, приём и возврат — исполнитель; автору действия не пишем.
    const audience = kind === "submitted"
      ? [task.createdById]
      : [task.assigneeId, task.takenById];
    await notifyTaskEvent({
      kind,
      userIds: audience.filter((id): id is string => !!id && id !== userId),
      companyId,
      companyName: gate!.displayName,
      taskId,
      taskTitle: task.title,
      extra: to === "CANCELLED" ? trimmed : null,
    });
  }
  touch(companyId, taskId);
  return { ok: true as const };
}

/** Реплика в обсуждении задачи. Писать вправе тот, кто задачу видит. */
export async function commentTask(companyId: string, taskId: string, body: string) {
  const userId = await requireUser();
  if (!userId) return fail("unauth");
  const gate = await editorCompany(companyId, userId);
  const rights = taskRightsFor(gate);
  if (!rights.active) return fail("forbidden");

  const v = validateComment(body);
  if (!v.ok) return fail(v.reason);

  const task = await prisma.companyTask.findFirst({
    where: { id: taskId, companyId },
    select: {
      id: true,
      title: true,
      createdById: true,
      assigneeId: true,
      takenById: true,
      pointId: true,
      _count: { select: { comments: true } },
    },
  });
  if (!task) return fail("not_found");
  const mine = task.assigneeId === userId || task.takenById === userId || task.createdById === userId;
  if (!mine && !rights.seeAll) return fail("forbidden");
  if (task._count.comments >= MAX_COMMENTS) return fail("too_many_comments");

  const text = body.trim();
  await prisma.companyTaskComment.create({ data: { taskId, authorUserId: userId, body: text } });
  await logCompanyAction({ companyId, actorUserId: userId, action: "TASK_COMMENTED", subject: task.title });
  await notifyTaskEvent({
    kind: "commented",
    userIds: [task.createdById, task.assigneeId, task.takenById].filter(
      (id): id is string => !!id && id !== userId,
    ),
    companyId,
    companyName: gate!.displayName,
    taskId,
    taskTitle: task.title,
    extra: text.slice(0, 300),
  });
  touch(companyId, taskId);
  return { ok: true as const };
}
