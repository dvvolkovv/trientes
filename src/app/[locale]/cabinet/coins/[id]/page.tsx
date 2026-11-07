import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  canEditSection,
  canManageMembers,
  canManagePolicy,
  canVote,
} from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import type { CardSection } from "@/lib/coin-card-risk";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { SectionEditor } from "@/components/coin-card-manage/section-editor";
import { CardTeamSection } from "@/components/coin-card-manage/team-section";
import { PolicySection } from "@/components/coin-card-manage/policy-section";
import { OnchainRecheck } from "@/components/coin-card-manage/onchain-recheck";
import { MarketsRefresh } from "@/components/coin-card-manage/markets-refresh";
import { ClaimSection } from "@/components/coin-card-manage/claim-section";
import { websiteDomain } from "@/lib/claim-domain";
import { claimMessage, isClaimed } from "@/lib/coin-card-claim";
import {
  RevisionsSection,
  type RevisionItem,
} from "@/components/coin-card-manage/revisions-section";

export const dynamic = "force-dynamic";

export default async function CoinCardManagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coinCard.manage");
  const { userId, card, member } = await getViewerCard(id);
  if (!userId) redirect(`/${locale}/login?next=/${locale}/cabinet/coins/${id}`);
  if (!card || !member) notFound();

  const published = card.status === "APPROVED";
  const policy = card.policy ?? { multisig: false, threshold: 1, sections: [] };

  const [signerCount, revisions, claim, viewer] = await Promise.all([
    prisma.coinCardMember.count({ where: { cardId: card.id, isSigner: true } }),
    prisma.coinCardRevision.findMany({
      where: { cardId: card.id, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        author: { select: { username: true, email: true, name: true } },
        approvals: { select: { decision: true, memberId: true } },
      },
    }),
    prisma.coinCardClaim.findFirst({
      where: { cardId: card.id, claimantId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
    // Текст вызова подписывается от имени юзернейма — он же проверяется на сервере.
    prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
  ]);

  const revisionItems: RevisionItem[] = revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    section: r.section,
    status: r.status,
    highRisk: r.highRisk,
    diff: (r.diff as unknown as DiffEntry[]) ?? [],
    thresholdAt: r.thresholdAt,
    signerCountAt: r.signerCountAt,
    approvals: r.approvals.filter((a) => a.decision === "APPROVE").length,
    rejections: r.approvals.filter((a) => a.decision === "REJECT").length,
    myVote: r.approvals.find((a) => a.memberId === member.id)?.decision ?? null,
    isMine: r.authorId === userId,
    authorLabel: r.author.username ?? r.author.email ?? r.author.name ?? "—",
    createdAt: r.createdAt.toISOString(),
    adminNote: r.adminNote,
  }));

  const editable = EDITABLE_SECTIONS.filter((s) => canEditSection(member, s));
  // Dates and Decimals have to be plain JSON before the editor prefills from them.
  const cardForForm = JSON.parse(JSON.stringify(card)) as unknown;

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <header>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-[36px] font-bold tracking-[-0.03em]">{card.name}</h1>
          <span className="num text-sm text-muted">{card.symbol}</span>
          <span
            className={`text-xs px-2 py-1 rounded ${
              card.status === "APPROVED"
                ? "bg-green-500/15 text-green-500"
                : card.status === "REJECTED"
                  ? "bg-red-500/15 text-red-500"
                  : "bg-yellow-500/15 text-yellow-500"
            }`}
          >
            {t(`status.${card.status}`)}
          </span>
          {published ? (
            <a
              href={`/${locale}/coin/${card.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] underline text-muted hover:text-foreground"
            >
              {t("viewPublic")} ↗
            </a>
          ) : null}
        </div>
        <p className="text-muted">
          {published ? t("introPublished") : t("introDraft")} · {card.completeness}%
        </p>
        {card.status === "REJECTED" && card.rejectReason ? (
          <div className="mt-4 p-4 rounded-md border border-red-500/30 bg-red-500/10">
            <div className="text-xs uppercase tracking-wider text-red-400 mb-1">
              {t("rejectReason")}
            </div>
            <div className="text-sm text-red-300">{card.rejectReason}</div>
          </div>
        ) : null}
      </header>

      {editable.length === 0 ? (
        <p className="text-sm text-muted">{t("noSections")}</p>
      ) : (
        editable.map((s) => (
          <section key={s} id={s.toLowerCase()}>
            <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t(`sections.${s}`)}</h2>
            <SectionEditor
              cardId={card.id}
              section={s as CardSection}
              card={cardForForm}
              published={published}
            />
          </section>
        ))
      )}

      <OnchainRecheck
        cardId={card.id}
        canEdit={canEditSection(member, "CONTRACTS")}
        contracts={card.contracts.map((c) => ({
          id: c.id,
          chain: c.chain,
          address: c.address,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString().slice(0, 10) : null,
          checkError: c.checkError,
          mismatches: c.mismatches,
          verified: c.verifiedAt != null,
        }))}
      />

      <ClaimSection
        cardId={card.id}
        claimed={isClaimed(card.trust)}
        domain={websiteDomain(card.links)}
        canonicalAddress={card.contracts.find((c) => c.isCanonical)?.address ?? null}
        claim={
          claim
            ? {
                id: claim.id,
                method: claim.method,
                status: claim.status,
                token: claim.token,
                attempts: claim.attempts,
                lastError: claim.lastError,
                expiresAt: claim.expiresAt.toISOString().slice(0, 10),
                message: claimMessage({
                  slug: card.slug,
                  claimant: viewer?.username ?? userId,
                  token: claim.token,
                }),
              }
            : null
        }
      />

      <MarketsRefresh
        cardId={card.id}
        canEdit={canEditSection(member, "MARKETS")}
        index={
          card.priceIndex
            ? {
                priceUsd: card.priceIndex.priceUsd,
                marketCount: card.priceIndex.marketCount,
                confidence: card.priceIndex.confidence,
                computedAt: card.priceIndex.computedAt.toISOString().slice(0, 16).replace("T", " "),
              }
            : null
        }
        markets={card.markets.map((m) => ({
          id: m.id,
          exchangeName: m.exchangeName,
          pair: m.pair,
          priceUsd: m.priceUsd,
          checkedAt: m.checkedAt ? m.checkedAt.toISOString().slice(0, 10) : null,
          checkError: m.checkError,
          isOutlier: m.isOutlier,
          confirmed: m.confirmedAt != null,
        }))}
      />

      <RevisionsSection revisions={revisionItems} canVote={canVote(member)} />

      <CardTeamSection
        cardId={card.id}
        viewerId={userId}
        viewerRole={member.role}
        canManage={canManageMembers(member)}
      />

      <PolicySection
        cardId={card.id}
        multisig={policy.multisig}
        threshold={policy.threshold}
        sections={policy.sections}
        signerCount={signerCount}
        canManage={canManagePolicy(member)}
      />
    </main>
  );
}
