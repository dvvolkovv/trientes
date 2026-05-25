"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateExchangeProfile, type ExchangeProfileInput } from "@/lib/exchange";

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function createExchange(input: ExchangeProfileInput) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const v = validateExchangeProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const exchange = await prisma.registeredExchange.create({
    data: {
      ownerUserId: userId,
      legalName: v.data.legalName,
      displayName: v.data.displayName,
      description: v.data.description,
      website: v.data.website,
      country: v.data.country,
      email: v.data.email,
      phone: v.data.phone,
      address: v.data.address,
      logoUrl: v.data.logoUrl,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
      status: "PENDING",
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: exchange.id };
}

export async function saveExchangeProfile(
  exchangeId: string,
  input: ExchangeProfileInput,
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const existing = await prisma.registeredExchange.findUnique({ where: { id: exchangeId } });
  if (!existing || existing.ownerUserId !== userId) {
    return { ok: false as const, reason: "not_found" as const };
  }
  const v = validateExchangeProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  // Editing an approved exchange returns it to PENDING (admin must re-approve).
  const nextStatus = existing.status === "APPROVED" ? "PENDING" : existing.status;
  await prisma.registeredExchange.update({
    where: { id: exchangeId },
    data: {
      ...v.data,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
      status: nextStatus,
      rejectionReason: nextStatus === "PENDING" ? null : existing.rejectionReason,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
