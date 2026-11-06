# Карточка монеты для реального сектора — Слайс F1: «Где принимается»

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Публичная карточка монеты показывает, в каких одобренных точках её физически принимают (счётчик, разбивка по типу и странам, шесть точек списком, кнопка «открыть на карте»), а продавец прямо с карточки заявляет приём — его точка попадает в тот же счётчик и в POI-фид навигатора.

**Architecture:** Связь «карточка ↔ точка» — новый параллельный массив `CompanyPoint.acceptedCardIds` (идентификаторы `CoinCard.id`), рядом с существующим `acceptedCoinIds`. Вся недетерминированная логика — чистые функции в `src/lib/coin-card-acceptance.ts` (агрегация), `src/lib/crypto-map.ts` (`parseCoinSelector`), `src/lib/coin-card-merchant-cta.ts` (`ctaHref`), `src/lib/coin-card-badge.ts` (SVG) и покрывается Vitest без базы. Поверх — тонкие запросы Prisma без кеша (одобрение точки должно быть видно сразу) и серверные компоненты.

**Tech Stack:** Next.js 16.2.6 (App Router, server actions), Prisma 5.22 + PostgreSQL, next-intl (10 локалей), Vitest (`npm test`), Tailwind v4. Прод — PM2 (`trientes-web`, `trientes-worker`).

**Важно перед кодом:** AGENTS.md требует читать документацию из `node_modules/next/dist/docs/` — это НЕ тот Next.js, что в обучающих данных. Минимум перед правкой: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` (роут `badge.svg`), `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidate-path.md`.

**Спека:** `docs/superpowers/specs/2026-11-06-coin-card-real-economy-design.md`
**Предыдущие слайсы:** `docs/superpowers/plans/2026-11-06-coin-card-listing-a1.md`, `…-a2.md`

---

## Граница слайса и сознательные отклонения от спеки

1. **Миграция одна и аддитивная на весь слайс F** (требование спеки). В ней сразу создаются поля F3/F4 (`FintechCompany.supportedCardIds`, `CoinCard.payments`, `CoinCard.legal`) и значение enum `CoinCardSection.PAYMENTS`. Код F1 их не читает и не пишет. Решение `LEGAL` отдельной секцией спека откладывает до планирования F4 — значение `LEGAL` в enum **не** добавляем, чтобы не фиксировать нерешённое.
2. **Страницы `/{locale}/crypto-map` в проекте не существует** — навигатор до сих жил только секцией `#navigator` внутри страницы монеты (`CryptoMapSection` → `CryptoNavigator`). Спека называет URL `/{locale}/crypto-map?coin=card:<id>`, значит страницу надо создать (Задача 7). Это тонкая серверная обёртка над существующим клиентским компонентом, нового визуального языка она не вводит.
3. **URL из спеки `/cabinet/companies/<id>#add-point?card=<cardId>` синтаксически невозможен** — фрагмент всегда последний. Реализуем как `/cabinet/companies/<id>?card=<cardId>#add-point`.
4. **Без ICU-плюралов.** Счётчик рисуется парой «ярлык + число» (`Точек приёма: 3`, `Стран: 2`), а не фразой «принимают в N точках». Причина: правильные плюральные категории в десяти локалях — отдельный источник ошибок, а стат-строка читается однозначно везде.
5. **Чистки «висячих» id при удалении карточки нет** — потому что пути удаления карточки в проекте не существует (карточку отклоняют, `prisma.coinCard.delete` не вызывается нигде). Агрегация и так считает точки по конкретному `cardId`, несуществующий id просто ни с чем не совпадает. Задача появится вместе с удалением карточки.
6. **Фильтр по карточке применяется только к нашим точкам.** Половина фида из зеркала BTC Map в режиме `card:<id>` отдаётся с общим тегом `payment:cryptocurrencies` и никогда не помечается `coinSpecific` — в зеркале собственных карточек заведомо нет.
7. **Платёжный профиль, путь к фиату и правовой блок — не в этом слайсе** (F2/F3/F4).

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma` | правка: `CompanyPoint.acceptedCardIds`, `FintechCompany.supportedCardIds`, `CoinCard.payments/legal`, `CoinCardSection.PAYMENTS` |
| `prisma/migrations/20261106210000_coin_card_real_economy/migration.sql` | **новый** — аддитивная миграция всего слайса F |
| `src/lib/coin-card-acceptance.ts` | **новый** — чистая `aggregateAcceptance()` + запрос `getAcceptanceSummary()` без кеша |
| `src/lib/coin-card-merchant-cta.ts` | **новый** — состояние посетителя (`getMerchantCta`) и чистый `ctaHref()` |
| `src/lib/coin-card-badge.ts` | **новый** — чистый `buildAcceptBadgeSvg()` + `escapeXml()` |
| `src/lib/crypto-map.ts` | правка: `parseCoinSelector()`, `GENERIC_CRYPTO_TAGS` |
| `src/lib/company-points.ts` | правка: `companyPointToPoi`/`fetchApprovedPointsInBbox` принимают `CoinSelector` |
| `src/lib/company.ts` | правка: валидация `acceptedCardIds` в `validateCompanyPoint` |
| `src/app/api/crypto-map/poi/route.ts` | правка: разбор `coin=card:<id>` |
| `src/app/actions/company.ts` | правка: проверка «карточка одобрена» → `coin_not_selectable`, запись `acceptedCardIds` |
| `src/components/business/point-form.tsx` | правка: группа «Свой листинг», префилл карточки |
| `src/app/[locale]/cabinet/companies/[id]/page.tsx` | правка: передать карточки, прочитать `?card=`, якоря `#add-point` / `#your-points` |
| `src/components/coin-card/sections/acceptance-section.tsx` | **новый** — публичная секция `#acceptance` |
| `src/components/coin-card/card-sections.tsx` | правка: секция между «Рынки» и «Безопасность» |
| `src/app/[locale]/crypto-map/page.tsx` | **новый** — полноэкранный навигатор по `?coin=` |
| `src/app/[locale]/coin/[slug]/badge.svg/route.ts` | **новый** — виджет-бейдж |
| `messages/*.json` (10 файлов) | правка: `coinCard.sections.acceptance`, `coinCard.acceptance.*`, `business.ownListing`, `business.err.coin_not_selectable` |
| `tests/coin-card-acceptance.test.ts` | **новый** |
| `tests/coin-selector.test.ts` | **новый** |
| `tests/coin-card-badge.test.ts` | **новый** |
| `tests/coin-card-merchant-cta.test.ts` | **новый** |
| `tests/company-points.test.ts` | правка: новая подпись + фильтр по карточке |
| `tests/company.test.ts` | правка: `acceptedCardIds` в валидации |

---

## Задача 1: Схема и миграция (аддитивно, на весь слайс F)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261106210000_coin_card_real_economy/migration.sql`

- [ ] **Шаг 1: Убедиться, что папка миграций и база сходятся**

```bash
./node_modules/.bin/prisma migrate status
```

Ожидается: `Database schema is up to date!`. Если нет — остановиться и разобраться, НЕ продолжать (в проекте есть давний дрейф по `Company.ownerUserId`, который сознательно не трогают, см. комментарий в `20261106190000_coin_card/migration.sql`).

- [ ] **Шаг 2: Добавить поле и GIN-индекс в `CompanyPoint`**

В `prisma/schema.prisma` в модели `CompanyPoint` после строки `acceptedCoinIds String[]` добавить:

```prisma
  // Собственные листинги (CoinCard.id). Параллельный массив, а не магические
  // строки "card:<id>" внутри acceptedCoinIds: те тихо сломали бы любой
  // существующий acceptedCoinIds.includes(coin.id).
  acceptedCardIds String[]
```

и в блок индексов той же модели, после `@@index([lat, lon])`:

```prisma
  @@index([acceptedCardIds(ops: ArrayOps)], type: Gin)
```

- [ ] **Шаг 3: Добавить поле и GIN-индекс в `FintechCompany`**

В модели `FintechCompany` после строки `supportedCoinIds String[]` добавить:

```prisma
  // Заполняется слайсом F3 (путь к фиату); в F1 только создаётся.
  supportedCardIds String[]
```

и после существующего `@@index([status, displayName])`:

```prisma
  @@index([supportedCardIds(ops: ArrayOps)], type: Gin)
```

- [ ] **Шаг 4: Добавить поля F2/F4 в `CoinCard` и значение enum**

В модели `CoinCard` после строки `security      Json?` добавить:

```prisma
  // Слайс F2 (платёжный профиль) и F4 (правовой статус) — поля создаются
  // одной миграцией со всем слайсом F, наполняются позже.
  payments      Json?
  legal         Json?
```

В `enum CoinCardSection` после `ACCEPTANCE` добавить:

```prisma
  PAYMENTS
```

- [ ] **Шаг 5: Проверить, что схема валидна**

```bash
cd /home/dv/trientes && ./node_modules/.bin/prisma validate
```

Ожидается: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Шаг 6: Написать миграцию руками**

Автодиффу доверять нельзя: он протащит давний дрейф. Создать файл
`prisma/migrations/20261106210000_coin_card_real_economy/migration.sql`:

```sql
-- Карточка монеты для реального сектора, слайс F.
-- Миграция строго аддитивная и покрывает все четыре подслайса (F1-F4), чтобы
-- не плодить вторую: только ADD COLUMN / CREATE INDEX / ALTER TYPE ADD VALUE.
-- Поля payments/legal и значение PAYMENTS создаются заранее и в F1 не читаются.

-- AlterEnum
ALTER TYPE "CoinCardSection" ADD VALUE 'PAYMENTS';

-- AlterTable: связь точки приёма с собственным листингом (F1)
ALTER TABLE "CompanyPoint" ADD COLUMN "acceptedCardIds" TEXT[];

-- AlterTable: связь финтех-сервиса с собственным листингом (F3)
ALTER TABLE "FintechCompany" ADD COLUMN "supportedCardIds" TEXT[];

-- AlterTable: платёжный профиль (F2) и правовой статус (F4)
ALTER TABLE "CoinCard" ADD COLUMN "payments" JSONB,
                       ADD COLUMN "legal" JSONB;

-- CreateIndex
CREATE INDEX "CompanyPoint_acceptedCardIds_idx" ON "CompanyPoint" USING GIN ("acceptedCardIds");
CREATE INDEX "FintechCompany_supportedCardIds_idx" ON "FintechCompany" USING GIN ("supportedCardIds");
```

- [ ] **Шаг 7: Применить миграцию и перегенерировать клиент**

```bash
cd /home/dv/trientes && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma generate
```

Ожидается: `1 migration found` … `Applied migration(s)`, затем `Generated Prisma Client`.

- [ ] **Шаг 8: Убедиться, что дрейфа не появилось**

```bash
cd /home/dv/trientes && ./node_modules/.bin/prisma migrate status
```

Ожидается: `Database schema is up to date!` (если Prisma жалуется на индексы — значит синтаксис `ops: ArrayOps` сгенерировал другое имя индекса; привести имена в SQL к тем, что требует Prisma).

- [ ] **Шаг 9: Коммит**

```bash
cd /home/dv/trientes && git add prisma/schema.prisma prisma/migrations/20261106210000_coin_card_real_economy && git commit -m "feat(coin-card): аддитивная миграция слайса F — связь точек и финтеха с карточкой"
```

---

## Задача 2: Агрегация приёма (чистая функция + запрос)

**Files:**
- Create: `src/lib/coin-card-acceptance.ts`
- Test: `tests/coin-card-acceptance.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/coin-card-acceptance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_PREVIEW,
  ACCEPTANCE_TOP_COUNTRIES,
  aggregateAcceptance,
  type AcceptanceRow,
} from "@/lib/coin-card-acceptance";

function row(i: number, countryCode: string | null, type: AcceptanceRow["type"]): AcceptanceRow {
  return { id: `p${i}`, name: `Point ${i}`, city: "Prague", countryCode, type, lat: 50, lon: 14 };
}

describe("aggregateAcceptance", () => {
  it("returns an honest zero for no points", () => {
    const s = aggregateAcceptance([], 0);
    expect(s.total).toBe(0);
    expect(s.countries).toBe(0);
    expect(s.byCountry).toEqual([]);
    expect(s.byType).toEqual([]);
    expect(s.recent).toEqual([]);
  });

  it("counts countries and types, most frequent first", () => {
    const s = aggregateAcceptance(
      [row(1, "CZ", "SHOP"), row(2, "CZ", "ATM"), row(3, "PL", "SHOP"), row(4, "CZ", "SHOP")],
      4,
    );
    expect(s.total).toBe(4);
    expect(s.countries).toBe(2);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 3 }, { code: "PL", count: 1 }]);
    expect(s.byType).toEqual([{ type: "SHOP", count: 3 }, { type: "ATM", count: 1 }]);
  });

  it("trusts the caller's total over the row count (rows are capped)", () => {
    const s = aggregateAcceptance([row(1, "CZ", "SHOP")], 900);
    expect(s.total).toBe(900);
  });

  it("ignores points with no country in the breakdown but keeps them in the total", () => {
    const s = aggregateAcceptance([row(1, null, "ONLINE"), row(2, "CZ", "SHOP")], 2);
    expect(s.total).toBe(2);
    expect(s.countries).toBe(1);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 1 }]);
  });

  it("caps the country breakdown and the preview list", () => {
    const codes = ["AA","BB","CC","DD","EE","FF","GG","HH","II","JJ","KK","LL"];
    const rows = codes.map((c, i) => row(i, c, "SHOP"));
    const s = aggregateAcceptance(rows, rows.length);
    expect(s.byCountry).toHaveLength(ACCEPTANCE_TOP_COUNTRIES);
    expect(s.recent).toHaveLength(ACCEPTANCE_PREVIEW);
    expect(s.recent[0].id).toBe("p0");
    expect(s.countries).toBe(12);
  });

  it("breaks country ties by code so the order is stable", () => {
    const s = aggregateAcceptance([row(1, "PL", "SHOP"), row(2, "CZ", "SHOP")], 2);
    expect(s.byCountry).toEqual([{ code: "CZ", count: 1 }, { code: "PL", count: 1 }]);
  });
});
```

- [ ] **Шаг 2: Запустить тест, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-acceptance.test.ts
```

Ожидается: FAIL, `Failed to resolve import "@/lib/coin-card-acceptance"`.

- [ ] **Шаг 3: Написать модуль**

Создать `src/lib/coin-card-acceptance.ts`:

```ts
import type { PointType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Шесть точек превью — ровно столько, сколько требует спека F1. */
export const ACCEPTANCE_PREVIEW = 6;
export const ACCEPTANCE_TOP_COUNTRIES = 10;
/** Потолок выборки для разбивки. Общее число берётся отдельным count(). */
export const ACCEPTANCE_SCAN_LIMIT = 500;

export type AcceptanceRow = {
  id: string;
  name: string;
  city: string | null;
  countryCode: string | null;
  type: PointType;
  lat: number | null;
  lon: number | null;
};

export type AcceptanceSummary = {
  /** Одобренных точек, принимающих монету. Может быть больше, чем rows.length. */
  total: number;
  /** Сколько разных стран встретилось в выборке. */
  countries: number;
  byCountry: { code: string; count: number }[];
  byType: { type: PointType; count: number }[];
  recent: AcceptanceRow[];
};

function countBy<K extends string>(keys: readonly (K | null)[]): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of keys) {
    if (k === null || k === "") continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Чистая часть: разбивка по странам и типам из уже прочитанных строк.
 * `total` передаётся отдельно, потому что выборка ограничена ACCEPTANCE_SCAN_LIMIT,
 * а счётчик на карточке должен быть настоящим.
 */
export function aggregateAcceptance(
  rows: readonly AcceptanceRow[],
  total: number,
): AcceptanceSummary {
  const countries = countBy(rows.map((r) => r.countryCode));
  const types = countBy(rows.map((r) => r.type));
  return {
    total,
    countries: countries.size,
    byCountry: [...countries.entries()]
      .map(([code, count]) => ({ code, count }))
      // Ничья по частоте решается кодом страны — иначе порядок пляшет между запросами.
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, ACCEPTANCE_TOP_COUNTRIES),
    byType: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    recent: rows.slice(0, ACCEPTANCE_PREVIEW),
  };
}

/**
 * Только APPROVED-точки одобренных компаний: непроверенная точка — не
 * доказательство приёма. Без кеша и без Redis — одобрение модератором должно
 * быть видно на карточке сразу, как и в POI-фиде.
 */
export async function getAcceptanceSummary(cardId: string): Promise<AcceptanceSummary> {
  const where = {
    status: "APPROVED" as const,
    company: { status: "APPROVED" as const },
    acceptedCardIds: { has: cardId },
  };
  const [total, rows] = await Promise.all([
    prisma.companyPoint.count({ where }),
    prisma.companyPoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: ACCEPTANCE_SCAN_LIMIT,
      select: {
        id: true, name: true, city: true, countryCode: true,
        type: true, lat: true, lon: true,
      },
    }),
  ]);
  return aggregateAcceptance(rows, total);
}
```

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-acceptance.test.ts
```

Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /home/dv/trientes && git add src/lib/coin-card-acceptance.ts tests/coin-card-acceptance.test.ts && git commit -m "feat(coin-card): агрегация точек приёма для карточки"
```

---

## Задача 3: Селектор монеты и фильтр POI-фида

**Files:**
- Modify: `src/lib/crypto-map.ts`
- Modify: `src/lib/company-points.ts`
- Modify: `src/app/api/crypto-map/poi/route.ts`
- Create: `tests/coin-selector.test.ts`
- Modify: `tests/company-points.test.ts`

- [ ] **Шаг 1: Написать падающий тест на разбор селектора**

Создать `tests/coin-selector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { coinPaymentTags, parseCoinSelector } from "@/lib/crypto-map";

describe("parseCoinSelector", () => {
  it("defaults to bitcoin when the param is missing or blank", () => {
    expect(parseCoinSelector(null)).toEqual({ kind: "coin", coinId: "bitcoin" });
    expect(parseCoinSelector("  ")).toEqual({ kind: "coin", coinId: "bitcoin" });
  });

  it("treats a plain value as a lowercased CoinGecko id", () => {
    expect(parseCoinSelector("Bitcoin-Cash")).toEqual({ kind: "coin", coinId: "bitcoin-cash" });
  });

  it("reads card:<cuid> as a self-listed card", () => {
    expect(parseCoinSelector("card:clz1abc234def567")).toEqual({
      kind: "card",
      cardId: "clz1abc234def567",
    });
  });

  it("never falls back to a coin when the prefix says card — a junk id matches nothing", () => {
    expect(parseCoinSelector("card:")).toEqual({ kind: "card", cardId: "" });
    expect(parseCoinSelector("card:../../etc/passwd")).toEqual({ kind: "card", cardId: "" });
    expect(parseCoinSelector("CARD:clz1abc234def567")).toEqual({
      kind: "card",
      cardId: "clz1abc234def567",
    });
  });
});

describe("coinPaymentTags", () => {
  it("still resolves known coins and falls back to the generic crypto tag", () => {
    expect(coinPaymentTags("bitcoin", "btc")).toContain("payment:bitcoin");
    expect(coinPaymentTags("taler", "tal")).toEqual(["payment:cryptocurrencies"]);
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-selector.test.ts
```

Ожидается: FAIL, `parseCoinSelector is not a function`.

- [ ] **Шаг 3: Добавить селектор в `src/lib/crypto-map.ts`**

Заменить существующую функцию `coinPaymentTags` и добавить селектор — то есть
привести конец блока с тегами (сразу после объявления `SYMBOL_TO_ID`) к виду:

```ts
/** Общий крипто-тег OSM: всё, что мы не знаем по имени, и любой свой листинг. */
export const GENERIC_CRYPTO_TAGS = ["payment:cryptocurrencies"];

export function coinPaymentTags(coinId: string, symbol: string): string[] {
  const byId = COIN_TAGS[coinId.toLowerCase()];
  if (byId) return byId;
  const id = SYMBOL_TO_ID[symbol.toLowerCase()];
  if (id && COIN_TAGS[id]) return COIN_TAGS[id];
  return [...GENERIC_CRYPTO_TAGS];
}

/**
 * Что выбрано в навигаторе: монета из фида CoinGecko или собственная карточка.
 * Карточки живут в отдельном пространстве id (CoinCard.id — cuid), поэтому в
 * query-параметре они приходят с префиксом `card:`.
 */
export type CoinSelector =
  | { kind: "coin"; coinId: string }
  | { kind: "card"; cardId: string };

const CUID_RE = /^[a-z0-9]{10,40}$/i;

export function parseCoinSelector(raw: string | null | undefined): CoinSelector {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "coin", coinId: "bitcoin" };
  if (s.toLowerCase().startsWith("card:")) {
    const cardId = s.slice("card:".length).trim();
    // Мусорный id не подменяется биткоином: показать «не та монета» хуже, чем
    // показать пусто. Пустой cardId ни с чем не совпадёт в запросе.
    return { kind: "card", cardId: CUID_RE.test(cardId) ? cardId : "" };
  }
  return { kind: "coin", coinId: s.toLowerCase() };
}
```

- [ ] **Шаг 4: Запустить тест селектора, убедиться что проходит**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-selector.test.ts
```

Ожидается: PASS, 6 тестов.

- [ ] **Шаг 5: Написать падающий тест на фильтр точек**

В `tests/company-points.test.ts` заменить верхнюю часть файла (импорт, фикстуру
`row` и блок `describe("companyPointToPoi", …)`) на:

```ts
import { describe, expect, it } from "vitest";
import { companyPointToPoi } from "@/lib/company-points";
import type { CoinSelector } from "@/lib/crypto-map";

const BTC: CoinSelector = { kind: "coin", coinId: "bitcoin" };
const ETH: CoinSelector = { kind: "coin", coinId: "ethereum" };
const CARD: CoinSelector = { kind: "card", cardId: "clz1abc234def567" };

const row = {
  id: "ckpoint1", type: "ATM", name: "BTC ATM", description: null,
  lat: 50.08, lon: 14.42, address: "Main St", acceptedCoinIds: ["bitcoin"],
  acceptedCardIds: ["clz1abc234def567"],
  logoUrl: "https://x/y.png", openingHours: "24/7", phone: null, website: null,
  socials: [{ network: "telegram", url: "https://t.me/x" }],
  company: { displayName: "ACME", logoUrl: "https://x/c.png", website: "https://acme.co", socials: null },
};

describe("companyPointToPoi", () => {
  it("maps an ATM point to an atm-layer Poi with a company id prefix", () => {
    const p = companyPointToPoi(row as never, BTC);
    expect(p.id).toBe("company/ckpoint1");
    expect(p.layer).toBe("atm");
    expect(p.lat).toBe(50.08);
    expect(p.coinSpecific).toBe(true);
    expect(p.image).toBe("https://x/y.png");
    expect(p.socials).toEqual([{ network: "telegram", url: "https://t.me/x" }]);
  });
  it("maps SHOP/POS/SALES_OFFICE to the merchant layer and reads coinSpecific per coin", () => {
    expect(companyPointToPoi({ ...row, type: "SHOP" } as never, ETH).layer).toBe("merchant");
    expect(companyPointToPoi({ ...row, type: "POS" } as never, ETH).coinSpecific).toBe(false);
  });
  it("reads coinSpecific from acceptedCardIds when a self-listed card is selected", () => {
    expect(companyPointToPoi(row as never, CARD).coinSpecific).toBe(true);
    expect(companyPointToPoi({ ...row, acceptedCardIds: [] } as never, CARD).coinSpecific).toBe(false);
  });
  it("never marks a point card-specific just because the coin id matches", () => {
    const p = companyPointToPoi({ ...row, acceptedCardIds: [] } as never, { kind: "card", cardId: "bitcoin" });
    expect(p.coinSpecific).toBe(false);
  });
  it("survives a legacy row with no acceptedCardIds column value", () => {
    const legacy = { ...row } as Record<string, unknown>;
    delete legacy.acceptedCardIds;
    expect(companyPointToPoi(legacy as never, CARD).coinSpecific).toBe(false);
  });
  it("falls back to the company logo + website when the point has none", () => {
    const p = companyPointToPoi({ ...row, logoUrl: null, website: null } as never, BTC);
    expect(p.image).toBe("https://x/c.png");
    expect(p.website).toBe("https://acme.co");
  });
```

Дальше в файле остаётся существующий тест `it("drops socials with non-http(s) urls (XSS guard)", …)` и всё,
что за ним; внутри него вызов `companyPointToPoi(dirty as never, "bitcoin")` заменить на
`companyPointToPoi(dirty as never, BTC)`.

- [ ] **Шаг 6: Запустить, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/company-points.test.ts
```

Ожидается: FAIL — `coinSpecific` приходит `false`/`undefined` там, где тест ждёт карточку.

- [ ] **Шаг 7: Перевести `company-points.ts` на селектор**

В `src/lib/company-points.ts`:

1. В импорты добавить тип:

```ts
import type { Bbox, CoinSelector, Poi, PoiLayer, Social } from "@/lib/crypto-map";
```

2. Заменить сигнатуру и тело `coinSpecific` в `companyPointToPoi`:

```ts
export function companyPointToPoi(p: PointWithCompany, selector: CoinSelector): Poi {
```

и строку

```ts
    coinSpecific: p.acceptedCoinIds.includes(coinId.toLowerCase()),
```

на

```ts
    // Своя карточка и монета CoinGecko живут в разных пространствах id, поэтому
    // сверяются с разными массивами и никогда не путаются между собой.
    coinSpecific:
      selector.kind === "card"
        ? (p.acceptedCardIds ?? []).includes(selector.cardId)
        : (p.acceptedCoinIds ?? []).includes(selector.coinId.toLowerCase()),
```

3. Заменить `fetchApprovedPointsInBbox` целиком:

```ts
// Approved company points whose coordinates fall inside the viewport bbox.
// Defense-in-depth: the parent Company must also be APPROVED — a rejected company
// shouldn't leak its previously-approved points onto the public map.
//
// В режиме карточки фид дополнительно фильтруется по acceptedCardIds: для своего
// листинга «все точки с флажком» бесполезны — его принимают единицы.
export async function fetchApprovedPointsInBbox(
  bbox: Bbox,
  selector: CoinSelector,
): Promise<Poi[]> {
  const rows = await prisma.companyPoint.findMany({
    where: {
      status: "APPROVED",
      company: { status: "APPROVED" },
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lon: { gte: bbox.minLon, lte: bbox.maxLon },
      ...(selector.kind === "card"
        ? { acceptedCardIds: { has: selector.cardId } }
        : {}),
    },
    take: 500,
    include: {
      company: {
        select: {
          displayName: true, logoUrl: true, website: true, socials: true,
          description: true, email: true, phone: true,
        },
      },
    },
  });
  return rows.map((r) => companyPointToPoi(r, selector));
}
```

- [ ] **Шаг 8: Прокинуть селектор в роут POI-фида**

Заменить `src/app/api/crypto-map/poi/route.ts` целиком:

```ts
import { NextResponse } from "next/server";
import {
  GENERIC_CRYPTO_TAGS,
  coinPaymentTags,
  parseBbox,
  parseCoinSelector,
  type Poi,
} from "@/lib/crypto-map";
import { fetchOsmPoisInBbox } from "@/lib/osm-poi-store";
import { fetchApprovedPointsInBbox } from "@/lib/company-points";
import { fetchApprovedFintechHqInBbox } from "@/lib/fintech-pois";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bboxParam = url.searchParams.get("bbox");
  const selector = parseCoinSelector(url.searchParams.get("coin"));
  const symbol = url.searchParams.get("symbol") ?? "btc";

  const bbox = parseBbox(bboxParam);
  if (!bbox) return NextResponse.json({ error: "invalid bbox" }, { status: 400 });

  // В зеркале BTC Map собственных карточек заведомо нет, и притворяться, что
  // есть, нельзя: для карточки берём общий крипто-тег, а фильтр по карточке
  // применяем только к нашим точкам.
  const coinTags =
    selector.kind === "card"
      ? [...GENERIC_CRYPTO_TAGS]
      : coinPaymentTags(selector.coinId, symbol);

  // OSM points come from our own nightly BTC Map mirror rather than a live
  // Overpass query, so a saturated upstream can't blank the map mid-request.
  // No Redis layer: the bbox lookup is an indexed read, and skipping the cache
  // means an overnight sync is visible immediately.
  let osm: Poi[] = [];
  try {
    osm = await fetchOsmPoisInBbox(bbox, coinTags);
  } catch {
    // DB hiccup — still merge the company and fintech layers below.
  }

  let company: Poi[] = [];
  try {
    company = await fetchApprovedPointsInBbox(bbox, selector);
  } catch {
    // DB hiccup — degrade to OSM only.
  }

  let fintech: Poi[] = [];
  try {
    fintech = await fetchApprovedFintechHqInBbox(bbox);
  } catch {
    // DB hiccup — degrade silently.
  }

  return NextResponse.json({ pois: [...fintech, ...company, ...osm] });
}
```

- [ ] **Шаг 9: Запустить тесты и тайпчек**

```bash
cd /home/dv/trientes && npx vitest run tests/company-points.test.ts tests/coin-selector.test.ts && npx tsc --noEmit
```

Ожидается: PASS по обоим файлам, `tsc` без ошибок.

- [ ] **Шаг 10: Коммит**

```bash
cd /home/dv/trientes && git add src/lib/crypto-map.ts src/lib/company-points.ts src/app/api/crypto-map/poi/route.ts tests/coin-selector.test.ts tests/company-points.test.ts && git commit -m "feat(crypto-map): POI-фид понимает coin=card:<id> и фильтрует свои точки по карточке"
```

---

## Задача 4: Форма точки принимает собственные листинги

**Files:**
- Modify: `src/lib/company.ts`
- Modify: `src/app/actions/company.ts`
- Modify: `src/components/business/point-form.tsx`
- Modify: `tests/company.test.ts`

- [ ] **Шаг 1: Написать падающий тест валидации**

В конец `tests/company.test.ts` добавить:

```ts
describe("validateCompanyPoint — собственные листинги", () => {
  const base = { type: "SHOP", name: "Shop", lat: 50.08, lon: 14.42 };

  it("keeps card ids verbatim — a cuid is case-sensitive, unlike a CoinGecko id", () => {
    const r = validateCompanyPoint({ ...base, acceptedCardIds: ["clzABC234def567"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.acceptedCardIds).toEqual(["clzABC234def567"]);
  });

  it("defaults to an empty array and drops blanks and duplicates", () => {
    const empty = validateCompanyPoint(base);
    expect(empty.ok && empty.data.acceptedCardIds).toEqual([]);
    const r = validateCompanyPoint({
      ...base,
      acceptedCardIds: [" clz1abc234def567 ", "clz1abc234def567", "", "   "],
    });
    expect(r.ok && r.data.acceptedCardIds).toEqual(["clz1abc234def567"]);
  });

  it("still lowercases CoinGecko ids, which are case-insensitive by convention", () => {
    const r = validateCompanyPoint({ ...base, acceptedCoinIds: ["Bitcoin"] });
    expect(r.ok && r.data.acceptedCoinIds).toEqual(["bitcoin"]);
  });

  it("caps the card list so one point cannot claim the whole catalogue", () => {
    const many = Array.from({ length: MAX_ACCEPTED_CARDS + 10 }, (_, i) => `clz1abc234def${i}`);
    const r = validateCompanyPoint({ ...base, acceptedCardIds: many });
    expect(r.ok && r.data.acceptedCardIds.length).toBe(MAX_ACCEPTED_CARDS);
  });
});
```

В начале файла дополнить импорт из `@/lib/company` так, чтобы в нём были
`validateCompanyPoint` и `MAX_ACCEPTED_CARDS` (`describe/expect/it` там уже импортированы).

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/company.test.ts
```

Ожидается: FAIL — `MAX_ACCEPTED_CARDS` не экспортируется.

- [ ] **Шаг 3: Добавить поле в валидацию `src/lib/company.ts`**

1. Рядом с `const POINT_TYPES` добавить:

```ts
/** Потолок на точку: больше — это уже не «что я принимаю», а спам каталогом. */
export const MAX_ACCEPTED_CARDS = 50;
```

2. В тип `CompanyPointInput` после `acceptedCoinIds?: string[] | null;` добавить:

```ts
  acceptedCardIds?: string[] | null;
```

3. В тип `ValidatedPoint` в строке с `acceptedCoinIds: string[];` добавить рядом:

```ts
  acceptedCardIds: string[];
```

4. В `validateCompanyPoint`, сразу после блока, вычисляющего `acceptedCoinIds`, добавить:

```ts
  // Id карточки — это cuid, регистр значащий. В отличие от id CoinGecko его
  // нельзя приводить к нижнему регистру: ссылка перестанет совпадать.
  const acceptedCardIds = Array.from(
    new Set((input.acceptedCardIds ?? []).map((c) => String(c).trim()).filter(Boolean)),
  ).slice(0, MAX_ACCEPTED_CARDS);
```

5. В возвращаемом объекте `data` заменить `acceptedCoinIds, logoUrl,` на:

```ts
      acceptedCoinIds, acceptedCardIds, logoUrl,
```

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
cd /home/dv/trientes && npx vitest run tests/company.test.ts
```

Ожидается: PASS.

- [ ] **Шаг 5: Проверять одобренность карточки в серверном действии**

В `src/app/actions/company.ts`, в `submitCompanyPoint`, сразу после блока
проверки лимита `MAX_PENDING_POINTS` (`if (pending >= MAX_PENDING_POINTS) …`) добавить:

```ts
  // Заявить приём можно только одобренной карточки: иначе точка указывала бы
  // на листинг, которого публично не существует.
  if (v.data.acceptedCardIds.length > 0) {
    const approved = await prisma.coinCard.count({
      where: { id: { in: v.data.acceptedCardIds }, status: "APPROVED" },
    });
    if (approved !== v.data.acceptedCardIds.length) {
      return { ok: false as const, reason: "coin_not_selectable" as const };
    }
  }
```

и в объекте `data:` вызова `prisma.companyPoint.create` после строки
`acceptedCoinIds: v.data.acceptedCoinIds,` добавить:

```ts
      acceptedCardIds: v.data.acceptedCardIds,
```

- [ ] **Шаг 6: Научить форму показывать свои листинги**

В `src/components/business/point-form.tsx`:

1. После объявления типа `PointFormCoin` добавить:

```ts
/** Одобренный собственный листинг — у него нет id CoinGecko, только CoinCard.id. */
export type PointFormCard = { id: string; symbol: string; name: string; logoUrl: string | null };
```

2. Расширить пропсы компонента:

```tsx
export function PointForm({
  companyId,
  coins,
  cards,
  initialCardIds = [],
  companyAddress,
}: {
  companyId: string;
  coins: PointFormCoin[];
  cards: PointFormCard[];
  initialCardIds?: string[];
  companyAddress: Addr;
}) {
```

3. Рядом с `const [accepted, setAccepted] = useState<string[]>([]);` добавить:

```tsx
  const [acceptedCards, setAcceptedCards] = useState<string[]>(initialCardIds);
```

4. В `save()` в объект, передаваемый в `submitCompanyPoint`, добавить
`acceptedCardIds: acceptedCards`, то есть первый аргумент payload становится:

```tsx
      const res = await submitCompanyPoint(companyId, {
        type, name, ...addr, lat: pos?.[1] ?? null, lon: pos?.[0] ?? null,
        acceptedCoinIds: accepted, acceptedCardIds: acceptedCards,
        photos,
      });
```

а в ветке успеха, рядом с `setAccepted([])`, добавить `setAcceptedCards([]);`.

5. Сразу после существующего блока с чипами монет (закрывающий `</div>` списка
`coins.map(...)`) добавить блок карточек:

```tsx
      {cards.length > 0 && (
        <>
          <div className="text-[12px] text-muted">{t("ownListing")}:</div>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {cards.map((c) => {
              const on = acceptedCards.includes(c.id);
              return (
                <button key={c.id} type="button" title={c.name}
                  onClick={() => setAcceptedCards((a) => on ? a.filter((x) => x !== c.id) : [...a, c.id])}
                  className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border ${on ? "bg-accent/15 text-accent border-accent/40" : "border-hairline text-muted"}`}>
                  {c.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" width={14} height={14} className="rounded-full" />
                  )}
                  {c.symbol.toUpperCase()}
                </button>
              );
            })}
          </div>
        </>
      )}
```

- [ ] **Шаг 7: Тайпчек**

```bash
cd /home/dv/trientes && npx tsc --noEmit
```

Ожидается: единственные ошибки — в `src/app/[locale]/cabinet/companies/[id]/page.tsx`
(не передан обязательный проп `cards`). Их закрывает Задача 5.

- [ ] **Шаг 8: Коммит**

```bash
cd /home/dv/trientes && git add src/lib/company.ts src/app/actions/company.ts src/components/business/point-form.tsx tests/company.test.ts && git commit -m "feat(business): точка может принимать собственный листинг монеты"
```

---

## Задача 5: Кабинет компании — карточки в форме, префилл и якоря

**Files:**
- Modify: `src/app/[locale]/cabinet/companies/[id]/page.tsx`

- [ ] **Шаг 1: Прочитать карточки и `?card=`**

В `src/app/[locale]/cabinet/companies/[id]/page.tsx`:

1. В импорты добавить:

```ts
import { listSelfListedCards } from "@/lib/coin-card-directory";
```

2. Заменить сигнатуру компонента и первые строки на:

```tsx
export default async function CompanyManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { locale, id } = await params;
  const { card: cardParam } = await searchParams;
```

3. Заменить блок `const [points, coins] = await Promise.all([…])` на:

```tsx
  const [points, coins, cards] = await Promise.all([
    prisma.companyPoint.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    readTop100(),
    // Все одобренные собственные листинги — их пока десятки, не сотни.
    listSelfListedCards(200),
  ]);
```

4. После строки `const coinOpts = coins.map(…)` добавить:

```tsx
  const cardOpts = cards.map((c) => ({
    id: c.id, symbol: c.symbol, name: c.name, logoUrl: c.logoUrl,
  }));
  // Префилл приходит по ссылке с карточки монеты. Непонятный id молча
  // игнорируется — иначе кнопка «я принимаю» могла бы проставить что угодно.
  const prefillCards = cardParam && cardOpts.some((c) => c.id === cardParam) ? [cardParam] : [];
```

- [ ] **Шаг 2: Передать в форму и расставить якоря**

1. Секцию «ваши точки» сделать целью ссылки `#your-points`:

```tsx
      <section id="your-points" className="scroll-mt-24">
        <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("yourPoints")}</h2>
        <PointsList points={items} />
      </section>
```

2. Секцию добавления точки — целью `#add-point`, и передать карточки:

```tsx
      {editable ? (
        <section id="add-point" className="scroll-mt-24">
          <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">{t("addPoint")}</h2>
          <PointForm
            companyId={company.id}
            coins={coinOpts}
            cards={cardOpts}
            initialCardIds={prefillCards}
            companyAddress={{
              countryCode: company.countryCode ?? "",
              city: company.city ?? "",
              street: company.street ?? "",
              houseNumber: company.houseNumber ?? "",
              postalCode: company.postalCode ?? "",
            }}
          />
        </section>
      ) : null}
```

- [ ] **Шаг 3: Тайпчек**

```bash
cd /home/dv/trientes && npx tsc --noEmit
```

Ожидается: без ошибок.

- [ ] **Шаг 4: Коммит**

```bash
cd /home/dv/trientes && git add "src/app/[locale]/cabinet/companies/[id]/page.tsx" && git commit -m "feat(cabinet): свои листинги в форме точки, префилл по ?card= и якоря разделов"
```

---

## Задача 6: Кнопка продавца «Я принимаю эту монету»

**Files:**
- Create: `src/lib/coin-card-merchant-cta.ts`
- Test: `tests/coin-card-merchant-cta.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/coin-card-merchant-cta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ctaHref, type MerchantCta } from "@/lib/coin-card-merchant-cta";

const ctx = { locale: "ru", slug: "taler", cardId: "clz1abc234def567" };

describe("ctaHref", () => {
  it("sends a guest to login and brings them back to the acceptance section", () => {
    const href = ctaHref({ kind: "login" }, ctx);
    expect(href).toBe("/ru/login?next=%2Fru%2Fcoin%2Ftaler%23acceptance");
  });

  it("sends an individual with no company to the business cabinet", () => {
    expect(ctaHref({ kind: "register_company" }, ctx)).toBe("/ru/business");
  });

  it("opens the point form with the card preselected (query first, fragment last)", () => {
    const cta: MerchantCta = { kind: "add_point", companyId: "cmp1" };
    expect(ctaHref(cta, ctx)).toBe("/ru/cabinet/companies/cmp1?card=clz1abc234def567#add-point");
  });

  it("sends an existing merchant to their own points", () => {
    const cta: MerchantCta = { kind: "already", companyId: "cmp1", points: 3 };
    expect(ctaHref(cta, ctx)).toBe("/ru/cabinet/companies/cmp1#your-points");
  });

  it("escapes a slug that would otherwise break out of the next= param", () => {
    const href = ctaHref({ kind: "login" }, { ...ctx, slug: "a b/c?d" });
    expect(href).toBe("/ru/login?next=%2Fru%2Fcoin%2Fa%20b%2Fc%3Fd%23acceptance");
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-merchant-cta.test.ts
```

Ожидается: FAIL, `Failed to resolve import "@/lib/coin-card-merchant-cta"`.

- [ ] **Шаг 3: Написать модуль**

Создать `src/lib/coin-card-merchant-cta.ts`:

```ts
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Состояние посетителя карточки с точки зрения «могу ли я заявить приём».
 * Замкнутый цикл спеки F: карточка приводит продавца → продавец заводит точку
 * → точка делает карточку ценнее. Поэтому кнопка живёт на карточке, а не в
 * глубине кабинета.
 */
export type MerchantCta =
  | { kind: "login" }
  | { kind: "register_company" }
  | { kind: "add_point"; companyId: string }
  | { kind: "already"; companyId: string; points: number };

export type CtaContext = { locale: string; slug: string; cardId: string };

/** Чистая часть: куда ведёт кнопка в каждом состоянии. */
export function ctaHref(cta: MerchantCta, ctx: CtaContext): string {
  const { locale, slug, cardId } = ctx;
  switch (cta.kind) {
    case "login": {
      const next = `/${locale}/coin/${slug}#acceptance`;
      return `/${locale}/login?next=${encodeURIComponent(next)}`;
    }
    case "register_company":
      return `/${locale}/business`;
    case "add_point":
      // Спека рисует "#add-point?card=…", но фрагмент в URL всегда последний.
      return `/${locale}/cabinet/companies/${cta.companyId}?card=${encodeURIComponent(cardId)}#add-point`;
    case "already":
      return `/${locale}/cabinet/companies/${cta.companyId}#your-points`;
  }
}

/**
 * Запросная часть. Без кеша — состояние зависит от сессии, а число точек
 * должно обновляться сразу после одобрения модератором.
 */
export async function getMerchantCta(cardId: string): Promise<MerchantCta> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!userId) return { kind: "login" };

  // Права на точки даёт членство, а не Company.ownerUserId (командные аккаунты).
  const membership = await prisma.companyMember.findFirst({
    where: { userId, role: { in: ["OWNER", "EDITOR"] } },
    orderBy: { createdAt: "asc" },
    select: { companyId: true },
  });
  if (!membership) return { kind: "register_company" };

  const points = await prisma.companyPoint.count({
    where: { companyId: membership.companyId, acceptedCardIds: { has: cardId } },
  });
  if (points > 0) return { kind: "already", companyId: membership.companyId, points };
  return { kind: "add_point", companyId: membership.companyId };
}
```

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-merchant-cta.test.ts
```

Ожидается: PASS, 5 тестов.

- [ ] **Шаг 5: Коммит**

```bash
cd /home/dv/trientes && git add src/lib/coin-card-merchant-cta.ts tests/coin-card-merchant-cta.test.ts && git commit -m "feat(coin-card): состояние продавца и ссылки кнопки «я принимаю»"
```

---

## Задача 7: Страница навигатора `/{locale}/crypto-map`

**Files:**
- Create: `src/app/[locale]/crypto-map/page.tsx`

- [ ] **Шаг 1: Прочитать документацию Next про searchParams страницы**

```bash
cd /home/dv/trientes && sed -n '1,80p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
```

Убедиться, что `params` и `searchParams` — промисы (в этой версии Next это так,
как и на остальных страницах проекта).

- [ ] **Шаг 2: Создать страницу**

Создать `src/app/[locale]/crypto-map/page.tsx`:

```tsx
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { parseCoinSelector } from "@/lib/crypto-map";
import { CryptoMapSection } from "@/components/coin-detail/crypto-map-section";

// Фид точек считается на запрос: одобренная точка должна появляться сразу.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "cryptoMap" });
  // Страница — срез фида по выбранной монете, самостоятельной ценности для
  // индекса у неё нет; канонический адрес остаётся у карточки монеты.
  return { title: t("title"), robots: { index: false, follow: true } };
}

/**
 * Полноэкранный навигатор. До слайса F карта жила только секцией внутри
 * страницы монеты, но кнопка «открыть на карте» с карточки должна вести по
 * ссылке, которую можно переслать: /{locale}/crypto-map?coin=card:<id>.
 */
export default async function CryptoMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ coin?: string }>;
}) {
  const { locale } = await params;
  const { coin } = await searchParams;
  setRequestLocale(locale);

  const selector = parseCoinSelector(coin);
  let coinId = "bitcoin";
  let symbol = "btc";
  let coinName = "Bitcoin";

  if (selector.kind === "card") {
    const card = selector.cardId
      ? await prisma.coinCard.findFirst({
          where: { id: selector.cardId, status: "APPROVED" },
          select: { id: true, name: true, symbol: true },
        })
      : null;
    // Неизвестная или неодобренная карточка не подменяется биткоином молча:
    // фильтр остаётся карточным и карта честно покажет пусто.
    coinId = `card:${selector.cardId}`;
    symbol = card?.symbol ?? "";
    coinName = card?.name ?? "";
  } else {
    const c = await prisma.coin.findFirst({
      where: { OR: [{ id: selector.coinId }, { slug: selector.coinId }] },
      select: { id: true, name: true, symbol: true },
    });
    if (c) {
      coinId = c.id;
      symbol = c.symbol;
      coinName = c.name;
    }
  }

  return (
    <main className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 space-y-6">
      <CryptoMapSection coinId={coinId} symbol={symbol} coinName={coinName} />
    </main>
  );
}
```

- [ ] **Шаг 3: Тайпчек**

```bash
cd /home/dv/trientes && npx tsc --noEmit
```

Ожидается: без ошибок.

- [ ] **Шаг 4: Коммит**

```bash
cd /home/dv/trientes && git add "src/app/[locale]/crypto-map/page.tsx" && git commit -m "feat(crypto-map): отдельная страница навигатора с фильтром по монете или карточке"
```

---

## Задача 8: Виджет-бейдж `badge.svg`

**Files:**
- Create: `src/lib/coin-card-badge.ts`
- Create: `src/app/[locale]/coin/[slug]/badge.svg/route.ts`
- Test: `tests/coin-card-badge.test.ts`

- [ ] **Шаг 1: Написать падающий тест**

Создать `tests/coin-card-badge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BADGE_HEIGHT, buildAcceptBadgeSvg, escapeXml } from "@/lib/coin-card-badge";

describe("escapeXml", () => {
  it("escapes every character that could close a tag or an attribute", () => {
    expect(escapeXml(`<a href="x" & 'y'>`)).toBe(
      "&lt;a href=&quot;x&quot; &amp; &apos;y&apos;&gt;",
    );
  });
});

describe("buildAcceptBadgeSvg", () => {
  it("renders a self-contained svg with the label and the symbol", () => {
    const svg = buildAcceptBadgeSvg({ label: "Принимаем", symbol: "TAL" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`height="${BADGE_HEIGHT}"`);
    expect(svg).toContain("Принимаем TAL");
    expect(svg).toContain("trientes.org");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>");
  });

  it("never lets a hostile symbol inject markup", () => {
    const svg = buildAcceptBadgeSvg({ label: "Accepted here", symbol: `</text><script>x</script>` });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;/text&gt;");
  });

  it("widens with the text instead of clipping it", () => {
    const narrow = buildAcceptBadgeSvg({ label: "We take", symbol: "TAL" });
    const wide = buildAcceptBadgeSvg({ label: "We proudly accept", symbol: "LONGSYMBOL" });
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)?.[1]);
    expect(w(wide)).toBeGreaterThan(w(narrow));
  });

  it("uppercases the symbol and collapses whitespace in the label", () => {
    const svg = buildAcceptBadgeSvg({ label: "  Принимаем \n тут ", symbol: " tal " });
    expect(svg).toContain("Принимаем тут TAL");
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться что падает**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-badge.test.ts
```

Ожидается: FAIL, `Failed to resolve import "@/lib/coin-card-badge"`.

- [ ] **Шаг 3: Написать билдер**

Создать `src/lib/coin-card-badge.ts`:

```ts
// Бейдж для чужого сайта: статичный SVG без скриптов, без внешних ссылок на
// шрифты и без какой-либо телеметрии — это не наша страница.
// Цвета взяты из токенов темы (src/app/globals.css), новый визуальный язык
// не изобретается.

const BG = "#161616";
const HAIRLINE = "#2a2932";
const FG = "#ffffff";
const MUTED = "#a09baa";
const ACCENT = "#fe5c04";

export const BADGE_HEIGHT = 36;
const PAD = 12;
const DOT = 7;
const GAP = 8;
/** Средняя ширина символа при font-size 13 в системном sans. Шрифта в SVG нет,
 *  поэтому ширину считаем приближённо и с запасом — обрезать текст нельзя. */
const CHAR_W = 7.1;
const SITE = "trientes.org";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function buildAcceptBadgeSvg({
  label,
  symbol,
}: {
  label: string;
  symbol: string;
}): string {
  const text = `${collapse(label)} ${collapse(symbol).toUpperCase()}`.trim();
  const textW = Math.ceil(text.length * CHAR_W);
  const siteW = Math.ceil(SITE.length * (CHAR_W - 1));
  const width = PAD + DOT + GAP + textW + GAP + siteW + PAD;
  const dotX = PAD;
  const textX = PAD + DOT + GAP;
  const siteX = textX + textW + GAP;
  const mid = BADGE_HEIGHT / 2;
  const title = escapeXml(`${text} · ${SITE}`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${BADGE_HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${BADGE_HEIGHT - 1}" rx="8" ` +
    `fill="${BG}" stroke="${HAIRLINE}"/>` +
    `<circle cx="${dotX + DOT / 2}" cy="${mid}" r="${DOT / 2}" fill="${ACCENT}"/>` +
    `<text x="${textX}" y="${mid}" dominant-baseline="central" fill="${FG}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="13" ` +
    `font-weight="600">${escapeXml(text)}</text>` +
    `<text x="${siteX}" y="${mid}" dominant-baseline="central" fill="${MUTED}" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12">` +
    `${SITE}</text>` +
    `</svg>`
  );
}
```

- [ ] **Шаг 4: Запустить тест, убедиться что проходит**

```bash
cd /home/dv/trientes && npx vitest run tests/coin-card-badge.test.ts
```

Ожидается: PASS, 5 тестов.

- [ ] **Шаг 5: Создать роут**

Создать `src/app/[locale]/coin/[slug]/badge.svg/route.ts`:

```ts
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { buildAcceptBadgeSvg } from "@/lib/coin-card-badge";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
) {
  const { locale, slug } = await params;

  // Бейдж есть и у собственного листинга, и у обычной монеты — ставят его на
  // свой сайт продавцы, а не только проекты.
  const card = await prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED" },
    select: { symbol: true },
  });
  const symbol =
    card?.symbol ??
    (await prisma.coin.findUnique({ where: { slug }, select: { symbol: true } }))?.symbol ??
    null;
  if (!symbol) return new Response("not found", { status: 404 });

  const t = await getTranslations({ locale, namespace: "coinCard.acceptance" });
  const svg = buildAcceptBadgeSvg({ label: t("badgeLabel"), symbol });

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
```

- [ ] **Шаг 6: Коммит**

```bash
cd /home/dv/trientes && git add src/lib/coin-card-badge.ts "src/app/[locale]/coin/[slug]/badge.svg" tests/coin-card-badge.test.ts && git commit -m "feat(coin-card): виджет-бейдж badge.svg для сайта продавца"
```

---

## Задача 9: Ключи переводов

**Files:**
- Modify: `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json`

Секция рендерится в Задаче 10 и падает на отсутствующем ключе, поэтому переводы идут раньше.

- [ ] **Шаг 1: Добавить ключи в `messages/ru.json`**

В объект `coinCard` добавить `acceptance` (рядом с существующим `provenance`), а в
`coinCard.sections` — ключ `acceptance`:

```json
    "sections": {
      "acceptance": "Где принимается"
    },
    "acceptance": {
      "eyebrow": "Реальный сектор",
      "source": "по базе Trientes",
      "points": "Точек приёма",
      "countries": "Стран",
      "byType": "По типу",
      "topCountries": "Страны",
      "nearby": "Где именно",
      "openMap": "Открыть на карте",
      "zero": "Эту монету пока нигде не принимают.",
      "zeroHint": "Если вы принимаете её у себя — станьте первым: точка появится здесь и на карте после проверки модератором.",
      "iAccept": "Я принимаю эту монету",
      "becomeFirst": "Стать первым",
      "loginToAccept": "Войдите, чтобы заявить приём",
      "registerCompany": "Зарегистрировать компанию",
      "youAccept": "Вы принимаете эту монету в своих точках: {points}",
      "managePoints": "Управлять точками",
      "badgeTitle": "Бейдж для вашего сайта",
      "badgeHint": "Вставьте этот код. Бейдж обновляется сам, телеметрии в нём нет.",
      "badgeLabel": "Принимаем",
      "badgeAlt": "Принимаем {symbol}"
    }
```

(ключ `sections.acceptance` добавляется в уже существующий объект `sections`, не
заменяет его.)

В объект `business` добавить `ownListing` и ключ ошибки:

```json
    "ownListing": "Свой листинг",
    "err": {
      "coin_not_selectable": "Эта карточка монеты не одобрена — указать её нельзя."
    }
```

(`err` тоже уже существует — добавляется один ключ внутрь него.)

- [ ] **Шаг 2: Добавить те же ключи в `messages/en.json`**

```json
    "sections": {
      "acceptance": "Where it is accepted"
    },
    "acceptance": {
      "eyebrow": "Real economy",
      "source": "from the Trientes database",
      "points": "Accepting locations",
      "countries": "Countries",
      "byType": "By type",
      "topCountries": "Countries",
      "nearby": "Exactly where",
      "openMap": "Open on the map",
      "zero": "Nobody accepts this coin yet.",
      "zeroHint": "If you take it at your own business, be the first: your location shows up here and on the map once a moderator approves it.",
      "iAccept": "I accept this coin",
      "becomeFirst": "Be the first",
      "loginToAccept": "Sign in to claim acceptance",
      "registerCompany": "Register a company",
      "youAccept": "You accept this coin at your locations: {points}",
      "managePoints": "Manage locations",
      "badgeTitle": "Badge for your site",
      "badgeHint": "Paste this snippet. The badge updates itself and carries no telemetry.",
      "badgeLabel": "We accept",
      "badgeAlt": "We accept {symbol}"
    }
```

```json
    "ownListing": "Self-listed",
    "err": {
      "coin_not_selectable": "This coin card is not approved, so it cannot be selected."
    }
```

- [ ] **Шаг 3: Перевести тот же набор в остальные 8 локалей**

`messages/{de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — те же ключи с тем же набором
плейсхолдеров (`{points}`, `{symbol}`), в тоне уже существующих переводов файла.
Числа и единицы не склоняются нигде: счётчик — пара «ярлык: число», плюралов нет.

- [ ] **Шаг 4: Проверить паритет ключей по всем десяти файлам**

```bash
cd /home/dv/trientes && python3 - <<'PY'
import json, sys
need_card = ["eyebrow","source","points","countries","byType","topCountries","nearby",
             "openMap","zero","zeroHint","iAccept","becomeFirst","loginToAccept",
             "registerCompany","youAccept","managePoints","badgeTitle","badgeHint",
             "badgeLabel","badgeAlt"]
bad = False
for loc in ["en","ru","de","es","fr","ja","ko","pt-BR","tr","zh-CN"]:
    d = json.load(open(f"messages/{loc}.json"))
    a = d.get("coinCard", {}).get("acceptance", {})
    miss = [k for k in need_card if k not in a]
    if "acceptance" not in d.get("coinCard", {}).get("sections", {}):
        miss.append("sections.acceptance")
    if "ownListing" not in d.get("business", {}):
        miss.append("business.ownListing")
    if "coin_not_selectable" not in d.get("business", {}).get("err", {}):
        miss.append("business.err.coin_not_selectable")
    if miss:
        bad = True
        print(loc, "MISSING:", ", ".join(miss))
print("KEY PARITY OK" if not bad else "KEY PARITY FAILED")
sys.exit(1 if bad else 0)
PY
```

Ожидается: `KEY PARITY OK`.

- [ ] **Шаг 5: Коммит**

```bash
cd /home/dv/trientes && git add messages && git commit -m "i18n: ключи секции приёма карточки монеты во всех десяти локалях"
```

---

## Задача 10: Публичная секция `#acceptance`

**Files:**
- Create: `src/components/coin-card/sections/acceptance-section.tsx`
- Modify: `src/components/coin-card/card-sections.tsx`

- [ ] **Шаг 1: Написать компонент секции**

Создать `src/components/coin-card/sections/acceptance-section.tsx`:

```tsx
import { getLocale, getTranslations } from "next-intl/server";
import { getAcceptanceSummary } from "@/lib/coin-card-acceptance";
import { ctaHref, getMerchantCta } from "@/lib/coin-card-merchant-cta";
import { countryName } from "@/lib/countries";
import { ProvenanceBadge } from "../provenance-badge";

const SITE = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Главный факт карточки для продавца: принимают ли эту монету живьём.
 * Ноль — это ноль: блок не скрывается, а честно говорит «пока нигде» и
 * предлагает стать первым. Скрытый пустой блок читается как обман, когда
 * пользователь найдёт его у другой монеты.
 */
export async function AcceptanceSection({
  cardId,
  slug,
  symbol,
}: {
  cardId: string;
  slug: string;
  symbol: string;
}) {
  const [t, tb, ts, locale] = await Promise.all([
    getTranslations("coinCard.acceptance"),
    getTranslations("business"),
    getTranslations("coinCard.sections"),
    getLocale(),
  ]);
  const [summary, cta] = await Promise.all([
    getAcceptanceSummary(cardId),
    getMerchantCta(cardId),
  ]);

  const href = ctaHref(cta, { locale, slug, cardId });
  const ctaLabel =
    cta.kind === "login" ? t("loginToAccept")
    : cta.kind === "register_company" ? t("registerCompany")
    : cta.kind === "already" ? t("managePoints")
    : summary.total === 0 ? t("becomeFirst")
    : t("iAccept");

  const badgeUrl = `${SITE}/${locale}/coin/${slug}/badge.svg`;
  const cardUrl = `${SITE}/${locale}/coin/${slug}`;
  const snippet =
    `<a href="${cardUrl}"><img src="${badgeUrl}" alt="${t("badgeAlt", { symbol: symbol.toUpperCase() })}"></a>`;

  const chip = "inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md border border-hairline text-muted";

  return (
    <section id="acceptance" className="scroll-mt-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-2">{t("eyebrow")}</div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.025em] mb-4">
        {ts("acceptance")}
      </h2>
      {summary.total === 0 ? (
        <div className="border border-hairline rounded-md p-5 space-y-3">
          <p className="text-[15px]">{t("zero")}</p>
          <p className="text-muted text-[13px] max-w-[620px]">{t("zeroHint")}</p>
          <a href={href} className="inline-block text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground">
            {ctaLabel}
          </a>
        </div>
      ) : (
        <div className="border border-hairline rounded-md p-5 space-y-5">
          <div className="flex flex-wrap gap-8">
            <div>
              <div className="text-[12px] uppercase tracking-[0.15em] text-muted">
                {t("points")}
                <ProvenanceBadge entry={{ kind: "AGGREGATED", source: t("source"), at: new Date().toISOString() }} />
              </div>
              <div className="num text-[28px] font-bold">{summary.total}</div>
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("countries")}</div>
              <div className="num text-[28px] font-bold">{summary.countries}</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("byType")}</div>
            <div className="flex flex-wrap gap-2">
              {summary.byType.map((b) => (
                <span key={b.type} className={chip}>
                  {tb(`type.${b.type}`)} <span className="num text-foreground">{b.count}</span>
                </span>
              ))}
            </div>
          </div>

          {summary.byCountry.length > 0 && (
            <div className="space-y-2">
              <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("topCountries")}</div>
              <div className="flex flex-wrap gap-2">
                {summary.byCountry.map((c) => (
                  <span key={c.code} className={chip}>
                    {countryName(c.code) ?? c.code} <span className="num text-foreground">{c.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("nearby")}</div>
            <ul className="divide-y divide-hairline border-y border-hairline">
              {summary.recent.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/${locale}/crypto-map?coin=${encodeURIComponent(`card:${cardId}`)}`}
                    className="flex items-baseline justify-between gap-4 py-2.5 hover:text-accent"
                  >
                    <span className="text-[14px]">{p.name}</span>
                    <span className="text-[12px] text-muted shrink-0">
                      {[p.city, countryName(p.countryCode) ?? p.countryCode].filter(Boolean).join(", ")}
                      {" · "}
                      {tb(`type.${p.type}`)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/${locale}/crypto-map?coin=${encodeURIComponent(`card:${cardId}`)}`}
              className="inline-block text-[13px] px-4 py-2 rounded-md font-medium bg-accent text-accent-foreground"
            >
              {t("openMap")}
            </a>
            <a href={href} className="inline-block text-[13px] px-4 py-2 rounded-md border border-hairline hover:border-accent">
              {ctaLabel}
            </a>
            {cta.kind === "already" && (
              <span className="text-[13px] text-muted">{t("youAccept", { points: cta.points })}</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 space-y-2">
        <div className="text-[12px] uppercase tracking-[0.15em] text-muted">{t("badgeTitle")}</div>
        <div className="flex flex-wrap items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/${locale}/coin/${slug}/badge.svg`} alt={t("badgeAlt", { symbol: symbol.toUpperCase() })} height={36} />
          <code className="text-[11px] text-muted bg-bg-tint border border-hairline rounded-md px-3 py-2 overflow-x-auto max-w-full">
            {snippet}
          </code>
        </div>
        <p className="text-[12px] text-muted">{t("badgeHint")}</p>
      </div>
    </section>
  );
}
```

- [ ] **Шаг 2: Вставить секцию между «Рынки» и «Безопасность»**

В `src/components/coin-card/card-sections.tsx` добавить импорт

```ts
import { AcceptanceSection } from "./sections/acceptance-section";
```

и строку между `<MarketsSection …/>` и `<SecuritySection …/>`:

```tsx
      <AcceptanceSection cardId={card.id} slug={card.slug} symbol={card.symbol} />
```

- [ ] **Шаг 3: Тайпчек и сборка**

```bash
cd /home/dv/trientes && npx tsc --noEmit && npm run lint
```

Ожидается: без ошибок.

- [ ] **Шаг 4: Проверить на живой карточке**

```bash
cd /home/dv/trientes && npm run build && pm2 restart trientes-web && sleep 5 && curl -s "http://127.0.0.1:3000/ru/coin/taler" | grep -o 'id="acceptance"' | head -1 && curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://127.0.0.1:3000/ru/coin/taler/badge.svg"
```

Ожидается: `id="acceptance"` и `200 image/svg+xml; charset=utf-8`.

- [ ] **Шаг 5: Коммит**

```bash
cd /home/dv/trientes && git add "src/components/coin-card/sections/acceptance-section.tsx" src/components/coin-card/card-sections.tsx && git commit -m "feat(coin-card): публичная секция «Где принимается» со счётчиком, картой и бейджем"
```

---

## Задача 11: Проверка целиком и выкладка

**Files:** нет новых

- [ ] **Шаг 1: Прогнать весь тестовый набор**

```bash
cd /home/dv/trientes && npm test 2>&1 | tail -20
```

Ожидается: все файлы PASS. Если падает что-то вне слайса — починить до выкладки,
а не объявлять «не связано».

- [ ] **Шаг 2: Линт и типы**

```bash
cd /home/dv/trientes && npm run lint && npx tsc --noEmit
```

Ожидается: оба без ошибок.

- [ ] **Шаг 3: Сборка и рестарт**

`src/lib/company-points.ts` и `src/lib/crypto-map.ts` правятся, но воркер их не
импортирует (он гоняет синк BTC Map через `src/lib/btcmap.ts` и `osm-poi-store.ts`
— последний не менялся). Проверить это явно, и если импорт найдётся — перезапустить
и воркер тоже:

```bash
cd /home/dv/trientes && grep -rn "company-points\|coin-card-acceptance\|coin-card-merchant-cta\|coin-card-badge" worker/ || echo "worker clean"
cd /home/dv/trientes && npm run build && pm2 restart trientes-web && pm2 save
```

Ожидается: `worker clean`, затем успешная сборка и `trientes-web` в статусе `online`.

- [ ] **Шаг 4: Проверить сквозной сценарий руками (curl)**

```bash
cd /home/dv/trientes
# 1. Карточка отдаёт секцию приёма и нулевое состояние
curl -s "http://127.0.0.1:3000/ru/coin/taler" | grep -c 'id="acceptance"'
# 2. Страница навигатора открывается с фильтром по карточке
curl -s -o /dev/null -w "crypto-map: %{http_code}\n" "http://127.0.0.1:3000/ru/crypto-map?coin=card:doesnotexist"
# 3. POI-фид в режиме карточки не падает и не отдаёт наши точки чужой монеты
curl -s "http://127.0.0.1:3000/api/crypto-map/poi?bbox=14.3,49.9,14.6,50.2&coin=card:doesnotexist&symbol=tal" | head -c 200; echo
```

Ожидается: `1`, `crypto-map: 200`, и JSON с ключом `pois` (точек компаний в нём
быть не должно — карточки с таким id нет).

- [ ] **Шаг 5: Запушить**

```bash
cd /home/dv/trientes && git push origin main && git log --oneline -8
```

Ожидается: push прошёл, в логе коммиты слайса F1.

---

## Самопроверка плана против спеки

| Требование спеки F1 | Где закрыто |
|---|---|
| `CompanyPoint.acceptedCardIds` + GIN | Задача 1 |
| `FintechCompany.supportedCardIds` + GIN (F3, поле заранее) | Задача 1 |
| Одна аддитивная миграция на весь слайс F (`payments`, `legal`, `PAYMENTS`) | Задача 1 |
| `getAcceptanceSummary(cardId)` → total / byCountry(10) / byType / recent(6) | Задача 2 |
| Только `APPROVED`-точки | Задача 2 (`where.status`, `company.status`) |
| Счётчик без кеша | Задача 2 (без Redis), Задача 7/10 (`force-dynamic` / cookie-зависимая страница) |
| Секция `#acceptance` между «Рынки» и «Безопасность» | Задача 10, шаг 2 |
| Бейдж провенанса `AGGREGATED`, источник «по базе Trientes», дата | Задача 10 (`ProvenanceBadge`) |
| Разбивка по типу ярлыками навигатора (`business.type.*`) | Задача 10 |
| Топ стран | Задача 2 + 10 |
| Шесть точек списком, каждая ведёт на карту | Задача 10 |
| Кнопка «Открыть на карте» → `/{locale}/crypto-map?coin=card:<id>` | Задача 7 + 10 |
| Нулевое состояние «пока нигде не принимают» + стать первым | Задача 10 |
| Кнопка «я принимаю» с четырьмя состояниями посетителя | Задача 6 + 10 |
| `PointForm` = топ-100 + одобренные карточки, помеченные как свой листинг | Задача 4 (`business.ownListing`) |
| Запись в `acceptedCardIds` / `acceptedCoinIds` по типу выбора | Задача 4 |
| POI-фид: `coin=card:<id>` фильтрует только наши точки | Задача 3 |
| Зеркало BTC Map не притворяется, что знает карточки | Задача 3 (`GENERIC_CRYPTO_TAGS`) |
| `badge.svg` + сниппет + `max-age=86400` + без телеметрии | Задача 8 + 10 |
| Ошибка `coin_not_selectable` | Задача 4, шаг 5 |
| Тесты: агрегация (страны, типы, пустой случай, лимит превью) | Задача 2 |
| Тесты: фильтр фида `card:<id>` только по нашим точкам | Задача 3 |
| i18n во всех 10 локалях | Задача 9 |
