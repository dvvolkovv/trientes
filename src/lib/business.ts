import type { CompanyRole } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NOT_DELETED } from "@/lib/soft-delete";
import {
  type TeamPermissions,
  type TeamSection,
  can,
  parsePermissions,
  permissionsFor,
} from "@/lib/company-team/permissions";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerCompanies() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, companies: [] };
  // Any membership (OWNER / EDITOR / VIEWER) shows up in the cabinet list.
  const companies = await prisma.company.findMany({
    where: { members: { some: { userId } }, ...NOT_DELETED },
    orderBy: { createdAt: "asc" },
  });
  return { userId, companies };
}

export type ViewerCompanyResult =
  | {
      userId: string;
      company: NonNullable<Awaited<ReturnType<typeof prisma.company.findUnique>>>;
      role: CompanyRole;
      /// Права по разделам кабинета (слайс BE): раздел без права не показываем вовсе.
      permissions: TeamPermissions;
      /// Участок по точкам продаж. Пусто — все точки.
      pointScope: string[];
    }
  | { userId: string | null; company: null; role: null; permissions: TeamPermissions; pointScope: string[] };

export async function getViewerCompanyById(companyId: string): Promise<ViewerCompanyResult> {
  const empty = { permissions: {} as TeamPermissions, pointScope: [] as string[] };
  const userId = await viewerId();
  if (!userId) return { userId: null, company: null, role: null, ...empty };
  const [company, membership] = await Promise.all([
    prisma.company.findFirst({ where: { id: companyId, ...NOT_DELETED } }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: {
        role: true,
        teamRole: { select: { permissions: true } },
        points: { select: { pointId: true } },
      },
    }),
  ]);
  if (!company || !membership) return { userId, company: null, role: null, ...empty };
  return {
    userId,
    company,
    role: membership.role,
    permissions: permissionsFor({
      role: membership.role,
      rolePermissions: membership.teamRole ? parsePermissions(membership.teamRole.permissions) : null,
    }),
    pointScope: membership.points.map((p) => p.pointId),
  };
}

/** Правит ли человек названный раздел кабинета. */
export function canEditSection(permissions: TeamPermissions, section: TeamSection): boolean {
  return can(permissions, section, "EDIT");
}

/** Видит ли человек названный раздел: нет права — ссылки в полосе разделов нет. */
export function canSeeSection(permissions: TeamPermissions, section: TeamSection): boolean {
  return can(permissions, section, "VIEW");
}

export function canManageMembers(role: CompanyRole | null | undefined): boolean {
  return role === "OWNER";
}
