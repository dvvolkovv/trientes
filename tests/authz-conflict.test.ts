import { describe, expect, it } from "vitest";
import { conflictReason, type ConflictFacts } from "@/lib/authz/conflict";

const none: ConflictFacts = { isApplicant: false, isCompanyMember: false, isCardMember: false };

describe("конфликт интересов", () => {
  it("без связей конфликта нет", () => {
    expect(conflictReason(none)).toBe(null);
  });

  it("сотрудник сам подал эту заявку", () => {
    expect(conflictReason({ ...none, isApplicant: true })).toBe("conflict_of_interest");
  });

  it("сотрудник в команде этого предприятия", () => {
    expect(conflictReason({ ...none, isCompanyMember: true })).toBe("conflict_of_interest");
  });

  it("сотрудник в команде этой карточки", () => {
    expect(conflictReason({ ...none, isCardMember: true })).toBe("conflict_of_interest");
  });

  it("несколько связей — всё равно один отказ", () => {
    expect(conflictReason({ isApplicant: true, isCompanyMember: true, isCardMember: true })).toBe(
      "conflict_of_interest",
    );
  });
});
