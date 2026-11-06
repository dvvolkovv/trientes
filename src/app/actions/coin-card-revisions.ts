"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { CoinCardRevisionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditSection, canVote } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { normalizeSectionPayload, patchValues, sectionValues } from "@/lib/coin-card-sections";
import { buildDiff, diffPaths, diffToCardUpdate, type DiffEntry } from "@/lib/coin-card-diff";
import { diffNeedsModerator, isHighRiskSection, type CardSection } from "@/lib/coin-card-risk";
import {
  routeSubmission,
  routeAfterSigners,
  revisionExpiry,
  tally,
  type CardTrust,
} from "@/lib/coin-card-multisig";
import { markSelfReported } from "@/lib/coin-card-provenance";
import { computeCompleteness } from "@/lib/coin-card-completeness";
import { notifyUser } from "@/lib/notify";

export type RevisionResult =
  | { ok: true; revisionId: string; status: CoinCardRevisionStatus }
  | { ok: false; reason: string };

/**
 * Applies a revision's diff to the card and marks the touched paths in the
 * provenance map. Shared by the three ways a revision can land: straight
 * through, after signatures, and by a moderator.
 */
export async function applyRevisionNow(revisionId: string): Promise<void> {
  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, diff: true, kind: true },
  });
  if (!rev) return;
  const diff = (rev.diff as unknown as DiffEntry[]) ?? [];

  // A policy revision changes the multisig itself, not card content.
  if (rev.kind === "POLICY") {
    const next: { multisig?: boolean; threshold?: number; sections?: CardSection[] } = {};
    for (const e of diff) {
      if (e.path === "policy.multisig") next.multisig = Boolean(e.after);
      if (e.path === "policy.threshold") next.threshold = Number(e.after);
      if (e.path === "policy.sections") next.sections = e.after as CardSection[];
    }
    await prisma.$transaction([
      prisma.coinCardPolicy.upsert({
        where: { cardId: rev.cardId },
        create: { cardId: rev.cardId, ...next },
        update: next,
      }),
      prisma.coinCardRevision.update({
        where: { id: rev.id },
        data: { status: "APPLIED", appliedAt: new Date(), decidedAt: new Date() },
      }),
    ]);
    revalidatePath("/", "layout");
    return;
  }

  const update = diffToCardUpdate(diff);
  const card = await prisma.coinCard.findUnique({
    where: { id: rev.cardId },
    select: {
      name: true, symbol: true, tagline: true, description: true, logoUrl: true,
      launchDate: true, tags: true, links: true, tokenomics: true, security: true,
      teamInfo: true, marketing: true, provenance: true,
    },
  });
  if (!card) return;

  if (update.contracts) {
    await prisma.$transaction([
      prisma.coinCardContract.deleteMany({ where: { cardId: rev.cardId } }),
      prisma.coinCardContract.createMany({
        data: update.contracts.map((r) => ({ ...r, cardId: rev.cardId })) as never,
        skipDuplicates: true,
      }),
    ]);
  }
  if (update.markets) {
    await prisma.$transaction([
      prisma.coinCardMarket.deleteMany({ where: { cardId: rev.cardId } }),
      prisma.coinCardMarket.createMany({
        data: update.markets.map((r) => ({ ...r, cardId: rev.cardId })) as never,
        skipDuplicates: true,
      }),
    ]);
  }

  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: rev.cardId } }),
    prisma.coinCardMarket.count({ where: { cardId: rev.cardId } }),
  ]);
  const completeness = computeCompleteness({
    ...(card as Record<string, unknown>),
    ...update.data,
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  });

  await prisma.$transaction([
    prisma.coinCard.update({
      where: { id: rev.cardId },
      data: {
        ...update.data,
        completeness,
        // A moderator approving a project's own numbers does not make them
        // verified — the source is still the project.
        provenance: markSelfReported(card.provenance, diffPaths(diff), new Date()),
      },
    }),
    prisma.coinCardRevision.update({
      where: { id: rev.id },
      data: { status: "APPLIED", appliedAt: new Date(), decidedAt: new Date() },
    }),
  ]);
  revalidatePath("/", "layout");
}

/** Threshold met: either publish or hand the diff to the moderator. */
async function finishAfterSigners(
  revisionId: string,
  highRisk: boolean,
  trust: CardTrust,
  kind: "CONTENT" | "POLICY" = "CONTENT",
): Promise<RevisionResult> {
  // A policy change is the team's own business: the site moderator has no
  // opinion on how many signatures a project wants.
  const next =
    kind === "POLICY" ? { status: "APPLIED" as const } : routeAfterSigners(highRisk, trust);
  if (next.status === "APPLIED") {
    await applyRevisionNow(revisionId);
    return { ok: true, revisionId, status: "APPLIED" };
  }
  await prisma.coinCardRevision.update({
    where: { id: revisionId },
    data: { status: "PENDING_ADMIN" },
  });
  revalidatePath("/", "layout");
  return { ok: true, revisionId, status: "PENDING_ADMIN" };
}

async function notifySigners(cardId: string, cardName: string, exceptUserId: string) {
  const signers = await prisma.coinCardMember.findMany({
    where: { cardId, isSigner: true },
    select: { userId: true },
  });
  for (const s of signers) {
    if (s.userId === exceptUserId) continue;
    void notifyUser({
      userId: s.userId,
      text: `✍️ A change to "${cardName}" on Trientes needs your signature.`,
      subject: `Signature needed for ${cardName}`,
    }).catch(() => {});
  }
}

/**
 * The single entry point for changing a published card. Builds the diff,
 * classifies the risk, then routes: straight to APPLIED, to the signers, or to
 * the moderator.
 */
export async function submitSectionRevision(input: {
  cardId: string;
  section: CardSection;
  payload: Record<string, unknown>;
}): Promise<RevisionResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canEditSection(member, input.section)) return { ok: false, reason: "forbidden" };

  const state = {
    name: card.name, symbol: card.symbol, tagline: card.tagline,
    description: card.description, logoUrl: card.logoUrl, launchDate: card.launchDate,
    tags: card.tags, links: card.links, tokenomics: card.tokenomics,
    security: card.security, teamInfo: card.teamInfo, marketing: card.marketing,
    contracts: card.contracts.map((c) => ({
      chain: c.chain, address: c.address, decimals: c.decimals,
      standard: c.standard, explorerUrl: c.explorerUrl, isCanonical: c.isCanonical,
    })),
    markets: card.markets.map((m) => ({
      kind: m.kind as "CEX" | "DEX", exchangeName: m.exchangeName, pair: m.pair,
      tradeUrl: m.tradeUrl, chain: m.chain, poolAddress: m.poolAddress,
    })),
  };

  const norm = normalizeSectionPayload(input.section, input.payload, state);
  if (!norm.ok) return { ok: false, reason: norm.reason };

  const diff = buildDiff(sectionValues(input.section, state), patchValues(norm.patch));
  if (diff.length === 0) return { ok: false, reason: "no_changes" };

  const highRisk = isHighRiskSection(input.section) || diffNeedsModerator(diffPaths(diff));
  const policy = card.policy ?? { multisig: false, threshold: 1, sections: [] };
  const signerCount = await prisma.coinCardMember.count({
    where: { cardId: card.id, isSigner: true },
  });

  const route = routeSubmission({
    policy: { multisig: policy.multisig, threshold: policy.threshold, sections: policy.sections },
    section: input.section,
    highRisk,
    trust: card.trust as CardTrust,
    signerCount,
  });

  const revision = await prisma.coinCardRevision.create({
    data: {
      cardId: card.id,
      kind: "CONTENT",
      section: input.section,
      authorId: userId,
      // APPLIED is never stored as a submit status: applyRevisionNow() sets it
      // once the write actually happened.
      status: route.status === "APPLIED" ? "PENDING_ADMIN" : route.status,
      highRisk,
      diff: diff as unknown as Prisma.InputJsonValue,
      thresholdAt: route.status === "PENDING_SIGNERS" ? route.thresholdAt : null,
      signerCountAt: route.status === "PENDING_SIGNERS" ? route.signerCountAt : null,
      expiresAt: route.status === "PENDING_SIGNERS" ? revisionExpiry() : null,
      // The author's own signature counts — asking someone to approve their own
      // edit is theatre.
      approvals:
        route.status === "PENDING_SIGNERS" && member.isSigner
          ? { create: { memberId: member.id, decision: "APPROVE" } }
          : undefined,
    },
    select: { id: true },
  });

  if (route.status === "APPLIED") {
    await applyRevisionNow(revision.id);
    return { ok: true, revisionId: revision.id, status: "APPLIED" };
  }

  if (route.status === "PENDING_SIGNERS") {
    // One signature needed and the author already gave it.
    if (member.isSigner && route.thresholdAt <= 1) {
      return finishAfterSigners(revision.id, highRisk, card.trust as CardTrust);
    }
    await notifySigners(card.id, card.name, userId);
    return { ok: true, revisionId: revision.id, status: "PENDING_SIGNERS" };
  }

  return { ok: true, revisionId: revision.id, status: "PENDING_ADMIN" };
}

export async function voteOnRevision(input: {
  revisionId: string;
  decision: "APPROVE" | "REJECT";
  comment?: string;
}): Promise<RevisionResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: input.revisionId },
    select: {
      id: true, cardId: true, status: true, highRisk: true, authorId: true, kind: true,
      thresholdAt: true, signerCountAt: true,
      card: { select: { trust: true, name: true } },
    },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_SIGNERS") return { ok: false, reason: "revision_closed" };

  const member = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: rev.cardId, userId } },
    select: { id: true, role: true, sections: true, isSigner: true },
  });
  if (!member || !canVote(member)) return { ok: false, reason: "not_a_signer" };

  try {
    await prisma.coinCardApproval.create({
      data: {
        revisionId: rev.id,
        memberId: member.id,
        decision: input.decision,
        comment: (input.comment ?? "").trim() || null,
      },
    });
  } catch (e) {
    const dup = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
    if (dup) return { ok: false, reason: "already_voted" };
    throw e;
  }

  const [approvals, rejections] = await Promise.all([
    prisma.coinCardApproval.count({ where: { revisionId: rev.id, decision: "APPROVE" } }),
    prisma.coinCardApproval.count({ where: { revisionId: rev.id, decision: "REJECT" } }),
  ]);
  const t = tally({
    thresholdAt: rev.thresholdAt ?? 1,
    signerCountAt: rev.signerCountAt ?? 1,
    approvals,
    rejections,
  });

  if (t.outcome === "PASSED") {
    const r = await finishAfterSigners(
      rev.id,
      rev.highRisk,
      rev.card.trust as CardTrust,
      rev.kind,
    );
    void notifyUser({
      userId: rev.authorId,
      text: `✅ Your change to "${rev.card.name}" collected enough signatures.`,
      subject: `Signatures collected for ${rev.card.name}`,
    }).catch(() => {});
    return r;
  }

  if (t.outcome === "FAILED") {
    await prisma.coinCardRevision.update({
      where: { id: rev.id },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    void notifyUser({
      userId: rev.authorId,
      text: `❌ Your change to "${rev.card.name}" cannot reach the signature threshold and was closed.`,
      subject: `Change to ${rev.card.name} declined`,
    }).catch(() => {});
    revalidatePath("/", "layout");
    return { ok: true, revisionId: rev.id, status: "REJECTED" };
  }

  revalidatePath("/", "layout");
  return { ok: true, revisionId: rev.id, status: "PENDING_SIGNERS" };
}

/** The author pulls their own revision back while it is still open. */
export async function withdrawRevision(input: {
  revisionId: string;
}): Promise<RevisionResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: input.revisionId },
    select: { id: true, authorId: true, status: true },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.authorId !== userId) return { ok: false, reason: "forbidden" };
  if (rev.status !== "PENDING_SIGNERS" && rev.status !== "PENDING_ADMIN") {
    return { ok: false, reason: "revision_closed" };
  }

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  revalidatePath("/", "layout");
  return { ok: true, revisionId: rev.id, status: "WITHDRAWN" };
}
