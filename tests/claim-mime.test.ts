import { describe, it, expect } from "vitest";
import { decodeHeaderWords, extractText } from "@/lib/claims/mime";

/**
 * Разбор письма как оно приходит на самом деле. Найдено живой разведкой
 * 24.11: тема приходит в кодировке RFC 2047 (`=?UTF-8?Q?…`), а тело — как
 * `multipart/alternative` с `quoted-printable`. Без разбора проверяющий видел
 * бы в деле границы частей, переносы со знаком равенства и вторую, html-ю
 * копию того же текста.
 */

describe("decodeHeaderWords", () => {
  it("разбирает Q-кодировку utf-8", () => {
    expect(decodeHeaderWords("=?UTF-8?Q?CI_probe_=E2=80=94_domain?=")).toBe("CI probe — domain");
  });

  it("разбирает B-кодировку utf-8", () => {
    const b = Buffer.from("Это наш проект", "utf8").toString("base64");
    expect(decodeHeaderWords(`=?utf-8?B?${b}?=`)).toBe("Это наш проект");
  });

  it("склеивает несколько слов подряд", () => {
    const a = Buffer.from("Привет, ", "utf8").toString("base64");
    const b = Buffer.from("Trientes", "utf8").toString("base64");
    expect(decodeHeaderWords(`=?utf-8?B?${a}?= =?utf-8?B?${b}?=`)).toBe("Привет, Trientes");
  });

  it("обычный текст не трогает", () => {
    expect(decodeHeaderWords("This is our coin")).toBe("This is our coin");
    expect(decodeHeaderWords("")).toBe("");
  });

  it("latin1 читается как latin1, а не как utf-8", () => {
    expect(decodeHeaderWords("=?ISO-8859-1?Q?caf=E9?=")).toBe("café");
  });

  it("незнакомая кодировка не роняет разбор: слово остаётся как есть", () => {
    expect(decodeHeaderWords("=?KOI8-R?Q?test?=")).toContain("test");
  });

  it("имя с адресом сохраняет адрес", () => {
    const name = Buffer.from("Акала", "utf8").toString("base64");
    expect(decodeHeaderWords(`=?utf-8?B?${name}?= <ops@acala.network>`)).toBe(
      "Акала <ops@acala.network>",
    );
  });
});

describe("extractText", () => {
  it("берёт text/plain из multipart и снимает quoted-printable", () => {
    const raw = [
      "Content-Type: multipart/alternative; boundary=\"--_Part_1\"",
      "",
      "----_Part_1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Probe body for slice CI. Checking what our server =",
      "writes.",
      "----_Part_1",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<p>Probe body</p>",
      "----_Part_1--",
    ].join("\r\n");
    expect(extractText(raw)).toBe("Probe body for slice CI. Checking what our server writes.");
  });

  it("берёт base64 text/plain", () => {
    const body = Buffer.from("This is our coin, we are the team.", "utf8").toString("base64");
    const raw = [
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n");
    expect(extractText(raw)).toBe("This is our coin, we are the team.");
  });

  it("простое письмо без кодировки читается как есть", () => {
    const raw = ["Content-Type: text/plain; charset=utf-8", "", "Hello there"].join("\r\n");
    expect(extractText(raw)).toBe("Hello there");
  });

  it("если text/plain нет вовсе, html превращается в текст", () => {
    const raw = [
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Hello <b>there</b></p>",
    ].join("\r\n");
    expect(extractText(raw)).toBe("Hello there");
  });

  it("вложение текстом не считается", () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "See the deck attached.",
      "--b",
      "Content-Type: application/pdf; name=deck.pdf",
      "Content-Disposition: attachment; filename=deck.pdf",
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0xLjQK",
      "--b--",
    ].join("\r\n");
    expect(extractText(raw)).toBe("See the deck attached.");
  });

  it("вложенный multipart разбирается рекурсивно", () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Inner plain text",
      "--inner--",
      "--outer--",
    ].join("\r\n");
    expect(extractText(raw)).toBe("Inner plain text");
  });

  it("пустое письмо — null, а не пустая строка", () => {
    expect(extractText("")).toBeNull();
    expect(extractText("Content-Type: text/plain\r\n\r\n   ")).toBeNull();
  });

  it("длинное тело режется", () => {
    const raw = `Content-Type: text/plain\r\n\r\n${"x".repeat(5_000)}`;
    expect(extractText(raw)?.length).toBe(4_001);
  });
});
