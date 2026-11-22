import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { ADMIN_COLUMN, ADMIN_BUTTON } from "@/lib/admin-ui";
import { can } from "@/lib/company-team/permissions";
import { readThread } from "@/lib/customer-messages/read";
import { ThreadView } from "@/components/customer-messages/thread-view";
import { BlockCustomerForm } from "@/components/customer-messages/block-customer-form";
import { CabinetBackButton } from "@/components/cabinet/company-back";

export const dynamic = "force-dynamic";

/** Разговор с покупателем глазами магазина: ответ, блокировка, история. */
export default async function CompanyThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string; threadId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { locale, id, threadId } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("customerMessages");
  const { userId, company, role, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!can(permissions, "customers", "VIEW")) notFound();

  const before = query.before ? new Date(query.before) : null;
  const thread = await readThread(threadId, "STORE", {
    before: before && !Number.isNaN(before.getTime()) ? before : null,
  });
  if (!thread || thread.companyId !== company.id) notFound();

  const base = `/${locale}/cabinet/companies/${company.id}`;
  const mayReply = can(permissions, "customers", "EDIT");
  const active = company.status === "APPROVED" && !company.suspendedAt && !company.deletedAt;

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <CabinetBackButton locale={locale} />
      <div>
        <Link href={`${base}/inbox`} className="text-[12px] text-muted underline">
          ← {t("inboxTitle")}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">{thread.customerLabel}</h1>
        {thread.blockedAt ? (
          <p className="mt-2 rounded-[14px] border border-down/40 bg-down/5 p-3 text-sm">
            {t("blockedNotice")}
            {thread.blockReason ? <span className="block text-muted">{thread.blockReason}</span> : null}
          </p>
        ) : null}
      </div>

      {thread.earlierBefore ? (
        <Link
          href={`${base}/inbox/${thread.id}?before=${encodeURIComponent(thread.earlierBefore.toISOString())}`}
          className="block text-center text-[12px] text-muted underline"
        >
          {t("earlier")}
        </Link>
      ) : null}

      <ThreadView
        threadId={thread.id}
        companyId={company.id}
        side="STORE"
        viewerUserId={userId}
        canPost={mayReply && active}
        isOwner={canManageMembers(role)}
        blocked={Boolean(thread.blockedAt)}
        initial={thread.rows.map((row) => ({
          id: row.id,
          body: row.body,
          side: row.side,
          createdAt: row.createdAt.toISOString(),
          mine: row.mine,
          withdrawn: row.withdrawn,
          authorLabel: row.authorLabel,
          authorUserId: row.authorUserId,
        }))}
        paged={Boolean(before)}
      />

      {mayReply ? (
        <BlockCustomerForm
          companyId={company.id}
          threadId={thread.id}
          blocked={Boolean(thread.blockedAt)}
          buttonClass={ADMIN_BUTTON}
        />
      ) : null}
    </main>
  );
}
