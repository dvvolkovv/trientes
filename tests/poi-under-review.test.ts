import { describe, expect, it } from "vitest";
import { pointUnderReview } from "@/lib/company-points";

describe("pointUnderReview", () => {
  it("точка без жалоб не помечена", () => {
    expect(pointUnderReview({ underReviewAt: null })).toBe(false);
  });
  it("точка с пометкой помечена", () => {
    expect(pointUnderReview({ underReviewAt: new Date() })).toBe(true);
  });
});
