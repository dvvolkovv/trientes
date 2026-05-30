"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";

export async function approveCompany(input: { companyId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  if (company.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.company.update({
    where: { id: company.id },
    data: {
      status: "APPROVED",
      rejectionReason: null,
      reviewedById: admin.userId,
      reviewedAt: new Date(),
    },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_COMPANY",
    targetType: "Company",
    targetId: company.id,
    details: { displayName: company.displayName, legalName: company.legalName },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectCompany(input: { companyId: string; rejectionReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectionReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  if (company.status !== "PENDING") return { ok: false, reason: "not_pending" };
  await prisma.company.update({
    where: { id: company.id },
    data: {
      status: "REJECTED",
      rejectionReason: reason,
      reviewedById: admin.userId,
      reviewedAt: new Date(),
    },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "REJECT_COMPANY",
    targetType: "Company",
    targetId: company.id,
    details: { reason },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
