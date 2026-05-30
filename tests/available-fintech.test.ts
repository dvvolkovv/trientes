import { describe, expect, it } from "vitest";
import { availableFintechCacheKey } from "@/lib/available-fintech";

describe("availableFintechCacheKey", () => {
  it("upper-cases the country code in the key", () => {
    expect(availableFintechCacheKey("us")).toBe("fintech:avail:US");
    expect(availableFintechCacheKey("DE")).toBe("fintech:avail:DE");
  });
});
