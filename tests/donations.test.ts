import { describe, expect, it } from "vitest";
import {
  donateLimits,
  donatePresets,
  parseDonateTerms,
  usdCents,
  usdText,
} from "@/lib/donations";
import { donateHref } from "@/lib/dex-link";

/** Живой ответ службы 18 ноября 2026 (`GET https://pay.trientes.com/donate/m_…`). */
const LIVE = {
  merchant: "Trientes",
  description: "Пожертвование на развитие Trientes",
  coin: { symbol: "TAL", network: "taler", decimals: 12 },
  pilot: true,
  accepting: true,
  reason: null,
  busy: false,
  usd_per_coin: "11870.79894",
  fee_usd: "0.60",
  min_usd: "10",
  max_usd: "75.84",
  presets_usd: ["10", "20", "50"],
  as_of: "2026-11-18T11:21:21.921Z",
};

describe("суммы службы", () => {
  it("читает центы", () => {
    expect(usdCents("10")).toBe(1000);
    expect(usdCents("75.84")).toBe(7584);
    expect(usdCents("0.5")).toBe(50);
    expect(usdCents("-1")).toBeNull();
    expect(usdCents("1e3")).toBeNull();
    expect(usdCents("01")).toBeNull();
  });

  it("пишет суммы для человека", () => {
    expect(usdText(1000)).toBe("10");
    expect(usdText(7584)).toBe("75.84");
    expect(usdText(1050)).toBe("10.50");
  });
});

describe("условия пожертвований", () => {
  it("читает живой ответ", () => {
    const terms = parseDonateTerms(LIVE);
    expect(terms).toEqual({
      merchant: "Trientes",
      accepting: true,
      minUsd: "10",
      maxUsd: "75.84",
      presetsUsd: ["10", "20", "50"],
    });
  });

  it("закрытые условия без пределов — всё ещё условия", () => {
    const terms = parseDonateTerms({
      ...LIVE,
      accepting: false,
      reason: "no-reserve",
      min_usd: null,
      max_usd: null,
      presets_usd: [],
    });
    expect(terms?.accepting).toBe(false);
    expect(donatePresets(terms!)).toEqual([]);
    expect(donateLimits(terms!)).toBeNull();
  });

  it("ответ не той формы ответом не считается", () => {
    expect(parseDonateTerms(null)).toBeNull();
    expect(parseDonateTerms([LIVE])).toBeNull();
    expect(parseDonateTerms({ ...LIVE, merchant: 42 })).toBeNull();
    expect(parseDonateTerms({ ...LIVE, accepting: "yes" })).toBeNull();
    // принимают, а предела нет
    expect(parseDonateTerms({ ...LIVE, max_usd: null })).toBeNull();
    // меньший больше большего
    expect(parseDonateTerms({ ...LIVE, min_usd: "100" })).toBeNull();
    // сумма не той формы
    expect(parseDonateTerms({ ...LIVE, min_usd: "10,00" })).toBeNull();
    // наборы не по возрастанию, с повтором, с нулём, числом, числом сверх шести
    expect(parseDonateTerms({ ...LIVE, presets_usd: ["20", "10"] })).toBeNull();
    expect(parseDonateTerms({ ...LIVE, presets_usd: ["10", "10"] })).toBeNull();
    expect(parseDonateTerms({ ...LIVE, presets_usd: ["0", "10"] })).toBeNull();
    expect(parseDonateTerms({ ...LIVE, presets_usd: [10, 20] })).toBeNull();
    expect(
      parseDonateTerms({ ...LIVE, presets_usd: ["1", "2", "3", "4", "5", "6", "7"] }),
    ).toBeNull();
  });

  it("наборы сверх сегодняшних пределов не предлагаются", () => {
    const terms = parseDonateTerms({ ...LIVE, presets_usd: ["5", "10", "20", "50", "100"] })!;
    expect(donatePresets(terms)).toEqual(["10", "20", "50"]);
    expect(donateLimits(terms)).toEqual({ min: "10", max: "75.84" });
  });
});

describe("ссылка на экран пожертвований", () => {
  it("несёт язык сайта и сумму", () => {
    expect(donateHref("ru", "20")).toBe("/exchange/?lang=ru#/donate?amount=20");
    expect(donateHref("sk")).toBe("/exchange/?lang=sk#/donate");
  });

  it("чужой язык обмену не пишем", () => {
    expect(donateHref("xx", "20")).toBe("/exchange/#/donate?amount=20");
  });

  it("негодная сумма в адрес не идёт", () => {
    expect(donateHref("en", "0.5")).toBe("/exchange/?lang=en#/donate");
    expect(donateHref("en", "1000000")).toBe("/exchange/?lang=en#/donate");
    expect(donateHref("en", "10'><script>")).toBe("/exchange/?lang=en#/donate");
  });
});
