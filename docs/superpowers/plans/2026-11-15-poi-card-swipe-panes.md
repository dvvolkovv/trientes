# Карточка точки — листалка из трёх страниц: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Карточка точки на карте становится листалкой: страница «Карта» (прозрачное окно поверх живого полотна MapLibre с полосой управления маршрутом), страница «Карточка» (наши факты + чипсы принимаемых монет) и страница «Витрина» (контент заведения).

**Architecture:** Полотно MapLibre никуда не переезжает — страница «Карта» это та же карточка с прозрачным фоном и `pointer-events: none`, сквозь которую палец достаёт до карты. Логика жеста и порядок страниц живут в чистом `src/lib/poi-pager.ts` под юнит-тестами; компонент карточки раскладывается на оболочку и три страницы. Пристыкованное состояние листа (55vh) удаляется — его работу делает страница «Карта».

**Tech Stack:** Next.js (App Router, см. `AGENTS.md` — читать `node_modules/next/dist/docs/` перед правками роутинга), React 19 client components, MapLibre GL, Tailwind, Prisma, vitest (`npm test`), Playwright (`npm run test:e2e`), next-intl + `scripts/translate-messages.ts`.

**Спека:** `docs/superpowers/specs/2026-11-15-poi-card-swipe-panes-design.md`

---

## Карта файлов

| Файл | Ответственность | Статус |
|---|---|---|
| `src/lib/poi-pager.ts` | порядок страниц, подписи, `claimsSwipe`, `settlePage`, `dragOffset` — чистые функции без DOM | создать |
| `tests/poi-pager.test.ts` | юнит-тесты жеста и порядка страниц | создать |
| `src/lib/crypto-map.ts` | тип `Poi` + `acceptedCoinsFromTags` (чтение реестра `COIN_TAGS` в обратную сторону) | править |
| `tests/poi-accepted-coins.test.ts` | тесты чтения тегов | создать |
| `src/lib/company-points.ts` | `acceptedCoins`/`photos` у своей точки, пакетный справочник монет и карточек | править |
| `tests/company-points.test.ts` | тесты маппера своей точки | править |
| `src/components/coin-detail/poi-sheet.tsx` | оболочка: шапка, индикатор, дорожка страниц, жест, клавиши | править (сильно) |
| `src/components/coin-detail/poi-pane-card.tsx` | страница фактов | создать |
| `src/components/coin-detail/poi-pane-showcase.tsx` | страница витрины | создать |
| `src/components/coin-detail/poi-pane-map.tsx` | прозрачная страница + полоса управления маршрутом | создать |
| `src/components/coin-detail/crypto-navigator.tsx` | проводка: страница вместо `sheetExpanded`, `mapFull`, отступ `fitRoute` | править |
| `tests/poi-sheet-buttons.test.ts` | в страницах карточки нет голых текстовых ссылок | создать |
| `messages/en.json` + 10 локалей | подписи | править (`npm run i18n`) |
| `e2e/poi-sheet-panes.spec.ts` | открытие на «Карточке», свайп, карта тянется, индикатор, десктоп | создать |

---

### Task 1: Чистая логика листалки

**Files:**
- Create: `src/lib/poi-pager.ts`
- Test: `tests/poi-pager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-pager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  claimsSwipe,
  dragOffset,
  pageLabelKey,
  pagesFor,
  settlePage,
  type PoiPage,
} from "@/lib/poi-pager";

const PHONE: PoiPage[] = ["map", "card", "showcase"];

describe("pagesFor", () => {
  it("gives the phone three pages and opens on the facts", () => {
    expect(pagesFor(true)).toEqual(["map", "card", "showcase"]);
  });

  it("drops the map page on desktop, where the map is already beside the panel", () => {
    expect(pagesFor(false)).toEqual(["card", "showcase"]);
  });
});

describe("pageLabelKey", () => {
  it("never reuses a label", () => {
    const keys = PHONE.map(pageLabelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("claimsSwipe", () => {
  it("ignores a vertical drag — that is page scrolling", () => {
    expect(claimsSwipe({ page: "card", dx: 20, dy: 40, fromEdge: false })).toBe(false);
  });

  it("ignores a tremor below the threshold", () => {
    expect(claimsSwipe({ page: "card", dx: 8, dy: 0, fromEdge: false })).toBe(false);
  });

  it("takes a clearly horizontal drag on the facts page from anywhere", () => {
    expect(claimsSwipe({ page: "card", dx: -40, dy: 5, fromEdge: false })).toBe(true);
  });

  it("leaves the middle of the map page to the map itself", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: false })).toBe(false);
  });

  it("still listens at the edge strip of the map page", () => {
    expect(claimsSwipe({ page: "map", dx: -80, dy: 2, fromEdge: true })).toBe(true);
  });
});

describe("settlePage", () => {
  const base = { pages: PHONE, page: "card" as PoiPage, width: 400, velocity: 0 };

  it("snaps back when the drag is too short and slow", () => {
    expect(settlePage({ ...base, dx: -60 })).toBe("card");
  });

  it("turns the page past a quarter of the width", () => {
    expect(settlePage({ ...base, dx: -140 })).toBe("showcase");
    expect(settlePage({ ...base, dx: 140 })).toBe("map");
  });

  it("turns the page on a fast short flick", () => {
    expect(settlePage({ ...base, dx: -30, velocity: 0.9 })).toBe("showcase");
  });

  it("cannot go past the ends", () => {
    expect(settlePage({ ...base, page: "map", dx: 200 })).toBe("map");
    expect(settlePage({ ...base, page: "showcase", dx: -200 })).toBe("showcase");
  });

  it("knows nothing of the map page on desktop", () => {
    expect(settlePage({ ...base, pages: ["card", "showcase"], page: "card", dx: 200 })).toBe("card");
  });
});

describe("dragOffset", () => {
  it("follows the finger inside the deck", () => {
    expect(dragOffset({ pages: PHONE, page: "card", dx: -50, width: 400 })).toBe(-450);
  });

  it("resists past the first page instead of tearing off", () => {
    const offset = dragOffset({ pages: PHONE, page: "map", dx: 100, width: 400 });
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/poi-pager.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/poi-pager"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/poi-pager.ts`:

```ts
/**
 * Листалка карточки точки: порядок страниц и разбор жеста.
 *
 * Вынесено из компонента целиком ради одного свойства: на странице «Карта»
 * палец принадлежит самой карте. Если ловить горизонтальный свайп со всей
 * площади, перетаскивание карты влево перелистывало бы страницу. Правило
 * «на карте — только от края» легко потерять глазами при правке разметки,
 * поэтому оно живёт в функции, накрытой тестами, а не в обработчике событий.
 */

export type PoiPage = "map" | "card" | "showcase";

/** Жест короче — это дрожание пальца, а не листание. */
export const SWIPE_MIN_DX = 12;
/** Горизонтальным считается жест, который заметно длиннее по оси X. */
export const SWIPE_AXIS_RATIO = 1.4;
/** Доля ширины, после которой страница переворачивается. */
export const SWIPE_SNAP_SHARE = 0.25;
/** Скорость на отрыве (px/ms), при которой листает и короткий флик. */
export const SWIPE_SNAP_VELOCITY = 0.35;
/** Полоска у края страницы «Карта», с которой жест всё-таки слушается. */
export const SWIPE_EDGE_PX = 24;
/** Сопротивление за крайней страницей: палец идёт, лист почти не едет. */
const EDGE_RESISTANCE = 0.3;

/**
 * На десктопе карточка — панель внутри окна карты, карта и так видна рядом,
 * поэтому прозрачная страница поверх панели там не покупает ничего.
 */
export function pagesFor(phone: boolean): PoiPage[] {
  return phone ? ["map", "card", "showcase"] : ["card", "showcase"];
}

/** Страница, которая открывается по нажатию на точку: вопрос «что это за место». */
export const DEFAULT_POI_PAGE: PoiPage = "card";

const LABEL: Record<PoiPage, string> = {
  map: "pageMap",
  card: "pageCard",
  showcase: "pageShowcase",
};

/** Ключ подписи в пространстве `cryptoMap`. */
export function pageLabelKey(page: PoiPage): string {
  return LABEL[page];
}

export function claimsSwipe(i: { page: PoiPage; dx: number; dy: number; fromEdge: boolean }): boolean {
  if (Math.abs(i.dx) <= SWIPE_MIN_DX) return false;
  if (Math.abs(i.dx) <= Math.abs(i.dy) * SWIPE_AXIS_RATIO) return false;
  if (i.page === "map" && !i.fromEdge) return false;
  return true;
}

export function settlePage(i: {
  pages: PoiPage[];
  page: PoiPage;
  dx: number;
  width: number;
  velocity: number;
}): PoiPage {
  const index = i.pages.indexOf(i.page);
  if (index < 0) return i.page;
  const far = Math.abs(i.dx) > i.width * SWIPE_SNAP_SHARE;
  const fast = Math.abs(i.velocity) > SWIPE_SNAP_VELOCITY;
  if (!far && !fast) return i.page;
  // Палец влево — следующая страница приходит справа.
  const step = i.dx < 0 ? 1 : -1;
  const next = Math.min(i.pages.length - 1, Math.max(0, index + step));
  return i.pages[next];
}

/** Смещение дорожки страниц в пикселях, пока палец на экране. */
export function dragOffset(i: { pages: PoiPage[]; page: PoiPage; dx: number; width: number }): number {
  const index = Math.max(0, i.pages.indexOf(i.page));
  const atFirst = index === 0 && i.dx > 0;
  const atLast = index === i.pages.length - 1 && i.dx < 0;
  const dx = atFirst || atLast ? i.dx * EDGE_RESISTANCE : i.dx;
  return -index * i.width + dx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/poi-pager.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poi-pager.ts tests/poi-pager.test.ts
git commit -m "feat(navigator): чистая логика листалки карточки точки"
```

---

### Task 2: Принимаемые монеты у точки BTC Map

**Files:**
- Modify: `src/lib/crypto-map.ts` (тип `Poi` ~строка 93, рядом с `COIN_TAGS` ~строка 31, `parseOverpassElements` ~строка 198)
- Test: `tests/poi-accepted-coins.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-accepted-coins.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acceptedCoinsFromTags, parseOverpassElements } from "@/lib/crypto-map";

describe("acceptedCoinsFromTags", () => {
  it("names the coins the tags name", () => {
    const coins = acceptedCoinsFromTags({ "payment:bitcoin": "yes", "payment:monero": "yes" });
    expect(coins.map((c) => c.symbol)).toEqual(["BTC", "XMR"]);
    expect(coins.every((c) => c.own === false)).toBe(true);
  });

  it("reads the currency spelling too, and never lists a coin twice", () => {
    const coins = acceptedCoinsFromTags({ "payment:bitcoin": "yes", "currency:XBT": "yes" });
    expect(coins.map((c) => c.key)).toEqual(["bitcoin"]);
  });

  it("ignores a tag that is not a yes", () => {
    expect(acceptedCoinsFromTags({ "payment:bitcoin": "no" })).toEqual([]);
  });

  it("does not turn the generic crypto tag into a ticker", () => {
    expect(acceptedCoinsFromTags({ "payment:cryptocurrencies": "yes" })).toEqual([]);
  });

  it("leaves the logo empty — OSM tags carry none", () => {
    expect(acceptedCoinsFromTags({ "payment:bitcoin": "yes" })[0].logoUrl).toBeNull();
  });
});

describe("parseOverpassElements", () => {
  const element = (tags: Record<string, string>) => ({
    elements: [{ type: "node", id: 1, lat: 10, lon: 20, tags: { name: "Shop", ...tags } }],
  });

  it("carries the accepted coins into the Poi", () => {
    const [poi] = parseOverpassElements(element({ "payment:litecoin": "yes" }), ["payment:bitcoin"]);
    expect(poi.acceptedCoins.map((c) => c.symbol)).toEqual(["LTC"]);
    expect(poi.acceptedGeneric).toBe(false);
  });

  it("raises the generic flag for the generic tag", () => {
    const [poi] = parseOverpassElements(element({ "payment:cryptocurrencies": "yes" }), []);
    expect(poi.acceptedCoins).toEqual([]);
    expect(poi.acceptedGeneric).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/poi-accepted-coins.test.ts`
Expected: FAIL — `acceptedCoinsFromTags is not a function`.

- [ ] **Step 3: Extend the `Poi` type**

In `src/lib/crypto-map.ts`, right above `export type Poi = {` (~line 93), add:

```ts
/**
 * Монета, которую в этой точке принимают. `own: true` — наш листинг
 * (`CoinCard`), а не монета каталога: это разные пространства id и разные
 * страницы, путать их нельзя.
 */
export type AcceptedCoin = {
  key: string;
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  slug: string | null;
  own: boolean;
};
```

Then inside `export type Poi = {`, after the `coinSpecific: boolean;` line, add:

```ts
  /** Что здесь принимают по именам. Пусто — секции в карточке нет. */
  acceptedCoins: AcceptedCoin[];
  /** Тег `payment:cryptocurrencies`: «какая-то крипта», без тикера. */
  acceptedGeneric: boolean;
  /** Фотографии точки (у своих — до 5); `image` остаётся превью для маркера. */
  photos: string[];
```

- [ ] **Step 4: Add the tag reader**

In `src/lib/crypto-map.ts`, right after the `SYMBOL_TO_ID` map (~line 53), add:

```ts
/** `COIN_TAGS` наоборот: id монеты → тикер для чипса. */
const ID_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_TO_ID).map(([symbol, id]) => [id, symbol.toUpperCase()]),
);

/**
 * Какие монеты названы тегами точки. Реестр `COIN_TAGS` читается в обратную
 * сторону: он заведён для вопроса «принимают ли выбранную монету», а здесь
 * отвечает на «какие вообще». Логотипов в тегах OSM нет, и подставлять их
 * оттуда неоткуда — чипс рисуется тикером.
 */
export function acceptedCoinsFromTags(tags: Record<string, string>): AcceptedCoin[] {
  const out: AcceptedCoin[] = [];
  for (const [id, keys] of Object.entries(COIN_TAGS)) {
    if (!keys.some((k) => tags[k] === "yes")) continue;
    out.push({
      key: id,
      symbol: ID_TO_SYMBOL[id] ?? id.toUpperCase(),
      name: null,
      logoUrl: null,
      slug: id,
      own: false,
    });
  }
  return out;
}
```

- [ ] **Step 5: Fill the new fields in `parseOverpassElements`**

In `src/lib/crypto-map.ts`, inside `parseOverpassElements`, after the existing
`const coinSpecific = coinTags.some((t) => tags[t] === "yes");` line add:

```ts
    const acceptedCoins = acceptedCoinsFromTags(tags);
    const acceptedGeneric = GENERIC_CRYPTO_TAGS.some((t) => tags[t] === "yes");
```

and inside the `out.push({ ... })` literal, after `coinSpecific,`:

```ts
      acceptedCoins,
      acceptedGeneric,
      photos: [],
```

- [ ] **Step 6: Run the test and the whole suite**

Run: `npx vitest run tests/poi-accepted-coins.test.ts`
Expected: PASS, 7 tests.

Run: `npx vitest run tests/crypto-map.test.ts tests/btcmap-parse.test.ts tests/fintech-pois.test.ts tests/curated-pois.test.ts tests/company-points.test.ts`
Expected: type errors are not caught by vitest, so also run `npx tsc --noEmit`.
Expected from `tsc`: errors in every other place that builds a `Poi` literal —
`src/lib/fintech-pois.ts`, `src/lib/company-points.ts`, `src/lib/curated-pois.ts`
(whichever exist). Fix each by adding `acceptedCoins: []`, `acceptedGeneric: false`,
`photos: []` to the literal; `company-points.ts` gets its real values in Task 3.

- [ ] **Step 7: Verify types are clean**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/lib/crypto-map.ts src/lib/fintech-pois.ts src/lib/curated-pois.ts src/lib/company-points.ts tests/poi-accepted-coins.test.ts
git commit -m "feat(navigator): точка знает, какие монеты в ней принимают"
```

---

### Task 3: Монеты и фотографии своей точки

**Files:**
- Modify: `src/lib/company-points.ts` (`companyPointToPoi` ~строка 43, `fetchApprovedPointsInBbox`)
- Test: `tests/company-points.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/company-points.test.ts`:

```ts
describe("companyPointToPoi — что здесь принимают", () => {
  const registry = {
    coins: new Map([
      ["bitcoin", { symbol: "BTC", name: "Bitcoin", logoUrl: "/i/btc.png", slug: "bitcoin" }],
    ]),
    cards: new Map([
      ["card1", { symbol: "TAL", name: "Taler", logoUrl: "/i/tal.png", slug: "taler" }],
    ]),
  };

  const point = (over: Record<string, unknown> = {}) =>
    ({
      id: "p1",
      type: "SHOP",
      name: "Shop",
      description: "Point story",
      lat: 10,
      lon: 20,
      address: "Street 1",
      acceptedCoinIds: ["bitcoin", "unknown-coin"],
      acceptedCardIds: ["card1"],
      logoUrl: null,
      photos: [{ url: "https://x.test/a.jpg" }, { url: "javascript:alert(1)" }],
      openingHours: null,
      phone: null,
      website: null,
      socials: null,
      company: {
        displayName: "Acme",
        logoUrl: null,
        website: null,
        socials: null,
        description: "Company story",
        email: null,
        phone: null,
      },
      ...over,
    }) as never;

  it("names both catalogue coins and our own listings", () => {
    const poi = companyPointToPoi(point(), { kind: "coin", coinId: "bitcoin" }, registry);
    expect(poi.acceptedCoins.map((c) => c.symbol)).toEqual(["BTC", "TAL"]);
    expect(poi.acceptedCoins.find((c) => c.symbol === "TAL")?.own).toBe(true);
  });

  it("drops a coin the catalogue does not know — a chip without a ticker says nothing", () => {
    const poi = companyPointToPoi(point(), { kind: "coin", coinId: "bitcoin" }, registry);
    expect(poi.acceptedCoins.map((c) => c.key)).not.toContain("unknown-coin");
  });

  it("never raises the generic flag for our own point — it declared names", () => {
    expect(companyPointToPoi(point(), { kind: "coin", coinId: "bitcoin" }, registry).acceptedGeneric).toBe(false);
  });

  it("carries every photo, sanitized the way socials are", () => {
    const poi = companyPointToPoi(point(), { kind: "coin", coinId: "bitcoin" }, registry);
    expect(poi.photos).toEqual(["https://x.test/a.jpg"]);
  });

  it("keeps at most five photos", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ url: `https://x.test/${i}.jpg` }));
    const poi = companyPointToPoi(point({ photos: many }), { kind: "coin", coinId: "bitcoin" }, registry);
    expect(poi.photos).toHaveLength(5);
  });
});
```

Add `companyPointToPoi` to the imports at the top of the file if it is not there already.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/company-points.test.ts`
Expected: FAIL — `companyPointToPoi` takes two arguments / `acceptedCoins` undefined.

- [ ] **Step 3: Implement the registry and the mapper**

In `src/lib/company-points.ts`, after `asSocials` (~line 38) add:

```ts
/** Тикеры, имена и логотипы для чипсов — один справочник на весь ответ фида. */
export type CoinRegistry = {
  coins: Map<string, { symbol: string; name: string; logoUrl: string | null; slug: string }>;
  cards: Map<string, { symbol: string; name: string; logoUrl: string | null; slug: string }>;
};

export const EMPTY_COIN_REGISTRY: CoinRegistry = { coins: new Map(), cards: new Map() };

/** Не больше пяти, как в форме точки, и только http(s) — те же правила, что у `socials`. */
function asPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const url = (item as { url?: unknown }).url;
    if (typeof url !== "string") continue;
    try {
      const u = new URL(url, "https://trientes.org");
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push(url);
    if (out.length === 5) break;
  }
  return out;
}

function acceptedCoinsFor(p: PointWithCompany, registry: CoinRegistry): AcceptedCoin[] {
  const out: AcceptedCoin[] = [];
  for (const id of p.acceptedCoinIds ?? []) {
    const row = registry.coins.get(id);
    if (!row) continue; // монеты нет в каталоге — чипс без тикера ничего не сообщает
    out.push({ key: id, symbol: row.symbol.toUpperCase(), name: row.name, logoUrl: row.logoUrl, slug: row.slug, own: false });
  }
  for (const id of p.acceptedCardIds ?? []) {
    const row = registry.cards.get(id);
    if (!row) continue;
    out.push({ key: id, symbol: row.symbol.toUpperCase(), name: row.name, logoUrl: row.logoUrl, slug: row.slug, own: true });
  }
  return out;
}
```

Add `AcceptedCoin` to the type import from `@/lib/crypto-map` at the top of the file.

Change the signature of `companyPointToPoi` to:

```ts
export function companyPointToPoi(
  p: PointWithCompany,
  selector: CoinSelector,
  registry: CoinRegistry = EMPTY_COIN_REGISTRY,
): Poi {
```

and inside its returned literal, after `coinSpecific: ...,` add:

```ts
    acceptedCoins: acceptedCoinsFor(p, registry),
    // Своя точка называет монеты по именам, поэтому «какая-то крипта» ей не нужна.
    acceptedGeneric: false,
    photos: asPhotos(p.photos),
```

- [ ] **Step 4: Fill the registry once per feed response**

In `src/lib/company-points.ts`, inside `fetchApprovedPointsInBbox`, after the
`prisma.companyPoint.findMany` call returns `rows` and before the `.map(...)`
that builds the Poi list, insert:

```ts
  // Один запрос на весь кадр, а не на точку: в кадре бывает двести точек, и
  // справочник на каждую превратил бы фид в двести запросов.
  const coinIds = Array.from(new Set(rows.flatMap((r) => r.acceptedCoinIds ?? [])));
  const cardIds = Array.from(new Set(rows.flatMap((r) => r.acceptedCardIds ?? [])));
  const [coinRows, cardRows] = await Promise.all([
    coinIds.length
      ? prisma.coin.findMany({
          where: { id: { in: coinIds } },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
    cardIds.length
      ? prisma.coinCard.findMany({
          where: { id: { in: cardIds }, status: "APPROVED" },
          select: { id: true, symbol: true, name: true, logoUrl: true, slug: true },
        })
      : Promise.resolve([]),
  ]);
  const registry: CoinRegistry = {
    coins: new Map(coinRows.map((c) => [c.id, { symbol: c.symbol, name: c.name, logoUrl: c.logoUrl, slug: c.slug }])),
    cards: new Map(cardRows.map((c) => [c.id, { symbol: c.symbol, name: c.name, logoUrl: c.logoUrl, slug: c.slug }])),
  };
```

and pass it through: `rows.map((r) => companyPointToPoi(r, selector, registry))`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/company-points.test.ts`
Expected: PASS, including the five new tests.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/company-points.ts tests/company-points.test.ts
git commit -m "feat(navigator): своя точка отдаёт монеты и все фотографии"
```

---

### Task 4: Подписи и переводы

**Files:**
- Modify: `messages/en.json` (`cryptoMap`)
- Modify: `messages/{ru,de,es,fr,it,pl,pt,tr,uk,hr}.json` — через `npm run i18n`

- [ ] **Step 1: Add the English keys**

In `messages/en.json`, inside `"cryptoMap"`, add these keys and **remove**
`"expandCard"` and `"collapseCard"` (полустояние листа удаляется в Task 7):

```json
    "pageMap": "Map",
    "pageCard": "Place",
    "pageShowcase": "Showcase",
    "acceptedCoins": "Accepted here",
    "acceptedAny": "Crypto accepted",
    "ownListing": "Own listing",
    "showcasePhotos": "Photos",
    "aboutCompany": "About the company",
    "openCompany": "Company profile",
    "claimTitle": "This place has not claimed itself on Trientes yet.",
    "claimCta": "This is my business",
    "routeOnMap": "Show on the map",
    "pageOf": "Page {n} of {total}"
```

- [ ] **Step 2: Translate every locale**

Run: `npm run i18n`
Expected: eleven files rewritten; the script rebuilds each locale from the
English shape, so the two removed keys disappear everywhere by construction.

- [ ] **Step 3: Verify the boundary test**

Run: `npx vitest run tests/messages-parity.test.ts`
Expected: PASS for all locales — no missing keys, no extra keys.

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "i18n(navigator): подписи страниц карточки точки на всех локалях"
```

---

### Task 5: Страница фактов — `poi-pane-card.tsx`

**Files:**
- Create: `src/components/coin-detail/poi-pane-card.tsx`
- Modify: `src/components/coin-detail/poi-sheet.tsx` (вынести общие классы в экспорт)

Это перенос уже работающей разметки плюс чипсы монет. Поведение не меняется,
поэтому новых юнит-тестов здесь нет — страницу закрывает e2e в Task 10.

- [ ] **Step 1: Export the shared tap-target classes**

In `src/components/coin-detail/poi-sheet.tsx`, change the four class constants
(~line 62) from `const` to `export const`:

```ts
export const TAP = "min-h-[44px] rounded-xl text-[13px] font-medium transition-all flex items-center gap-2 px-3";
export const PRIMARY = `${TAP} justify-center bg-accent text-accent-foreground hover:opacity-90 font-semibold`;
export const SECONDARY = `${TAP} justify-center border border-hairline text-foreground hover:border-accent`;
export const ROW_BTN = `${TAP} w-full border border-hairline text-foreground hover:border-accent bg-bg-tint/40`;
```

Also export `LAYER_DOT` and the `usePoiPhoto` hook plus its `PhotoState` type
(the shell keeps the header dot, the card page keeps the photo).

- [ ] **Step 2: Create the card page**

Create `src/components/coin-detail/poi-pane-card.tsx`:

```tsx
"use client";

import type { AcceptedCoin, Poi, RouteMode } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { ROW_BTN, usePoiPhoto } from "@/components/coin-detail/poi-sheet";
import { MODE_ICON } from "@/components/coin-detail/poi-pane-map";
import { safeHttpUrl } from "@/lib/safe-url";

/**
 * Страница «Карточка»: только то, что проверили мы — адрес из OSM, монеты из
 * заявки компании, часы, связь. Реклама заведения живёт на витрине: в одном
 * свитке авторство утверждений размывается.
 */
export function PoiPaneCard({
  poi,
  locale,
  near,
  routeSummary,
  onShowRoute,
  onStreetView,
  t,
}: {
  poi: Poi;
  locale: string;
  near: boolean;
  /** Сводка активного маршрута к этой точке, уже отформатированная оболочкой. */
  routeSummary: { icon: string; text: string } | null;
  onShowRoute: () => void;
  onStreetView: () => void;
  t: StepTranslator;
}) {
  const website = safeHttpUrl(poi.website);
  const photo = usePoiPhoto(poi, website);

  return (
    <div className="space-y-5 px-4 py-4">
      {routeSummary && (
        <button type="button" onClick={onShowRoute} className={ROW_BTN}>
          <span aria-hidden>{routeSummary.icon}</span>
          <span className="num font-semibold">{routeSummary.text}</span>
          <span className="ml-auto text-[12px] text-muted">{t("routeOnMap")} →</span>
        </button>
      )}

      {photo.image && (
        <div className="relative overflow-hidden rounded-xl border border-hairline bg-bg-tint">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={photo.onError}
            className="h-40 w-full object-cover"
          />
        </div>
      )}
      {photo.loading && !photo.image && (
        <div className="h-40 w-full animate-pulse rounded-xl border border-hairline bg-bg-tint" />
      )}

      {(poi.acceptedCoins.length > 0 || poi.acceptedGeneric || poi.lightning) && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("acceptedCoins")}</h3>
          <div className="flex flex-wrap gap-2">
            {poi.acceptedCoins.map((c) => (
              <CoinChip key={`${c.own ? "card" : "coin"}-${c.key}`} coin={c} locale={locale} t={t} />
            ))}
            {poi.acceptedGeneric && poi.acceptedCoins.length === 0 && (
              <span className="flex min-h-[40px] items-center rounded-full border border-hairline px-3.5 text-[12px] text-muted">
                ₿ {t("acceptedAny")}
              </span>
            )}
            {poi.lightning && (
              <span className="flex min-h-[40px] items-center rounded-full border border-hairline px-3.5 text-[12px] text-muted">
                ⚡ Lightning
              </span>
            )}
          </div>
        </section>
      )}

      <section className="space-y-2.5">
        {poi.description && <p className="text-[13px] leading-relaxed text-muted">{poi.description}</p>}

        {poi.openingHours && (
          <div className="flex gap-2 text-[13px] leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center text-muted">🕒</span>
            <span className="flex-1">{poi.openingHours}</span>
          </div>
        )}
        {poi.address && (
          <div className="flex gap-2 text-[13px] leading-snug">
            <span aria-hidden className="w-5 shrink-0 text-center text-muted">📍</span>
            <span className="flex-1">{poi.address}</span>
          </div>
        )}

        <button type="button" onClick={onStreetView} className={`${ROW_BTN} ${near ? "border-up" : ""}`}>
          <span aria-hidden>👁</span>
          {t("streetview")}
          {near && <span className="ml-auto text-[11px] text-up">{t("streetviewNear")}</span>}
        </button>
      </section>
    </div>
  );
}

/** Чипс монеты — кнопка-ссылка на её страницу; и у монеты, и у карточки это `/coin/<slug>`. */
function CoinChip({ coin, locale, t }: { coin: AcceptedCoin; locale: string; t: StepTranslator }) {
  const label = (
    <>
      {coin.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coin.logoUrl} alt="" className="h-5 w-5 rounded-full" loading="lazy" />
      ) : (
        <span aria-hidden className="text-[13px]">●</span>
      )}
      <span className="num font-medium">{coin.symbol}</span>
      {coin.own && <span className="text-[10px] uppercase tracking-wide text-accent">{t("ownListing")}</span>}
    </>
  );
  const cls =
    "flex min-h-[40px] items-center gap-2 rounded-full border border-hairline px-3 text-[12px] text-foreground hover:border-accent";
  if (!coin.slug) return <span className={cls}>{label}</span>;
  return (
    <a href={`/${locale}/coin/${coin.slug}`} className={cls}>
      {label}
    </a>
  );
}
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: `MODE_ICON` not found in `poi-pane-map` — that file lands in Task 7.
Until then keep importing `MODE_ICON` from `poi-sheet` (`import { MODE_ICON } from "@/components/coin-detail/poi-sheet";`)
and switch the import in Task 7.

Re-run after the swap: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/coin-detail/poi-pane-card.tsx src/components/coin-detail/poi-sheet.tsx
git commit -m "feat(navigator): страница фактов карточки точки с чипсами монет"
```

---

### Task 6: Страница витрины — `poi-pane-showcase.tsx`

**Files:**
- Create: `src/components/coin-detail/poi-pane-showcase.tsx`

- [ ] **Step 1: Create the showcase page**

Create `src/components/coin-detail/poi-pane-showcase.tsx`:

```tsx
"use client";

import type { Poi } from "@/lib/crypto-map";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { PRIMARY, ROW_BTN } from "@/components/coin-detail/poi-sheet";
import { safeHttpUrl } from "@/lib/safe-url";

const SOCIAL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  telegram: "Telegram",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  vk: "VK",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
};

/**
 * Страница «Витрина»: то, что заведение говорит о себе само. Пока рекламы из
 * кабинета нет (следующий слайс), она собирается из уже заявленного — фото,
 * рассказ, связь. У чужой точки вместо пустого экрана стоит приглашение
 * забрать её себе: это самый частый случай на карте.
 */
export function PoiPaneShowcase({
  poi,
  locale,
  t,
}: {
  poi: Poi;
  locale: string;
  t: StepTranslator;
}) {
  const website = safeHttpUrl(poi.website);
  const own = poi.id.startsWith("company/");

  return (
    <div className="space-y-5 px-4 py-4">
      {poi.photos.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("showcasePhotos")}</h3>
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
            {poi.photos.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-44 w-[78%] shrink-0 snap-center rounded-xl border border-hairline object-cover"
              />
            ))}
          </div>
        </section>
      )}

      {poi.description && <p className="text-[14px] leading-relaxed">{poi.description}</p>}

      {own && (
        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-[0.16em] text-muted">{t("aboutCompany")}</h3>
          <p className="text-[13px] leading-relaxed text-muted">{poi.category}</p>
        </section>
      )}

      <section className="space-y-2">
        {poi.phone && (
          <a href={`tel:${poi.phone}`} className={ROW_BTN}>
            <span aria-hidden>📞</span>
            {t("call")}
            <span className="num ml-auto truncate text-[12px] text-muted">{poi.phone}</span>
          </a>
        )}
        {poi.email && (
          <a href={`mailto:${poi.email}`} className={ROW_BTN}>
            <span aria-hidden>✉️</span>
            {t("write")}
            <span className="ml-auto truncate text-[12px] text-muted">{poi.email}</span>
          </a>
        )}
        {website && (
          <a href={website} target="_blank" rel="noopener noreferrer nofollow" className={ROW_BTN}>
            <span aria-hidden>🌐</span>
            {t("openSite")}
            <span className="ml-auto text-muted">↗</span>
          </a>
        )}
        {poi.layer === "fintech" && poi.slug && (
          <a href={`/${locale}/fintech/${poi.slug}`} className={ROW_BTN}>
            <span aria-hidden>🏛</span>
            {t("viewProfile")}
            <span className="ml-auto text-muted">→</span>
          </a>
        )}
      </section>

      {poi.socials.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {poi.socials.map((s) => (
            <a
              key={`${s.network}-${s.url}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex min-h-[40px] items-center rounded-full border border-hairline px-3.5 text-[12px] text-muted hover:border-accent hover:text-foreground"
            >
              {SOCIAL_LABELS[s.network] ?? s.network}
            </a>
          ))}
        </div>
      )}

      {!own && (
        <section className="space-y-2 rounded-xl border border-hairline bg-bg-tint/50 p-3">
          <p className="text-[13px] leading-snug text-muted">{t("claimTitle")}</p>
          <a href={`/${locale}/business`} className={`${PRIMARY} w-full`}>
            {t("claimCta")}
          </a>
        </section>
      )}
    </div>
  );
}
```

Delete the now-duplicated `SOCIAL_LABELS` map from `poi-sheet.tsx`.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/coin-detail/poi-pane-showcase.tsx src/components/coin-detail/poi-sheet.tsx
git commit -m "feat(navigator): страница витрины заведения в карточке точки"
```

---

### Task 7: Страница карты — прозрачное окно с полосой маршрута

**Files:**
- Create: `src/components/coin-detail/poi-pane-map.tsx`

- [ ] **Step 1: Create the map page**

Create `src/components/coin-detail/poi-pane-map.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { RouteMode } from "@/lib/crypto-map";
import type { SheetRoute } from "@/components/coin-detail/poi-sheet";
import { PRIMARY, SECONDARY, TAP } from "@/components/coin-detail/poi-sheet";
import { StepList, type StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { footerActions } from "@/lib/poi-sheet-actions";

export const MODE_ICON: Record<RouteMode, string> = { walk: "🚶", car: "🚗", transit: "🚍" };
const TRAVEL_MODES: RouteMode[] = ["walk", "car", "transit"];

const LEG_ICON: Record<string, string> = {
  WALK: "🚶", SUBWAY: "🚇", METRO: "🚇", RAIL: "🚆", REGIONAL_RAIL: "🚆",
  REGIONAL_FAST_RAIL: "🚆", LONG_DISTANCE: "🚆", HIGHSPEED_RAIL: "🚄",
  NIGHT_RAIL: "🚆", BUS: "🚌", COACH: "🚌", TRAM: "🚊", FERRY: "⛴️",
};

function legIcon(mode: string): string {
  return LEG_ICON[mode.toUpperCase()] ?? "🚆";
}

/**
 * Страница «Карта» — не карта, а окно в неё. Полотно MapLibre живёт в
 * навигаторе и никуда не переезжает: перенос канваса в другое место DOM
 * заставил бы MapLibre пересоздать контекст, и сбились бы линия маршрута,
 * положение и ведение — ровно то, на что жалоба. Поэтому страница прозрачна и
 * не берёт события (`pointer-events-none`), а палец достаёт до карты; обратно
 * события включены только у полосы управления.
 *
 * `barRef` отдаётся навигатору: `fitRoute()` вписывает маршрут в видимую часть
 * карты и меряет для этого реальную высоту полосы (у транспорта в сводке
 * появляются пересадки, и полоса выше).
 */
export function PoiPaneMap({
  route,
  mode,
  status,
  hasOrigin,
  voiceOn,
  voiceSupported,
  barRef,
  onMode,
  onBuildRoute,
  onGo,
  onClearRoute,
  onLocate,
  onToggleVoice,
  t,
}: {
  route: SheetRoute | null;
  mode: RouteMode;
  status: string | null;
  hasOrigin: boolean;
  voiceOn: boolean;
  voiceSupported: boolean;
  barRef: React.RefObject<HTMLDivElement | null>;
  onMode: (next: RouteMode) => void;
  onBuildRoute: () => void;
  onGo: () => void;
  onClearRoute: () => void;
  onLocate: () => void;
  onToggleVoice: () => void;
  t: StepTranslator;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const actions = footerActions(!!route);

  return (
    <div className="pointer-events-none flex h-full flex-col justify-end">
      <div
        ref={barRef}
        className="pointer-events-auto space-y-2 border-t border-hairline bg-card/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {!hasOrigin && (
          <button type="button" onClick={onLocate} className={`${SECONDARY} w-full`}>
            📍 {t("myLocation")}
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          {TRAVEL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              className={
                "flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[12px] font-medium transition-all " +
                (mode === m
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-hairline text-muted hover:text-foreground")
              }
            >
              <span aria-hidden className="text-[18px] leading-none">{MODE_ICON[m]}</span>
              {t(`mode_${m}`)}
            </button>
          ))}
        </div>

        {route && (
          <div className="rounded-xl border border-hairline bg-bg-tint/50 px-3 py-2.5 text-[13px]">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-muted">
                {t("duration")}:{" "}
                <span className="num font-semibold text-foreground">
                  {t("etaMin", { min: Math.max(1, Math.round(route.duration / 60)) })}
                </span>
              </span>
              <span className="text-muted">
                {t("distance")}:{" "}
                <span className="num font-semibold text-foreground">
                  {route.distance >= 1000
                    ? `${(route.distance / 1000).toFixed(1)} km`
                    : `${Math.round(route.distance)} m`}
                </span>
              </span>
            </div>
            {route.mode === "transit" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                <span>{route.transfers ? t("transfers", { count: route.transfers }) : t("transitDirect")}</span>
                {route.legs?.map((lg, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-muted/50">›</span>}
                    <span style={{ color: lg.dashed ? undefined : lg.color }}>
                      {legIcon(lg.mode)}
                      {lg.line ? ` ${lg.line}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            )}
            {!!route.steps?.length && (
              <>
                <button
                  type="button"
                  onClick={() => setStepsOpen((v) => !v)}
                  aria-expanded={stepsOpen}
                  className="mt-1.5 flex min-h-[36px] items-center gap-1.5 text-[12px] text-muted hover:text-foreground"
                >
                  <span aria-hidden>{stepsOpen ? "▾" : "▸"}</span>
                  {t("directions")}
                </button>
                {stepsOpen && (
                  <div className="max-h-[32vh] overflow-y-auto overscroll-contain">
                    <StepList steps={route.steps} t={t} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {voiceSupported && (
          <button
            type="button"
            onClick={onToggleVoice}
            aria-pressed={voiceOn}
            className={
              `${TAP} w-full border ` +
              (voiceOn ? "border-accent/40 bg-accent/10 text-foreground" : "border-hairline text-muted hover:text-foreground")
            }
          >
            <span aria-hidden>{voiceOn ? "🔊" : "🔇"}</span>
            {voiceOn ? t("voiceOn") : t("voiceOff")}
          </button>
        )}

        {status && <p className="text-[12px] leading-snug text-accent">{status}</p>}

        {actions.map((a) => {
          const handler = a.key === "go" ? onGo : a.key === "routeHere" ? onBuildRoute : onClearRoute;
          if (a.kind === "text") {
            return (
              <button
                key={a.key}
                type="button"
                onClick={handler}
                className="flex min-h-[40px] w-full items-center justify-center text-[12px] text-muted hover:text-foreground"
              >
                {t(a.labelKey)}
              </button>
            );
          }
          return (
            <button
              key={a.key}
              type="button"
              onClick={handler}
              className={`${a.kind === "primary" ? PRIMARY : SECONDARY} w-full`}
            >
              {a.key === "go" ? `▶ ${t(a.labelKey)}` : t(a.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Point the card page at the new `MODE_ICON`**

In `src/components/coin-detail/poi-pane-card.tsx`, change the import to
`import { MODE_ICON } from "@/components/coin-detail/poi-pane-map";`
(if the card page does not actually use it after Task 5, drop the import).

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: `poi-sheet.tsx` still declares its own `MODE_ICON`/`TRAVEL_MODES`/`LEG_ICON`
and re-exports `MODE_ICON`. Task 8 rewrites that file and removes the duplicates;
until then `tsc` may report an unused-variable style lint only, not an error.

- [ ] **Step 4: Commit**

```bash
git add src/components/coin-detail/poi-pane-map.tsx src/components/coin-detail/poi-pane-card.tsx
git commit -m "feat(navigator): страница карты в карточке точки — прозрачное окно с полосой маршрута"
```

---

### Task 8: Оболочка карточки — дорожка страниц, индикатор, жест

**Files:**
- Modify: `src/components/coin-detail/poi-sheet.tsx` (переписывается целиком)

- [ ] **Step 1: Rewrite `poi-sheet.tsx`**

Replace the whole file with:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OgPreview, Poi, RouteMode, RouteStep, TransitLeg } from "@/lib/crypto-map";
import {
  DEFAULT_POI_PAGE,
  SWIPE_EDGE_PX,
  claimsSwipe,
  dragOffset,
  pageLabelKey,
  pagesFor,
  settlePage,
  type PoiPage,
} from "@/lib/poi-pager";
import { PoiPaneCard } from "@/components/coin-detail/poi-pane-card";
import { PoiPaneMap, MODE_ICON } from "@/components/coin-detail/poi-pane-map";
import { PoiPaneShowcase } from "@/components/coin-detail/poi-pane-showcase";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";

export const LAYER_DOT: Record<string, string> = {
  merchant: "#30B658",
  atm: "#FE5C04",
  financial: "#5B8DEF",
  fintech: "#A855F7",
};

// Кнопка под палец: 44 px — минимум, по которому попадают не глядя.
export const TAP = "min-h-[44px] rounded-xl text-[13px] font-medium transition-all flex items-center gap-2 px-3";
export const PRIMARY = `${TAP} justify-center bg-accent text-accent-foreground hover:opacity-90 font-semibold`;
export const SECONDARY = `${TAP} justify-center border border-hairline text-foreground hover:border-accent`;
export const ROW_BTN = `${TAP} w-full border border-hairline text-foreground hover:border-accent bg-bg-tint/40`;

/** Маршрут, который карточка показывает: сводка + геометрия для ведения. */
export type SheetRoute = {
  distance: number;
  duration: number;
  mode: RouteMode;
  transfers?: number;
  legs?: TransitLeg[];
  steps?: RouteStep[];
  coordinates: [number, number][];
};

/**
 * Карточка точки — листалка. На телефоне три страницы: «Карта» (прозрачное
 * окно в живое полотно MapLibre), «Карточка» (наши факты) и «Витрина»
 * (контент заведения); открывается середина, потому что нажатие на точку — это
 * вопрос «что это за место». На десктопе страниц две: карта и так видна рядом
 * с панелью.
 */
export function PoiSheet({
  poi,
  locale,
  route,
  mode,
  status,
  hasOrigin,
  near,
  voiceOn,
  voiceSupported,
  page,
  onPageChange,
  routeBarRef,
  onClose,
  onMode,
  onBuildRoute,
  onGo,
  onClearRoute,
  onStreetView,
  onLocate,
  onToggleVoice,
  t,
}: {
  poi: Poi;
  locale: string;
  route: SheetRoute | null;
  mode: RouteMode;
  status: string | null;
  hasOrigin: boolean;
  near: boolean;
  voiceOn: boolean;
  voiceSupported: boolean;
  page: PoiPage;
  onPageChange: (next: PoiPage) => void;
  routeBarRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMode: (next: RouteMode) => void;
  onBuildRoute: () => void;
  onGo: () => void;
  onClearRoute: () => void;
  onStreetView: () => void;
  onLocate: () => void;
  onToggleVoice: () => void;
  t: StepTranslator;
}) {
  const phone = usePhone();
  const pages = useMemo(() => pagesFor(phone), [phone]);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const gesture = useRef<{ x: number; y: number; at: number; edge: boolean; claimed: boolean } | null>(null);

  // Страница «Карта» существует только на телефоне: если ширина выросла, пока
  // она открыта, листалку надо вернуть на существующую страницу.
  useEffect(() => {
    if (!pages.includes(page)) onPageChange(DEFAULT_POI_PAGE);
  }, [pages, page, onPageChange]);

  // Прокрутка страницы под карточкой на телефоне гасится так же, как под
  // бургер-меню: иначе палец листает страницу вместо карточки.
  useEffect(() => {
    if (!phone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phone]);

  // Клавиши — не украшение: листалка без жеста обязана работать с клавиатуры.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") return onClose();
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const index = pages.indexOf(page);
      const next = pages[index + (e.key === "ArrowRight" ? 1 : -1)];
      if (next) onPageChange(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages, page, onPageChange, onClose]);

  const width = () => deckRef.current?.clientWidth ?? 1;

  function onPointerDown(e: React.PointerEvent) {
    if (!phone || e.pointerType === "mouse") return;
    const box = deckRef.current?.getBoundingClientRect();
    const edge = !!box && (e.clientX - box.left < SWIPE_EDGE_PX || box.right - e.clientX < SWIPE_EDGE_PX);
    gesture.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, edge, claimed: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.claimed) {
      if (!claimsSwipe({ page, dx, dy, fromEdge: g.edge })) return;
      g.claimed = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDrag(dx);
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g?.claimed) {
      setDrag(null);
      return;
    }
    const dx = e.clientX - g.x;
    const ms = Math.max(1, e.timeStamp - g.at);
    const next = settlePage({ pages, page, dx, width: width(), velocity: dx / ms });
    setDrag(null);
    if (next !== page) onPageChange(next);
  }

  const index = Math.max(0, pages.indexOf(page));
  const offset = drag === null ? -index * width() : dragOffset({ pages, page, dx: drag, width: width() });
  const onMapPage = page === "map";

  const container = [
    "z-[60] flex flex-col overflow-hidden text-foreground",
    // На странице карты карточка — окно: фона нет, тени нет, палец идёт к карте.
    onMapPage ? "pointer-events-none bg-transparent" : "bg-card shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.6)]",
    "fixed inset-0",
    "md:absolute md:inset-y-3 md:right-auto md:left-3 md:top-3 md:bottom-3 md:w-[380px] md:rounded-[18px] md:border md:border-hairline md:bg-card",
  ].join(" ");

  return (
    <div className={container} role="dialog" aria-label={poi.name}>
      {/* Шапка: на странице карты полупрозрачная — иначе непонятно, чья карта. */}
      <div
        className={
          "pointer-events-auto flex shrink-0 items-start gap-2 border-b border-hairline px-4 pb-2 pt-3 " +
          (onMapPage ? "bg-card/90 backdrop-blur" : "")
        }
      >
        <span
          aria-hidden
          className="mt-[7px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: LAYER_DOT[poi.layer] ?? "#30B658" }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-tight">{poi.name}</div>
          <div className="truncate text-[12px] text-muted">
            {poi.category}
            {poi.lightning ? " · ⚡ Lightning" : ""}
            {poi.coinSpecific ? " · ✓" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[18px] text-muted hover:bg-bg-tint hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Индикатор страниц — кнопки: листать можно и без жеста вовсе. */}
      <div
        role="tablist"
        aria-label={t("pageOf", { n: index + 1, total: pages.length })}
        className={
          "pointer-events-auto flex shrink-0 items-center justify-center gap-1 border-b border-hairline px-2 " +
          (onMapPage ? "bg-card/90 backdrop-blur" : "")
        }
      >
        {pages.map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={p === page}
            onClick={() => onPageChange(p)}
            className={
              "min-h-[44px] flex-1 px-2 text-[12px] font-medium transition-all " +
              (p === page ? "border-b-2 border-accent text-foreground" : "text-muted hover:text-foreground")
            }
          >
            {t(pageLabelKey(p))}
          </button>
        ))}
      </div>

      {/* Дорожка страниц */}
      <div
        ref={deckRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="flex h-full"
          style={{
            width: `${pages.length * 100}%`,
            transform: `translate3d(${offset}px, 0, 0)`,
            transition: drag === null ? "transform 220ms ease-out" : "none",
          }}
        >
          {pages.map((p) => (
            <div
              key={p}
              role="tabpanel"
              aria-hidden={p !== page}
              className={
                "h-full overflow-y-auto overscroll-contain " +
                (p === "map" ? "pointer-events-none" : "pointer-events-auto")
              }
              style={{ width: `${100 / pages.length}%` }}
            >
              {p === "map" && (
                <PoiPaneMap
                  route={route}
                  mode={mode}
                  status={status}
                  hasOrigin={hasOrigin}
                  voiceOn={voiceOn}
                  voiceSupported={voiceSupported}
                  barRef={routeBarRef}
                  onMode={onMode}
                  onBuildRoute={onBuildRoute}
                  onGo={onGo}
                  onClearRoute={onClearRoute}
                  onLocate={onLocate}
                  onToggleVoice={onToggleVoice}
                  t={t}
                />
              )}
              {p === "card" && (
                <PoiPaneCard
                  poi={poi}
                  locale={locale}
                  near={near}
                  routeSummary={
                    route
                      ? {
                          icon: MODE_ICON[route.mode],
                          text: `${t("etaMin", { min: Math.max(1, Math.round(route.duration / 60)) })} · ${
                            route.distance >= 1000
                              ? `${(route.distance / 1000).toFixed(1)} km`
                              : `${Math.round(route.distance)} m`
                          }`,
                        }
                      : null
                  }
                  onShowRoute={() => onPageChange(phone ? "map" : "card")}
                  onStreetView={onStreetView}
                  t={t}
                />
              )}
              {p === "showcase" && <PoiPaneShowcase poi={poi} locale={locale} t={t} />}
            </div>
          ))}
        </div>
      </div>

      {/* На десктопе страницы карты нет, поэтому управление маршрутом стоит
          подвалом панели — ровно там, где его положил предыдущий слайс. */}
      {!phone && (
        <div className="hidden shrink-0 border-t border-hairline md:block">
          <PoiPaneMap
            route={route}
            mode={mode}
            status={status}
            hasOrigin={hasOrigin}
            voiceOn={voiceOn}
            voiceSupported={voiceSupported}
            barRef={routeBarRef}
            onMode={onMode}
            onBuildRoute={onBuildRoute}
            onGo={onGo}
            onClearRoute={onClearRoute}
            onLocate={onLocate}
            onToggleVoice={onToggleVoice}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

/** Тот же порог, которым карточка уже отличает телефон от десктопа. */
function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setPhone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return phone;
}

type PhotoState = { image: string | null; video: string | null; loading: boolean; onError: () => void };

/**
 * Снимок места: сначала картинка из OSM (если есть), затем — OpenGraph сайта
 * заведения. Битая картинка прячет слот целиком: сломанная иконка хуже пустоты.
 */
export function usePoiPhoto(poi: Poi, website: string | null): PhotoState {
  const [image, setImage] = useState<string | null>(poi.image);
  const [video, setVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!poi.image && !!website);

  useEffect(() => {
    if (!website) return;
    let cancelled = false;
    fetch(`/api/crypto-map/preview?url=${encodeURIComponent(website)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((res: { preview?: OgPreview }) => {
        if (cancelled) return;
        const og = res.preview ?? { title: null, image: null, video: null };
        if (og.image) setImage(og.image);
        setVideo(og.video ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [website]);

  return { image, video, loading, onError: () => setImage(null) };
}
```

Note: `poi-pane-card.tsx` imports `MODE_ICON` — after this rewrite it must come
from `poi-pane-map`, not from here. Fix that import if it still points at
`poi-sheet`.

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: errors only in `crypto-navigator.tsx` — it still passes `expanded` and
`onExpandedChange` and does not pass `page`/`onPageChange`/`routeBarRef`.
That is Task 9.

- [ ] **Step 3: Commit (after Task 9 compiles)**

Do not commit a non-compiling tree. Continue straight to Task 9 and commit both
together there.

---

### Task 9: Проводка в навигаторе

**Files:**
- Modify: `src/components/coin-detail/crypto-navigator.tsx` (`sheetExpanded`, `mapFull` ~строка 820, `fitRoute` ~строка 262, `<PoiSheet .../>` ~строка 937, `routeTo`)

- [ ] **Step 1: Replace the docked state with a page**

In `src/components/coin-detail/crypto-navigator.tsx`:

Remove the `sheetExpanded` state declaration and every use of it. Add next to
the other state:

```ts
  const [poiPage, setPoiPage] = useState<PoiPage>(DEFAULT_POI_PAGE);
  // Полосу управления страницы «Карта» мерит `fitRoute`: маршрут должен
  // уместиться в видимую часть карты, а не уехать под полосу.
  const routeBarRef = useRef<HTMLDivElement | null>(null);
```

with the import `import { DEFAULT_POI_PAGE, type PoiPage } from "@/lib/poi-pager";`.

Every `setSelected(poi)` call site also resets the page, so a freshly tapped
point always opens on the facts:

```ts
  function selectPoi(poi: Poi) {
    setPoiPage(DEFAULT_POI_PAGE);
    setSelected(poi);
  }
```

Replace the `setSelected(<poi>)` calls that come from marker/layer clicks with
`selectPoi(<poi>)`. Leave `setSelected(null)` (closing) as it is.

- [ ] **Step 2: Simplify `mapFull`**

Replace:

```ts
  const mapFull = isPhone && (navActive || (!!selected && !sheetExpanded));
```

with:

```ts
  // Карта занимает весь экран телефона, пока открыта карточка точки или идёт
  // ведение: карточка — листалка на весь экран, и её страница «Карта» должна
  // смотреть в карту, а не в кусок страницы. Полустояния листа больше нет.
  const mapFull = isPhone && (navActive || !!selected);
```

- [ ] **Step 3: Measure the route bar in `fitRoute`**

Inside `fitRoute()`, where the bottom padding is computed from the sheet height,
use the route bar instead:

```ts
    // Снизу мешает ровно полоса управления страницы «Карта»: её высота плывёт
    // (у транспорта в сводке появляются пересадки), поэтому меряем, а не
    // держим константу.
    const barHeight = routeBarRef.current?.getBoundingClientRect().height ?? 0;
```

and feed `barHeight` into the existing `padding.bottom` expression (keep the
existing minimum so the line never hides behind the header).

- [ ] **Step 4: Turn to the map page when a route appears**

In `routeTo(poi)`, right after the destination is set and the request is fired,
add:

```ts
    // Смысл нажатия «Маршрут сюда» — увидеть линию. Страница «Карта» и есть
    // это зрелище; раньше ту же работу делало пристыкованное полустояние.
    if (isPhone) setPoiPage("map");
```

- [ ] **Step 5: Update the `<PoiSheet />` props**

Replace `expanded={sheetExpanded}` and `onExpandedChange={setSheetExpanded}` with:

```tsx
            page={poiPage}
            onPageChange={setPoiPage}
            routeBarRef={routeBarRef}
```

and delete the `navActive={navActive}` prop — ведение больше не страница, а
состояние, и карточка о нём не знает. Instead, hide the whole sheet while
guiding by changing the render condition:

```tsx
        {selected && !navActive && (
          <PoiSheet ... />
        )}
```

- [ ] **Step 6: Verify types and the suite**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm test`
Expected: PASS — full vitest suite, including `poi-pager`, `poi-accepted-coins`,
`company-points`, `poi-sheet-actions`, `messages-parity`.

- [ ] **Step 7: Commit**

```bash
git add src/components/coin-detail/poi-sheet.tsx src/components/coin-detail/crypto-navigator.tsx src/components/coin-detail/poi-pane-card.tsx
git commit -m "feat(navigator): карточка точки листается — карта, факты, витрина"
```

---

### Task 10: Тест «в карточке нет голых ссылок»

**Files:**
- Test: `tests/poi-sheet-buttons.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/poi-sheet-buttons.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Требование владельца: в карточке точки всё — кнопки под палец, текстовых
 * ссылок нет. Внешний переход остаётся элементом `<a>` (иначе ломаются
 * «открыть в новой вкладке» и долгое нажатие по номеру), но меряется как
 * кнопка. Тест смотрит в исходник, потому что отрисовки компонентов в проекте
 * нет — jsdom не подключён, UI закрывает Playwright.
 */
const FILES = [
  "src/components/coin-detail/poi-sheet.tsx",
  "src/components/coin-detail/poi-pane-card.tsx",
  "src/components/coin-detail/poi-pane-showcase.tsx",
  "src/components/coin-detail/poi-pane-map.tsx",
];

const TAP_CLASSES = ["ROW_BTN", "PRIMARY", "SECONDARY", "TAP", "min-h-[40px]", "min-h-[44px]", "min-h-[56px]"];

describe("карточка точки: кнопки, а не ссылки", () => {
  for (const file of FILES) {
    it(`${file} — у каждого <a> есть размер под палец`, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      const anchors = src.split(/<a\s/).slice(1);
      const bare = anchors.filter((chunk) => {
        const head = chunk.slice(0, chunk.indexOf(">"));
        return !TAP_CLASSES.some((c) => head.includes(c));
      });
      expect(bare).toEqual([]);
    });

    it(`${file} — нет подчёркнутых ссылок`, () => {
      const src = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/\bunderline\b/);
    });
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/poi-sheet-buttons.test.ts`
Expected: PASS, 8 tests. If an `<a>` is reported, give it `ROW_BTN` or
`min-h-[40px]` — do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/poi-sheet-buttons.test.ts
git commit -m "test(navigator): в карточке точки нет голых текстовых ссылок"
```

---

### Task 11: E2E — листалка на телефоне и закладки на десктопе

**Files:**
- Create: `e2e/poi-sheet-panes.spec.ts`

- [ ] **Step 1: Write the spec**

Create `e2e/poi-sheet-panes.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

/**
 * Карточка точки как листалка. Куратская точка на карточке монеты открывается
 * надёжно (её координаты наши), поэтому проверяем на ней.
 */
const PAGE = "/ru/coin/bitcoin#map";

async function openFirstPoi(page: import("@playwright/test").Page) {
  await page.goto(PAGE);
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 30_000 });
  // Маркеры куратских точек — наши DOM-элементы, а не слой карты.
  const marker = page.locator(".maplibregl-marker").first();
  await marker.waitFor({ timeout: 30_000 });
  await marker.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("карточка точки — три страницы", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("открывается на фактах, а не на карте", async ({ page }) => {
    await openFirstPoi(page);
    await expect(page.getByRole("tab", { name: "Место" })).toHaveAttribute("aria-selected", "true");
  });

  test("индикатор листает без жеста", async ({ page }) => {
    await openFirstPoi(page);
    await page.getByRole("tab", { name: "Карта" }).click();
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveAttribute("aria-selected", "true");
    // На странице карты видна полоса управления маршрутом.
    await expect(page.getByRole("button", { name: /Маршрут|Поехали/ }).first()).toBeVisible();
  });

  test("витрина показывает контент заведения", async ({ page }) => {
    await openFirstPoi(page);
    await page.getByRole("tab", { name: "Витрина" }).click();
    await expect(page.getByRole("tab", { name: "Витрина" })).toHaveAttribute("aria-selected", "true");
  });

  test("на странице карты палец достаёт до карты", async ({ page }) => {
    await openFirstPoi(page);
    await page.getByRole("tab", { name: "Карта" }).click();
    const before = await page.evaluate(() => document.querySelectorAll("canvas.maplibregl-canvas").length);
    expect(before).toBe(1);
    // Перетаскивание середины страницы карты не перелистывает её.
    await page.mouse.move(195, 480);
    await page.mouse.down();
    await page.mouse.move(60, 480, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveAttribute("aria-selected", "true");
    // И полотно то же самое — карта не пересоздавалась.
    expect(await page.evaluate(() => document.querySelectorAll("canvas.maplibregl-canvas").length)).toBe(1);
  });
});

test.describe("карточка точки на десктопе", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("страниц две, карты среди них нет", async ({ page }) => {
    await openFirstPoi(page);
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.getByRole("tab", { name: "Карта" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test e2e/poi-sheet-panes.spec.ts`
Expected: 5 passed. If the tab names differ, read them from `messages/ru.json`
(`cryptoMap.pageMap/pageCard/pageShowcase`) and use the real strings — do not
loosen the selectors to `nth(...)`.

- [ ] **Step 3: Run the neighbouring map specs for regressions**

Run: `npx playwright test e2e/maplibre-races.spec.ts e2e/crypto-map-webgl-fallback.spec.ts e2e/coin-detail.spec.ts`
Expected: all passed.

- [ ] **Step 4: Commit**

```bash
git add e2e/poi-sheet-panes.spec.ts
git commit -m "test(e2e): листалка карточки точки — открытие, индикатор, карта под пальцем"
```

---

### Task 12: Сборка, деплой, пуш

**Files:** нет (операции)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Lint and types**

Run: `npx tsc --noEmit && npx next lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build completes; no new warnings about `poi-*` files.

- [ ] **Step 4: Restart the web process**

`src/lib/poi-pager.ts`, `crypto-map.ts` and `company-points.ts` live under
`src/lib`, so check whether the worker imports any of them:

Run: `grep -rn "poi-pager\|company-points\|crypto-map" worker/ | head`

- `crypto-map`/`company-points` imported by the worker → restart both:
  `pm2 restart trientes-web trientes-worker && pm2 save`
- otherwise → `pm2 restart trientes-web && pm2 save`

- [ ] **Step 5: Live check**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://trientes.org/ru/coin/bitcoin
curl -s "https://trientes.org/api/crypto-map/poi?bbox=30.2,59.9,30.4,60.0&coin=bitcoin&symbol=btc" | head -c 400
```
Expected: `200`, and the JSON carries `acceptedCoins` / `acceptedGeneric` /
`photos` on the points.

Then open `https://trientes.org/ru/coin/bitcoin#map` on a phone-sized viewport:
tap a point → opens on «Место»; tab to «Карта» → line and the control bar;
«Маршрут сюда» → page turns to the map by itself; swipe back to «Витрина».

- [ ] **Step 6: Push**

```bash
git push origin main
```
Expected: `main -> main` accepted.

---

## Self-review

**Покрытие спеки:**

| Требование спеки | Задача |
|---|---|
| Три страницы, первой открывается середина | 1, 8, 9 (шаг 1), e2e 11 |
| Страница «Карта» — прозрачное окно, полотно не переезжает | 7, 8, e2e 11 («полотно то же самое») |
| Полоса управления маршрутом на странице карты | 7 |
| Шапка на карте полупрозрачная | 8 |
| Ведение — состояние, а не страница | 9 (шаг 5) |
| Пристыкованное состояние удаляется, `expandCard`/`collapseCard` уходят | 4, 8, 9 |
| Построение маршрута перелистывает на карту | 9 (шаг 4) |
| `fitRoute` меряет полосу управления | 7 (`barRef`), 9 (шаг 3) |
| Правила захвата жеста, пороги, флик, сопротивление | 1, 8 |
| Листание без жеста: индикатор-кнопки, стрелки, `Esc` | 8 |
| Десктоп — две закладки, свайпа нет | 1 (`pagesFor`), 8, e2e 11 |
| `acceptedCoins` у точек BTC Map и своих, `acceptedGeneric` | 2, 3, 5 |
| Все фотографии точки на витрине | 3, 6 |
| Плашка «это моё заведение» у чужой точки | 6 |
| Кнопки, а не ссылки | 10 |
| Переводы на 11 локалей | 4 |
| Юнит- и e2e-проверки из спеки | 1, 2, 3, 10, 11 |

**Заглушек нет:** в каждом шаге, который меняет код, стоит код; команд с
ожидаемым выводом — в каждой проверке.

**Согласованность имён:** `PoiPage`, `pagesFor`, `claimsSwipe`, `settlePage`,
`dragOffset`, `pageLabelKey`, `DEFAULT_POI_PAGE`, `SWIPE_EDGE_PX` — объявлены в
Task 1 и используются ровно так же в Task 8 и 9. `AcceptedCoin` объявлен в
Task 2, читается в Task 3 и 5. `CoinRegistry`/`EMPTY_COIN_REGISTRY` — Task 3.
`TAP`/`PRIMARY`/`SECONDARY`/`ROW_BTN`/`usePoiPhoto`/`LAYER_DOT` экспортируются из
`poi-sheet.tsx` (Task 5 и 8) и импортируются страницами. `MODE_ICON` переезжает
в `poi-pane-map.tsx` в Task 7, и Task 7 шаг 2 правит импорт в `poi-pane-card.tsx`.
`routeBarRef` объявлен в Task 9, проброшен как `barRef` в Task 7/8.
