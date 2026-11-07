import { describe, expect, it } from "vitest";
import { isHighRiskPath, isHighRiskSection, HIGH_RISK_SECTIONS } from "@/lib/coin-card-risk";

describe("isHighRiskSection", () => {
  it("marks contracts, tokenomics, markets and security as high risk", () => {
    expect(isHighRiskSection("CONTRACTS")).toBe(true);
    expect(isHighRiskSection("TOKENOMICS")).toBe(true);
    expect(isHighRiskSection("MARKETS")).toBe(true);
    expect(isHighRiskSection("SECURITY")).toBe(true);
  });

  it("marks presentational sections as low risk", () => {
    expect(isHighRiskSection("MARKETING")).toBe(false);
    expect(isHighRiskSection("LINKS")).toBe(false);
    expect(isHighRiskSection("TEAM")).toBe(false);
    expect(isHighRiskSection("ACCEPTANCE")).toBe(false);
  });

  it("treats IDENTITY as low risk at section level", () => {
    expect(isHighRiskSection("IDENTITY")).toBe(false);
  });

  it("exposes the high-risk set for UI badges", () => {
    expect(HIGH_RISK_SECTIONS).toContain("CONTRACTS");
    expect(HIGH_RISK_SECTIONS).not.toContain("MARKETING");
  });
});

describe("isHighRiskPath", () => {
  it("escalates symbol and slug inside IDENTITY", () => {
    expect(isHighRiskPath("symbol")).toBe(true);
    expect(isHighRiskPath("slug")).toBe(true);
  });

  it("keeps the rest of IDENTITY low risk", () => {
    expect(isHighRiskPath("name")).toBe(false);
    expect(isHighRiskPath("tagline")).toBe(false);
    expect(isHighRiskPath("description")).toBe(false);
    expect(isHighRiskPath("logoUrl")).toBe(false);
  });

  it("marks every path under a high-risk section", () => {
    expect(isHighRiskPath("tokenomics.circulating")).toBe(true);
    expect(isHighRiskPath("contracts.0.address")).toBe(true);
    expect(isHighRiskPath("security.audits.1.reportUrl")).toBe(true);
    expect(isHighRiskPath("markets.3.pair")).toBe(true);
  });

  it("marks paths under low-risk sections as low risk", () => {
    expect(isHighRiskPath("marketing.roadmap.0.title")).toBe(false);
    expect(isHighRiskPath("links.website")).toBe(false);
  });

  it("fails closed on unknown paths", () => {
    expect(isHighRiskPath("whoKnows.someField")).toBe(true);
  });
});

describe("nativeChain", () => {
  it("высокий риск: подмена переносит на карточку выпуск чужой сети", () => {
    expect(isHighRiskPath("nativeChain")).toBe(true);
  });
});
