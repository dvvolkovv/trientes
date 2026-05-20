"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";

export async function toggleCoinActive(coinId: string) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const c = await prisma.coin.findUnique({ where: { id: coinId }, select: { isActive: true } });
  if (!c) return { ok: false, reason: "not_found" };
  await prisma.coin.update({ where: { id: coinId }, data: { isActive: !c.isActive } });
  revalidatePath("/", "layout");
  return { ok: true, isActive: !c.isActive };
}

export async function addAdminCoin(input: { coingeckoId: string; symbol: string; name: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const id = input.coingeckoId.trim().toLowerCase();
  const symbol = input.symbol.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { ok: false, reason: "invalid_id" };
  if (!symbol || symbol.length > 12) return { ok: false, reason: "invalid_symbol" };
  if (!name) return { ok: false, reason: "invalid_name" };

  const existing = await prisma.coin.findUnique({ where: { id } });
  if (existing) return { ok: false, reason: "coin_exists" };

  await prisma.coin.create({
    data: {
      id,
      symbol,
      name,
      slug: id,
      rank: 9999,
      source: "ADMIN_ADDED",
      isActive: true,
      addedByAdminId: admin.userId,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true, coinId: id };
}
