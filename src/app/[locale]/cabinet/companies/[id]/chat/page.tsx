import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canManageMembers } from "@/lib/business";
import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { chatRightsFor, isMentionable } from "@/lib/company-chat/rules";
import { readChatMembers, readChatPage } from "@/lib/company-chat/read";
import { ChatRoom } from "@/components/chat/chat-room";

export const dynamic = "force-dynamic";

/**
 * Общий чат команды (слайс BP, ТЗ 6.6). Комната одна на предприятие и принадлежит
 * команде: читают и пишут все члены, включая наблюдателя — своего раздела прав у чата
 * нет намеренно (спека § 2.2).
 */
export default async function CompanyChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetChat");
  const { userId, company, role } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();

  const rights = chatRightsFor(company);
  if (!rights.read) notFound();

  const before = query.before ? new Date(query.before) : null;
  const [{ rows, earlierBefore }, members] = await Promise.all([
    readChatPage(company.id, { userId }, { before: before && !Number.isNaN(before.getTime()) ? before : null }),
    readChatMembers(company.id),
  ]);

  const base = `/${locale}/cabinet/companies/${company.id}`;

  return (
    <main className={`${ADMIN_COLUMN} overflow-x-clip py-8 space-y-5`}>
      <div>
        <Link href={`${base}/g/order`} className="text-[12px] text-muted underline">
          ← {company.displayName}
        </Link>
        <h1 className="mt-2 text-[26px] font-bold tracking-[-0.03em]">💬 {t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
      </div>

      {earlierBefore ? (
        <Link
          href={`${base}/chat?before=${encodeURIComponent(earlierBefore.toISOString())}`}
          className="block text-center text-[12px] text-muted underline"
        >
          {t("earlier")}
        </Link>
      ) : null}

      <ChatRoom
        companyId={company.id}
        isOwner={canManageMembers(role)}
        canPost={rights.post}
        initial={rows.map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.createdAt.toISOString(),
          authorLabel: row.author?.label ?? null,
          withdrawn: row.withdrawn,
          mine: row.mine,
          mentionsMe: row.mentionsMe,
        }))}
        /* Чип ставим только тому, кого разбор на сервере действительно позовёт. */
        members={members
          .filter((m) => isMentionable(m.username) && m.userId !== userId)
          .map((m) => ({ username: m.username as string, label: m.label }))}
        /* Историю «раньше» опрос не трогает: на хвосте разговора курсора нет. */
        paged={Boolean(before)}
      />
    </main>
  );
}
