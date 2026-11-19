/**
 * Чтение задач для кабинета предприятия. Доска и список — одно и то же чтение,
 * разложенное по статусам (спека, § 2.7).
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { type TaskPriority, type TaskStatus, isClosed } from "@/lib/company-tasks/rules";

export type TaskPerson = { id: string; label: string } | null;

export type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  createdBy: TaskPerson;
  assignee: TaskPerson;
  takenBy: TaskPerson;
  pointName: string | null;
  productName: string | null;
  warehouseName: string | null;
  comments: number;
  createdAt: Date;
};

export type TaskFilters = {
  assigneeId?: string | null;
  status?: TaskStatus | null;
  pointId?: string | null;
  /** Только просроченные: `dueAt` в прошлом и задача не закрыта. */
  overdue?: boolean;
};

export type TaskViewer = {
  userId: string;
  /** Видит доску предприятия (право `tasks: VIEW`). */
  seeAll: boolean;
  /** Участок по точкам продаж; пусто — все точки. */
  pointScope: readonly string[];
};

function person(u: { id: string; username: string | null; name: string | null; email: string | null } | null): TaskPerson {
  if (!u) return null;
  return { id: u.id, label: u.username || u.name || u.email || u.id.slice(0, 8) };
}

const PERSON = { select: { id: true, username: true, name: true, email: true } } as const;

/**
 * Что человеку видно. Свои задачи видны **всегда**, даже если точка позже вышла из
 * участка: иначе поручение пропадает молча в день, когда владелец переставил участки
 * (спека, § 2.4).
 */
export function visibilityWhere(viewer: TaskViewer): Prisma.CompanyTaskWhereInput {
  const mine: Prisma.CompanyTaskWhereInput = {
    OR: [
      { assigneeId: viewer.userId },
      { takenById: viewer.userId },
      { createdById: viewer.userId },
    ],
  };
  if (!viewer.seeAll) return mine;
  if (viewer.pointScope.length === 0) return {};
  // Задача без точки — общая для предприятия, её видно и сотруднику участка.
  return { OR: [{ pointId: null }, { pointId: { in: [...viewer.pointScope] } }, mine] };
}

function filterWhere(filters: TaskFilters, now: Date): Prisma.CompanyTaskWhereInput {
  const where: Prisma.CompanyTaskWhereInput = {};
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.status) where.status = filters.status;
  if (filters.pointId) where.pointId = filters.pointId;
  if (filters.overdue) {
    where.dueAt = { lt: now };
    where.status = filters.status ?? { in: ["NEW", "IN_PROGRESS", "ON_REVIEW"] };
  }
  return where;
}

export async function readTasks(
  companyId: string,
  viewer: TaskViewer,
  filters: TaskFilters = {},
  opts: { take?: number; now?: Date } = {},
): Promise<TaskRow[]> {
  const now = opts.now ?? new Date();
  const rows = await prisma.companyTask.findMany({
    where: { companyId, AND: [visibilityWhere(viewer), filterWhere(filters, now)] },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: opts.take ?? 300,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueAt: true,
      createdAt: true,
      createdBy: PERSON,
      assignee: PERSON,
      takenBy: PERSON,
      point: { select: { name: true } },
      product: { select: { name: true } },
      warehouse: { select: { name: true } },
      _count: { select: { comments: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    dueAt: r.dueAt,
    createdAt: r.createdAt,
    createdBy: person(r.createdBy),
    assignee: person(r.assignee),
    takenBy: person(r.takenBy),
    pointName: r.point?.name ?? null,
    productName: r.product?.name ?? null,
    warehouseName: r.warehouse?.name ?? null,
    comments: r._count.comments,
  }));
}

export async function readTask(companyId: string, taskId: string, viewer: TaskViewer) {
  const task = await prisma.companyTask.findFirst({
    where: { id: taskId, companyId, AND: [visibilityWhere(viewer)] },
    select: {
      id: true,
      title: true,
      details: true,
      status: true,
      priority: true,
      dueAt: true,
      createdAt: true,
      createdById: true,
      assigneeId: true,
      assignedAt: true,
      takenById: true,
      takenAt: true,
      submittedById: true,
      submittedAt: true,
      closedAt: true,
      cancelReason: true,
      pointId: true,
      productId: true,
      warehouseId: true,
      createdBy: PERSON,
      assignee: PERSON,
      takenBy: PERSON,
      closedBy: PERSON,
      point: { select: { id: true, name: true } },
      product: { select: { id: true, name: true, slug: true } },
      warehouse: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, body: true, createdAt: true, author: PERSON },
      },
    },
  });
  if (!task) return null;
  return {
    ...task,
    createdByPerson: person(task.createdBy),
    assigneePerson: person(task.assignee),
    takenByPerson: person(task.takenBy),
    closedByPerson: person(task.closedBy),
    thread: task.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      author: person(c.author),
    })),
  };
}

export type TaskTally = {
  key: string;
  label: string;
  open: number;
  overdue: number;
  onReview: number;
  doneRecently: number;
};

/**
 * Отчёты по исполнителям и по точкам (ТЗ 6.6: «по выполнению задач и по участкам
 * ответственности»). Среднего времени выполнения нет: его считают по закрытым задачам,
 * и «0 ч» объявляло бы измерение, которого не было (прецедент `levelFor(null)` в BD).
 */
export async function readTaskReports(
  companyId: string,
  viewer: TaskViewer,
  opts: { now?: Date } = {},
): Promise<{ byAssignee: TaskTally[]; byPoint: TaskTally[] }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const rows = await prisma.companyTask.findMany({
    where: { companyId, AND: [visibilityWhere(viewer)] },
    select: {
      status: true,
      dueAt: true,
      closedAt: true,
      assignee: PERSON,
      takenBy: PERSON,
      point: { select: { id: true, name: true } },
    },
  });

  const tally = new Map<string, TaskTally>();
  const bump = (key: string, label: string, patch: Partial<TaskTally>) => {
    const row = tally.get(key) ?? { key, label, open: 0, overdue: 0, onReview: 0, doneRecently: 0 };
    tally.set(key, {
      ...row,
      open: row.open + (patch.open ?? 0),
      overdue: row.overdue + (patch.overdue ?? 0),
      onReview: row.onReview + (patch.onReview ?? 0),
      doneRecently: row.doneRecently + (patch.doneRecently ?? 0),
    });
  };

  const points = new Map<string, TaskTally>();
  const bumpPoint = (key: string, label: string, patch: Partial<TaskTally>) => {
    const row = points.get(key) ?? { key, label, open: 0, overdue: 0, onReview: 0, doneRecently: 0 };
    points.set(key, {
      ...row,
      open: row.open + (patch.open ?? 0),
      overdue: row.overdue + (patch.overdue ?? 0),
      onReview: row.onReview + (patch.onReview ?? 0),
      doneRecently: row.doneRecently + (patch.doneRecently ?? 0),
    });
  };

  for (const r of rows) {
    const who = person(r.takenBy) ?? person(r.assignee);
    const open = isClosed(r.status) ? 0 : 1;
    const overdue = !isClosed(r.status) && r.dueAt && r.dueAt.getTime() < now.getTime() ? 1 : 0;
    const onReview = r.status === "ON_REVIEW" ? 1 : 0;
    const doneRecently = r.status === "DONE" && r.closedAt && r.closedAt >= since ? 1 : 0;
    const patch = { open, overdue, onReview, doneRecently };
    bump(who ? who.id : "__unassigned__", who ? who.label : "", patch);
    bumpPoint(r.point ? r.point.id : "__nopoint__", r.point ? r.point.name : "", patch);
  }

  const order = (a: TaskTally, b: TaskTally) => b.open - a.open || b.doneRecently - a.doneRecently;
  return {
    byAssignee: [...tally.values()].sort(order),
    byPoint: [...points.values()].sort(order),
  };
}

/** Что можно выбрать в форме: сотрудники, точки, товары и склады участка. */
export async function readTaskTargets(companyId: string, scope: readonly string[]) {
  const scoped = scope.length > 0 ? { in: [...scope] } : undefined;
  const [members, points, products, warehouses] = await Promise.all([
    prisma.companyMember.findMany({
      where: { companyId },
      select: { userId: true, user: PERSON, points: { select: { pointId: true } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    prisma.companyPoint.findMany({
      where: { companyId, deletedAt: null, ...(scoped ? { id: scoped } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.product.findMany({
      where: { offers: { some: { companyId } }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.warehouse.findMany({
      where: { companyId, archivedAt: null, ...(scoped ? { pointId: scoped } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
  ]);
  return {
    members: members.map((m) => ({
      id: m.userId,
      label: person(m.user)?.label ?? m.userId.slice(0, 8),
      pointScope: m.points.map((p) => p.pointId),
    })),
    points,
    products,
    warehouses,
  };
}
