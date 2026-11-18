import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Звёздочка закладки должна быть у каждой строки списка, включая монету,
 * живущую одной карточкой (Taler). Прежде кнопка у такой строки не рисовалась
 * вовсе: `Watchlist.coinId` — внешний ключ на `Coin`, а строки `Coin` у неё
 * нет, и закладка обещала бы невозможное. Теперь закладка ложится в свою
 * таблицу (`CardWatchlist`), и выбор таблицы делает `kind`.
 *
 * Проверяется по исходнику: правило живёт в разметке, и разъехаться оно может
 * молча — на экране просто не будет звезды.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const VIEWS = [
  "src/components/coin-row.tsx",
  "src/components/coin-card-mobile.tsx",
];

describe("звёздочка закладки в списке монет", () => {
  for (const file of VIEWS) {
    it(`${file}: рисуется у каждой строки`, () => {
      const src = read(file);
      expect(src).toContain("<WatchlistButton");
      // Ни одной ветки «карточной монете звезду не рисуем».
      expect(src).not.toMatch(/row\.unranked\s*\?\s*null\s*:\s*<WatchlistButton/);
    });

    it(`${file}: карточная монета кладёт закладку в свою таблицу`, () => {
      expect(read(file)).toContain('kind={row.unranked ? "card" : "coin"}');
    });
  }

  it("кнопка умеет обе таблицы, и по умолчанию это монета рыночного фида", () => {
    const src = read("src/components/watchlist-button.tsx");
    expect(src).toContain('kind = "coin"');
    expect(src).toContain("toggleCardWatchlist(coinId)");
    expect(src).toContain("toggleWatchlist(coinId)");
  });
});
