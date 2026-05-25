import { describe, expect, it } from "vitest";
import { validateExchangeProfile } from "@/lib/exchange";

describe("validateExchangeProfile", () => {
  const base = {
    legalName: "Acme Exchange Ltd",
    displayName: "Acme",
    website: "https://acme.exchange",
    country: "EE",
    email: "ops@acme.exchange",
  };

  it("accepts a minimal valid profile and trims strings", () => {
    const r = validateExchangeProfile({ ...base, legalName: " Acme Exchange Ltd " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.legalName).toBe("Acme Exchange Ltd");
      expect(r.data.displayName).toBe("Acme");
    }
  });

  it("requires legalName, displayName, website, country, email", () => {
    expect(validateExchangeProfile({ ...base, legalName: "" })).toMatchObject({ ok: false, reason: "legal_name_required" });
    expect(validateExchangeProfile({ ...base, displayName: "" })).toMatchObject({ ok: false, reason: "display_name_required" });
    expect(validateExchangeProfile({ ...base, website: "" })).toMatchObject({ ok: false, reason: "website_required" });
    expect(validateExchangeProfile({ ...base, country: "" })).toMatchObject({ ok: false, reason: "country_required" });
    expect(validateExchangeProfile({ ...base, email: "" })).toMatchObject({ ok: false, reason: "email_required" });
  });

  it("rejects a non-http website", () => {
    expect(validateExchangeProfile({ ...base, website: "javascript:alert(1)" }))
      .toMatchObject({ ok: false, reason: "website_invalid" });
  });

  it("rejects a non-http logoUrl", () => {
    expect(validateExchangeProfile({ ...base, logoUrl: "ftp://x/y.png" }))
      .toMatchObject({ ok: false, reason: "logo_invalid" });
  });

  it("accepts an https logoUrl", () => {
    const r = validateExchangeProfile({ ...base, logoUrl: "https://cdn.acme.exchange/logo.png" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.logoUrl).toBe("https://cdn.acme.exchange/logo.png");
  });
});
