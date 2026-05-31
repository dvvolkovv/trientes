"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const MAX_ALERTS_PER_USER = 50;

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

const createSchema = z.object({
  coinId: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "invalid coin id"),
  symbol: z.string().min(1).max(20),
  op: z.enum(["GTE", "LTE"]),
  threshold: z.coerce.number().positive().finite(),
});

export async function createPriceAlert(input: unknown) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };

  const count = await prisma.priceAlert.count({ where: { userId } });
  if (count >= MAX_ALERTS_PER_USER) return { ok: false as const, reason: "too_many" as const };

  // Verify the coin actually exists, surface a friendly error otherwise.
  const coin = await prisma.coin.findUnique({
    where: { id: parsed.data.coinId },
    select: { id: true, symbol: true },
  });
  if (!coin) return { ok: false as const, reason: "unknown_coin" as const };

  await prisma.priceAlert.create({
    data: {
      userId,
      coinId: coin.id,
      symbol: coin.symbol.toUpperCase(),
      op: parsed.data.op,
      threshold: parsed.data.threshold,
    },
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function togglePriceAlert(id: string, enabled: boolean) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const row = await prisma.priceAlert.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== userId) return { ok: false as const, reason: "not_found" as const };
  await prisma.priceAlert.update({
    where: { id },
    data: { enabled, triggered: false }, // toggling resets the latched state
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deletePriceAlert(id: string) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const row = await prisma.priceAlert.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== userId) return { ok: false as const, reason: "not_found" as const };
  await prisma.priceAlert.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

const channelsSchema = z.object({
  notifyTelegram: z.boolean(),
  notifyEmail: z.boolean(),
});

export async function updateNotifyChannels(input: unknown) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const parsed = channelsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };
  await prisma.user.update({
    where: { id: userId },
    data: { notifyTelegram: parsed.data.notifyTelegram, notifyEmail: parsed.data.notifyEmail },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
