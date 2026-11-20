"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import { logCompanyAction } from "@/lib/company-team/journal";
import { pointScopeAllows } from "@/lib/company-team/permissions";
import { ensureCase } from "@/lib/cases/ensure";
import {
  validateCompanyProfile,
  validateCompanyPoint,
  type CompanyProfileInput,
  type CompanyPointInput,
} from "@/lib/company";
import { checkCompanyLimits } from "@/lib/company-limits";
import { pointEditNeedsModeration } from "@/lib/point-edit";
import { toCompanyPatch, splitCompanyEdit } from "@/lib/company-edit";
import { Prisma, type PointType } from "@prisma/client";
import { LIVE_POINT, NOT_DELETED } from "@/lib/soft-delete";

const MAX_PENDING_POINTS = 20;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function createCompany(input: { legalName: string; displayName: string }) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };

  // Одна компания на аккаунт больше не ограничение базы, поэтому спам держат
  // явные лимиты. Считаем по членству с ролью OWNER: переданное владение чужой
  // компанией тоже расходует лимит.
  const [owned, pending] = await Promise.all([
    prisma.companyMember.count({ where: { userId, role: "OWNER" } }),
    prisma.companyMember.count({
      where: { userId, role: "OWNER", company: { status: "PENDING" } },
    }),
  ]);
  const limit = checkCompanyLimits({ owned, pending });
  if (!limit.ok) return { ok: false as const, reason: limit.reason };

  // The creator becomes OWNER both via the legacy ownerUserId field (kept for
  // moderation lookups) and via CompanyMember (the operational gate).
  const company = await prisma.company.create({
    data: {
      ownerUserId: userId,
      legalName: v.data.legalName,
      displayName: v.data.displayName,
      description: v.data.description,
      country: v.data.country,
      countryCode: v.data.countryCode,
      city: v.data.city,
      street: v.data.street,
      houseNumber: v.data.houseNumber,
      postalCode: v.data.postalCode,
      address: v.data.address,
      phone: v.data.phone,
      email: v.data.email,
      website: v.data.website,
      logoUrl: v.data.logoUrl,
      members: { create: { userId, role: "OWNER" } },
    },
  });
  await ensureCase({
    subjectType: "COMPANY",
    subjectId: company.id,
    title: company.displayName,
    applicantUserId: company.ownerUserId,
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id: company.id };
}

/**
 * Сохранение карточки предприятия (слайс BM).
 *
 * У залистованного предприятия модерируемые поля в карточку **не пишутся**: они
 * ложатся правкой `CompanyRevision`, а витрина держит прежнее значение, пока
 * модератор не одобрит. Свободные поля (описание, логотип) применяются сразу.
 *
 * У предприятия в `PENDING`/`REJECTED` на витрине защищать нечего, а заявитель
 * обязан иметь возможность дозаполнить то, что у него же на проверке — там всё
 * пишется сразу, как было до слайса.
 */
export async function saveCompanyProfile(
  companyId: string,
  input: CompanyProfileInput,
  documents?: { kind: string; url: string; label?: string | null }[],
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  // Право на раздел «карточка магазина» (слайс BE). Профиль правит и предприятие,
  // ещё не прошедшее модерацию, — поэтому не `canWrite`, которая требует APPROVED.
  const gate = await editorCompany(companyId, userId);
  if (!gate || !gate.permissions.card || gate.permissions.card !== "EDIT") {
    return { ok: false as const, reason: "not_found" as const };
  }
  const company = await prisma.company.findFirst({ where: { id: companyId, ...NOT_DELETED } });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };

  if (company.status !== "APPROVED") {
    await prisma.company.update({ where: { id: company.id }, data: v.data });
    await logCompanyAction({ companyId, actorUserId: userId, action: "PROFILE_SAVED", subject: v.data.displayName });
    revalidatePath("/", "layout");
    return { ok: true as const, moderated: 0 };
  }

  const split = splitCompanyEdit(company, v.data);
  // Выводимая строка адреса следует за структурными частями, а они ждут модератора:
  // записать её сразу значило бы показать на витрине новый адрес до решения.
  if (Object.keys(split.free).length > 0) {
    await prisma.company.update({ where: { id: company.id }, data: toCompanyPatch(split.free) });
    await logCompanyAction({ companyId, actorUserId: userId, action: "PROFILE_SAVED", subject: company.displayName });
  }
  if (split.pending.length === 0) {
    revalidatePath("/", "layout");
    return { ok: true as const, moderated: 0 };
  }

  const docs = (documents ?? [])
    .map((d) => ({ kind: String(d.kind), url: String(d.url).trim(), label: d.label?.trim() || null }))
    .filter((d) => d.url.startsWith("/uploads/") || d.url.startsWith("https://"))
    .slice(0, 8);
  // Юридическое имя подтверждается бумагой, а не словом заявителя: отказ вслух,
  // а не молчаливое применение.
  if (split.needsDocuments && docs.length === 0) {
    return { ok: false as const, reason: "documents_required" as const };
  }

  // Одна ждущая правка на предприятие: новая правка переписывает прежнюю, а дело
  // остаётся тем же. Две ждущие означали бы, что модератор одобряет изменения в
  // порядке, которого никто не выбирал. Различия всегда считаются от живой
  // карточки, поэтому «было» в деле — это то, что сейчас на витрине.
  const existing = await prisma.companyRevision.findFirst({
    where: { companyId: company.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const changes = split.pending as unknown as Prisma.InputJsonValue;
  const revision = existing
    ? await prisma.companyRevision.update({
        where: { id: existing.id },
        data: { changes, documents: docs.length > 0 ? (docs as unknown as Prisma.InputJsonValue) : undefined, authorId: userId },
      })
    : await prisma.companyRevision.create({
        data: {
          companyId: company.id,
          authorId: userId,
          changes,
          documents: docs.length > 0 ? (docs as unknown as Prisma.InputJsonValue) : undefined,
        },
      });

  await ensureCase({
    subjectType: "COMPANY_REVISION",
    subjectId: revision.id,
    title: company.displayName,
    applicantUserId: company.ownerUserId,
  });
  await logCompanyAction({
    companyId,
    actorUserId: userId,
    action: "PROFILE_CHANGES_SUBMITTED",
    subject: company.displayName,
  });
  revalidatePath("/", "layout");
  return { ok: true as const, moderated: split.pending.length };
}

export async function submitCompanyPoint(
  companyId: string,
  input: CompanyPointInput & { socials?: { network: string; url: string }[] },
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const gate = await editorCompany(companyId, userId);
  if (!gate || gate.permissions.points !== "EDIT") return { ok: false as const, reason: "not_found" as const };
  // Новая точка участком не ограничивается: её ещё нет ни в одном участке, а
  // запретить сотруднику заводить точку значило бы запереть раздел целиком.
  const company = await prisma.company.findFirst({ where: { id: companyId, ...NOT_DELETED } });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const pending = await prisma.companyPoint.count({
    where: { companyId: company.id, status: "PENDING", ...NOT_DELETED },
  });
  if (pending >= MAX_PENDING_POINTS) return { ok: false as const, reason: "too_many_pending" as const };

  // Заявить приём можно только одобренной карточки: иначе точка указывала бы
  // на листинг, которого публично не существует.
  if (v.data.acceptedCardIds.length > 0) {
    const approved = await prisma.coinCard.count({
      where: { id: { in: v.data.acceptedCardIds }, status: "APPROVED" },
    });
    if (approved !== v.data.acceptedCardIds.length) {
      return { ok: false as const, reason: "coin_not_selectable" as const };
    }
  }
  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
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
      acceptedCardIds: v.data.acceptedCardIds,
      logoUrl: v.data.logoUrl,
      photos: v.data.photos.length ? (v.data.photos as unknown as Prisma.InputJsonValue) : undefined,
      openingHours: v.data.openingHours,
      hours: (v.data.hours ?? undefined) as Prisma.InputJsonValue | undefined,
      timezone: v.data.timezone,
      category: v.data.category,
      phone: v.data.phone,
      website: v.data.website,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
    },
  });
  await ensureCase({
    subjectType: "POINT",
    subjectId: point.id,
    title: point.name,
    applicantUserId: company.ownerUserId,
  });
  await logCompanyAction({ companyId, actorUserId: userId, action: "POINT_SUBMITTED", subject: point.name });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Правка существующей точки. Контактные поля меняются молча; смена типа,
 * названия, адреса, координат или набора принимаемых монет возвращает точку в
 * очередь модерации — иначе одобренную точку можно было бы переписать во
 * что угодно уже после проверки.
 */
export async function updateCompanyPoint(
  pointId: string,
  input: CompanyPointInput & { socials?: { network: string; url: string }[] },
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const point = await prisma.companyPoint.findFirst({
    where: { id: pointId, ...LIVE_POINT },
  });
  if (!point) return { ok: false as const, reason: "not_found" as const };

  const gate = await editorCompany(point.companyId, userId);
  if (!gate || gate.permissions.points !== "EDIT") return { ok: false as const, reason: "not_found" as const };
  // Сотрудник участка правит только свои точки.
  if (!pointScopeAllows(gate.pointScope, point.id)) return { ok: false as const, reason: "not_found" as const };

  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };

  if (v.data.acceptedCardIds.length > 0) {
    const approved = await prisma.coinCard.count({
      where: { id: { in: v.data.acceptedCardIds }, status: "APPROVED" },
    });
    if (approved !== v.data.acceptedCardIds.length) {
      return { ok: false as const, reason: "coin_not_selectable" as const };
    }
  }

  const needsModeration = pointEditNeedsModeration(
    {
      type: point.type, name: point.name, countryCode: point.countryCode, city: point.city,
      street: point.street, houseNumber: point.houseNumber, postalCode: point.postalCode,
      lat: point.lat, lon: point.lon,
      acceptedCoinIds: point.acceptedCoinIds, acceptedCardIds: point.acceptedCardIds,
    },
    {
      type: v.data.type, name: v.data.name, countryCode: v.data.countryCode, city: v.data.city,
      street: v.data.street, houseNumber: v.data.houseNumber, postalCode: v.data.postalCode,
      lat: v.data.lat, lon: v.data.lon,
      acceptedCoinIds: v.data.acceptedCoinIds, acceptedCardIds: v.data.acceptedCardIds,
    },
  );

  await prisma.companyPoint.update({
    where: { id: point.id },
    data: {
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
      acceptedCardIds: v.data.acceptedCardIds,
      logoUrl: v.data.logoUrl,
      photos: v.data.photos.length ? (v.data.photos as unknown as Prisma.InputJsonValue) : undefined,
      openingHours: v.data.openingHours,
      // Часы, пояс и вид заведения — свободные поля: правка не возвращает точку в
      // очередь. На праздники часы меняют каждый год, а возврат означает, что
      // точка уходит с карты до решения человека (правило AT).
      // `null` в JSONB-колонке Prisma требует `DbNull`; строкой "null" тут была бы
      // запись слова вместо очистки поля.
      hours: (v.data.hours ?? Prisma.DbNull) as Prisma.InputJsonValue,
      timezone: v.data.timezone,
      category: v.data.category,
      phone: v.data.phone,
      website: v.data.website,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
      // Возврат на модерацию стирает прежнее решение: оно относилось к другой точке.
      ...(needsModeration
        ? { status: "PENDING" as const, reviewedById: null, reviewedAt: null, rejectReason: null }
        : {}),
    },
  });
  if (needsModeration) {
    // Прежнее решение стёрто — значит объект снова ждёт человека. Без этого
    // вызова точка лежала бы в PENDING, а дела в очереди не было: решённое
    // дело заведение само не открывает, это делает `ensureCase`.
    const owner = await prisma.companyMember.findFirst({
      where: { companyId: point.companyId, role: "OWNER" },
      select: { userId: true },
    });
    await ensureCase({
      subjectType: "POINT",
      subjectId: point.id,
      title: v.data.name,
      applicantUserId: owner?.userId ?? null,
    });
  }
  await logCompanyAction({
    companyId: point.companyId,
    actorUserId: userId,
    action: "POINT_UPDATED",
    subject: v.data.name,
    meta: { moderated: needsModeration },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, moderated: needsModeration };
}
