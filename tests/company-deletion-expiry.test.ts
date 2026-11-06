import { describe, expect, it, vi } from "vitest";
import { expireStaleDeletionRequests } from "@/lib/company-deletion-expiry";

describe("expireStaleDeletionRequests", () => {
  it("expires only pending requests past their deadline", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = new Date("2026-11-20T00:00:00.000Z");
    const n = await expireStaleDeletionRequests(
      { companyDeletionRequest: { updateMany } } as never,
      now,
    );
    expect(n).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING", expiresAt: { lt: now } },
      data: { status: "EXPIRED", decidedAt: now },
    });
  });

  it("reports zero without throwing when nothing is stale", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(
      expireStaleDeletionRequests({ companyDeletionRequest: { updateMany } } as never, new Date(0)),
    ).resolves.toBe(0);
  });
});
