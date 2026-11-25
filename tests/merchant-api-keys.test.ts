import { describe, expect, it } from "vitest";
import {
  MAX_API_KEYS,
  apiKeyPrefix,
  generateApiKey,
  hashApiKey,
  keyNameValid,
  parseBearer,
} from "@/lib/merchant-api/keys";

describe("ключи read-only API предприятия", () => {
  it("ключ узнаётся по приставке и не повторяется", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith("tri_")).toBe(true);
    expect(a).not.toBe(b);
    expect(apiKeyPrefix(a)).toHaveLength(8);
    expect(a.startsWith(apiKeyPrefix(a))).toBe(true);
  });

  it("в базе лежит хеш, а не ключ", () => {
    const token = generateApiKey();
    const hash = hashApiKey(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token.slice(4));
    expect(hashApiKey(token)).toBe(hash);
  });

  it("принимается только Bearer с нашей приставкой", () => {
    const token = generateApiKey();
    expect(parseBearer(`Bearer ${token}`)).toBe(token);
    expect(parseBearer(`bearer ${token}`)).toBe(token);
    // Ключ в строке запроса попадает в журнал nginx — такой заголовок не годится.
    expect(parseBearer(token)).toBeNull();
    expect(parseBearer(`Basic ${token}`)).toBeNull();
    expect(parseBearer("Bearer abc123")).toBeNull();
    expect(parseBearer("Bearer tri_short")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });

  it("имя ключа — одна строка, которую читает человек", () => {
    expect(keyNameValid("1С бухгалтера")).toBe(true);
    expect(keyNameValid(" a ")).toBe(false);
    expect(keyNameValid("x".repeat(61))).toBe(false);
    expect(keyNameValid("две\nстроки")).toBe(false);
  });

  it("живых ключей на предприятие пять", () => {
    expect(MAX_API_KEYS).toBe(5);
  });
});
