# Слайс E — токеномика: проверенный выпуск, капитализация, аллокация, разлоки: план

**Спека:** `docs/superpowers/specs/2026-11-07-coin-card-tokenomics-e-design.md`

**Цель:** циркулирующий выпуск считается из сети (`totalSupply` минус балансы
адресов исключений), капитализация и FDV считаются по индексной цене слайса C, а
аллокация и календарь разлоков появляются в карточке как структурные данные.

## Границы и отклонения

1. Только EVM: `balanceOf` читается через `ethCall` слайса B. Solana/TON — позже.
2. Разлоки вводятся руками; чтение контрактов локеров — отдельный слайс.
3. Капитализация при самозаявленном выпуске показывается с меткой
   `SELF_REPORTED` (решение владельца), а не скрывается.
4. Каталог монет по нашей капитализации не сортируется — он на фиде CoinGecko.
5. Новых зависимостей нет: строковая арифметика деления на `10^decimals`
   пишется сама (нужны только сдвиг точки и обрезка), `BigInt` уже в рантайме.

## Файлы

| Файл | Что |
| ---- | --- |
| `src/lib/coin-card-supply.ts` | новый — `unitsToCoins`, `parseExcluded`, `computeSupply`, `claimedDeltaPct`, `marketCap`, `fdv`, `readSupplyFacts`, `syncCardSupply` |
| `src/lib/coin-card-tokenomics.ts` | новый — `validateAllocation`, `validateUnlocks`, `allocationBars`, `unlockSummary` |
| `src/lib/evm-abi.ts` | `SELECTORS.balanceOf`, `encodeAddressArg(address)` |
| `prisma/schema.prisma` + миграция `20261107190000_coin_card_supply` | модель `CoinCardSupply`, связь у `CoinCard`, три поля у `CoinCardPriceIndex` |
| `src/lib/coin-card-sections.ts` | нормализация `tokenomics.excluded` / `allocation` / `unlocks` в секции TOKENOMICS |
| `src/lib/coin-card-form-spec.ts` | строки `excluded`, `allocation`, `unlock` вместо поля `lines` |
| `src/lib/coin-card-completeness.ts` | веса под аллокацию и разлоки, сумма снова 100 |
| `src/lib/coin-card-markets.ts` | `writeIndex` считает `marketCapUsd` / `fdvUsd` / `supplySource` |
| `src/lib/coin-card-public.ts` | `supply: true` в `include` |
| `src/app/actions/coin-card-supply.ts` | новый — `recheckCardSupply(cardId)` |
| `src/components/coin-card/sections/tokenomics-section.tsx` | проверенный выпуск, расчёт, аллокация, разлоки |
| `src/components/coin-card/market-cap-line.tsx` | новый — капитализация и FDV под ценой |
| `src/components/coin-card/price-index-block.tsx` | подключение строки капитализации |
| `src/components/coin-card-manage/supply-recheck.tsx` | новый — кнопка «Пересчитать выпуск» |
| `src/app/[locale]/cabinet/coins/[id]/page.tsx` | монтирование кнопки |
| `worker/index.ts` | `runSupplySweep()` + `cron.schedule("45 * * * *")` |
| `messages/*.json` (10) | `coinCard.supply.*`, `coinCard.allocation.*`, `coinCard.unlocks.*`, `coinCard.wizard.*` ярлыки строк |
| `tests/coin-card-supply.test.ts`, `tests/coin-card-tokenomics.test.ts` | чистые функции, подменённый `fetch`, прогон на `PrismaLike` |

## Задачи

### 1. Схема и миграция

Модель `CoinCardSupply` по спеке (`cardId @unique`, `chain`, `address`,
`decimals`, строки `totalSupply`/`excludedTotal`/`circulating`, `excluded` Json,
`partial`, `claimedDeltaPct`, `method`, `checkedAt`, `checkError`), обратная
связь `supply CoinCardSupply?` у `CoinCard`, поля `marketCapUsd Float?`,
`fdvUsd Float?`, `supplySource String?` у `CoinCardPriceIndex`. Миграция
аддитивная, пишется руками в `prisma/migrations/20261107190000_coin_card_supply/migration.sql`,
применяется `npx prisma migrate deploy` (как в слайсах B–D), клиент —
`npx prisma generate`.

### 2. `coin-card-supply.ts` — чистое ядро + тесты

- `unitsToCoins(units: string, decimals: number): string` — сдвиг точки
  `BigInt`-строкой, без потери знаков; `"420000000000000000000"`/18 → `"420"`,
  дробный хвост обрезается до 6 знаков и теряет хвостовые нули; мусор → `null`.
- `parseExcluded(tokenomics): ExcludedInput[]` — читает новые строки
  `{address,label}` и старый `excludedAddresses: string[]`, добавляет
  `0x0000…0000` и `0x000…dEaD` с меткой `burn`, нормализует адреса в нижний
  регистр, выбрасывает мусор и дубликаты, обрезает на 20 записях.
- `computeSupply({ totalUnits, decimals, balances })` →
  `{ total, excludedTotal, circulating, partial, excluded }`; `circulating`
  зажат в ноль, если исключения больше общего выпуска; адрес с ошибкой не
  участвует в сумме и поднимает `partial`.
- `claimedDeltaPct(claimed: number | null, circulating: string): number | null`.
- `marketCap(priceUsd, circulating)` и `fdv(priceUsd, maxOrTotal)` → `number | null`.

Тесты — список из спеки, раздел «Тестирование», пункты 1–5.

### 3. Чтение из сети + тесты с подменённым `fetch`

- `src/lib/evm-abi.ts`: `SELECTORS.balanceOf = "0x70a08231"` и
  `encodeAddressArg(addr)` — адрес, выровненный нулями в 32 байта.
- `readSupplyFacts({ chain, address, decimals, excluded, fetchImpl })` →
  `{ totalUnits, balances: Array<{address,label,units,error}>, error }`:
  один `eth_call` на `totalSupply()`, затем по одному на адрес исключения.
  Ошибка `totalSupply` фатальна (`supply_unreadable`), ошибка адреса — локальна.
- Тесты: успех; таймаут одного адреса → `partial`; `rpc_error` от узла;
  пустой ответ → `decode_failed`.

### 4. `syncCardSupply` + прогон на `PrismaLike`

`syncCardSupply({ prisma, fetchImpl?, cardId?, limit?, now? })`:
выбирает `APPROVED`-карточки, у которых есть контракт с `isCanonical: true` и
`verifiedAt != null`, очередь по `supply.checkedAt` (сначала никогда не
проверенные), `limit` по умолчанию 50; на карточку — `readSupplyFacts`,
`computeSupply`, `upsert` в `CoinCardSupply`, провенанс
`supply.circulating = {kind:"VERIFIED_ONCHAIN", source: chain, at}` через
`mergeProvenance`. Карточка без канонического проверенного контракта
пропускается (`no_canonical_contract` не пишется — её просто нет в выборке).
Возвращает `{ cards, ok, partial, failed }`.

Тесты на `PrismaLike`: пропуск карточки без контракта; запись и провенанс;
повторный прогон обновляет ту же запись; ошибка сети пишет `checkError` и не
стирает прошлые числа.

### 5. `coin-card-tokenomics.ts` — аллокация и разлоки + тесты

- `validateAllocation(rows)` → `{ok:true,data}` | `{ok:false,reason}` с кодами
  `allocation_over_100`, `allocation_invalid`; ≤20 строк, `label` обязателен,
  `pct` 0…100, сумма ≤100.5.
- `allocationBars(rows)` → доли для полосы плюс остаток «не распределено».
- `validateUnlocks(rows)` → `unlock_invalid`; ≤50 строк, дата парсится, задан
  `amount` либо `pct`; сортировка по дате.
- `unlockSummary(rows, { now, total })` → `{ next: Row[5], pct30, pct90, pastCount }`.

Тесты — пункты 6–7 раздела «Тестирование» спеки.

### 6. Форма и нормализация секции

`coin-card-form-spec.ts`: в `TOKENOMICS` вместо `lines`-поля
`tokenomics.excludedAddresses` — три `rows`-поля
(`excluded`: address+label; `allocation`: label, pct, cliffMonths,
vestingMonths, address; `unlocks`: date, label, amount, pct, source).
`coin-card-sections.ts`: нормализация секции прогоняет `validateTokenomics`
(как сейчас) плюс `validateAllocation` и `validateUnlocks`, чистит пустые
строки, нормализует адреса. `coin-card-completeness.ts`: новые проверки
`tokenomics.allocation` (вес 3) и `tokenomics.unlocks` (вес 2); снимаем по
единице с `description`, `logoUrl`, `contracts`, `tokenomics.supply`,
`tokenomics.method` — сумма весов остаётся 100 (проверяется существующим тестом).

### 7. Капитализация в индексе

`coin-card-markets.ts`: в `findMany` добавляется
`supply: { select: { circulating: true } }` и `tokenomics: true`;
`writeIndex` считает `marketCapUsd` / `fdvUsd` / `supplySource`
(`ONCHAIN`, если есть запись `CoinCardSupply`, иначе `SELF_REPORTED` по
`tokenomics.circulating`), и дописывает провенанс `marketCap` —
`AGGREGATED` при `ONCHAIN`, `SELF_REPORTED` иначе.

### 8. Серверное действие и кнопка в кабинете

`src/app/actions/coin-card-supply.ts`: `recheckCardSupply(cardId)` —
`getViewerCard`, `canEditSection(member, "TOKENOMICS")`, окно 5 минут по
`supply.checkedAt` (`too_soon`), отсутствие канонического проверенного
контракта → `no_canonical_contract` / `contract_unverified`, затем
`syncCardSupply({ cardId, limit: 1 })` и `revalidatePath("/", "layout")`.
`supply-recheck.tsx` — по образцу `onchain-recheck.tsx`: текущие числа,
время проверки, ошибка, кнопка. Монтируется в кабинете карточки рядом с
`OnchainRecheck`.

### 9. Публичный рендер

- `coin-card-public.ts`: `supply: true` в `include`.
- `market-cap-line.tsx`: `Капитализация $X · FDV $Y` с `ProvenanceBadge` по
  пути `marketCap`; ничего не рисует, если капитализации нет.
- `price-index-block.tsx`: монтирует строку под ценой.
- `tokenomics-section.tsx`: циркулирующий выпуск из `supply` с меткой
  `VERIFIED_ONCHAIN` и строкой «проект заявляет» при `|claimedDeltaPct| > 1`;
  раскрывающийся расчёт `total − Σ исключения` с адресами, балансами,
  подписями и пометкой «частичный расчёт»; полоса и таблица аллокации;
  сводка и таблица разлоков; существующая методика остаётся.

### 10. Воркер

`runSupplySweep()` по образцу `runContractVerify`: `syncCardSupply({ prisma,
limit: 50 })`, лог только при `cards > 0`, `cron.schedule("45 * * * *")`.

### 11. Переводы

`coinCard.supply.{verified,claimedSays,calculation,excludedBalance,partial,
marketCap,fdv,recheck,rechecking,never,result,error.*,reason.*}`,
`coinCard.allocation.{title,unallocated,cliff,vesting}`,
`coinCard.unlocks.{title,next30,next90,past,amount,pct,source}`,
ярлыки строк в `coinCard.wizard.*` — 10 локалей (en, ru, de, es, fr, ja, ko,
pt-BR, tr, zh-CN).

### 12. Проверка и выкладка

`npx tsc --noEmit`, `npm test`, `npm run build`, `npx prisma migrate deploy`,
живой прогон `syncCardSupply` на реальной карточке с проверенным контрактом,
`pm2 restart trientes-web trientes-worker`, `pm2 save`, `git push origin main`.
