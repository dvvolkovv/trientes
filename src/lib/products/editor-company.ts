/**
 * Предприятие глазами правила правки: статус, надзор, удаление и **права** того, кто
 * нажал. Читается из базы на каждом вызове — снятое надзором предприятие перестаёт
 * править паспорта, цены и остатки тем же сеансом, без перезахода; снятое право
 * действует так же сразу (прецедент AS — грант сотрудника платформы).
 *
 * Жил внутри `src/app/actions/products.ts`; вынесен в слайсе BC, потому что то же
 * правило нужно предложениям и складам. В слайсе BE отдаёт не роль, а набор прав по
 * разделам и участок по точкам продаж.
 */
import { prisma } from "@/lib/prisma";
import {
  type TeamPermissions,
  type TeamSection,
  can,
  parsePermissions,
  permissionsFor,
} from "@/lib/company-team/permissions";
import type { EditorCompany } from "@/lib/products/rules";

export type CompanyGate = EditorCompany & {
  displayName: string;
  /// Роль фазы 10 — нужна там, где решение принадлежит владельцу (команда, KYB).
  role: "OWNER" | "EDITOR" | "VIEWER";
  /// Точки участка. Пусто — все точки предприятия.
  pointScope: string[];
};

export async function editorCompany(companyId: string, userId: string): Promise<CompanyGate | null> {
  const [company, member] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, status: true, suspendedAt: true, deletedAt: true, displayName: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: {
        role: true,
        teamRole: { select: { permissions: true } },
        points: { select: { pointId: true } },
      },
    }),
  ]);
  if (!company || !member) return null;
  const permissions: TeamPermissions = permissionsFor({
    role: member.role,
    rolePermissions: member.teamRole ? parsePermissions(member.teamRole.permissions) : null,
  });
  return {
    id: company.id,
    status: company.status,
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    displayName: company.displayName,
    role: member.role,
    permissions,
    pointScope: member.points.map((p) => p.pointId),
  };
}

/**
 * Может ли этот человек писать в названный раздел: предприятие залистовано, живо, не
 * снято надзором, и право на раздел есть. Раздел — обязательный параметр: забытый вызов
 * должен падать на сборке, а не тихо пускать кладовщика в цену.
 */
export function canWrite(company: CompanyGate | null, section: TeamSection): boolean {
  if (!company) return false;
  if (company.status !== "APPROVED") return false;
  if (company.suspendedAt || company.deletedAt) return false;
  return can(company.permissions, section, "EDIT");
}

/** То же для чтения раздела: нет права — раздела в кабинете не видно вовсе. */
export function canSee(company: CompanyGate | null, section: TeamSection): boolean {
  if (!company) return false;
  if (company.deletedAt) return false;
  return can(company.permissions, section, "VIEW");
}
