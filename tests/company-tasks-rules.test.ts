import { describe, expect, it } from "vitest";
import {
  DAILY_TASKS,
  MAX_OPEN_TASKS,
  TASK_STATUSES,
  boardColumns,
  canTransition,
  dueFromDate,
  isOverdue,
  taskRights,
  taskRightsFor,
  validateComment,
  validateTask,
} from "@/lib/company-tasks/rules";

const perms = (level?: "VIEW" | "EDIT") => (level ? { tasks: level } : {});
/** Код отказа без сужения типа: в тесте важен сам код, а не ветка объединения. */
const why = (r: { ok: boolean } | { ok: false; reason: string }) =>
  "reason" in r ? r.reason : null;

describe("taskRights — три ступени доступа", () => {
  it("без уровня человек ведёт только свои задачи, но раздел ему виден", () => {
    const r = taskRights(perms());
    expect(r.seeAll).toBe(false);
    expect(r.manage).toBe(false);
    expect(r.seeOwn).toBe(true);
  });

  it("VIEW открывает доску предприятия, но не даёт ставить задачи другим", () => {
    const r = taskRights(perms("VIEW"));
    expect(r.seeAll).toBe(true);
    expect(r.manage).toBe(false);
  });

  it("EDIT ставит задачи, принимает и отменяет", () => {
    const r = taskRights(perms("EDIT"));
    expect(r.seeAll).toBe(true);
    expect(r.manage).toBe(true);
  });
});

describe("validateTask", () => {
  const ctx = { openCount: 0, todayCount: 0, now: new Date("2026-11-19T10:00:00Z") };

  it("заголовок обязателен", () => {
    expect(validateTask({ title: "  ", dueDate: null }, ctx)).toEqual({ ok: false, reason: "title_required" });
  });

  it("срок в прошлом отвергается, сегодняшний день считается будущим", () => {
    expect(validateTask({ title: "Пополнить полку", dueDate: "2026-11-18" }, ctx).ok).toBe(false);
    expect(validateTask({ title: "Пополнить полку", dueDate: "2026-11-19" }, ctx).ok).toBe(true);
  });

  it("негодная дата — отказ словами, а не молчаливое «без срока»", () => {
    expect(validateTask({ title: "x", dueDate: "19.11.2026" }, ctx)).toEqual({ ok: false, reason: "due_invalid" });
  });

  it("потолки считаются до работы", () => {
    expect(why(validateTask({ title: "x", dueDate: null }, { ...ctx, openCount: MAX_OPEN_TASKS }))).toBe("too_many_open");
    expect(why(validateTask({ title: "x", dueDate: null }, { ...ctx, todayCount: DAILY_TASKS }))).toBe("daily_limit");
  });

  it("слишком длинный заголовок и описание отвергаются", () => {
    expect(why(validateTask({ title: "a".repeat(201), dueDate: null }, ctx))).toBe("title_too_long");
    expect(why(validateTask({ title: "a", details: "b".repeat(4001), dueDate: null }, ctx))).toBe("details_too_long");
  });
});

describe("canTransition — выполненной задачу объявляет не исполнитель", () => {
  const task = {
    status: "NEW" as const,
    createdById: "boss",
    assigneeId: "worker",
    takenById: null as string | null,
    submittedById: null as string | null,
  };

  it("берёт назначенный", () => {
    expect(canTransition(task, "IN_PROGRESS", { userId: "worker", manage: false }).ok).toBe(true);
    expect(canTransition(task, "IN_PROGRESS", { userId: "stranger", manage: false }).ok).toBe(false);
  });

  it("задачу без исполнителя берёт любой, кто её видит", () => {
    const free = { ...task, assigneeId: null };
    expect(canTransition(free, "IN_PROGRESS", { userId: "stranger", manage: false }).ok).toBe(true);
  });

  it("сдаёт на проверку исполнитель, а не постановщик", () => {
    const work = { ...task, status: "IN_PROGRESS" as const, takenById: "worker" };
    expect(canTransition(work, "ON_REVIEW", { userId: "worker", manage: false }).ok).toBe(true);
    expect(canTransition(work, "ON_REVIEW", { userId: "boss", manage: true }).ok).toBe(false);
  });

  it("принимает постановщик или носитель EDIT, но не тот, кто сдавал", () => {
    const review = { ...task, status: "ON_REVIEW" as const, takenById: "worker", submittedById: "worker" };
    expect(canTransition(review, "DONE", { userId: "boss", manage: false }).ok).toBe(true);
    expect(canTransition(review, "DONE", { userId: "chief", manage: true }).ok).toBe(true);
    expect(canTransition(review, "DONE", { userId: "worker", manage: true }).ok).toBe(false);
  });

  it("вернуть в работу может принимающая сторона", () => {
    const review = { ...task, status: "ON_REVIEW" as const, takenById: "worker", submittedById: "worker" };
    expect(canTransition(review, "IN_PROGRESS", { userId: "boss", manage: false }).ok).toBe(true);
    expect(canTransition(review, "IN_PROGRESS", { userId: "worker", manage: false }).ok).toBe(false);
  });

  it("выполненная задача — конец: переоткрытия и отмены нет", () => {
    const done = { ...task, status: "DONE" as const };
    for (const to of TASK_STATUSES) {
      expect(canTransition(done, to, { userId: "boss", manage: true }).ok).toBe(false);
    }
  });

  it("отмена требует причины и права, отменённая задача не оживает", () => {
    expect(canTransition(task, "CANCELLED", { userId: "boss", manage: false }).ok).toBe(true);
    expect(canTransition(task, "CANCELLED", { userId: "worker", manage: false }).ok).toBe(false);
    const cancelled = { ...task, status: "CANCELLED" as const };
    expect(canTransition(cancelled, "IN_PROGRESS", { userId: "boss", manage: true }).ok).toBe(false);
  });

  it("переход в тот же статус не переход", () => {
    expect(canTransition(task, "NEW", { userId: "boss", manage: true }).ok).toBe(false);
  });
});

describe("срок и просрочка", () => {
  it("срок хранится концом дня по UTC: часового пояса у предприятия нет", () => {
    expect(dueFromDate("2026-11-20")?.toISOString()).toBe("2026-11-20T23:59:59.999Z");
    expect(dueFromDate("")).toBe(null);
  });

  it("просрочка — свойство, а не статус; закрытая задача не просрочена", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const past = new Date("2026-11-18T23:59:59.999Z");
    expect(isOverdue({ status: "IN_PROGRESS", dueAt: past }, now)).toBe(true);
    expect(isOverdue({ status: "DONE", dueAt: past }, now)).toBe(false);
    expect(isOverdue({ status: "NEW", dueAt: null }, now)).toBe(false);
  });
});

describe("доска", () => {
  it("колонки — четыре рабочих статуса; отменённые в колонках не стоят", () => {
    expect(boardColumns()).toEqual(["NEW", "IN_PROGRESS", "ON_REVIEW", "DONE"]);
  });
});

describe("validateComment", () => {
  it("пустая реплика и слишком длинная отвергаются", () => {
    expect(validateComment("   ").ok).toBe(false);
    expect(validateComment("a".repeat(2001)).ok).toBe(false);
    expect(validateComment("полка пополнена наполовину").ok).toBe(true);
  });
});

describe("taskRightsFor — калитка предприятия", () => {
  const live = { suspendedAt: null, deletedAt: null, permissions: { tasks: "EDIT" as const } };

  it("листинга задачи не требуют: предприятие в модерации уже готовит открытие", () => {
    expect(taskRightsFor(live).manage).toBe(true);
  });

  it("снятое надзором предприятие задачи только читает", () => {
    expect(taskRightsFor({ ...live, suspendedAt: new Date() }).manage).toBe(false);
    expect(taskRightsFor({ ...live, suspendedAt: new Date() }).seeAll).toBe(true);
  });

  it("не член — ничего", () => {
    expect(taskRightsFor(null)).toEqual({ active: false, seeOwn: false, seeAll: false, manage: false });
  });
});
