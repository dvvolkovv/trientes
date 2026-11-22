"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireQueue } from "@/lib/authz/guard";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import { NOT_DELETED } from "@/lib/soft-delete";
import { changesToPatch, parseChanges, toCompanyPatch } from "@/lib/company-edit";
import { displayAddress } from "@/lib/company";
import { ensureCase } from "@/lib/cases/ensure";

/**
 * Решение по правке карточки предприятия (слайс BM).
 *
 * Правка — отдельный объект, и решение применяется к предприятию только здесь:
 * `saveCompanyProfile` в карточку залистованного предприятия модерируемые поля не
 * пишет вовсе. Тот же порядок, что у ревизии паспорта товара в BB.
 */

type Res = { ok: true } | { ok: false; reason: string };

export async function approveCompanyRevision(input: { revisionId: string }): Promise<Res> {
  const admin = await requireQueue("companies", "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const rev = await prisma.companyRevision.findUnique({
    where: { id: input.revisionId },
    include: { company: { select: { id: true, displayName: true, ownerUserId: true, deletedAt: true } } },
  });
  if (!rev || rev.company.deletedAt) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING") return { ok: false, reason: "not_pending" };

  const changes = parseChanges(rev.changes);
  if (changes.length === 0) return { ok: false, reason: "nothing_to_apply" };
  const patch = changesToPatch(changes);
  // В предприятие пишем через `toCompanyPatch`: набор монет (слайс BX) в базе
  // массив, а в наборе изменений он лежит строкой — её читает человек. Строка
  // `patch` остаётся для пересчёта выводимого адреса, он тоже строковый.
  const dataPatch = toCompanyPatch(patch);
  const docs = Array.isArray(rev.documents) ? rev.documents : [];
  // Правка юридического имени — повторная проверка лица: присланные бумаги
  // дописываются к пакету, статус проверки возвращается в «на проверке», и дело KYB
  // открывается заново. Предприятие с витрины при этом не снимается: снимает его
  // только человек (правило AR).
  const reverifies = docs.length > 0 && changes.some((c) => c.field === "legalName");

  await prisma.$transaction(async (tx) => {
    const current = await tx.company.findFirst({
      where: { id: rev.companyId, ...NOT_DELETED },
      select: {
        kybDocuments: true,
        street: true, houseNumber: true, postalCode: true, city: true, country: true,
      },
    });
    // Выводимая строка адреса пересчитывается здесь, а не ждёт своей правки:
    // источник у неё один — структурные части, которые модератор только что принял.
    const addressPatch = current
      ? displayAddress({
          street: patch.street !== undefined ? patch.street : current.street,
          houseNumber: patch.houseNumber !== undefined ? patch.houseNumber : current.houseNumber,
          postalCode: patch.postalCode !== undefined ? patch.postalCode : current.postalCode,
          city: patch.city !== undefined ? patch.city : current.city,
          country: patch.country !== undefined ? patch.country : current.country,
        })
      : null;
    const existingDocs = Array.isArray(current?.kybDocuments) ? current!.kybDocuments : [];
    await tx.company.update({
      where: { id: rev.companyId },
      data: {
        ...dataPatch,
        ...(addressPatch ? { address: addressPatch } : {}),
        ...(reverifies
          ? {
              kybStatus: "PENDING",
              kybSubmittedAt: new Date(),
              kybRejectionReason: null,
              kybDocuments: [...existingDocs, ...docs] as never,
            }
          : {}),
      },
    });
    await tx.companyRevision.update({
      where: { id: rev.id },
      data: { status: "APPROVED", decidedById: admin.userId, decidedAt: new Date() },
    });
  });

  if (reverifies) {
    await ensureCase({
      subjectType: "KYB",
      subjectId: rev.companyId,
      title: rev.company.displayName,
      applicantUserId: rev.company.ownerUserId,
    });
  }

  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_COMPANY_REVISION",
    targetType: "Company",
    targetId: rev.companyId,
    details: { revisionId: rev.id, fields: changes.map((c) => c.field), reverifies },
  });
  void notifyUser({
    userId: rev.company.ownerUserId,
    text: `✅ Changes to your company card "${rev.company.displayName}" were approved on Trientes.`,
    subject: `Company changes approved: ${rev.company.displayName}`,
    url: `https://trientes.org/en/cabinet/companies/${rev.companyId}`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectCompanyRevision(input: {
  revisionId: string;
  reason: string;
  silent?: boolean;
}): Promise<Res> {
  const admin = await requireQueue("companies", "APPROVE");
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const rev = await prisma.companyRevision.findUnique({
    where: { id: input.revisionId },
    include: { company: { select: { id: true, displayName: true, ownerUserId: true } } },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.companyRevision.update({
    where: { id: rev.id },
    data: { status: "REJECTED", decidedById: admin.userId, decidedAt: new Date(), reason },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_COMPANY_REVISION",
    targetType: "Company",
    targetId: rev.companyId,
    details: { revisionId: rev.id, reason },
  });
  if (input.silent !== true) {
    void notifyUser({
      userId: rev.company.ownerUserId,
      text: `❌ Changes to your company card "${rev.company.displayName}" were not accepted.\nReason: ${reason}`,
      subject: `Company changes rejected: ${rev.company.displayName}`,
      url: `https://trientes.org/en/cabinet/companies/${rev.companyId}`,
    }).catch(() => {});
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
