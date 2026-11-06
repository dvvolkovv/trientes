import { describe, expect, it, vi } from "vitest";
import { expireStaleRevisions } from "@/lib/coin-card-expiry";

describe("expireStaleRevisions", () => {
  it("expires only unsigned revisions whose deadline has passed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = new Date("2026-11-20T00:00:00.000Z");
    const count = await expireStaleRevisions({ coinCardRevision: { updateMany } }, now);

    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING_SIGNERS", expiresAt: { lt: now } },
      data: { status: "EXPIRED", decidedAt: now },
    });
  });
});
