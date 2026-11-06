// Off-chain M-of-N approval over Trientes accounts (wallet-bound signers are
// slice D). Pure arithmetic — no Prisma — so every edge case is unit-tested.

import type { CardSection } from "@/lib/coin-card-risk";

/** A revision nobody signs within two weeks is stale, not pending. */
export const REVISION_TTL_DAYS = 14;

export type PolicyLike = {
  multisig: boolean;
  threshold: number;
  sections: readonly CardSection[];
};

export type CardTrust =
  | "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";

const TRUST_RANK: Record<CardTrust, number> = {
  UNVERIFIED: 0,
  CONTRACT_VERIFIED: 1,
  PROJECT_CLAIMED: 2,
  FULLY_VERIFIED: 3,
};

/** Only a claimed project may publish without a moderator in the loop. */
export function trustSkipsModerator(trust: CardTrust): boolean {
  return TRUST_RANK[trust] >= TRUST_RANK.PROJECT_CLAIMED;
}

/**
 * `section === null` means a POLICY revision — changing the multisig itself.
 * It always goes through the multisig, otherwise an owner disarms it in one
 * click and the whole mechanism is decoration.
 */
export function policyApplies(policy: PolicyLike, section: CardSection | null): boolean {
  if (!policy.multisig) return false;
  if (section === null) return true;
  if (policy.sections.length === 0) return true;
  return policy.sections.includes(section);
}

export type SubmissionRoute =
  | { status: "APPLIED" }
  | { status: "PENDING_ADMIN" }
  | { status: "PENDING_SIGNERS"; thresholdAt: number; signerCountAt: number };

/**
 * Where a freshly submitted revision lands. Signatures come first; the
 * moderator question is asked again after the threshold is met.
 */
export function routeSubmission(input: {
  policy: PolicyLike;
  section: CardSection | null;
  highRisk: boolean;
  trust: CardTrust;
  signerCount: number;
}): SubmissionRoute {
  if (policyApplies(input.policy, input.section)) {
    // Clamp: a signer may have left after the threshold was set. Never demand
    // more signatures than there are signers, or the revision can never pass.
    const thresholdAt = Math.max(1, Math.min(input.policy.threshold, input.signerCount));
    return { status: "PENDING_SIGNERS", thresholdAt, signerCountAt: input.signerCount };
  }
  return routeAfterSigners(input.highRisk, input.trust);
}

/** The moderator test, applied both at submit time and after the threshold. */
export function routeAfterSigners(
  highRisk: boolean,
  trust: CardTrust,
): { status: "APPLIED" } | { status: "PENDING_ADMIN" } {
  if (highRisk) return { status: "PENDING_ADMIN" };
  if (!trustSkipsModerator(trust)) return { status: "PENDING_ADMIN" };
  return { status: "APPLIED" };
}

export type TallyOutcome = "WAITING" | "PASSED" | "FAILED";

/**
 * Uses the snapshots taken at submit time, never the live signer set: moving
 * people in and out of the signer group must not change a vote in flight.
 * FAILED is arithmetic, not a veto right — the threshold became unreachable.
 */
export function tally(input: {
  thresholdAt: number;
  signerCountAt: number;
  approvals: number;
  rejections: number;
}): { outcome: TallyOutcome } {
  if (input.approvals >= input.thresholdAt) return { outcome: "PASSED" };
  const maxPossible = input.signerCountAt - input.rejections;
  if (maxPossible < input.thresholdAt) return { outcome: "FAILED" };
  return { outcome: "WAITING" };
}

/** 1 <= M <= N. Explicit refusal beats silently lowering someone's threshold. */
export function thresholdReachable(threshold: number, signerCount: number): boolean {
  return Number.isInteger(threshold) && threshold >= 1 && threshold <= signerCount;
}

export function revisionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REVISION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
