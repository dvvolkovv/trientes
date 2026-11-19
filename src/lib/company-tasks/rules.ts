/**
 * Правила задач команды — чистые, без Prisma. Спека
 * `docs/superpowers/specs/2026-11-19-merchant-tasks-board-design.md`, раздел 2.
 *
 * Главное решение слайса живёт здесь: «на проверке» имеет смысл только если задачу
 * закрывает не тот, кто её сдавал. Второе — три ступени доступа: свои задачи человек
 * видит всегда, иначе поручение невидимо тому, кому оно адресовано.
 */
import { can, type TeamPermissions } from "@/lib/company-team/permissions";

export const TASK_STATUSES = ["NEW", "IN_PROGRESS", "ON_REVIEW", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Незакрытых задач на предприятие: столько человек ещё читает глазами. */
export const MAX_OPEN_TASKS = 300;
/** Новых задач в сутки — тот же приём, что `DAILY_MOVEMENTS` в BC. */
export const DAILY_TASKS = 200;
export const MAX_COMMENTS = 100;
export const TITLE_CHARS = 200;
export const DETAILS_CHARS = 4000;
export const COMMENT_CHARS = 2000;
/** Причина отмены — не короче порога причины отказа во всём проекте. */
export const REASON_CHARS = 3;

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

/** Задача закрыта: ни работы, ни часов. */
export function isClosed(status: TaskStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

export type TaskRights = {
  /** Свои задачи видит каждый член: иначе поручение невидимо исполнителю. */
  seeOwn: boolean;
  /** Доска предприятия в границах участка. */
  seeAll: boolean;
  /** Ставить задачи другим, принимать сделанное, отменять. */
  manage: boolean;
};

export function taskRights(perms: TeamPermissions): TaskRights {
  return {
    seeOwn: true,
    seeAll: can(perms, "tasks", "VIEW"),
    manage: can(perms, "tasks", "EDIT"),
  };
}

export type TaskGateCompany = {
  suspendedAt: Date | null;
  deletedAt: Date | null;
  permissions: TeamPermissions;
};

/**
 * Права на задачи у живого предприятия. Листинга задачи **не требуют** (§ 2.9): это
 * внутренняя работа, витрине она ничего не обещает, и предприятие, ждущее модерации,
 * вправе готовить открытие. Снятое надзором или удалённое — другое дело: там работа
 * остановлена целиком, и задачи только читаются.
 */
export function taskRightsFor(company: TaskGateCompany | null | undefined): TaskRights & { active: boolean } {
  if (!company) return { active: false, seeOwn: false, seeAll: false, manage: false };
  const active = !company.suspendedAt && !company.deletedAt;
  const rights = taskRights(company.permissions);
  return {
    active,
    seeOwn: true,
    seeAll: rights.seeAll,
    manage: active && rights.manage,
  };
}

type Ok = { ok: true };
type Bad<R extends string> = { ok: false; reason: R };

export type TaskReason =
  | "title_required"
  | "title_too_long"
  | "details_too_long"
  | "due_invalid"
  | "due_past"
  | "too_many_open"
  | "daily_limit";

/**
 * Срок — дата, а не час: часового пояса у предприятия в данных нет, и «к 18:00»
 * означало бы неизвестно чей вечер. Хранится концом дня по UTC.
 */
export function dueFromDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const date = new Date(`${value.trim()}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateTask(
  input: { title: string; details?: string | null; dueDate?: string | null },
  ctx: { openCount: number; todayCount: number; now: Date },
): Ok | Bad<TaskReason> {
  const title = input.title.trim();
  if (!title) return { ok: false, reason: "title_required" };
  if (title.length > TITLE_CHARS) return { ok: false, reason: "title_too_long" };
  if ((input.details ?? "").length > DETAILS_CHARS) return { ok: false, reason: "details_too_long" };
  if (ctx.openCount >= MAX_OPEN_TASKS) return { ok: false, reason: "too_many_open" };
  if (ctx.todayCount >= DAILY_TASKS) return { ok: false, reason: "daily_limit" };
  const raw = (input.dueDate ?? "").trim();
  if (raw) {
    const due = dueFromDate(raw);
    if (!due) return { ok: false, reason: "due_invalid" };
    // Сегодняшний день — будущее: задача «на сегодня» законна, а просроченная в момент
    // рождения — опечатка в годе.
    if (due.getTime() < ctx.now.getTime()) return { ok: false, reason: "due_past" };
  }
  return { ok: true };
}

export function validateComment(body: string): Ok | Bad<"body_required" | "body_too_long"> {
  const text = body.trim();
  if (!text) return { ok: false, reason: "body_required" };
  if (text.length > COMMENT_CHARS) return { ok: false, reason: "body_too_long" };
  return { ok: true };
}

export type TransitionTask = {
  status: TaskStatus;
  createdById: string | null;
  assigneeId: string | null;
  takenById: string | null;
  /** Кто сдал на проверку: он же не вправе принять свою работу. */
  submittedById: string | null;
};

export type TransitionReason = "not_a_transition" | "task_closed" | "forbidden";

/**
 * Переходы из § 2.2 спеки. Принимающая сторона — постановщик или носитель `EDIT`;
 * исполнитель своё не принимает, иначе «на проверке» это слово, которое никто не читает.
 */
export function canTransition(
  task: TransitionTask,
  to: TaskStatus,
  actor: { userId: string; manage: boolean },
): Ok | Bad<TransitionReason> {
  if (to === task.status) return { ok: false, reason: "not_a_transition" };
  // `DONE` и `CANCELLED` — конец: вернувшаяся работа это новая задача со своим сроком.
  if (isClosed(task.status)) return { ok: false, reason: "task_closed" };

  const isAuthor = !!task.createdById && task.createdById === actor.userId;
  const accepting = isAuthor || actor.manage;
  const worker = task.takenById ?? task.assigneeId;
  const isWorker = !!worker && worker === actor.userId;

  if (to === "CANCELLED") {
    return accepting ? { ok: true } : { ok: false, reason: "forbidden" };
  }
  if (to === "IN_PROGRESS" && task.status === "NEW") {
    // Задача без исполнителя — «кто возьмёт»: берёт любой, кто её видит.
    const mine = !task.assigneeId || task.assigneeId === actor.userId;
    return mine ? { ok: true } : { ok: false, reason: "forbidden" };
  }
  if (to === "ON_REVIEW" && task.status === "IN_PROGRESS") {
    return isWorker ? { ok: true } : { ok: false, reason: "forbidden" };
  }
  if (to === "IN_PROGRESS" && task.status === "ON_REVIEW") {
    return accepting && !isSubmitter(task, actor.userId)
      ? { ok: true }
      : { ok: false, reason: "forbidden" };
  }
  if (to === "DONE" && task.status === "ON_REVIEW") {
    return accepting && !isSubmitter(task, actor.userId)
      ? { ok: true }
      : { ok: false, reason: "forbidden" };
  }
  return { ok: false, reason: "not_a_transition" };
}

function isSubmitter(task: TransitionTask, userId: string): boolean {
  return !!task.submittedById && task.submittedById === userId;
}

/** Просрочка — свойство задачи, а не статус: статус описывает работу, а не часы. */
export function isOverdue(
  task: { status: TaskStatus; dueAt: Date | null },
  now: Date,
): boolean {
  if (!task.dueAt) return false;
  if (isClosed(task.status)) return false;
  return task.dueAt.getTime() < now.getTime();
}

/** Колонки доски: отменённые задачи не стоят в колонке, их читают списком. */
export function boardColumns(): TaskStatus[] {
  return ["NEW", "IN_PROGRESS", "ON_REVIEW", "DONE"];
}
