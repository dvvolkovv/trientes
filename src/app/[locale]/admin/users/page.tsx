import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { AdminNav } from "@/components/admin/nav";
import { UserRoleToggle } from "@/components/admin/user-role-toggle";
import { AdminSearchInput } from "@/components/admin/search-input";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);

  const admin = await checkAdmin();
  const t = await getTranslations("admin");

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      accounts: { select: { provider: true } },
    },
  });

  return (
    <>
      <AdminNav locale={locale} active="users" />
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("users.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("users.subtitle")}</p>
      </header>

      <div className="mb-4">
        <AdminSearchInput placeholder={t("users.searchPlaceholder")} />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr className="border-b">
              <th className="px-3 py-2 text-left font-medium">{t("users.email")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.name")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.providers")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("users.role")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("users.action")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b">
                <td className="px-3 py-2">{u.email ?? "—"}</td>
                <td className="px-3 py-2">{u.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {u.accounts.map((a) => a.provider).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded ${
                      u.role === "ADMIN"
                        ? "bg-purple-500/15 text-purple-700 dark:text-purple-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  {admin.ok && admin.userId !== u.id && (
                    <UserRoleToggle userId={u.id} currentRole={u.role} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
