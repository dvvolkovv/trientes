import { describe, it, expect } from "vitest";
import { reviewDue } from "@/lib/staff-access-sweep";

const NOW = new Date("2026-11-18T10:00:00Z");

describe("пересмотр доступа сотрудника", () => {
  it("срок в прошлом — пора пересматривать", () => {
    expect(reviewDue({ accessReviewAt: new Date("2026-11-17T00:00:00Z"), revokedAt: null }, NOW)).toBe(
      true,
    );
  });

  it("срок в будущем — молчим", () => {
    expect(reviewDue({ accessReviewAt: new Date("2027-05-18T00:00:00Z"), revokedAt: null }, NOW)).toBe(
      false,
    );
  });

  it("отозванный доступ пересматривать нечего", () => {
    expect(reviewDue({ accessReviewAt: new Date("2026-01-01T00:00:00Z"), revokedAt: NOW }, NOW)).toBe(
      false,
    );
  });
});
