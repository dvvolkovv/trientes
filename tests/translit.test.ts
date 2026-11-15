import { describe, expect, it } from "vitest";
import {
  geocodeQueryOrder,
  hasCyrillic,
  latinQueryCandidates,
  translitLangForCountry,
} from "@/lib/translit";

describe("hasCyrillic", () => {
  it("sees Cyrillic letters and ignores digits and Latin", () => {
    expect(hasCyrillic("Гемайндеберггассе 8")).toBe(true);
    expect(hasCyrillic("Gemeindeberggasse 8")).toBe(false);
    expect(hasCyrillic("8")).toBe(false);
  });
});

describe("translitLangForCountry", () => {
  it("German rules only in the German-speaking countries", () => {
    expect(translitLangForCountry("AT")).toBe("de");
    expect(translitLangForCountry("de")).toBe("de");
    expect(translitLangForCountry("CZ")).toBe("generic");
    expect(translitLangForCountry(null)).toBe("generic");
  });
});

describe("latinQueryCandidates (German)", () => {
  it("gives nothing to do for a Latin query", () => {
    expect(latinQueryCandidates("Gemeindeberggasse 8", "de")).toEqual([]);
  });

  // Живой случай владельца: кириллицей Nominatim отдаёт 0, и побуквенный
  // перевод («Gemaindeberggasse») — тоже 0. Нужно именно «ай» → ei.
  it("transcribes ай → ei and keeps the house number", () => {
    expect(latinQueryCandidates("Гемайндеберггассе 8", "de")[0]).toBe("Gemeindeberggasse 8");
  });

  // Распознавание речи рубит немецкое слово дефисами и добавляет «н»
  // в конце «гассен» — склеенный вариант должен быть первым кандидатом.
  it("joins hyphenated parts into one German word", () => {
    const out = latinQueryCandidates("Гемайнде-Берг-Гассен 8", "de");
    expect(out[0]).toBe("Gemeindeberggasse 8");
    expect(out).toContain("Gemeinde Berg Gasse 8");
  });

  it("knows the street-type suffixes", () => {
    expect(latinQueryCandidates("Хауптштрассе 8", "de")[0]).toBe("Hauptstrasse 8");
    expect(latinQueryCandidates("Рингштрассе", "de")[0]).toBe("Ringstrasse");
    expect(latinQueryCandidates("Штефансплац", "de")[0]).toBe("Stefansplatz");
  });

  it("reads х as h at the start of a word and as ch inside it", () => {
    expect(latinQueryCandidates("Хиршгассе", "de")[0]).toBe("Hirschgasse");
    expect(latinQueryCandidates("Мюнхен", "de")[0]).toBe("Munchen");
  });

  it("offers the other reading of х as a separate candidate", () => {
    expect(latinQueryCandidates("Хиршгассе", "de")).toContain("Chirschgasse");
  });

  it("never returns more than three candidates and never repeats one", () => {
    const out = latinQueryCandidates("Гемайнде-Берг-Гассен 8", "de");
    expect(out.length).toBeLessThanOrEqual(3);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("latinQueryCandidates (generic)", () => {
  it("uses plain transliteration outside the German-speaking countries", () => {
    expect(latinQueryCandidates("Шишкина 8", "generic")[0]).toBe("Shishkina 8");
    expect(latinQueryCandidates("Чехова", "generic")[0]).toBe("Chekhova");
  });
});

describe("geocodeQueryOrder", () => {
  it("leaves a Latin query alone", () => {
    expect(geocodeQueryOrder("Hauptstrasse 8", "AT")).toEqual(["Hauptstrasse 8"]);
  });

  // Живой прогон: «Гран Виа 8» Nominatim находит, но отдаёт два объекта,
  // названных этим адресом, а «Gran Via 8» — пять настоящих адресов. Значит
  // в латинской стране латиница идёт первой, а напечатанное — запасным.
  it("puts the Latin reading first in a Latin-script country", () => {
    const out = geocodeQueryOrder("Гран Виа 8", "ES");
    expect(out[0]).toBe("Gran Via 8");
    expect(out[out.length - 1]).toBe("Гран Виа 8");
  });

  it("does not translate anything in a Cyrillic-script country", () => {
    expect(geocodeQueryOrder("Шишкина 8", "RU")).toEqual(["Шишкина 8"]);
    expect(geocodeQueryOrder("Шишкина 8", "BG")).toEqual(["Шишкина 8"]);
  });

  // Страна неизвестна — немецких правил взять негде, поэтому первым идёт
  // напечатанное, а запасным общий перевод: искать человек может и дома.
  it("tries what the person typed first when the country is unknown", () => {
    const out = geocodeQueryOrder("Гемайндеберггассе 8", null);
    expect(out[0]).toBe("Гемайндеберггассе 8");
    expect(out.length).toBeGreaterThan(1);
  });

  it("uses the German reading in Austria", () => {
    expect(geocodeQueryOrder("Гемайндеберггассе 8", "AT")[0]).toBe("Gemeindeberggasse 8");
  });
});
