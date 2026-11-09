# План: карточки, проверенные в сети, на 19 монетах (слайс V)

**Спека:** `docs/superpowers/specs/2026-11-09-coin-card-verified-rollout-design.md`

Порядок: сначала Substrate (код уже есть — реестр, охранник выпуска, посев,
плашка), и карточки видны в тот же день; потом Cosmos (новый ридер). Каждая
задача — тест, реализация, коммит.

## Фаза 1 — Substrate

### Задача 1 — реестр сетей (`src/lib/substrate-chains.ts`)

1. Тест `tests/substrate-chains.test.ts`: девять ключей; `balancesPallet` и
   `transactionVersion` допускают `null` (hydradx, moonbeam, moonriver до
   подбора); `substrateIssuanceUrlFor` отдаёт Asset Hub для polkadot и kusama и
   обычный узел для остальных; `SUBSTRATE_RPC_<KEY>` и
   `SUBSTRATE_ISSUANCE_RPC_<KEY>` переопределяют.
2. Типы: `ss58Format`, `balancesPallet`, `transactionVersion` → `number | null`;
   новое поле `issuanceRpcUrl?`. Девять записей с живыми числами 9 ноября и
   комментарием про Asset Hub.
3. Коммит.

### Задача 2 — выпуск: чужой узел и охранник доли (`src/lib/coin-card-supply.ts`)

1. Тесты в `tests/coin-card-supply.test.ts`: выпуск Substrate читается по
   `substrateIssuanceUrlFor` (поддельный fetch видит адрес Asset Hub);
   `supplyShare` — доли 0,0002 / 0,6 / 1,0 / снимка нет; при доле ниже порога
   `checkError = "supply_share"`, `circulating` не записывается в провенанс как
   проверенный выпуск.
2. Реализация: чистая `supplyShare()`, ветка в `syncCardSupply`, запрос
   последнего `CoinSnapshot` одним `findFirst` на карточку с `coinId`.
3. Коммит.

### Задача 3 — расхождение в фактах сети (`src/lib/coin-card-chain-facts.ts`)

1. Тесты: `ss58Format` у узла `null` → кода `SS58_FORMAT` нет;
   `balancesPallet === null` → `transferFeeError = "fee_unsupported"`, прогон не
   падает; `moved` по `genesisHash` работает, как было.
2. Реализация: только снятие предположения «в реестре всё заполнено».
3. Коммит.

### Задача 4 — таблица посева (`src/lib/coin-card-seed.ts`)

1. Тест `tests/coin-card-seed.test.ts`: каждый ключ есть в одном из реестров;
   `Coin.id` не повторяются; ключи Substrate и Cosmos не пересекаются;
   `plannedCard()` даёт `status: PENDING`, `trust: UNVERIFIED`, пустые
   `steward`/`company` и провенанс `ADMIN_SET/seed`.
2. Реализация: таблица `SEED_CARDS: {coinId, chain}[]` и чистая `plannedCard()`.
3. Коммит.

### Задача 5 — скрипт посева (`scripts/seed-chain-cards.ts`)

Без теста (скрипт-обёртка, вся логика — в задаче 4 и в прогонах воркера).
Флаги: без флага — посев идемпотентно (`upsert` по `slug`, уже существующую
карточку не трогает); `--fill` — `syncChainFacts({cardId})` +
`syncCardSupply({cardId})` по каждой посеянной; `--dump` — печать фактов
таблицей для сверки глазами; `--publish` — `status: APPROVED` только тем, у кого
факты прочитаны без ошибок. Коммит.

### Задача 6 — плашка и рендер (Substrate)

1. Тест `tests/coin-card-public.test.ts` (или рядом): `getPublicCoinCard`
   отдаёт `stewardUserId` и `companyId`.
2. `trust-plaque.tsx`: при обоих `null` — вариант `SEEDED` с ссылкой на claim.
3. `tokenomics-section.tsx`: при `checkError === "supply_share"` — строка «в
   этой сети N, это M % от заявленного», без бейджа проверенного выпуска.
4. Ключи `coinCard.trust.SEEDED`, `SEEDED_note`, `coinCard.claimCta`,
   `coin.supply.shareNote` на 10 локалей.
5. Коммит.

### Задача 7 — миграция и живой прогон фазы 1

`prisma migrate` не нужен (полей не добавляли). Посев 9 карточек, `--fill`,
`--dump`, сверка глазами, `--publish`, `npm run build`,
`pm2 restart trientes-web trientes-worker` (реестр и supply лежат в `src/lib`,
воркер их импортирует), `pm2 save`. Коммит и push.

## Фаза 2 — Cosmos

### Задача 8 — реестр Cosmos (`src/lib/cosmos-chains.ts`)

1. Тест `tests/cosmos-chains.test.ts`: девять ключей; `cosmosRestUrlFor` с
   переопределением `COSMOS_REST_<KEY>`; `exponent` и `denom` заданы у всех;
   ключи не пересекаются с Substrate.
2. Реализация по образцу `substrate-chains.ts`.
3. Коммит.

### Задача 9 — ридер Cosmos (`src/lib/cosmos-rest.ts`)

1. Тест `tests/cosmos-rest.test.ts` на поддельном fetch с записанными ответами
   9 ноября: выпуск по деному; `supply/by_denom` ответил `panic` →
   `decode_failed` (а не тихий ноль); последний блок (высота, время, chain-id);
   блок на высоте `N−k`; измерение времени блока; разбор
   `minimum_gas_price` с двумя деномами → берём свой; пустая строка → `null`;
   таймаут → `rpc_unreachable`; один повтор на обрыве.
2. Реализация: `readCosmosBlock`, `readCosmosSupply`, `readCosmosNodeConfig`,
   `measureCosmosBlockSeconds`, `pickGasPrice`.
3. Коммит.

### Задача 10 — миграция фактов сети

`prisma/migrations/20261109.../migration.sql`: `genesisHash` → nullable;
`chainId TEXT`, `minGasPrice TEXT`, `family TEXT NOT NULL DEFAULT 'SUBSTRATE'` в
`CoinCardChainFacts`. `prisma migrate deploy` + `generate`. Коммит.

### Задача 11 — ветка семьи в фактах и выпуске

1. Тесты: `readChainFacts` по ключу Cosmos зовёт REST, а не JSON-RPC, и пишет
   `family: "COSMOS"`, `chainId`, `finalityLag: 0`; chain-id разошёлся с
   реестром → `CHAIN_ID` в `mismatches`; переезд (`chainId` сменился у уже
   записанной карточки) → `checkError = "genesis_mismatch"`, числа не
   перезаписываются; `syncCardSupply` с ключом Cosmos пишет
   `method: "COSMOS_V1"`, `address = chainId`, и охранник доли применяется.
2. Реализация: развилка по `resolveSubstrateChain` / `resolveCosmosChain` в
   начале обоих прогонов.
3. Коммит.

### Задача 12 — рендер Cosmos и локали

1. Блок сети: вместо хэша генезиса — chain-id; вместо задержки финализации —
   «финальность в том же блоке»; строка «минимальная цена газа по узлу» вместо
   комиссии перевода; подпись, что комиссия перевода у этой семьи пока не
   считается.
2. Ключи `coin.network.chainId`, `finalityInstant`, `minGasPrice`,
   `feeNotMeasured` на 10 локалей.
3. Коммит.

### Задача 13 — живой прогон фазы 2

Посев 9 карточек Cosmos, `--fill`, `--dump`, сверка выпуска с публично
известными числами, `--publish`, сборка, рестарт веба и воркера, `pm2 save`,
push.

## Проверка по завершении

- `npx vitest run` — вся сюита зелёная.
- `/en/coin/astar`, `/en/coin/celestia`, `/ru/coin/bittensor` отдают 200 и
  содержат блок сети с проверенными числами.
- `pm2 logs trientes-worker` на 35-й и 45-й минуте: `chain facts ok: 19 cards`,
  `supply sweep ok: 19 cards`.
