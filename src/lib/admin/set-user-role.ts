type UserRow = { id: string; role: "USER" | "ADMIN" };

type PrismaLike = {
  user: {
    findUnique(args: { where: { id: string } }): Promise<UserRow | null>;
    update(args: { where: { id: string }; data: { role: "USER" | "ADMIN" } }): Promise<UserRow>;
    count(args: { where: { role: "ADMIN" } }): Promise<number>;
  };
};

export type SetRoleResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "last_admin" };

export async function setUserRoleCore(
  prisma: PrismaLike,
  input: { userId: string; role: "USER" | "ADMIN"; actorId: string },
): Promise<SetRoleResult> {
  const u = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!u) return { ok: false, reason: "not_found" };

  if (u.role === "ADMIN" && input.role === "USER") {
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    if (adminCount <= 1) return { ok: false, reason: "last_admin" };
  }

  await prisma.user.update({ where: { id: input.userId }, data: { role: input.role } });
  return { ok: true };
}
