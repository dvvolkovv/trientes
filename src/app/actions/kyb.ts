"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAdminAction } from "@/lib/admin/audit";
import { checkAdmin } from "@/lib/is-admin";
import { notifyUser } from "@/lib/notify";

const KYB_KINDS = ["REGISTRATION_CERT", "TAX_CERT", "ID", "OTHER"] as const;

const documentSchema = z.object({
  kind: z.enum(KYB_KINDS),
  url: z.string().url().refine((s) => {
    try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
    catch { return false; }
  }),
  label: z.string().max(120).optional().nullable(),
});

const submitSchema = z.object({
  companyId: z.string().min(1),
  documents: z.array(documentSchema).min(1).max(8),
});

async function requireOwner(companyId: string, userId: string): Promise<boolean> {
  const m = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  return m?.role === "OWNER";
}

export async function submitKyb(input: unknown) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "invalid" as const };
  if (!(await requireOwner(parsed.data.companyId, userId))) {
    return { ok: false as const, reason: "forbidden" as const };
  }

  const company = await prisma.company.findUnique({
    where: { id: parsed.data.companyId },
    select: { kybStatus: true },
  });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  if (company.kybStatus === "APPROVED") return { ok: false as const, reason: "already_verified" as const };

  await prisma.company.update({
    where: { id: parsed.data.companyId },
    data: {
      kybStatus: "PENDING",
      kybDocuments: parsed.data.documents,
      kybSubmittedAt: new Date(),
      kybRejectionReason: null,
      kybReviewedAt: null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function withdrawKyb(input: { companyId: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!(await requireOwner(input.companyId, userId))) {
    return { ok: false as const, reason: "forbidden" as const };
  }

  await prisma.company.update({
    where: { id: input.companyId },
    data: {
      kybStatus: "NONE",
      kybDocuments: undefined,
      kybSubmittedAt: null,
      kybReviewedAt: null,
      kybRejectionReason: null,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function approveKyb(input: { companyId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { ownerUserId: true, displayName: true, kybStatus: true },
  });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  if (company.kybStatus !== "PENDING") return { ok: false as const, reason: "not_pending" as const };
  await prisma.company.update({
    where: { id: input.companyId },
    data: { kybStatus: "APPROVED", kybReviewedAt: new Date(), kybRejectionReason: null },
  });
  await logAdminAction({
    actorId: admin.userId, action: "APPROVE_COMPANY", targetType: "Company", targetId: input.companyId,
    details: { kyb: true, displayName: company.displayName },
  });
  void notifyUser({
    userId: company.ownerUserId,
    text: `🔒 KYB verification approved for "${company.displayName}". Your company now shows a Verified badge.`,
    subject: `KYB approved: ${company.displayName}`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function rejectKyb(input: { companyId: string; reason: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false as const, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false as const, reason: "reason_too_short" as const };
  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: { ownerUserId: true, displayName: true, kybStatus: true },
  });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  if (company.kybStatus !== "PENDING") return { ok: false as const, reason: "not_pending" as const };
  await prisma.company.update({
    where: { id: input.companyId },
    data: { kybStatus: "REJECTED", kybReviewedAt: new Date(), kybRejectionReason: reason },
  });
  await logAdminAction({
    actorId: admin.userId, action: "REJECT_COMPANY", targetType: "Company", targetId: input.companyId,
    details: { kyb: true, reason },
  });
  void notifyUser({
    userId: company.ownerUserId,
    text: `🔒 KYB verification not approved for "${company.displayName}".\nReason: ${reason}`,
    subject: `KYB not approved: ${company.displayName}`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true as const };
}
