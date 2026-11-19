import { describe, expect, it } from "vitest";
import {
  DAILY_EDITS,
  cleanAttributes,
  editKind,
  isMp4,
  revertPatch,
  tokenizationReadiness,
  withinDailyLimit,
} from "@/lib/products/rules";

const listedCompany = {
  id: "c1",
  status: "APPROVED" as const,
  suspendedAt: null,
  deletedAt: null,
  permissions: { products: "EDIT" as const },
};
const freeProduct = { ownerCompanyId: null, suspendedAt: null, mergedIntoId: null, deletedAt: null };

describe("editKind", () => {
  it("lets any listed company write straight into an unclaimed passport", () => {
    expect(editKind(freeProduct, listedCompany)).toBe("direct");
  });

  it("lets the owner write straight, and others only propose", () => {
    const owned = { ...freeProduct, ownerCompanyId: "c1" };
    expect(editKind(owned, listedCompany)).toBe("direct");
    expect(editKind(owned, { ...listedCompany, id: "c2" })).toBe("revision");
  });

  it("refuses a company that has not passed our moderation or is off the shelf", () => {
    expect(editKind(freeProduct, { ...listedCompany, status: "PENDING" })).toBe("forbidden");
    expect(editKind(freeProduct, { ...listedCompany, suspendedAt: new Date() })).toBe("forbidden");
    expect(editKind(freeProduct, { ...listedCompany, deletedAt: new Date() })).toBe("forbidden");
  });

  it("refuses a viewer and a stranger", () => {
    expect(editKind(freeProduct, { ...listedCompany, permissions: { products: "VIEW" } })).toBe("forbidden");
    expect(editKind(freeProduct, null)).toBe("forbidden");
  });

  it("refuses a passport that supervision took off, that is merged or deleted", () => {
    // Снятый возвращает сотрудник, а не правка; у слитого правят главный.
    expect(editKind({ ...freeProduct, suspendedAt: new Date() }, listedCompany)).toBe("forbidden");
    expect(editKind({ ...freeProduct, mergedIntoId: "p9" }, listedCompany)).toBe("forbidden");
    expect(editKind({ ...freeProduct, deletedAt: new Date() }, listedCompany)).toBe("forbidden");
  });
});

describe("tokenizationReadiness", () => {
  const ready = {
    name: "Молоко",
    category: "food",
    description: "x".repeat(120),
    photoCount: 1,
    documentCount: 1,
    gtin: "5449000000996",
    ownerCompanyId: "c1",
  };

  it("is ready only when every part is there", () => {
    expect(tokenizationReadiness(ready)).toEqual({ ready: true, missing: [] });
  });

  it("names exactly what is missing", () => {
    expect(tokenizationReadiness({ ...ready, gtin: null }).missing).toEqual(["gtin"]);
    expect(tokenizationReadiness({ ...ready, ownerCompanyId: null }).missing).toEqual(["manufacturer"]);
    expect(tokenizationReadiness({ ...ready, photoCount: 0 }).missing).toEqual(["photo"]);
    expect(tokenizationReadiness({ ...ready, documentCount: 0 }).missing).toEqual(["document"]);
    expect(tokenizationReadiness({ ...ready, description: "короткое" }).missing).toEqual(["description"]);
    expect(tokenizationReadiness({ ...ready, name: " " }).missing).toEqual(["name"]);
    expect(tokenizationReadiness({ ...ready, category: "" }).missing).toEqual(["category"]);
  });

  it("is never ready with anything missing", () => {
    expect(tokenizationReadiness({ ...ready, gtin: null }).ready).toBe(false);
  });
});

describe("isMp4", () => {
  it("reads the container, not the claimed type", () => {
    const head = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42")]);
    expect(isMp4(head)).toBe(true);
    expect(isMp4(Buffer.from("<svg onload=alert(1)>"))).toBe(false);
    expect(isMp4(Buffer.from([0, 1, 2]))).toBe(false);
  });
});

describe("revertPatch", () => {
  it("turns an edit into its own undo, as a new entry", () => {
    expect(revertPatch({ field: "name", before: "Молоко", after: "Мусор" })).toEqual({
      field: "name",
      after: "Молоко",
    });
  });

  it("undoes a field that had nothing in it", () => {
    expect(revertPatch({ field: "brand", before: null, after: "Х" })).toEqual({
      field: "brand",
      after: null,
    });
  });
});

describe("cleanAttributes", () => {
  it("drops empty rows, trims and caps the list", () => {
    expect(cleanAttributes([{ key: " Вес ", value: " 1 ", unit: " кг " }, { key: "", value: "x" }, { key: "a", value: "" }])).toEqual([
      { key: "Вес", value: "1", unit: "кг" },
    ]);
    expect(cleanAttributes(Array.from({ length: 80 }, (_, i) => ({ key: `k${i}`, value: "v" }))).length).toBe(50);
  });

  it("makes nothing of a value that is not a list", () => {
    expect(cleanAttributes("свойства" as unknown)).toEqual([]);
  });
});

describe("withinDailyLimit", () => {
  it("counts what was already written today", () => {
    expect(withinDailyLimit(DAILY_EDITS - 1, DAILY_EDITS)).toBe(true);
    expect(withinDailyLimit(DAILY_EDITS, DAILY_EDITS)).toBe(false);
  });
});
