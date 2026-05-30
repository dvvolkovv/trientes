"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  fintechCreateSchema,
  sanitizeFintechSocials,
  type FintechCreateInput,
} from "@/lib/fintech";
import { redis } from "@/lib/redis";

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function bustAvailabilityCache(countryCodes: string[]) {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    for (const cc of countryCodes) await redis.del(`fintech:avail:${cc.toUpperCase()}`);
  } catch { /* best-effort */ }
}

// Single owner-facing entrypoint: creates the user's FintechCompany if none
// exists, otherwise patches the existing row. Status always reverts to PENDING
// after an owner edit so admin re-review is required.
export async function saveOwnFintech(input: unknown) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const parsed = fintechCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalid" as const, details: parsed.error.flatten() };
  }
  const data: FintechCreateInput = parsed.data;
  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;

  const baseData = {
    slug: data.slug,
    displayName: data.displayName,
    legalName: data.legalName ?? null,
    logoUrl: data.logoUrl ?? null,
    description: data.description ?? null,
    website: data.website,
    socials: socials as Prisma.InputJsonValue | undefined,
    foundedYear: data.foundedYear ?? null,
    countryCode: data.countryCode ?? null,
    city: data.city ?? null,
    address: data.address ?? null,
    hqLat: data.hqLat ?? null,
    hqLon: data.hqLon ?? null,
    services: data.services,
    supportedCoinIds: data.supportedCoinIds,
    supportedFiats: data.supportedFiats,
    availableIn: data.availableIn,
    kycLevel: data.kycLevel ?? null,
    feesSummary: data.feesSummary ?? null,
    appStoreUrl: data.appStoreUrl ?? null,
    playStoreUrl: data.playStoreUrl ?? null,
  };

  try {
    const existing = await prisma.fintechCompany.findUnique({ where: { ownerUserId: userId } });
    if (existing) {
      const row = await prisma.fintechCompany.update({
        where: { id: existing.id },
        data: {
          ...baseData,
          status: "PENDING",
          rejectionReason: null,
          reviewedById: null,
          reviewedAt: null,
        },
      });
      await bustAvailabilityCache([...existing.availableIn, ...data.availableIn]);
      revalidatePath("/", "layout");
      return { ok: true as const, id: row.id, status: row.status };
    }
    const row = await prisma.fintechCompany.create({
      data: {
        ...baseData,
        source: "registered",
        status: "PENDING",
        ownerUserId: userId,
      },
    });
    await bustAvailabilityCache(data.availableIn);
    revalidatePath("/", "layout");
    return { ok: true as const, id: row.id, status: row.status };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined)?.join(",") ?? "";
      if (target.includes("slug")) return { ok: false as const, reason: "slug_taken" as const };
      if (target.includes("ownerUserId")) return { ok: false as const, reason: "already_registered" as const };
    }
    throw e;
  }
}
