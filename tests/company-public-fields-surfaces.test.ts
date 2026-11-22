import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_FIELD_KEYS, type PublicFieldKey } from "@/lib/company-public-fields";

/**
 * Граница слайса BX: «один набор выключателей на обе витрины». Выключатель,
 * заведённый в наборе, обязан гасить модуль **и** на публичной странице
 * предприятия, **и** в фиде навигатора — иначе продавец выключает товары,
 * видит их исчезнувшими в карточке с карты и находит на своей же витрине.
 *
 * Живой прогон 22 ноября так и поймал: `website`, `products`, `promos`,
 * `photos` и часы точки на витрине выключателя не читали вовсе. Проверка
 * исходниками — приём `tests/cabinet-back-button.test.ts` и
 * `tests/outbound-timeouts.test.ts`: забытый гейт видно до выкладки.
 */

const SHOWCASE = readFileSync("src/app/[locale]/companies/[id]/page.tsx", "utf8");
const FEED = [
  readFileSync("src/lib/company-points.ts", "utf8"),
  readFileSync("src/lib/products/offers-read.ts", "utf8"),
].join("\n");

/** Чего на этой поверхности нет вовсе — с причиной, а не молча. */
const NOT_RENDERED: Record<"showcase" | "feed", Partial<Record<PublicFieldKey, string>>> = {
  showcase: {
    coins: "набор монет живёт у точки на карте, на витрине его нет",
    socials: "ссылки на соцсети показывает только карточка с карты",
  },
  feed: {
    preciseAddress: "адрес точки на карте публичен всегда — её там и ищут (BU)",
    documents: "публичные документы читает только витрина",
  },
};

function gated(source: string, key: PublicFieldKey): boolean {
  // Витрина читает `show.<key>`, фид — `show.<key>` или `publicFieldOn(..., "<key>")`.
  return source.includes(`show.${key}`) || source.includes(`"${key}")`);
}

describe("выключатели витрины действуют на обеих поверхностях", () => {
  for (const key of PUBLIC_FIELD_KEYS) {
    it(`${key}: гейт стоит на витрине предприятия`, () => {
      if (NOT_RENDERED.showcase[key]) {
        expect(SHOWCASE.includes(`show.${key}`)).toBe(false);
        return;
      }
      expect(gated(SHOWCASE, key)).toBe(true);
    });

    it(`${key}: гейт стоит в фиде навигатора`, () => {
      if (NOT_RENDERED.feed[key]) return;
      expect(gated(FEED, key)).toBe(true);
    });
  }
});
