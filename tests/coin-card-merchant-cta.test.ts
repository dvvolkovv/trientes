import { describe, expect, it } from "vitest";
import { ctaHref, type MerchantCta } from "@/lib/coin-card-merchant-cta";

const ctx = { locale: "ru", slug: "taler", cardId: "clz1abc234def567" };

describe("ctaHref", () => {
  it("sends a guest to login and brings them back to the acceptance section", () => {
    const href = ctaHref({ kind: "login" }, ctx);
    expect(href).toBe("/ru/login?next=%2Fru%2Fcoin%2Ftaler%23acceptance");
  });

  it("sends an individual with no company to the business cabinet", () => {
    expect(ctaHref({ kind: "register_company" }, ctx)).toBe("/ru/business");
  });

  it("opens the point form with the card preselected (query first, fragment last)", () => {
    const cta: MerchantCta = { kind: "add_point", companyId: "cmp1" };
    expect(ctaHref(cta, ctx)).toBe("/ru/cabinet/companies/cmp1?card=clz1abc234def567#add-point");
  });

  it("sends an existing merchant to their own points", () => {
    const cta: MerchantCta = { kind: "already", companyId: "cmp1", points: 3 };
    expect(ctaHref(cta, ctx)).toBe("/ru/cabinet/companies/cmp1#your-points");
  });

  it("escapes a slug that would otherwise break out of the next= param", () => {
    const href = ctaHref({ kind: "login" }, { ...ctx, slug: "a b/c?d" });
    expect(href).toBe("/ru/login?next=%2Fru%2Fcoin%2Fa%20b%2Fc%3Fd%23acceptance");
  });
});
