"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  validateCompanyProfile,
  validateCompanyPoint,
  type CompanyProfileInput,
  type CompanyPointInput,
} from "@/lib/company";
import { type PointType, type Prisma } from "@prisma/client";

const MAX_PENDING_POINTS = 20;

async function requireUser() {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

async function memberRole(companyId: string, userId: string) {
  const m = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

export async function createCompany(input: { legalName: string; displayName: string }) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
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
  revalidatePath("/", "layout");
  return { ok: true as const, id: company.id };
}

export async function saveCompanyProfile(companyId: string, input: CompanyProfileInput) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const role = await memberRole(companyId, userId);
  if (role !== "OWNER" && role !== "EDITOR") return { ok: false as const, reason: "not_found" as const };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyProfile(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  await prisma.company.update({ where: { id: company.id }, data: v.data });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function submitCompanyPoint(
  companyId: string,
  input: CompanyPointInput & { socials?: { network: string; url: string }[] },
) {
  const userId = await requireUser();
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  const role = await memberRole(companyId, userId);
  if (role !== "OWNER" && role !== "EDITOR") return { ok: false as const, reason: "not_found" as const };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { ok: false as const, reason: "not_found" as const };
  const v = validateCompanyPoint(input);
  if (!v.ok) return { ok: false as const, reason: v.reason };
  const pending = await prisma.companyPoint.count({
    where: { companyId: company.id, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_POINTS) return { ok: false as const, reason: "too_many_pending" as const };
  await prisma.companyPoint.create({
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
      logoUrl: v.data.logoUrl,
      photos: v.data.photos.length ? (v.data.photos as unknown as Prisma.InputJsonValue) : undefined,
      openingHours: v.data.openingHours,
      phone: v.data.phone,
      website: v.data.website,
      socials: Array.isArray(input.socials) ? input.socials : undefined,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
