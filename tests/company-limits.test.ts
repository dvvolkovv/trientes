import { describe, expect, it } from "vitest";
import {
  MAX_COMPANIES_PER_USER,
  MAX_FINTECH_PER_USER,
  MAX_PENDING_COMPANIES_PER_USER,
  MAX_PENDING_FINTECH_PER_USER,
  checkCompanyLimits,
  checkFintechLimits,
} from "@/lib/company-limits";

describe("checkCompanyLimits", () => {
  it("lets a user with no companies through", () => {
    expect(checkCompanyLimits({ owned: 0, pending: 0 })).toEqual({ ok: true });
  });

  it("lets the last allowed company through and stops the next one", () => {
    expect(checkCompanyLimits({ owned: MAX_COMPANIES_PER_USER - 1, pending: 0 })).toEqual({ ok: true });
    expect(checkCompanyLimits({ owned: MAX_COMPANIES_PER_USER, pending: 0 })).toEqual({
      ok: false,
      reason: "too_many_companies",
    });
  });

  it("stops a fourth company waiting for moderation", () => {
    expect(checkCompanyLimits({ owned: 3, pending: MAX_PENDING_COMPANIES_PER_USER - 1 })).toEqual({ ok: true });
    expect(checkCompanyLimits({ owned: 3, pending: MAX_PENDING_COMPANIES_PER_USER })).toEqual({
      ok: false,
      reason: "too_many_pending_companies",
    });
  });

  it("reports the total limit first — it is the harder stop of the two", () => {
    expect(checkCompanyLimits({ owned: MAX_COMPANIES_PER_USER, pending: MAX_PENDING_COMPANIES_PER_USER })).toEqual({
      ok: false,
      reason: "too_many_companies",
    });
  });

  it("does not count approved companies against the pending limit", () => {
    expect(checkCompanyLimits({ owned: 9, pending: 0 })).toEqual({ ok: true });
  });
});

describe("checkFintechLimits", () => {
  it("allows the first service and stops past the cap", () => {
    expect(checkFintechLimits({ owned: 0, pending: 0 })).toEqual({ ok: true });
    expect(checkFintechLimits({ owned: MAX_FINTECH_PER_USER - 1, pending: 0 })).toEqual({ ok: true });
    expect(checkFintechLimits({ owned: MAX_FINTECH_PER_USER, pending: 0 })).toEqual({
      ok: false,
      reason: "too_many_fintechs",
    });
  });

  it("stops a third service waiting for review", () => {
    expect(checkFintechLimits({ owned: 2, pending: MAX_PENDING_FINTECH_PER_USER })).toEqual({
      ok: false,
      reason: "too_many_pending_fintechs",
    });
  });

  it("keeps its own caps, lower than the company ones", () => {
    expect(MAX_FINTECH_PER_USER).toBeLessThan(MAX_COMPANIES_PER_USER);
  });
});
