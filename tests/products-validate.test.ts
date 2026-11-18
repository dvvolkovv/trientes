import { describe, expect, it } from "vitest";
import { diffProduct, isOwnMediaUrl, validateProductInput } from "@/lib/products/validate";

const base = {
  name: "Молоко «Домик в деревне» 3,2%",
  category: "food",
  language: "ru",
  description: "Пастеризованное молоко жирностью 3,2 процента в упаковке один литр.",
};

describe("validateProductInput", () => {
  it("takes a filled passport and trims it", () => {
    const r = validateProductInput({ ...base, brand: " Домик ", gtin: " 5449-0000 0099 6 " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.brand).toBe("Домик");
    expect(r.data.gtin).toBe("5449000000996");
    expect(r.data.usage).toBeNull();
  });

  it("refuses a bad barcode out loud instead of clearing it", () => {
    // Молча обнулив код, мы завели бы паспорт-двойник вместо склейки.
    expect(validateProductInput({ ...base, gtin: "5449000000997" })).toEqual({ ok: false, reason: "gtin_invalid" });
  });

  it("names every refusal by its own code", () => {
    expect(validateProductInput({ ...base, name: "  " })).toEqual({ ok: false, reason: "name_required" });
    expect(validateProductInput({ ...base, category: "weapons" })).toEqual({ ok: false, reason: "category_invalid" });
    expect(validateProductInput({ ...base, language: "xx" })).toEqual({ ok: false, reason: "language_invalid" });
    expect(validateProductInput({ ...base, description: "" })).toEqual({ ok: false, reason: "description_required" });
  });

  it("takes media only from our own upload root", () => {
    const good = "/uploads/products/abc123/deadbeef.jpg";
    expect(isOwnMediaUrl(good)).toBe(true);
    expect(isOwnMediaUrl("https://evil.example/x.jpg")).toBe(false);
    expect(isOwnMediaUrl("/uploads/points/abc/x.jpg")).toBe(false);
    expect(isOwnMediaUrl("/uploads/products/../../etc/passwd")).toBe(false);

    expect(validateProductInput({ ...base, photos: [{ url: good }] }).ok).toBe(true);
    expect(validateProductInput({ ...base, photos: [{ url: "https://evil.example/x.jpg" }] })).toEqual({
      ok: false,
      reason: "bad_media_url",
    });
  });

  it("caps photos and documents", () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({ url: `/uploads/products/abc/${i}aaaa.jpg` }));
    expect(validateProductInput({ ...base, photos })).toEqual({ ok: false, reason: "too_many_photos" });
    expect(
      validateProductInput({ ...base, documents: [{ kind: "nonsense", url: "/uploads/products/abc/a.pdf" }] }),
    ).toEqual({ ok: false, reason: "bad_document_kind" });
  });
});

describe("diffProduct", () => {
  it("names the fields that changed, not the fact of an edit", () => {
    const d = diffProduct({ name: "A", brand: null }, { name: "B", brand: null });
    expect(d).toEqual([{ field: "name", before: "A", after: "B" }]);
  });

  it("sees a changed list of attributes and ignores an unchanged one", () => {
    const attrs = [{ key: "Вес", value: "1", unit: "кг" }];
    expect(diffProduct({ attributes: attrs }, { attributes: attrs })).toEqual([]);
    expect(diffProduct({ attributes: attrs }, { attributes: [] })).toEqual([
      { field: "attributes", before: attrs, after: [] },
    ]);
  });
});
