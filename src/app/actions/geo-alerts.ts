"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const MAX_GEO_ALERTS_PER_USER = 20;

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

const createSchema = z.object({
  countryCode: z.string().regex(/^[A-Za-z]{2}$/, "invalid"),
  notifyFintech: z.boolean(),
  notifyPoints: z.boolean(),
});

export async function createGeoAlert(input: unknown) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };
  if (!parsed.data.notifyFintech && !parsed.data.notifyPoints) {
    return { ok: false as const, reason: "no_channels" as const };
  }
  const count = await prisma.geoAlert.count({ where: { userId } });
  if (count >= MAX_GEO_ALERTS_PER_USER) return { ok: false as const, reason: "too_many" as const };
  try {
    await prisma.geoAlert.create({
      data: {
        userId,
        countryCode: parsed.data.countryCode.toUpperCase(),
        notifyFintech: parsed.data.notifyFintech,
        notifyPoints: parsed.data.notifyPoints,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false as const, reason: "duplicate" as const };
    }
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function toggleGeoAlert(id: string, enabled: boolean) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const row = await prisma.geoAlert.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== userId) return { ok: false as const, reason: "not_found" as const };
  await prisma.geoAlert.update({ where: { id }, data: { enabled } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function deleteGeoAlert(id: string) {
  const userId = await requireUserId();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const row = await prisma.geoAlert.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== userId) return { ok: false as const, reason: "not_found" as const };
  await prisma.geoAlert.delete({ where: { id } });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
