import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { companyAcceptsMessages } from "@/lib/customer-messages/rules";
import { readThread } from "@/lib/customer-messages/read";
import { ThreadView } from "@/components/customer-messages/thread-view";

export const dynamic = "force-dynamic";

/**
 * Разговор глазами покупателя. Имени сотрудника здесь нет: магазин отвечает одним
 * голосом (§ 2.3). Блокировку покупатель видит словами «магазин закрыл переписку», без
 * причины — причина внутренняя.
 */
export default async function CustomerThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; threadId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { locale, threadId } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("customerMessages");
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/cabinet/messages/${threadId}`)}`);
  }

  const own = await prisma.customerThread.findFirst({
    where: { id: threadId, customerUserId: userId },
    select: {
      id: true,
      company: { select: { id: true, status: true, suspendedAt: true, deletedAt: true } },
    },
  });
  if (!own) notFound();

  const before = query.before ? new Date(query.before) : null;
  const thread = await readThread(threadId, "CUSTOMER", {
    before: before && !Number.isNaN(before.getTime()) ? before : null,
  });
  if (!thread) notFound();

  const active = companyAcceptsMessages(own.company);

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <div>
        <Link href={`/${locale}/cabinet/messages`} className="text-[12px] text-muted underline">
          ← {t("myTitle")}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">{thread.companyName}</h1>
        {thread.blockedAt ? (
          <p className="mt-2 rounded-[14px] border border-hairline bg-card p-3 text-sm text-muted">
            {t("closedByStore")}
          </p>
        ) : null}
      </div>

      {thread.earlierBefore ? (
        <Link
          href={`/${locale}/cabinet/messages/${thread.id}?before=${encodeURIComponent(thread.earlierBefore.toISOString())}`}
          className="block text-center text-[12px] text-muted underline"
        >
          {t("earlier")}
        </Link>
      ) : null}

      <ThreadView
        threadId={thread.id}
        companyId={null}
        side="CUSTOMER"
        viewerUserId={userId}
        canPost={active && !thread.blockedAt}
        isOwner={false}
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
    </main>
  );
}
