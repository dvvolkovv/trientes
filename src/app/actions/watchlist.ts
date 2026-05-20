"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function toggleWatchlist(coinId: string): Promise<{ ok: boolean; watched?: boolean; reason?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(coinId)) {
    return { ok: false, reason: "invalid_id" };
  }
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  // Confirm the coin exists.
  const coin = await prisma.coin.findUnique({ where: { id: coinId }, select: { id: true } });
  if (!coin) return { ok: false, reason: "not_found" };

  const existing = await prisma.watchlist.findUnique({
    where: { userId_coinId: { userId, coinId } },
  });
  if (existing) {
    await prisma.watchlist.delete({
      where: { userId_coinId: { userId, coinId } },
    });
    revalidatePath("/", "layout");
    return { ok: true, watched: false };
  }
  await prisma.watchlist.create({ data: { userId, coinId } });
  revalidatePath("/", "layout");
  return { ok: true, watched: true };
}
