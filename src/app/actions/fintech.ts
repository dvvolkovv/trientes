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
import { checkFintechLimits } from "@/lib/company-limits";

// Re-uses the LoginAttempt audit table to throttle saves per owner; keeps the
// audit trail consistent with login/register without a 2nd table.
const FINTECH_SAVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const FINTECH_SAVE_MAX_PER_USER = 10;
const FINTECH_SAVE_IDENTIFIER = "__fintech_save__";

async function requireUser(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function checkFintechSaveLimit(userId: string): Promise<{ blocked: boolean }> {
  const since = new Date(Date.now() - FINTECH_SAVE_WINDOW_MS);
  const count = await prisma.loginAttempt.count({
    where: { userId, identifier: FINTECH_SAVE_IDENTIFIER, createdAt: { gte: since } },
  });
  return { blocked: count >= FINTECH_SAVE_MAX_PER_USER };
}

async function recordFintechSave(userId: string): Promise<void> {
  await prisma.loginAttempt.create({
    data: { ip: "server-action", identifier: FINTECH_SAVE_IDENTIFIER, success: true, userId },
  });
}

async function bustAvailabilityCache(countryCodes: string[]) {
  try {
    if (redis.status === "wait" || redis.status === "end") await redis.connect();
    for (const cc of countryCodes) await redis.del(`fintech:avail:${cc.toUpperCase()}`);
  } catch { /* best-effort */ }
}

/**
 * Единственная точка входа для владельца. Без `id` создаёт новый сервис (в
 * пределах лимитов), с `id` правит свой существующий. Статус после правки
 * всегда возвращается в PENDING — модератор должен увидеть изменения.
 *
 * Раньше запись находилась по ownerUserId, потому что сервис был один на
 * аккаунт; уникальный индекс снят миграцией 20261106250000.
 */
export async function saveOwnFintech(input: unknown, fintechId?: string) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const limit = await checkFintechSaveLimit(userId);
  if (limit.blocked) return { ok: false as const, reason: "rate_limited" as const };

  const parsed = fintechCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalid" as const, details: parsed.error.flatten() };
  }
  const data: FintechCreateInput = parsed.data;
  const socials = data.socials ? sanitizeFintechSocials(data.socials) : null;

  // Указать можно только одобренную карточку: иначе сервис ссылался бы на
  // листинг, которого публично не существует.
  const cardIds = data.supportedCardIds ?? [];
  if (cardIds.length > 0) {
    const approved = await prisma.coinCard.count({
      where: { id: { in: cardIds }, status: "APPROVED" },
    });
    if (approved !== cardIds.length) {
      return { ok: false as const, reason: "coin_not_selectable" as const };
    }
  }

  await recordFintechSave(userId);

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
    supportedCardIds: data.supportedCardIds ?? [],
    supportedFiats: data.supportedFiats,
    availableIn: data.availableIn,
    kycLevel: data.kycLevel ?? null,
    feesSummary: data.feesSummary ?? null,
    appStoreUrl: data.appStoreUrl ?? null,
    playStoreUrl: data.playStoreUrl ?? null,
  };

  try {
    // Правим только свою запись: id из запроса сверяется с владельцем.
    const existing = fintechId
      ? await prisma.fintechCompany.findFirst({ where: { id: fintechId, ownerUserId: userId } })
      : null;
    if (fintechId && !existing) return { ok: false as const, reason: "not_found" as const };

    if (!existing) {
      const [owned, pending] = await Promise.all([
        prisma.fintechCompany.count({ where: { ownerUserId: userId } }),
        prisma.fintechCompany.count({ where: { ownerUserId: userId, status: "PENDING" } }),
      ]);
      const limit = checkFintechLimits({ owned, pending });
      if (!limit.ok) return { ok: false as const, reason: limit.reason };
    }

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
      // ownerUserId больше не уникален — ветка оставлена бы мёртвой, поэтому убрана.
    }
    throw e;
  }
}
