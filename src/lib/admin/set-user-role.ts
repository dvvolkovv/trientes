/**
 * Повышение и понижение роли. Роль грубая: сотрудник или владелец. Что именно
 * сотруднику можно, решают права по очередям (`StaffGrant`), а не это место.
 */
export type ManagedRole = "USER" | "STAFF" | "OWNER";

type UserRow = { id: string; role: string };

type PrismaLike = {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: { role: ManagedRole } }): Promise<UserRow>;
    count(args: { where: { role: { in: string[] } } }): Promise<number>;
  };
};

export type SetRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "last_owner" };

/** `ADMIN` — наследие, читается как владелец (см. `src/lib/authz/policy.ts`). */
const OWNER_ROLES = ["OWNER", "ADMIN"];

export async function setUserRoleCore(
  prisma: PrismaLike,
  input: { userId: string; role: ManagedRole; actorId: string },
): Promise<SetRoleResult> {
  const u = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!u) return { ok: false, reason: "not_found" };

  // Потеря последнего владельца запирает систему: выдавать права будет некому.
  if (OWNER_ROLES.includes(u.role) && input.role !== "OWNER") {
    const owners = await prisma.user.count({ where: { role: { in: OWNER_ROLES } } });
    if (owners <= 1) return { ok: false, reason: "last_owner" };
  }

  await prisma.user.update({ where: { id: input.userId }, data: { role: input.role } });
  return { ok: true };
}
