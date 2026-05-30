import { describe, expect, it } from "vitest";
import { CURATED_POIS } from "@/lib/curated-pois";

describe("CURATED_POIS", () => {
  it("has well-formed, uniquely-identified entries", () => {
    const ids = new Set<string>();
    for (const p of CURATED_POIS) {
      expect(p.name).toBeTruthy();
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      expect(p.logo.startsWith("/")).toBe(true); // a /public path, not a hotlink
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      for (const s of p.socials) expect(/^https?:\/\//.test(s.url)).toBe(true);
    }
  });
});
