import { describe, expect, it } from "vitest";
import { isAdminWhitelisted, parseAdminWhitelist } from "@/lib/admin-whitelist";

describe("parseAdminWhitelist", () => {
  it("parses comma-separated prefixed entries", () => {
    const parsed = parseAdminWhitelist(
      "email:foo@bar.com,telegram:123,github:octo",
    );
    expect(parsed).toEqual([
      { type: "email", value: "foo@bar.com" },
      { type: "telegram", value: "123" },
      { type: "github", value: "octo" },
    ]);
  });

  it("trims whitespace and ignores empty entries", () => {
    expect(parseAdminWhitelist(" email:a@b.com ,, github:x ")).toEqual([
      { type: "email", value: "a@b.com" },
      { type: "github", value: "x" },
    ]);
  });

  it("lowercases emails and github usernames", () => {
    expect(parseAdminWhitelist("email:FOO@Bar.COM,github:OctoCat")).toEqual([
      { type: "email", value: "foo@bar.com" },
      { type: "github", value: "octocat" },
    ]);
  });

  it("preserves telegram ids as-is (numeric strings)", () => {
    expect(parseAdminWhitelist("telegram:123456789")).toEqual([
      { type: "telegram", value: "123456789" },
    ]);
  });

  it("ignores entries with unknown prefixes", () => {
    expect(parseAdminWhitelist("twitter:foo,email:a@b.com")).toEqual([
      { type: "email", value: "a@b.com" },
    ]);
  });

  it("returns [] for empty/undefined input", () => {
    expect(parseAdminWhitelist("")).toEqual([]);
    expect(parseAdminWhitelist(undefined)).toEqual([]);
  });
});

describe("isAdminWhitelisted", () => {
  const list = parseAdminWhitelist(
    "email:foo@bar.com,telegram:42,github:octo",
  );

  it("matches by email case-insensitively", () => {
    expect(isAdminWhitelisted(list, { email: "FOO@bar.com" })).toBe(true);
  });

  it("matches by telegram id", () => {
    expect(isAdminWhitelisted(list, { telegramId: "42" })).toBe(true);
  });

  it("matches by github username case-insensitively", () => {
    expect(isAdminWhitelisted(list, { githubLogin: "Octo" })).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(isAdminWhitelisted(list, { email: "other@x.com" })).toBe(false);
  });

  it("returns false on empty whitelist", () => {
    expect(isAdminWhitelisted([], { email: "foo@bar.com" })).toBe(false);
  });
});
