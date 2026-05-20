"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { setUserRoleCore } from "@/lib/admin/set-user-role";
import { logAdminAction } from "@/lib/admin/audit";

export async function setUserRole(input: { userId: string; role: "USER" | "ADMIN" }) {
  const admin = await checkAdmin();
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
