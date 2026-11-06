import { describe, expect, it } from "vitest";
import {
  REVISION_TTL_DAYS,
  policyApplies,
  routeSubmission,
  tally,
  thresholdReachable,
  revisionExpiry,
} from "@/lib/coin-card-multisig";

describe("policyApplies", () => {
  it("is false when multisig is off", () => {
    expect(policyApplies({ multisig: false, threshold: 2, sections: [] }, "MARKETS")).toBe(false);
  });

  it("covers every section when the section list is empty", () => {
    expect(policyApplies({ multisig: true, threshold: 2, sections: [] }, "MARKETS")).toBe(true);
  });

  it("covers only the listed sections otherwise", () => {
    const p = { multisig: true, threshold: 2, sections: ["CONTRACTS" as const] };
    expect(policyApplies(p, "CONTRACTS")).toBe(true);
    expect(policyApplies(p, "MARKETING")).toBe(false);
  });

  it("always applies to a POLICY revision when multisig is on", () => {
    expect(policyApplies({ multisig: true, threshold: 2, sections: ["TEAM"] }, null)).toBe(true);
  });
});

describe("routeSubmission", () => {
  it("applies a low-risk change on a claimed card immediately", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "PROJECT_CLAIMED",
        signerCount: 1,
      }),
    ).toEqual({ status: "APPLIED" });
  });

  it("sends a high-risk change to the moderator even on a claimed card", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "CONTRACTS",
        highRisk: true,
        trust: "FULLY_VERIFIED",
        signerCount: 1,
      }),
    ).toEqual({ status: "PENDING_ADMIN" });
  });

  it("sends everything from an unverified card to the moderator", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "UNVERIFIED",
        signerCount: 1,
      }),
    ).toEqual({ status: "PENDING_ADMIN" });
  });

  it("collects signatures first when the policy applies", () => {
    expect(
      routeSubmission({
        policy: { multisig: true, threshold: 2, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "PROJECT_CLAIMED",
        signerCount: 3,
      }),
    ).toEqual({ status: "PENDING_SIGNERS", thresholdAt: 2, signerCountAt: 3 });
  });

  it("clamps a stale threshold to the live signer count", () => {
    const r = routeSubmission({
      policy: { multisig: true, threshold: 5, sections: [] },
      section: "MARKETING",
      highRisk: false,
      trust: "PROJECT_CLAIMED",
      signerCount: 2,
    });
    expect(r).toEqual({ status: "PENDING_SIGNERS", thresholdAt: 2, signerCountAt: 2 });
  });
});

describe("tally", () => {
  const snap = { thresholdAt: 2, signerCountAt: 3 };

  it("keeps waiting below the threshold", () => {
    expect(tally({ ...snap, approvals: 1, rejections: 0 })).toEqual({ outcome: "WAITING" });
  });

  it("passes at the threshold", () => {
    expect(tally({ ...snap, approvals: 2, rejections: 0 })).toEqual({ outcome: "PASSED" });
  });

  it("fails once the threshold is arithmetically out of reach", () => {
    // 3 signers, 2 needed → 2 rejections leave only 1 possible approval.
    expect(tally({ ...snap, approvals: 0, rejections: 2 })).toEqual({ outcome: "FAILED" });
  });

  it("does not fail while the threshold is still reachable", () => {
    expect(tally({ ...snap, approvals: 0, rejections: 1 })).toEqual({ outcome: "WAITING" });
  });

  it("prefers the pass when both conditions somehow hold", () => {
    expect(tally({ thresholdAt: 1, signerCountAt: 2, approvals: 1, rejections: 2 })).toEqual({
      outcome: "PASSED",
    });
  });
});

describe("thresholdReachable", () => {
  it("rejects a threshold above the signer count", () => {
    expect(thresholdReachable(3, 2)).toBe(false);
  });

  it("rejects a non-positive threshold", () => {
    expect(thresholdReachable(0, 2)).toBe(false);
  });

  it("accepts M <= N", () => {
    expect(thresholdReachable(2, 2)).toBe(true);
  });
});

describe("revisionExpiry", () => {
  it("is REVISION_TTL_DAYS ahead", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const exp = revisionExpiry(now);
    expect((exp.getTime() - now.getTime()) / 86_400_000).toBe(REVISION_TTL_DAYS);
  });
});
