"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { notifyUser } from "@/lib/notify";
import { logoForDomain } from "@/lib/logo";
import { NOT_DELETED } from "@/lib/soft-delete";

export async function approveCompany(input: { companyId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const company = await prisma.company.findFirst({ where: { id: input.companyId, ...NOT_DELETED } });
  if (!company) return { ok: false, reason: "not_found" };
  if (company.status !== "PENDING") return { ok: false, reason: "not_pending" };
  const derivedLogo = company.logoUrl ? null : logoForDomain(company.website);
  await prisma.company.update({
    where: { id: company.id },
    data: {
      status: "APPROVED",
      rejectionReason: null,
      reviewedById: admin.userId,
      reviewedAt: new Date(),
      ...(derivedLogo ? { logoUrl: derivedLogo } : {}),
    },
  });
  await logAdminAction({
    actorId: admin.userId,
    action: "APPROVE_COMPANY",
    targetType: "Company",
    targetId: company.id,
    details: { displayName: company.displayName, legalName: company.legalName },
  });
  void notifyUser({
    userId: company.ownerUserId,
    text: `✅ Your company "${company.displayName}" was approved on Trientes.\nhttps://trientes.org/en/companies/${company.id}`,
    subject: `Company approved: ${company.displayName}`,
    url: `https://trientes.org/en/companies/${company.id}`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectCompany(input: { companyId: string; rejectionReason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.rejectionReason.trim();
  if (reason.length < 3) return { ok: false, reason: "reason_too_short" };
  const company = await prisma.company.findFirst({ where: { id: input.companyId, ...NOT_DELETED } });
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
  void notifyUser({
    userId: company.ownerUserId,
    text: `❌ Your company "${company.displayName}" was not approved.\nReason: ${reason}`,
    subject: `Company not approved: ${company.displayName}`,
    url: `https://trientes.org/en/business`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}
