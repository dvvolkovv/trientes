import { describe, expect, it } from "vitest";
import {
  MERCHANT_COMPANY_LIMIT,
  addPointHref,
  ctaHref,
  manageHref,
  newCompanyHref,
  pickMerchantCompanies,
  type MerchantCompany,
} from "@/lib/coin-card-merchant-cta";

const ctx = { locale: "ru", slug: "taler", cardId: "clz1abc234def567" };

function company(i: number, acceptedPoints = 0): MerchantCompany {
  return { id: `cmp${i}`, displayName: `Company ${i}`, status: "APPROVED", acceptedPoints };
}

describe("ctaHref", () => {
  it("sends a guest to login and brings them back to the acceptance section", () => {
    expect(ctaHref({ kind: "login" }, ctx)).toBe("/ru/login?next=%2Fru%2Fcoin%2Ftaler%23acceptance");
  });

  it("sends a user with no company to the cabinet, carrying the coin along", () => {
    expect(ctaHref({ kind: "register_company" }, ctx)).toBe(
      "/ru/cabinet?card=clz1abc234def567#companies",
    );
  });

  it("escapes a slug that would otherwise break out of the next= param", () => {
    expect(ctaHref({ kind: "login" }, { ...ctx, slug: "a b/c?d" })).toBe(
      "/ru/login?next=%2Fru%2Fcoin%2Fa%20b%2Fc%3Fd%23acceptance",
    );
  });
});

describe("addPointHref / newCompanyHref / manageHref", () => {
  it("opens one company's point form with the card preselected (query first, fragment last)", () => {
    expect(addPointHref("cmp1", ctx)).toBe(
      "/ru/cabinet/companies/cmp1?card=clz1abc234def567#add-point",
    );
  });

  it("offers registering another company without losing the coin", () => {
    expect(newCompanyHref(ctx)).toBe("/ru/cabinet?card=clz1abc234def567#companies");
  });

  it("points an existing merchant at that company's own points", () => {
    expect(manageHref("cmp1", ctx)).toBe("/ru/cabinet/companies/cmp1#your-points");
  });
});

describe("pickMerchantCompanies", () => {
  it("never silently picks one company for the user — all of them are offered", () => {
    const picked = pickMerchantCompanies([company(1), company(2)]);
    expect(picked.companies.map((c) => c.id)).toEqual(["cmp1", "cmp2"]);
    expect(picked.hasMore).toBe(false);
  });

  it("caps the inline list and says there are more", () => {
    const many = Array.from({ length: MERCHANT_COMPANY_LIMIT + 1 }, (_, i) => company(i));
    const picked = pickMerchantCompanies(many);
    expect(picked.companies).toHaveLength(MERCHANT_COMPANY_LIMIT);
    expect(picked.hasMore).toBe(true);
  });

  it("puts companies that already accept the coin first — that is where a point likely belongs", () => {
    const picked = pickMerchantCompanies([company(1, 0), company(2, 3), company(3, 1)]);
    expect(picked.companies.map((c) => c.id)).toEqual(["cmp2", "cmp3", "cmp1"]);
  });

  it("sums accepted points across every company, not just the first", () => {
    expect(pickMerchantCompanies([company(1, 2), company(2, 3)]).acceptedTotal).toBe(5);
    expect(pickMerchantCompanies([]).acceptedTotal).toBe(0);
  });
});
