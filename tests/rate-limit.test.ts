import { describe, expect, it } from "vitest";
import { evalLoginLimit, evalRegisterLimit } from "@/lib/rate-limit";

describe("evalLoginLimit", () => {
  it("allows under the threshold", () => {
    expect(evalLoginLimit({ failuresByIp: 3, failuresByIpAndIdentifier: 2 })).toEqual({ blocked: false });
  });
  it("blocks at 10 failures by IP alone in the window", () => {
    expect(evalLoginLimit({ failuresByIp: 10, failuresByIpAndIdentifier: 0 })).toEqual({ blocked: true });
  });
  it("blocks at 5 failures for (ip,identifier) even if total IP failures are low", () => {
    expect(evalLoginLimit({ failuresByIp: 1, failuresByIpAndIdentifier: 5 })).toEqual({ blocked: true });
  });
});

describe("evalRegisterLimit", () => {
  it("allows under the per-IP threshold", () => {
    expect(evalRegisterLimit({ registrationsByIp: 4 })).toEqual({ blocked: false });
  });
  it("blocks at 5 registrations per IP per hour", () => {
    expect(evalRegisterLimit({ registrationsByIp: 5 })).toEqual({ blocked: true });
  });
});
