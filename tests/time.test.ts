import { describe, it, expect } from "vitest";
import { timeAgo } from "@/lib/time";

describe("timeAgo", () => {
  const now = 1_700_000_000_000; // fixed ms so the buckets are deterministic
  const ago = (s: number) => Math.floor(now / 1000) - s;

  it("buckets seconds, minutes, hours and days", () => {
    expect(timeAgo(ago(5), "en", now)).toMatch(/now|sec/i);
    expect(timeAgo(ago(2 * 60), "en", now)).toMatch(/min/i);
    expect(timeAgo(ago(3 * 3600), "en", now)).toMatch(/hour|hr/i);
    expect(timeAgo(ago(4 * 86400), "en", now)).toMatch(/day/i);
  });

  it("is locale-aware", () => {
    expect(timeAgo(ago(3 * 3600), "ru", now)).not.toEqual(timeAgo(ago(3 * 3600), "en", now));
  });
});
