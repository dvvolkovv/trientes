import { describe, expect, it } from "vitest";
import {
  DELETION_TTL_DAYS,
  MAX_DELETION_REASON,
  canVoteOnDeletion,
  deletionExpiry,
  deletionThreshold,
  routeDeletion,
  validateDeletionReason,
} from "@/lib/company-deletion";

describe("routeDeletion", () => {
  it("lets the company owner delete outright", () => {
    expect(routeDeletion({ role: "OWNER", isSiteAdmin: false })).toBe("apply");
  });

  it("makes an editor ask the owners instead of deleting", () => {
    expect(routeDeletion({ role: "EDITOR", isSiteAdmin: false })).toBe("request");
  });

  it("refuses a viewer and a non-member", () => {
    expect(routeDeletion({ role: "VIEWER", isSiteAdmin: false })).toBe("forbidden");
    expect(routeDeletion({ role: null, isSiteAdmin: false })).toBe("forbidden");
  });

  it("lets a site admin delete anything, member or not", () => {
    expect(routeDeletion({ role: null, isSiteAdmin: true })).toBe("apply");
    expect(routeDeletion({ role: "VIEWER", isSiteAdmin: true })).toBe("apply");
  });
});

describe("deletionThreshold", () => {
  it("asks every owner when the requester is not one of them", () => {
    expect(deletionThreshold({ ownerCount: 1, requesterIsOwner: false })).toBe(1);
    expect(deletionThreshold({ ownerCount: 3, requesterIsOwner: false })).toBe(3);
  });

  it("excludes the requester when they are an owner", () => {
    expect(deletionThreshold({ ownerCount: 3, requesterIsOwner: true })).toBe(2);
  });

  it("never drops to zero — a threshold of zero would self-approve", () => {
    expect(deletionThreshold({ ownerCount: 1, requesterIsOwner: true })).toBe(1);
    expect(deletionThreshold({ ownerCount: 0, requesterIsOwner: false })).toBe(1);
  });
});

describe("canVoteOnDeletion", () => {
  it("only owners vote, and never on their own request", () => {
    expect(canVoteOnDeletion({ role: "OWNER", userId: "u1", requestedById: "u2" })).toBe(true);
    expect(canVoteOnDeletion({ role: "OWNER", userId: "u1", requestedById: "u1" })).toBe(false);
    expect(canVoteOnDeletion({ role: "EDITOR", userId: "u1", requestedById: "u2" })).toBe(false);
    expect(canVoteOnDeletion({ role: null, userId: "u1", requestedById: "u2" })).toBe(false);
  });
});

describe("validateDeletionReason", () => {
  it("treats a blank reason as absent — it is optional for members", () => {
    expect(validateDeletionReason("   ")).toEqual({ ok: true, reason: null });
  });

  it("trims and keeps a real reason", () => {
    expect(validateDeletionReason("  закрылись  ")).toEqual({ ok: true, reason: "закрылись" });
  });

  it("refuses a reason longer than the column is meant to hold", () => {
    expect(validateDeletionReason("x".repeat(MAX_DELETION_REASON + 1))).toEqual({
      ok: false,
      error: "reason_too_long",
    });
  });
});

describe("deletionExpiry", () => {
  it("expires in two weeks, like a card revision", () => {
    const now = new Date("2026-11-06T00:00:00.000Z");
    expect(deletionExpiry(now).toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(DELETION_TTL_DAYS).toBe(14);
  });
});
