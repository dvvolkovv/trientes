import { describe, expect, it } from "vitest";
import { parsePayLinkInput, payHref, payCabinetHref, PAY_LINK_ID } from "@/lib/pay-link/parse";

const ID = "pl_A1b2C3d4E5f";

/**
 * Проверки списком из задания (§ «Как проверить», п. 2): каждая строка — путь, по
 * которому деньги покупателей ушли бы на чужой кошелёк, если разбирать ввод
 * регуляркой по строке вместо парсера адресов.
 */
describe("разбор ссылки оплаты", () => {
  it("принимает голый номер", () => {
    expect(parsePayLinkInput(ID)).toEqual({ ok: true, linkId: ID });
  });

  it("обрезает только пробелы ASCII снаружи", () => {
    expect(parsePayLinkInput(` \t${ID}\n `)).toEqual({ ok: true, linkId: ID });
  });

  it("принимает наш адрес целиком и с языком", () => {
    expect(parsePayLinkInput(`https://trientes.org/exchange/#/l/${ID}`)).toEqual({ ok: true, linkId: ID });
    expect(parsePayLinkInput(`https://trientes.org/exchange/?lang=ru#/l/${ID}`)).toEqual({ ok: true, linkId: ID });
    expect(parsePayLinkInput(`https://trientes.org/exchange/?lang=pt-BR#/l/${ID}`)).toEqual({ ok: true, linkId: ID });
  });

  it("не важен регистр хоста", () => {
    expect(parsePayLinkInput(`https://TRIENTES.ORG/exchange/#/l/${ID}`)).toEqual({ ok: true, linkId: ID });
  });

  it("пустой ввод — свой отказ", () => {
    expect(parsePayLinkInput("   ")).toEqual({ ok: false, reason: "empty" });
  });

  const rejected: [string, string][] = [
    ["логин в адресе", `https://trientes.org@evil.example/exchange/#/l/${ID}`],
    ["хост с нашим именем в начале", `https://trientes.org.evil.example/exchange/#/l/${ID}`],
    ["наш адрес внутри чужого", `https://evil.example/?u=https://trientes.org/exchange/#/l/${ID}`],
    ["явный порт", `https://trientes.org:8443/exchange/#/l/${ID}`],
    ["без шифрования", `http://trientes.org/exchange/#/l/${ID}`],
    ["точка в конце хоста", `https://trientes.org./exchange/#/l/${ID}`],
    ["другой путь", `https://trientes.org/exchange#/l/${ID}`],
    ["путь с хвостом", `https://trientes.org/exchange/pay/#/l/${ID}`],
    ["чужой язык в запросе", `https://trientes.org/exchange/?lang=xx#/l/${ID}`],
    ["лишний параметр", `https://trientes.org/exchange/?lang=ru&next=/evil#/l/${ID}`],
    ["запрос не про язык", `https://trientes.org/exchange/?a=1#/l/${ID}`],
    ["процентная запись номера", "https://trientes.org/exchange/#/l/%70l_A1b2C3d4E5f"],
    ["два номера", `https://trientes.org/exchange/#/l/${ID}#/l/pl_B1b2C3d4E5f`],
    ["выход из каталога", "https://trientes.org/exchange/#/l/pl_A1b2C3d4E5f/../pl_B1b2C3d4E5f"],
    ["лишний хвост", `https://trientes.org/exchange/#/l/${ID}?x=1`],
    ["пробел внутри", "https://trientes.org/exchange/#/l/pl_A1b2C3d4E 5"],
    ["кириллица в номере", "pl_А1b2C3d4E5f"],
    ["кириллические о, е, Р, С", "pl_оеРС3d4E5f1"],
    ["полноширинные цифры", "pl_Ａ1b2C3d4E5f"],
    ["знак нулевой ширины внутри", "pl_A1b2C​3d4E5f"],
    ["bidi внутри", "pl_A1b2C‮3d4E5f"],
    ["короткий номер", "pl_A1b2C3d4E5"],
    ["длинный номер", "pl_A1b2C3d4E5ff"],
    ["без приставки", "A1b2C3d4E5f"],
    ["не адрес вовсе", "посмотрите вот тут"],
    ["другая схема", `javascript:alert(1)//trientes.org/exchange/#/l/${ID}`],
  ];

  for (const [name, input] of rejected) {
    it(`отказ: ${name}`, () => {
      expect(parsePayLinkInput(input)).toEqual({ ok: false, reason: "bad_link" });
    });
  }

  it("номер с другим регистром — уже другой номер", () => {
    const lower = parsePayLinkInput(ID.toLowerCase());
    expect(lower).toEqual({ ok: true, linkId: ID.toLowerCase() });
    expect(lower).not.toEqual({ ok: true, linkId: ID });
  });

  it("образец номера с учётом регистра и длины", () => {
    expect(PAY_LINK_ID.test("pl_abcdefghijk")).toBe(true);
    expect(PAY_LINK_ID.test("PL_abcdefghijk")).toBe(false);
    expect(PAY_LINK_ID.test("pl_abcdefghij_")).toBe(false);
  });
});

describe("адреса, которые собираем сами", () => {
  it("кнопка «Оплатить» — постоянный шаблон и язык страницы", () => {
    expect(payHref("ru", ID)).toBe(`/exchange/?lang=ru#/l/${ID}`);
    expect(payHref("zh-CN", ID)).toBe(`/exchange/?lang=zh-CN#/l/${ID}`);
  });

  it("чужая локаль уходит без языка", () => {
    expect(payHref("xx", ID)).toBe(`/exchange/#/l/${ID}`);
    expect(payCabinetHref("xx")).toBe("https://pay.trientes.com/cabinet/#/apply");
  });

  it("кабинет подключения — на языке страницы", () => {
    expect(payCabinetHref("sk")).toBe("https://pay.trientes.com/cabinet/?lang=sk#/apply");
  });
});
