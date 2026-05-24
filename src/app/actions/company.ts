"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCompanyProfile, validateCompanyPoint } from "@/lib/company";
import type { PointType } from "@prisma/client";

const MAX_PENDING_POINTS = 20;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

// Register the signed-in user as a COMPANY (Variant A: open, no pre-verification).
export async function registerCompany(input: { legalName: string; displayName: string }) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const existing = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (existing) return { ok: false, reason: "already_company" };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  await prisma.$transaction([
    prisma.company.create({
      data: {
        ownerUserId: userId,
        legalName: v.data.legalName,
        displayName: v.data.displayName,
        description: v.data.description,
        country: v.data.country,
        address: v.data.address,
        phone: v.data.phone,
        email: v.data.email,
        website: v.data.website,
        logoUrl: v.data.logoUrl,
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { accountType: "COMPANY" } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveCompanyProfile(input: Parameters<typeof validateCompanyProfile>[0]) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (!company) return { ok: false, reason: "not_company" };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  await prisma.company.update({ where: { id: company.id }, data: v.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function submitCompanyPoint(input: Parameters<typeof validateCompanyPoint>[0] & { socials?: { network: string; url: string }[] }) {
  const userId = await requireUser();
  if (!userId) return { ok: false, reason: "unauth" };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  if (!company) return { ok: false, reason: "not_company" };
  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false, reason: v.reason };
  const pending = await prisma.companyPoint.count({ where: { companyId: company.id, status: "PENDING" } });
  if (pending >= MAX_PENDING_POINTS) return { ok: false, reason: "too_many_pending" };
  await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: v.data.type as PointType,
      name: v.data.name,
      description: v.data.description,
      lat: v.data.lat,
      lon: v.data.lon,
      address: v.data.address,
      acceptedCoinIds: v.data.acceptedCoinIds,
      logoUrl: v.data.logoUrl,
      openingHours: v.data.openingHours,
      phone: v.data.phone,
      website: v.data.website,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
