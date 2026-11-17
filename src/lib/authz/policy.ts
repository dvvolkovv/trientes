/**
 * Политика прав: кто что может. Без Prisma и без сессии — всё нужное для
 * решения приходит аргументом, поэтому правило проверяется тестом, а не живым
 * нажатием в админке.
 *
 * Право — тройка «кто / где / сколько»: пользователь × очередь дел × уровень.
 * Нет строки права — нет доступа (запрет по умолчанию). До этого слайса вопрос
 * был один на всю админку — «ты админ или нет», — и ответ «да» означал полные
 * ключи.
 */
import { QUEUES, type QueueKey } from "@/lib/cases/queues";

export type StaffLevel = "VIEW" | "HANDLE" | "APPROVE";
export type ViewerRole = "USER" | "STAFF" | "OWNER" | "ADMIN";

export type GrantRow = { queue: string; level: StaffLevel; expiresAt: Date | null };

export type ViewerAccess = {
  userId: string;
  role: ViewerRole;
  /** Отзыв доступа сотрудника. Строка сотрудника остаётся — для журнала. */
  revokedAt: Date | null;
  grants: GrantRow[];
};

const ORDER: Record<StaffLevel, number> = { VIEW: 1, HANDLE: 2, APPROVE: 3 };

/**
 * `ADMIN` — наследие: значение из типа Postgres внутри одной миграции не
 * убрать, а оставить его бесправным значило бы запереть живую запись владельца.
 */
export function isOwnerRole(role: ViewerRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function isStaffRole(role: ViewerRole): boolean {
  return role === "STAFF" || isOwnerRole(role);
}

export function levelFor(access: ViewerAccess, queue: string, now: Date): StaffLevel | null {
  if (access.revokedAt) return null;
  if (isOwnerRole(access.role)) return "APPROVE";
  if (access.role !== "STAFF") return null;
  const g = access.grants.find((x) => x.queue === queue);
  if (!g) return null;
  // Истёкший срок гасит право сам, без прогона: прогон мог бы не состояться, и
  // право прожило бы лишний день.
  if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return null;
  return g.level;
}

export function can(access: ViewerAccess, queue: string, need: StaffLevel, now: Date): boolean {
  const have = levelFor(access, queue, now);
  return !!have && ORDER[have] >= ORDER[need];
}

/** Любая из очередей на нужном уровне — для объекта, за который отвечают две. */
export function canAny(
  access: ViewerAccess,
  queues: string[],
  need: StaffLevel,
  now: Date,
): boolean {
  return queues.some((q) => can(access, q, need, now));
}

export function visibleQueues(access: ViewerAccess, now: Date): QueueKey[] {
  return QUEUES.map((q) => q.key).filter((key) => can(access, key, "VIEW", now));
}

/** Экраны, которые делом не являются: права, пользователи, аудит, аналитика, каталог. */
export function canOwnerOnly(access: ViewerAccess): boolean {
  return !access.revokedAt && isOwnerRole(access.role);
}
