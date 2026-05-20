import { redirect } from "next/navigation";
import { auth } from "@/auth";

export type AdminCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauth" | "not_admin" };

export async function checkAdmin(): Promise<AdminCheckResult> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return { ok: false, reason: "unauth" };
  if (user.role !== "ADMIN") return { ok: false, reason: "not_admin" };
  return { ok: true, userId: user.id };
}

export async function requireAdmin(redirectLocale: string): Promise<string> {
  const r = await checkAdmin();
  if (!r.ok) redirect(`/${redirectLocale}/login`);
  return r.userId;
}
