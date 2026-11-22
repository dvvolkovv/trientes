import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CaseThread } from "@/components/cases/case-thread";
import { CaseComposer } from "@/components/cases/case-composer";
import { CaseReadMarker } from "@/components/cases/case-read-marker";
import { parseAttachments } from "@/lib/cases/attachments";
import { unreadCount } from "@/lib/cases/messages";
import { CabinetBackButton } from "@/components/cabinet/back-button";

export const dynamic = "force-dynamic";

export default async function CabinetCasePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id;
  if (!me) redirect(`/${locale}/login?next=/${locale}/cabinet/cases/${id}`);

  const c = await prisma.complianceCase.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, username: true } } },
      },
    },
  });
  // Чужое дело — notFound, а не «нет прав»: существование заявки не наше дело
  // рассказывать постороннему.
  if (!c || c.applicantUserId !== me) notFound();

  const t = await getTranslations("cabinet.cases");
  const tThread = await getTranslations("admin.case.thread");
  const unread = unreadCount(c.messages, "APPLICANT");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 md:py-16">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      {unread > 0 ? <CaseReadMarker caseId={c.id} /> : null}
      <header>
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">{t("title")}</div>
        <h1 className="mb-1 text-[26px] font-bold tracking-[-0.03em]">{c.title}</h1>
        <p className="text-muted">{t(`status.${c.status}`)}</p>
      </header>

      <CaseThread
        caseId={c.id}
        locale={locale}
        mySide="APPLICANT"
        messages={c.messages.map((m) => ({
          id: m.id,
          side: m.side,
          body: m.body,
          attachments: parseAttachments(m.attachments),
          createdAt: m.createdAt,
          authorName: m.author?.name ?? m.author?.username ?? null,
        }))}
        staffLabel={tThread("staff")}
        applicantLabel={tThread("applicant")}
        emptyLabel={tThread("empty")}
      />

      <CaseComposer
        caseId={c.id}
        side="APPLICANT"
        labels={{
          placeholder: t("placeholder"),
          send: t("send"),
          needsReply: "",
          templates: "",
          attach: tThread("attach"),
          attaching: tThread("attaching"),
          attached: tThread.raw("attached") as string,
          errors: {
            empty: tThread("errors.empty"),
            too_long: tThread("errors.too_long"),
            too_large: tThread("errors.too_large"),
            bad_type: tThread("errors.bad_type"),
            failed: tThread("errors.failed"),
            forbidden: tThread("errors.failed"),
            unauth: tThread("errors.failed"),
            not_found: tThread("errors.failed"),
          },
        }}
      />
    </main>
  );
}
