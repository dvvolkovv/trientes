import { describe, expect, it } from "vitest";
import { fintechToPoi } from "@/lib/fintech-pois";

const row = {
  id: "ckft1",
  slug: "revolut",
  displayName: "Revolut",
  logoUrl: "https://x/r.png",
  description: "Neobank with crypto",
  website: "https://revolut.com",
  hqLat: 51.5074,
  hqLon: -0.1278,
  address: "7 Westferry Circus, London",
  services: ["CARD", "IBAN", "EXCHANGE"],
  socials: [{ network: "twitter", url: "https://x.com/revolut" }],
};

describe("fintechToPoi", () => {
  it("maps a fintech HQ to a Poi with a fintech/ id prefix", () => {
    const p = fintechToPoi(row as never);
    expect(p.id).toBe("fintech/ckft1");
    expect(p.lat).toBe(51.5074);
    expect(p.lon).toBe(-0.1278);
    expect(p.layer).toBe("fintech");
    expect(p.name).toBe("Revolut");
    expect(p.image).toBe("https://x/r.png");
    expect(p.website).toBe("https://revolut.com");
    expect(p.address).toBe("7 Westferry Circus, London");
  });
  it("drops malicious socials (XSS guard)", () => {
    const dirty = { ...row, socials: [{ network: "evil", url: "javascript:alert(1)" }] };
    const p = fintechToPoi(dirty as never);
    expect(p.socials).toEqual([]);
  });
  it("returns coinSpecific=false (HQ pin is not coin-aware)", () => {
    expect(fintechToPoi(row as never).coinSpecific).toBe(false);
  });
  it("carries the company slug through so the popup can deep-link", () => {
    expect(fintechToPoi(row as never).slug).toBe("revolut");
  });
});
