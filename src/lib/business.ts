import type { CompanyRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerCompanies() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, companies: [] };
  // Any membership (OWNER / EDITOR / VIEWER) shows up in the cabinet list.
  const companies = await prisma.company.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "asc" },
  });
  return { userId, companies };
}

export type ViewerCompanyResult =
  | { userId: string; company: NonNullable<Awaited<ReturnType<typeof prisma.company.findUnique>>>; role: CompanyRole }
  | { userId: string | null; company: null; role: null };

export async function getViewerCompanyById(companyId: string): Promise<ViewerCompanyResult> {
  const userId = await viewerId();
  if (!userId) return { userId: null, company: null, role: null };
  const [company, membership] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true },
    }),
  ]);
  if (!company || !membership) return { userId, company: null, role: null };
  return { userId, company, role: membership.role };
}

export function canEditCompany(role: CompanyRole | null | undefined): boolean {
  return role === "OWNER" || role === "EDITOR";
}

export function canManageMembers(role: CompanyRole | null | undefined): boolean {
  return role === "OWNER";
}
