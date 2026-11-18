"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { validateCompanyPoint } from "@/lib/company";
import { NOT_DELETED } from "@/lib/soft-delete";
import { claimBlockedBy, claimPrefillFromTags } from "@/lib/point-claim";
import { isOsmPoiKey } from "@/lib/osm-key";
import type { PointType } from "@prisma/client";

const MAX_PENDING_POINTS = 20;

type Result = { ok: true; pointId: string } | { ok: false; reason: string };

/**
 * Забрать точку зеркала BTC Map себе.
 *
 * Поля точки берутся **из нашего зеркала**, а не из браузера заявителя: кнопка
 * говорит «это моё предприятие», а не «впишите сюда что хотите». Дальше точка
 * идёт обычным путём — PENDING, дело в очереди модерации, те же лимиты, — и
 * только после одобрения фид прячет зеркальную булавку.
 */
export async function claimOsmPoint(companyId: string, osmKey: string): Promise<Result> {
  if (!isOsmPoiKey(osmKey)) return { ok: false, reason: "invalid_point" };

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  // Право то же, что у подачи новой точки: владелец или редактор предприятия.
  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  if (member?.role !== "OWNER" && member?.role !== "EDITOR") {
    return { ok: false, reason: "not_found" };
  }
  const company = await prisma.company.findFirst({
    where: { id: companyId, ...NOT_DELETED },
    select: { id: true, ownerUserId: true },
  });
  if (!company) return { ok: false, reason: "not_found" };

  const mirror = await prisma.osmCryptoPoi.findUnique({
    where: { id: osmKey },
    select: { lat: true, lon: true, tags: true },
  });
  if (!mirror) return { ok: false, reason: "point_gone" };

  // Точку, которую уже забрали, второй раз не отдаём — иначе два предприятия
  // держали бы одно заведение.
  const existing = await prisma.companyPoint.findMany({
    where: { osmId: osmKey },
    select: { status: true, deletedAt: true },
  });
  const blocked = claimBlockedBy(existing);
  if (blocked) return { ok: false, reason: blocked === "taken" ? "already_claimed" : "claim_pending" };

  const pending = await prisma.companyPoint.count({
    where: { companyId: company.id, status: "PENDING", ...NOT_DELETED },
  });
  if (pending >= MAX_PENDING_POINTS) return { ok: false, reason: "too_many_pending" };

  const pre = claimPrefillFromTags((mirror.tags ?? {}) as Record<string, string>);
  // Монеты из тегов — это id каталога CoinGecko; в поле точки идут только те,
  // что у нас есть, иначе на карточке повисла бы ссылка в никуда.
  const known = pre.acceptedCoinIds.length
    ? await prisma.coin.findMany({
        where: { id: { in: pre.acceptedCoinIds } },
        select: { id: true },
      })
    : [];

  const v = validateCompanyPoint({
    type: pre.type,
    // У безымянной точки OSM имя взять неоткуда — тогда его даёт предприятие,
    // а до правки стоит его собственное название.
    name: pre.name || (await companyName(company.id)),
    description: pre.description,
    lat: mirror.lat,
    lon: mirror.lon,
    countryCode: pre.countryCode,
    city: pre.city,
    street: pre.street,
    houseNumber: pre.houseNumber,
    postalCode: pre.postalCode,
    openingHours: pre.openingHours,
    phone: pre.phone,
    website: pre.website,
    acceptedCoinIds: known.map((c) => c.id),
    acceptedCardIds: [],
  });
  if (!v.ok) return { ok: false, reason: v.reason };

  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      osmId: osmKey,
      type: v.data.type as PointType,
      name: v.data.name,
      description: v.data.description,
      lat: v.data.lat,
      lon: v.data.lon,
      countryCode: v.data.countryCode,
      city: v.data.city,
      street: v.data.street,
      houseNumber: v.data.houseNumber,
      postalCode: v.data.postalCode,
      address: v.data.address,
      acceptedCoinIds: v.data.acceptedCoinIds,
      acceptedCardIds: [],
      openingHours: v.data.openingHours,
      phone: v.data.phone,
      website: v.data.website,
    },
  });
  await ensureCase({
    subjectType: "POINT",
    subjectId: point.id,
    title: point.name,
    applicantUserId: company.ownerUserId,
  });
  revalidatePath("/", "layout");
  return { ok: true, pointId: point.id };
}

async function companyName(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { displayName: true },
  });
  return c?.displayName ?? "";
}
