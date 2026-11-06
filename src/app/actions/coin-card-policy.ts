"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { CoinCardSection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canManagePolicy } from "@/lib/coin-card-access";
import { getViewerCard } from "@/lib/coin-card-viewer";
import { policyApplies, thresholdReachable, revisionExpiry } from "@/lib/coin-card-multisig";
import { buildDiff } from "@/lib/coin-card-diff";
import { notifyUser } from "@/lib/notify";
import { applyRevisionNow } from "@/app/actions/coin-card-revisions";

export type PolicyResult =
  | { ok: true; via: "direct" | "revision"; revisionId?: string }
  | { ok: false; reason: string };

/**
 * Turning multisig on, raising a threshold or changing which sections it
 * covers. While multisig is off this is a plain owner action; once it is on,
 * the change has to pass the very mechanism it modifies — otherwise the owner
 * disarms it in one click and the multisig is decoration.
 */
export async function updateCardPolicy(input: {
  cardId: string;
  multisig: boolean;
  threshold: number;
  sections: CoinCardSection[];
}): Promise<PolicyResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canManagePolicy(member)) return { ok: false, reason: "forbidden" };

  const signerCount = await prisma.coinCardMember.count({
    where: { cardId: card.id, isSigner: true },
  });
  if (input.multisig && !thresholdReachable(input.threshold, signerCount)) {
    return { ok: false, reason: "threshold_out_of_range" };
  }

  const current = card.policy ?? { multisig: false, threshold: 1, sections: [] };
  const sections = Array.from(new Set(input.sections));
  const next = { multisig: input.multisig, threshold: input.threshold, sections };

  const diff = buildDiff(
    {
      "policy.multisig": current.multisig,
      "policy.threshold": current.threshold,
      "policy.sections": current.sections,
    },
    {
      "policy.multisig": next.multisig,
      "policy.threshold": next.threshold,
      "policy.sections": next.sections,
    },
  );
  if (diff.length === 0) return { ok: false, reason: "no_changes" };

  // Multisig currently off → nothing to bypass yet.
  if (!policyApplies({ ...current, sections: current.sections }, null)) {
    await prisma.coinCardPolicy.upsert({
      where: { cardId: card.id },
      create: { cardId: card.id, ...next },
      update: next,
    });
    revalidatePath("/", "layout");
    return { ok: true, via: "direct" };
  }

  const thresholdAt = Math.max(1, Math.min(current.threshold, signerCount));
  const revision = await prisma.coinCardRevision.create({
    data: {
      cardId: card.id,
      kind: "POLICY",
      section: null,
      authorId: userId,
      status: "PENDING_SIGNERS",
      highRisk: true,
      diff: diff as unknown as Prisma.InputJsonValue,
      thresholdAt,
      signerCountAt: signerCount,
      expiresAt: revisionExpiry(),
      approvals: member.isSigner
        ? { create: { memberId: member.id, decision: "APPROVE" } }
        : undefined,
    },
    select: { id: true },
  });

  // The only signer is the author, who already signed → nothing left to wait for.
  if (member.isSigner && thresholdAt <= 1) {
    await applyRevisionNow(revision.id);
    return { ok: true, via: "revision", revisionId: revision.id };
  }

  const signers = await prisma.coinCardMember.findMany({
    where: { cardId: card.id, isSigner: true },
    select: { userId: true },
  });
  for (const s of signers) {
    if (s.userId === userId) continue;
    void notifyUser({
      userId: s.userId,
      text: `✍️ A multisig policy change on "${card.name}" needs your signature.`,
      subject: `Signature needed for ${card.name}`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true, via: "revision", revisionId: revision.id };
}
