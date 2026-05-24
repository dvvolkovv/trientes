import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// The signed-in user's company (or null). Used to gate the /business cabinet.
export async function getViewerCompany() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { userId: null, company: null };
  const company = await prisma.company.findUnique({ where: { ownerUserId: userId } });
  return { userId, company };
}
