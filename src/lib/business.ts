import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function listViewerCompanies() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, companies: [] };
  const companies = await prisma.company.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "asc" },
  });
  return { userId, companies };
}

export async function getViewerCompanyById(companyId: string) {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, company: null };
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || company.ownerUserId !== userId) return { userId, company: null };
  return { userId, company };
}
