import { describe, expect, it } from "vitest";
import { cleanDisplay, stripInvisible, DISPLAY_MAX } from "@/lib/pay-link/text";

const ZW = "\u200b";
const RLO = "\u202e";
const PDI = "\u2069";

describe("тексты владельца ссылки", () => {
  it("bidi и нулевая ширина вырезаются", () => {
    expect(cleanDisplay(`Кофе${ZW} ${RLO}Хауз${PDI}`)).toBe("Кофе Хауз");
  });

  it("разметка остаётся текстом, а не вырезается", () => {
    // Показываем только текстом; вырезать `<b>` значило бы молча менять слова владельца.
    expect(cleanDisplay("<b>Trientes</b>")).toBe("<b>Trientes</b>");
  });

  it("управляющие знаки и переводы строк становятся пробелом", () => {
    expect(cleanDisplay("Shop\n\tOne Two")).toBe("Shop One Two");
  });

  it("длина — до 80", () => {
    expect(cleanDisplay("x".repeat(200)).length).toBe(DISPLAY_MAX);
  });

  it("обрезка после очистки, а не до неё", () => {
    // Восемьдесят невидимых знаков впереди не должны съесть имя целиком.
    expect(cleanDisplay(`${ZW.repeat(100)}Shop`)).toBe("Shop");
  });

  it("stripInvisible длину не режет: код ищется в полном названии", () => {
    const long = `${"a".repeat(150)} ABCD2345`;
    expect(stripInvisible(long)).toBe(long);
  });
});
