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
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("users.title")}
        </h1>
        <p className="text-muted">{t("users.subtitle")}</p>
      </header>

      <div className="mb-6">
        <AdminSearchInput placeholder={t("users.searchPlaceholder")} />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-card border border-hairline rounded-[20px] overflow-hidden mt-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-hairline">
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("users.email")}
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("users.name")}
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("users.providers")}
              </th>
              <th className="text-left text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("users.role")}
              </th>
              <th className="text-right text-[11px] uppercase tracking-[0.18em] text-muted font-medium px-5 py-4">
                {t("users.action")}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr
                key={u.id}
                className={idx < users.length - 1 ? "border-b border-hairline" : ""}
              >
                <td className="px-5 py-4 text-sm">{u.email ?? "—"}</td>
                <td className="px-5 py-4 text-sm">{u.name ?? "—"}</td>
                <td className="px-5 py-4 num text-[11px] text-muted">
                  {u.accounts.map((a) => a.provider).join(", ") || "—"}
                </td>
                <td className="px-5 py-4">
                  <span
                    className={
                      u.role === "ADMIN"
                        ? "bg-accent/15 text-accent num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                        : "bg-card-alt text-muted num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                    }
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  {admin.ok && admin.userId !== u.id && (
                    <UserRoleToggle userId={u.id} currentRole={u.role} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2 mt-6">
        {users.map((u) => (
          <div
            key={u.id}
            className="bg-card border border-hairline rounded-[16px] p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">
                  {u.email ?? u.name ?? "(no name)"}
                </div>
                {u.name && u.email && (
                  <div className="text-[12px] text-muted truncate">{u.name}</div>
                )}
              </div>
              <span
                className={
                  u.role === "ADMIN"
                    ? "bg-accent/15 text-accent num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium flex-shrink-0"
                    : "bg-card-alt text-muted num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium flex-shrink-0"
                }
              >
                {u.role}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="num text-[11px] text-muted truncate">
                {u.accounts.map((a) => a.provider).join(", ") || "no provider"}
              </div>
              {admin.ok && admin.userId !== u.id && (
                <UserRoleToggle userId={u.id} currentRole={u.role} />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
