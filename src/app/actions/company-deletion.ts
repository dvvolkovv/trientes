"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import { tally } from "@/lib/multisig";
import { LIVE_POINT, NOT_DELETED } from "@/lib/soft-delete";
import {
  canVoteOnDeletion,
  deletionExpiry,
  deletionThreshold,
  routeDeletion,
  validateDeletionReason,
} from "@/lib/company-deletion";
import type { CompanyRole, Prisma } from "@prisma/client";

type Fail = { ok: false; reason: string };
type Ok = { ok: true; applied: boolean; requestId?: string };
type Result = Ok | Fail;

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function roleIn(companyId: string, userId: string): Promise<CompanyRole | null> {
  const m = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

async function isSiteAdmin(): Promise<boolean> {
  return (await checkAdmin()).ok;
}

/** Мягкое удаление: запись остаётся, объект выпадает из всех выборок. */
async function markCompanyDeleted(
  tx: Prisma.TransactionClient,
  companyId: string,
  actorId: string,
) {
  await tx.company.update({
    where: { id: companyId },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
  // Точкам deletedAt не проставляем — они скрываются условием на компанию.
  // Их собственная история остаётся неперезаписанной.
}

async function markPointDeleted(
  tx: Prisma.TransactionClient,
  pointId: string,
  actorId: string,
) {
  await tx.companyPoint.update({
    where: { id: pointId },
    data: { deletedAt: new Date(), deletedById: actorId },
  });
}

/** Владельцы компании — им уходят уведомления и они же голосуют. */
async function ownersOf(companyId: string): Promise<string[]> {
  const rows = await prisma.companyMember.findMany({
    where: { companyId, role: "OWNER" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

function notifyOwners(owners: string[], exceptUserId: string, text: string, subject: string, url: string) {
  for (const uid of owners) {
    if (uid === exceptUserId) continue;
    void notifyUser({ userId: uid, text, subject, url }).catch(() => {});
  }
}

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Удалить компанию или, если прав на прямое удаление нет, попросить владельцев.
 * Решение владельца проекта: OWNER и админ сайта удаляют сразу, EDITOR — через
 * подтверждение владельцев, остальные не могут.
 */
export async function requestOrDeleteCompany(input: {
  companyId: string;
  reason?: string | null;
}): Promise<Result> {
  const userId = await viewerId();
  if (!userId) return { ok: false, reason: "unauth" };

  const company = await prisma.company.findFirst({
    where: { id: input.companyId, ...NOT_DELETED },
    select: { id: true, displayName: true },
  });
  if (!company) return { ok: false, reason: "not_found" };

  const reason = validateDeletionReason(input.reason);
  if (!reason.ok) return { ok: false, reason: reason.error };

  const [role, admin] = await Promise.all([roleIn(company.id, userId), isSiteAdmin()]);
  const route = routeDeletion({ role, isSiteAdmin: admin });
  if (route === "forbidden") return { ok: false, reason: "forbidden" };

  const owners = await ownersOf(company.id);

  if (route === "apply") {
    // Единственный владелец не уводит компанию из-под остальных членов: сначала
    // передайте владение или удалите людей.
    if (!admin && owners.length === 1) {
      const members = await prisma.companyMember.count({ where: { companyId: company.id } });
      if (members > 1) return { ok: false, reason: "last_owner_company" };
    }
    await prisma.$transaction(async (tx) => {
      await markCompanyDeleted(tx, company.id, userId);
      await tx.companyDeletionRequest.updateMany({
        where: { companyId: company.id, status: "PENDING" },
        data: { status: "APPLIED", decidedAt: new Date() },
      });
    });
    if (admin) {
      await logAdminAction({
        actorId: userId, action: "DELETE_COMPANY", targetType: "Company", targetId: company.id,
        details: { displayName: company.displayName, reason: reason.reason },
      });
    }
    notifyOwners(owners, userId,
      `🗑 Company "${company.displayName}" was deleted on Trientes.`,
      `Company deleted: ${company.displayName}`, `${SITE}/en/cabinet#companies`);
    revalidatePath("/", "layout");
    return { ok: true, applied: true };
  }

  // route === "request"
  const existing = await prisma.companyDeletionRequest.findFirst({
    where: { companyId: company.id, kind: "COMPANY", status: "PENDING" },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "request_exists" };

  const req = await prisma.companyDeletionRequest.create({
    data: {
      companyId: company.id,
      kind: "COMPANY",
      requestedById: userId,
      reason: reason.reason,
      thresholdAt: deletionThreshold({ ownerCount: owners.length, requesterIsOwner: false }),
      ownerCountAt: owners.length,
      expiresAt: deletionExpiry(),
    },
    select: { id: true },
  });
  notifyOwners(owners, userId,
    `❓ Deletion of company "${company.displayName}" was requested and needs your confirmation.`,
    `Deletion requested: ${company.displayName}`,
    `${SITE}/en/cabinet/companies/${company.id}#deletion-requests`);
  revalidatePath("/", "layout");
  return { ok: true, applied: false, requestId: req.id };
}

/** То же для одной точки приёма. */
export async function requestOrDeletePoint(input: {
  pointId: string;
  reason?: string | null;
}): Promise<Result> {
  const userId = await viewerId();
  if (!userId) return { ok: false, reason: "unauth" };

  const point = await prisma.companyPoint.findFirst({
    where: { id: input.pointId, ...LIVE_POINT },
    select: { id: true, name: true, companyId: true },
  });
  if (!point) return { ok: false, reason: "not_found" };

  const reason = validateDeletionReason(input.reason);
  if (!reason.ok) return { ok: false, reason: reason.error };

  const [role, admin] = await Promise.all([roleIn(point.companyId, userId), isSiteAdmin()]);
  const route = routeDeletion({ role, isSiteAdmin: admin });
  if (route === "forbidden") return { ok: false, reason: "forbidden" };

  const owners = await ownersOf(point.companyId);

  if (route === "apply") {
    await prisma.$transaction(async (tx) => {
      await markPointDeleted(tx, point.id, userId);
      await tx.companyDeletionRequest.updateMany({
        where: { pointId: point.id, status: "PENDING" },
        data: { status: "APPLIED", decidedAt: new Date() },
      });
    });
    if (admin) {
      await logAdminAction({
        actorId: userId, action: "DELETE_POINT", targetType: "CompanyPoint", targetId: point.id,
        details: { name: point.name, companyId: point.companyId, reason: reason.reason },
      });
    }
    notifyOwners(owners, userId,
      `🗑 Location "${point.name}" was deleted and is no longer on the navigator.`,
      `Location deleted: ${point.name}`,
      `${SITE}/en/cabinet/companies/${point.companyId}#your-points`);
    revalidatePath("/", "layout");
    return { ok: true, applied: true };
  }

  const existing = await prisma.companyDeletionRequest.findFirst({
    where: { pointId: point.id, status: "PENDING" },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "request_exists" };

  const req = await prisma.companyDeletionRequest.create({
    data: {
      companyId: point.companyId,
      kind: "POINT",
      pointId: point.id,
      requestedById: userId,
      reason: reason.reason,
      thresholdAt: deletionThreshold({ ownerCount: owners.length, requesterIsOwner: false }),
      ownerCountAt: owners.length,
      expiresAt: deletionExpiry(),
    },
    select: { id: true },
  });
  notifyOwners(owners, userId,
    `❓ Deletion of location "${point.name}" was requested and needs your confirmation.`,
    `Deletion requested: ${point.name}`,
    `${SITE}/en/cabinet/companies/${point.companyId}#deletion-requests`);
  revalidatePath("/", "layout");
  return { ok: true, applied: false, requestId: req.id };
}

/**
 * Голос владельца. Исход считает общая арифметика мультиподписи по снимку,
 * снятому при подаче: уход владельца на ходу не меняет идущее голосование.
 */
export async function voteOnDeletion(input: {
  requestId: string;
  vote: "APPROVE" | "REJECT";
}): Promise<Result> {
  const userId = await viewerId();
  if (!userId) return { ok: false, reason: "unauth" };

  const req = await prisma.companyDeletionRequest.findUnique({
    where: { id: input.requestId },
    include: { approvals: { select: { vote: true } } },
  });
  if (!req) return { ok: false, reason: "not_found" };
  if (req.status !== "PENDING") return { ok: false, reason: "not_pending" };

  const role = await roleIn(req.companyId, userId);
  if (!canVoteOnDeletion({ role, userId, requestedById: req.requestedById })) {
    return { ok: false, reason: "forbidden" };
  }

  try {
    await prisma.companyDeletionApproval.create({
      data: { requestId: req.id, userId, vote: input.vote },
    });
  } catch {
    // @@unique([requestId, userId]) — второй голос того же владельца.
    return { ok: false, reason: "already_voted" };
  }

  const approvals = req.approvals.filter((a) => a.vote === "APPROVE").length + (input.vote === "APPROVE" ? 1 : 0);
  const rejections = req.approvals.filter((a) => a.vote === "REJECT").length + (input.vote === "REJECT" ? 1 : 0);
  const { outcome } = tally({
    thresholdAt: req.thresholdAt,
    signerCountAt: req.ownerCountAt,
    approvals,
    rejections,
  });

  if (outcome === "WAITING") {
    revalidatePath("/", "layout");
    return { ok: true, applied: false, requestId: req.id };
  }

  if (outcome === "FAILED") {
    await prisma.companyDeletionRequest.update({
      where: { id: req.id },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    revalidatePath("/", "layout");
    return { ok: true, applied: false, requestId: req.id };
  }

  await prisma.$transaction(async (tx) => {
    if (req.kind === "COMPANY") await markCompanyDeleted(tx, req.companyId, userId);
    else if (req.pointId) await markPointDeleted(tx, req.pointId, userId);
    await tx.companyDeletionRequest.update({
      where: { id: req.id },
      data: { status: "APPLIED", decidedAt: new Date() },
    });
  });
  revalidatePath("/", "layout");
  return { ok: true, applied: true, requestId: req.id };
}

/** Отозвать свой же запрос, пока он не решён. */
export async function withdrawDeletion(input: { requestId: string }): Promise<Result> {
  const userId = await viewerId();
  if (!userId) return { ok: false, reason: "unauth" };
  const r = await prisma.companyDeletionRequest.updateMany({
    where: { id: input.requestId, requestedById: userId, status: "PENDING" },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  if (r.count === 0) return { ok: false, reason: "not_pending" };
  revalidatePath("/", "layout");
  return { ok: true, applied: false };
}
