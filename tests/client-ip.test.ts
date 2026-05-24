import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://trientes.org/x", { headers });
}

describe("clientIp", () => {
  it("uses first entry from x-forwarded-for", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    expect(clientIp(reqWith({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });
  it("falls back to 'unknown' when no header", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
  it("trims whitespace", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "  9.9.9.9  " }))).toBe("9.9.9.9");
  });
});
