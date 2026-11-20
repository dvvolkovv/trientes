import { describe, expect, it } from "vitest";
import { splitCompanyEdit, changesToPatch, parseChanges } from "@/lib/company-edit";

describe("правка карточки предприятия", () => {
  const base = {
    legalName: "Arcon s.r.o.",
    displayName: "Arcon",
    description: "Шьём сумки",
    website: "https://arcon.cz",
    phone: "+420 1",
    email: "a@arcon.cz",
    city: "Praha",
  };

  it("ничего не менялось — ни свободных полей, ни ждущих", () => {
    const r = splitCompanyEdit(base, { ...base });
    expect(r.free).toEqual({});
    expect(r.pending).toEqual([]);
    expect(r.needsDocuments).toBe(false);
  });

  it("описание и логотип применяются сразу", () => {
    const r = splitCompanyEdit(base, { ...base, description: "Шьём сумки и ремни", logoUrl: "https://x/l.png" });
    expect(r.free).toEqual({ description: "Шьём сумки и ремни", logoUrl: "https://x/l.png" });
    expect(r.pending).toEqual([]);
  });

  it("витринное имя и адрес ждут модератора", () => {
    const r = splitCompanyEdit(base, { ...base, displayName: "Arcon Bags", city: "Brno" });
    expect(r.free).toEqual({});
    expect(r.pending.map((c) => c.field).sort()).toEqual(["city", "displayName"]);
    expect(r.needsDocuments).toBe(false);
  });

  it("юридическое имя требует документов", () => {
    const r = splitCompanyEdit(base, { ...base, legalName: "Arcon a.s." });
    expect(r.needsDocuments).toBe(true);
    expect(r.pending).toEqual([{ field: "legalName", before: "Arcon s.r.o.", after: "Arcon a.s." }]);
  });

  it("пустая строка и null — одно и то же «не задано»", () => {
    const r = splitCompanyEdit({ ...base, phone: null }, { ...base, phone: "   " });
    expect(r.pending).toEqual([]);
  });

  it("очистка заполненного поля — изменение", () => {
    const r = splitCompanyEdit(base, { ...base, phone: "" });
    expect(r.pending).toEqual([{ field: "phone", before: "+420 1", after: null }]);
  });

  it("набор изменений превращается в заплатку", () => {
    expect(changesToPatch([{ field: "city", before: "Praha", after: "Brno" }])).toEqual({ city: "Brno" });
  });

  it("негодные строки из JSONB выбрасываются", () => {
    expect(parseChanges([{ field: "nope", after: "x" }, { field: "city", before: null, after: "Brno" }, 7])).toEqual([
      { field: "city", before: null, after: "Brno" },
    ]);
  });
});
