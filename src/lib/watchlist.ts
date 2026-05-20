import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function readUserWatchedIds(): Promise<Set<string>> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Set();
  const rows = await prisma.watchlist.findMany({
    where: { userId },
    select: { coinId: true },
  });
  return new Set(rows.map((r) => r.coinId));
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await auth();
  return Boolean((session?.user as { id?: string } | undefined)?.id);
}
