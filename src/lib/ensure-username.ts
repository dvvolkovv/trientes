import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateUsernameFromName, RESERVED_USERNAMES } from "@/lib/username";

export async function ensureUsername(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true, name: true },
  });
  if (!user) throw new Error("ensureUsername: user not found");
  if (user.username) return user.username;

  const base = generateUsernameFromName(user.name);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 10000)}`;
    if (RESERVED_USERNAMES.has(candidate)) continue;
    try {
      await prisma.user.update({ where: { id: userId }, data: { username: candidate } });
      return candidate;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("ensureUsername: exhausted retries");
}
