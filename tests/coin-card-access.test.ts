import { describe, expect, it } from "vitest";
import { canEditSection, canEditCardNow, canManageMembers, canManagePolicy } from "@/lib/coin-card-access";

const card = (over: Partial<{ status: "PENDING" | "APPROVED" | "REJECTED"; stewardUserId: string | null }> = {}) => ({
  status: "PENDING" as const,
  stewardUserId: "u1" as string | null,
  ...over,
});

describe("canEditSection", () => {
  it("lets OWNER edit anything", () => {
    expect(canEditSection({ role: "OWNER", sections: [] }, "CONTRACTS")).toBe(true);
  });

  it("lets ADMIN edit anything", () => {
    expect(canEditSection({ role: "ADMIN", sections: [] }, "TOKENOMICS")).toBe(true);
  });

  it("limits EDITOR to granted sections", () => {
    const m = { role: "EDITOR" as const, sections: ["MARKETS" as const] };
    expect(canEditSection(m, "MARKETS")).toBe(true);
    expect(canEditSection(m, "TOKENOMICS")).toBe(false);
  });

  it("denies VIEWER everything", () => {
    expect(canEditSection({ role: "VIEWER", sections: ["MARKETS"] }, "MARKETS")).toBe(false);
  });

  it("denies a null member", () => {
    expect(canEditSection(null, "IDENTITY")).toBe(false);
  });
});

describe("canManageMembers / canManagePolicy", () => {
  it("lets OWNER and ADMIN manage members", () => {
    expect(canManageMembers({ role: "OWNER", sections: [] })).toBe(true);
    expect(canManageMembers({ role: "ADMIN", sections: [] })).toBe(true);
  });

  it("denies EDITOR and VIEWER member management", () => {
    expect(canManageMembers({ role: "EDITOR", sections: [] })).toBe(false);
    expect(canManageMembers({ role: "VIEWER", sections: [] })).toBe(false);
  });

  it("reserves multisig policy for OWNER only", () => {
    expect(canManagePolicy({ role: "OWNER", sections: [] })).toBe(true);
    expect(canManagePolicy({ role: "ADMIN", sections: [] })).toBe(false);
  });
});

describe("canEditCardNow", () => {
  it("lets the steward edit a pending card", () => {
    expect(canEditCardNow(card(), "u1", false)).toBe(true);
  });

  it("stops the steward once the card is approved (edits need A2 revisions)", () => {
    expect(canEditCardNow(card({ status: "APPROVED" }), "u1", false)).toBe(false);
  });

  it("stops a stranger", () => {
    expect(canEditCardNow(card(), "u2", false)).toBe(false);
  });

  it("stops an anonymous visitor", () => {
    expect(canEditCardNow(card(), null, false)).toBe(false);
  });

  it("lets a site admin edit regardless of status", () => {
    expect(canEditCardNow(card({ status: "APPROVED" }), "admin", true)).toBe(true);
  });

  it("allows editing a rejected card so the author can fix it", () => {
    expect(canEditCardNow(card({ status: "REJECTED" }), "u1", false)).toBe(true);
  });

  it("stops everyone on an orphaned card with no steward", () => {
    expect(canEditCardNow(card({ stewardUserId: null }), "u1", false)).toBe(false);
  });
});
