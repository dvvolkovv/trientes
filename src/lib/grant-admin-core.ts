import type { PrismaClient } from "@prisma/client";

export type GrantAdminInput = {
  email?: string;
  telegram?: string;
  github?: string;
};

export type GrantAdminResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_found" | "no_identifier" };

export async function grantAdminCore(
  prisma: PrismaClient,
  input: GrantAdminInput,
): Promise<GrantAdminResult> {
  const { email, telegram, github } = input;
  if (!email && !telegram && !github) {
    return { ok: false, reason: "no_identifier" };
  }

  let userId: string | null = null;

  if (email) {
    const u = await prisma.user.findFirst({ where: { email } });
    if (u) userId = u.id;
  }
  if (!userId && telegram) {
    const acc = await prisma.account.findFirst({
      where: { provider: "telegram", providerAccountId: telegram },
    });
    if (acc) userId = acc.userId;
  }
  if (!userId && github) {
    const acc = await prisma.account.findFirst({
      where: { provider: "github", providerAccountId: github },
    });
    if (acc) userId = acc.userId;
  }

  if (!userId) return { ok: false, reason: "not_found" };
  await prisma.user.update({
    where: { id: userId },
    data: { role: "ADMIN" },
  });
  return { ok: true, userId };
}
