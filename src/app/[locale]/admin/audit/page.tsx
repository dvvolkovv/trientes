import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { AuditTable } from "@/components/admin/audit-table";
import { AuditFilters } from "@/components/admin/audit-filters";
import type { Prisma, AdminAction } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const ACTIONS = new Set<AdminAction>([
  "APPROVE_REQUEST",
  "REJECT_REQUEST",
  "ADD_COIN",
  "TOGGLE_COIN_ACTIVE",
  "SET_USER_ROLE",
]);

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; action?: string; page?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("admin.audit");

  const q = (sp.q ?? "").trim();
  const action =
    sp.action && ACTIONS.has(sp.action as AdminAction)
      ? (sp.action as AdminAction)
      : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.AdminAuditLogWhereInput = {};
  if (action) where.action = action;
  if (q) {
    where.OR = [
      { targetId: { contains: q, mode: "insensitive" } },
      { actor: { email: { contains: q, mode: "insensitive" } } },
      { actor: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { actor: { select: { email: true, name: true } } },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const baseQs = new URLSearchParams();
  if (q) baseQs.set("q", q);
  if (action) baseQs.set("action", action);
  const pageHref = (p: number) => {
    const next = new URLSearchParams(baseQs);
    if (p > 1) next.set("page", String(p));
    const qs = next.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <>
      <AdminNav locale={locale} active="audit" />
      <header className="mb-8">
        <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-3">
          Admin
        </div>
        <h1 className="text-[40px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
          {t("title")}
        </h1>
        <p className="text-muted">{t("subtitle")}</p>
      </header>

      <AuditFilters
        labels={{
          searchPlaceholder: t("searchPlaceholder"),
          allActions: t("allActions"),
          apply: t("apply"),
          reset: t("reset"),
        }}
      />

      <div className="num text-[11px] uppercase tracking-[0.18em] text-muted mb-3">
        {t("resultCount", { total, page, totalPages })}
      </div>

      <AuditTable rows={rows} />

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2">
          {page > 1 && (
            <a
              href={pageHref(page - 1)}
              className="bg-card border border-hairline num text-[11px] uppercase tracking-[0.18em] px-4 py-2 rounded-[10px]"
            >
              ← {t("prev")}
            </a>
          )}
          <span className="num text-[11px] text-muted px-3">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={pageHref(page + 1)}
              className="bg-card border border-hairline num text-[11px] uppercase tracking-[0.18em] px-4 py-2 rounded-[10px]"
            >
              {t("next")} →
            </a>
          )}
        </nav>
      )}
    </>
  );
}
