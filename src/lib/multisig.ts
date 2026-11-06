// Арифметика M-of-N поверх аккаунтов Trientes. Общая: ею пользуются и ревизии
// карточки монеты, и запросы на удаление компании (слайс G2). Вынесена из
// coin-card-multisig.ts по тому же принципу, что invite-tokens.ts из
// company-invites.ts — один владелец логики, два потребителя.

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
