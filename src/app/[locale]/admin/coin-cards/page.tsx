import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CoinCardRow } from "@/components/admin/coin-card-row";
import { CoinRevisionRow, type AdminRevision } from "@/components/admin/coin-revision-row";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { CoinCardOwnershipRow, type OwnershipCard } from "@/components/admin/coin-card-ownership";

export const dynamic = "force-dynamic";

export default async function AdminCoinCardsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.coinCards");
  const tr = await getTranslations("admin.coinRevisions");
  const to = await getTranslations("admin.coinOwnership");

  // The ADMIN gate lives in admin/layout.tsx — no second check needed here.
  const cards = await prisma.coinCard.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      contracts: true,
      markets: { take: 20 },
      steward: { select: { username: true, name: true, email: true } },
    },
  });

  const revisions = await prisma.coinCardRevision.findMany({
    where: { status: { in: ["PENDING_ADMIN", "PENDING_SIGNERS", "EXPIRED"] } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      card: { select: { name: true, slug: true } },
      author: { select: { username: true, email: true, name: true } },
      _count: { select: { approvals: true } },
    },
  });
  const revisionRows: AdminRevision[] = revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    section: r.section,
    status: r.status,
    highRisk: r.highRisk,
    diff: (r.diff as unknown as DiffEntry[]) ?? [],
    thresholdAt: r.thresholdAt,
    signerCountAt: r.signerCountAt,
    approvals: r._count.approvals,
    createdAt: r.createdAt.toISOString(),
    cardName: r.card.name,
    cardSlug: r.card.slug,
    authorLabel: r.author.username ?? r.author.email ?? r.author.name ?? r.authorId.slice(0, 6),
  }));

  // Published cards, for the two admin-only levers: transfer and kill-multisig.
  const published = await prisma.coinCard.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      steward: { select: { username: true, email: true } },
      policy: true,
      _count: { select: { members: true } },
    },
  });
  const signerCounts = await prisma.coinCardMember.groupBy({
    by: ["cardId"],
    where: { isSigner: true, cardId: { in: published.map((c) => c.id) } },
    _count: { _all: true },
  });
  const signersByCard = new Map(signerCounts.map((s) => [s.cardId, s._count._all]));
  const ownershipRows: OwnershipCard[] = published.map((c) => ({
    id: c.id,
    name: c.name,
    symbol: c.symbol,
    slug: c.slug,
    steward: c.steward?.username ?? c.steward?.email ?? null,
    trust: c.trust,
    multisig: c.policy?.multisig ?? false,
    threshold: c.policy?.threshold ?? 1,
    signers: signersByCard.get(c.id) ?? 0,
  }));

  return (
    <div>
      <AdminNav locale={locale} active="coinCards" />
      <h1 className="text-2xl font-semibold mb-1">{t("title")}</h1>
      <p className="text-muted text-sm mb-6">{t("subtitle")}</p>
      {cards.length === 0 ? (
        <p className="text-muted text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {cards.map((c) => (
            <CoinCardRow key={c.id} card={JSON.parse(JSON.stringify(c))} />
          ))}
        </div>
      )}

      <h2 className="text-xl font-semibold mt-12 mb-1">{to("title")}</h2>
      <p className="text-muted text-sm mb-6">{to("subtitle")}</p>
      {ownershipRows.length === 0 ? (
        <p className="text-muted text-sm">{to("empty")}</p>
      ) : (
        <div className="space-y-4">
          {ownershipRows.map((c) => (
            <CoinCardOwnershipRow key={c.id} card={c} />
          ))}
        </div>
      )}

      <h2 className="text-xl font-semibold mt-12 mb-1">{tr("title")}</h2>
      <p className="text-muted text-sm mb-6">{tr("subtitle")}</p>
      {revisionRows.length === 0 ? (
        <p className="text-muted text-sm">{tr("empty")}</p>
      ) : (
        <div className="space-y-4">
          {revisionRows.map((r) => (
            <CoinRevisionRow key={r.id} revision={r} />
          ))}
        </div>
      )}
    </div>
  );
}
