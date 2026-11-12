import { describe, expect, it } from "vitest";
import { dexHref, dexUrlWithLang } from "@/lib/dex-link";
import { SUPPORTED_LOCALES } from "@/lib/locales";

describe("dexHref", () => {
  it("передаёт обмену язык сайта как есть — у него те же локали", () => {
    expect(dexHref("ru")).toBe("/exchange/?lang=ru#/swap");
    expect(dexHref("ja")).toBe("/exchange/?lang=ja#/swap");
    expect(dexHref("zh-CN")).toBe("/exchange/?lang=zh-CN#/swap");
    for (const locale of SUPPORTED_LOCALES) {
      expect(dexHref(locale)).toBe(`/exchange/?lang=${locale}#/swap`);
    }
  });

  it("незнакомую локаль в адрес не пишет — обмен сам выберет язык", () => {
    for (const junk of ["", "xx", "en-US", "zh", "ru;en"]) {
      expect(dexHref(junk)).toBe("/exchange/#/swap");
    }
  });
});

describe("dexUrlWithLang", () => {
  it("вставляет язык сайта в сохранённый адрес пары, не теряя хеш-путь", () => {
    expect(dexUrlWithLang("https://trientes.org/exchange/#/swap/USDT-TAL", "ja")).toBe(
      "https://trientes.org/exchange/?lang=ja#/swap/USDT-TAL",
    );
    expect(dexUrlWithLang("https://trientes.org/exchange/", "zh-CN")).toBe(
      "https://trientes.org/exchange/?lang=zh-CN",
    );
  });

  it("не трогает адрес при незнакомой локали и при чужом адресе", () => {
    const url = "https://trientes.org/exchange/#/swap/USDT-TAL";
    expect(dexUrlWithLang(url, "xx")).toBe(url);
    const foreign = "https://crypto.com/exchange/document/fees-limits";
    expect(dexUrlWithLang(foreign, "ja")).toBe(foreign);
  });

  it("заменяет уже стоящий язык, а остальные параметры оставляет", () => {
    expect(dexUrlWithLang("https://trientes.org/exchange/?lang=ru&ref=card#/swap", "de")).toBe(
      "https://trientes.org/exchange/?lang=de&ref=card#/swap",
    );
  });
});
