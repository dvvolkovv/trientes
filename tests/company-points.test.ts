import { describe, expect, it } from "vitest";
import { companyPointToPoi } from "@/lib/company-points";

const row = {
  id: "ckpoint1", type: "ATM", name: "BTC ATM", description: null,
  lat: 50.08, lon: 14.42, address: "Main St", acceptedCoinIds: ["bitcoin"],
  logoUrl: "https://x/y.png", openingHours: "24/7", phone: null, website: null,
  socials: [{ network: "telegram", url: "https://t.me/x" }],
  company: { displayName: "ACME", logoUrl: "https://x/c.png", website: "https://acme.co", socials: null },
};

describe("companyPointToPoi", () => {
  it("maps an ATM point to an atm-layer Poi with a company id prefix", () => {
    const p = companyPointToPoi(row as never, "bitcoin");
    expect(p.id).toBe("company/ckpoint1");
    expect(p.layer).toBe("atm");
    expect(p.lat).toBe(50.08);
    expect(p.coinSpecific).toBe(true);
    expect(p.image).toBe("https://x/y.png");
    expect(p.socials).toEqual([{ network: "telegram", url: "https://t.me/x" }]);
  });
  it("maps SHOP/POS/SALES_OFFICE to the merchant layer and reads coinSpecific per coin", () => {
    expect(companyPointToPoi({ ...row, type: "SHOP" } as never, "ethereum").layer).toBe("merchant");
    expect(companyPointToPoi({ ...row, type: "POS" } as never, "ethereum").coinSpecific).toBe(false);
  });
  it("falls back to the company logo + website when the point has none", () => {
    const p = companyPointToPoi({ ...row, logoUrl: null, website: null } as never, "bitcoin");
    expect(p.image).toBe("https://x/c.png");
    expect(p.website).toBe("https://acme.co");
  });
});
