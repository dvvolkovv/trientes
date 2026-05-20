"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCoinRequest } from "@/lib/coin-request";

const MAX_PENDING_PER_USER = 10;

export async function submitCoinRequest(input: {
  name: string;
  symbol: string;
  coingeckoId?: string;
  reason: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const validated = validateCoinRequest(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  // Anti-spam: limit pending requests per user.
  const pendingCount = await prisma.coinRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    return { ok: false, reason: "too_many_pending" };
  }

  await prisma.coinRequest.create({
    data: {
      userId,
      name: validated.data.name,
      symbol: validated.data.symbol,
      coingeckoId: validated.data.coingeckoId,
      reason: validated.data.reason,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
