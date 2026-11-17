import { describe, expect, it } from "vitest";
import { reportablePointId } from "@/lib/poi-tile";

describe("reportablePointId", () => {
  it("наша точка даёт id без приставки", () => {
    expect(reportablePointId("company/abc123")).toBe("abc123");
  });
  it("точка зеркала BTC Map жалобу не принимает", () => {
    expect(reportablePointId("node/12345")).toBeNull();
  });
  it("офис финтеха — не точка приёма, жалобы по нему не берём", () => {
    expect(reportablePointId("fintech/x1")).toBeNull();
  });
});
