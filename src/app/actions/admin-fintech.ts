"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import {
  fintechCreateSchema,
  sanitizeFintechSocials,
  type FintechCreateInput,
} from "@/lib/fintech";
import { redis } from "@/lib/redis";

async function bustAvailabilityCache(countryCodes: string[]) {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    for (const cc of countryCodes) await redis.del(`fintech:avail:${cc.toUpperCase()}`);
  } catch { /* best-effort */ }
}

function toData(data: FintechCreateInput): Prisma.FintechCompanyCreateInput {
  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;
  return {
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
}

export async function approveFintech(input: { id: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const row = await prisma.fintechCompany.findUnique({ where: { id: input.id } });
  if (!row) return { ok: false as const, reason: "not_found" as const };
  if (row.status === "APPROVED") return { ok: false as const, reason: "not_pending" as const };
  await prisma.fintechCompany.update({
    where: { id: row.id },
    data: { status: "APPROVED", rejectionReason: null, reviewedById: admin.userId, reviewedAt: new Date() },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_FINTECH",
    targetType: "FintechCompany",
    targetId: row.id,
    details: { displayName: row.displayName, slug: row.slug },
  });
  await bustAvailabilityCache(row.availableIn);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function rejectFintech(input: { id: string; rejectionReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const reason = input.rejectionReason.trim();
  if (reason.length < 3) return { ok: false as const, reason: "reason_too_short" as const };
  const row = await prisma.fintechCompany.findUnique({ where: { id: input.id } });
  if (!row) return { ok: false as const, reason: "not_found" as const };
  await prisma.fintechCompany.update({
    where: { id: row.id },
    data: { status: "REJECTED", rejectionReason: reason, reviewedById: admin.userId, reviewedAt: new Date() },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_FINTECH",
    targetType: "FintechCompany",
    targetId: row.id,
    details: { reason },
  });
  await bustAvailabilityCache(row.availableIn);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function createCuratedFintech(input: unknown) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const parsed = fintechCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const, details: parsed.error.flatten() };
  try {
    const row = await prisma.fintechCompany.create({
      data: { ...toData(parsed.data), source: "curated", status: "APPROVED" },
    });
    await logAdminAction({
      actorId: admin.userId,
      action: "CREATE_FINTECH",
      targetType: "FintechCompany",
      targetId: row.id,
      details: { displayName: row.displayName, slug: row.slug },
    });
    await bustAvailabilityCache(parsed.data.availableIn);
    revalidatePath("/", "layout");
    return { ok: true as const, id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false as const, reason: "slug_taken" as const };
    }
    throw e;
  }
}

export async function editFintech(input: { id: string; payload: unknown }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const parsed = fintechCreateSchema.safeParse(input.payload);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const, details: parsed.error.flatten() };
  const before = await prisma.fintechCompany.findUnique({ where: { id: input.id }, select: { availableIn: true } });
  if (!before) return { ok: false as const, reason: "not_found" as const };
  try {
    await prisma.fintechCompany.update({ where: { id: input.id }, data: toData(parsed.data) });
    await logAdminAction({
      actorId: admin.userId,
      action: "EDIT_FINTECH",
      targetType: "FintechCompany",
      targetId: input.id,
    });
    await bustAvailabilityCache([...before.availableIn, ...parsed.data.availableIn]);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false as const, reason: "slug_taken" as const };
    }
    throw e;
  }
}

export async function deleteFintech(input: { id: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const row = await prisma.fintechCompany.findUnique({ where: { id: input.id }, select: { availableIn: true } });
  if (!row) return { ok: false as const, reason: "not_found" as const };
  await prisma.fintechCompany.delete({ where: { id: input.id } });
  await logAdminAction({
    actorId: admin.userId,
    action: "DELETE_FINTECH",
    targetType: "FintechCompany",
    targetId: input.id,
  });
  await bustAvailabilityCache(row.availableIn);
  revalidatePath("/", "layout");
  return { ok: true as const };
}
