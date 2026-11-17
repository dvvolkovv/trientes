import { describe, expect, it } from "vitest";
import {
  collectKybDocuments,
  collectMessageDocuments,
  dedupeDocuments,
} from "@/lib/cases/documents";

describe("collectKybDocuments", () => {
  it("читает вид, адрес и подпись", () => {
    const rows = collectKybDocuments([
      { kind: "REGISTRATION_CERT", url: "https://example.org/a.pdf", label: "Выписка" },
    ]);
    expect(rows).toEqual([
      { kind: "KYB_REGISTRATION_CERT", url: "https://example.org/a.pdf", label: "Выписка" },
    ]);
  });

  it("неизвестный вид становится OTHER, а не теряется", () => {
    const rows = collectKybDocuments([{ kind: "WHATEVER", url: "https://example.org/a.pdf" }]);
    expect(rows[0]?.kind).toBe("KYB_OTHER");
  });

  it("отбрасывает мусор и не-http адреса", () => {
    expect(
      collectKybDocuments([
        null,
        "строка",
        { kind: "ID" },
        { kind: "ID", url: "javascript:alert(1)" },
        { kind: "ID", url: "/uploads/a.pdf" },
      ]),
    ).toEqual([]);
  });

  it("не массив — пустой список, а не исключение", () => {
    expect(collectKybDocuments(undefined)).toEqual([]);
    expect(collectKybDocuments({ url: "https://example.org/a.pdf" })).toEqual([]);
  });
});

describe("collectMessageDocuments", () => {
  const att = (name: string) => ({
    name,
    filename: "скан.pdf",
    size: 10,
    mime: "application/pdf",
  });

  it("берёт вложения заявителя", () => {
    const rows = collectMessageDocuments("case1", [
      { side: "APPLICANT", attachments: [att("a".repeat(24) + ".pdf")] },
    ]);
    expect(rows).toEqual([
      {
        kind: "MESSAGE_ATTACHMENT",
        url: `/api/case-attachment/case1/${"a".repeat(24)}.pdf`,
        label: "скан.pdf",
      },
    ]);
  });

  it("наши собственные вложения судить незачем", () => {
    const rows = collectMessageDocuments("case1", [
      { side: "STAFF", attachments: [att("b".repeat(24) + ".pdf")] },
    ]);
    expect(rows).toEqual([]);
  });

  it("битое имя файла до строки документа не доходит", () => {
    const rows = collectMessageDocuments("case1", [
      { side: "APPLICANT", attachments: [{ ...att("../../etc/passwd"), mime: "application/pdf" }] },
    ]);
    expect(rows).toEqual([]);
  });
});

describe("dedupeDocuments", () => {
  it("один адрес — одна строка", () => {
    const rows = dedupeDocuments([
      { kind: "KYB_ID", url: "https://example.org/a.pdf", label: "первый" },
      { kind: "MESSAGE_ATTACHMENT", url: "https://example.org/a.pdf", label: "второй" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("первый");
  });
});
