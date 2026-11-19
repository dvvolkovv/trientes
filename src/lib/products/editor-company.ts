/**
 * Предприятие глазами правила правки: статус, надзор, удаление и роль в нём того, кто
 * нажал. Читается из базы на каждом вызове — снятое надзором предприятие перестаёт
 * править паспорта, цены и остатки тем же сеансом, без перезахода.
 *
 * Жил внутри `src/app/actions/products.ts`; вынесен в слайсе BC, потому что то же
 * правило нужно предложениям и складам, а вторая копия разошлась бы с первой.
 */
import { prisma } from "@/lib/prisma";
import type { EditorCompany } from "@/lib/products/rules";

export async function editorCompany(
  companyId: string,
  userId: string,
): Promise<(EditorCompany & { displayName: string }) | null> {
  const [company, member] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, status: true, suspendedAt: true, deletedAt: true, displayName: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true },
    }),
  ]);
  if (!company || !member) return null;
  return {
    id: company.id,
    status: company.status,
    suspendedAt: company.suspendedAt,
    deletedAt: company.deletedAt,
    role: member.role,
    displayName: company.displayName,
  };
}

/** Может ли это предприятие вообще что-то писать: залистовано, живо, роль не VIEWER. */
export function canWrite(company: (EditorCompany & { displayName: string }) | null): boolean {
  if (!company) return false;
  if (company.status !== "APPROVED") return false;
  if (company.suspendedAt || company.deletedAt) return false;
  return company.role !== "VIEWER";
}
