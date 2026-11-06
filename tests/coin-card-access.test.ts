import { describe, expect, it } from "vitest";
import {
  canEditSection,
  canEditCardDirectly,
  canManageMembers,
  canManagePolicy,
  canAssignRole,
  canVote,
} from "@/lib/coin-card-access";

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

describe("canEditCardDirectly", () => {
  const pending = { status: "PENDING" as const, stewardUserId: "u1" };
  const approved = { status: "APPROVED" as const, stewardUserId: "u1" };
  const owner = { role: "OWNER" as const, sections: [] };

  it("lets an owner write straight to a card that is not public yet", () => {
    expect(canEditCardDirectly(pending, owner, "CONTRACTS", false)).toBe(true);
  });

  it("lets a rejected card be fixed in place", () => {
    expect(
      canEditCardDirectly({ status: "REJECTED", stewardUserId: "u1" }, owner, "IDENTITY", false),
    ).toBe(true);
  });

  it("closes direct writes once the card is published — revisions only", () => {
    expect(canEditCardDirectly(approved, owner, "CONTRACTS", false)).toBe(false);
  });

  it("still lets a site admin write to a published card", () => {
    expect(canEditCardDirectly(approved, null, "CONTRACTS", true)).toBe(true);
  });

  it("respects section grants for an EDITOR", () => {
    const m = { role: "EDITOR" as const, sections: ["MARKETS" as const] };
    expect(canEditCardDirectly(pending, m, "MARKETS", false)).toBe(true);
    expect(canEditCardDirectly(pending, m, "CONTRACTS", false)).toBe(false);
  });

  it("denies a stranger", () => {
    expect(canEditCardDirectly(pending, null, "IDENTITY", false)).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("lets an OWNER hand out any role", () => {
    expect(canAssignRole({ role: "OWNER", sections: [] }, "OWNER")).toBe(true);
    expect(canAssignRole({ role: "OWNER", sections: [] }, "VIEWER")).toBe(true);
  });

  it("stops an ADMIN from minting or touching an OWNER", () => {
    expect(canAssignRole({ role: "ADMIN", sections: [] }, "OWNER")).toBe(false);
    expect(canAssignRole({ role: "ADMIN", sections: [] }, "EDITOR")).toBe(true);
  });

  it("denies EDITOR and VIEWER entirely", () => {
    expect(canAssignRole({ role: "EDITOR", sections: [] }, "VIEWER")).toBe(false);
    expect(canAssignRole({ role: "VIEWER", sections: [] }, "VIEWER")).toBe(false);
  });
});

describe("canVote", () => {
  it("is exactly the signer flag", () => {
    expect(canVote({ role: "VIEWER", sections: [], isSigner: true })).toBe(true);
    expect(canVote({ role: "OWNER", sections: [], isSigner: false })).toBe(false);
    expect(canVote(null)).toBe(false);
  });
});
