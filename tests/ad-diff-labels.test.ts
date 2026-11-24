import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { AD_DIFF_FIELDS } from "@/lib/ads/moderation";

describe("подписи полей «было → стало» у дела рекламы", () => {
  it("у каждого поля различий есть слова", () => {
    const labels = (en as unknown as { admin: { case: { ad: { field: Record<string, string> } } } })
      .admin.case.ad.field;
    const missing = AD_DIFF_FIELDS.filter((f) => !labels[f]);
    expect(missing).toEqual([]);
  });

  it("слов для исчезнувших полей нет", () => {
    const labels = (en as unknown as { admin: { case: { ad: { field: Record<string, string> } } } })
      .admin.case.ad.field;
    const extra = Object.keys(labels).filter((k) => !(AD_DIFF_FIELDS as readonly string[]).includes(k));
    expect(extra).toEqual([]);
  });
});
