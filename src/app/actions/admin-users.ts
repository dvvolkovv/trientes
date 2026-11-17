"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/authz/guard";
import { setUserRoleCore, type ManagedRole } from "@/lib/admin/set-user-role";
import { logAdminAction } from "@/lib/admin/audit";

// Роли выдаёт только владелец: это управление системой, а не работа по заявке.
export async function setUserRole(input: { userId: string; role: ManagedRole }) {
  const admin = await requireOwner();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const res = await setUserRoleCore(prisma as never, {
    userId: input.userId,
    role: input.role,
    actorId: admin.userId,
  });
  if (res.ok) {
    await logAdminAction({
      actorId: admin.userId,
      action: "SET_USER_ROLE",
      targetType: "User",
      targetId: input.userId,
      details: { role: input.role },
    });
    revalidatePath("/", "layout");
  }
  return res;
}
