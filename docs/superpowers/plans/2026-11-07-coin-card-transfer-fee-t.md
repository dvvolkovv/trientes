# План: проверенная комиссия перевода (слайс T)

**Спека:** `docs/superpowers/specs/2026-11-07-coin-card-transfer-fee-design.md`

Порядок — один заход: кодек → чтение → реестр → факты → миграция → рендер →
локали → прогон в проде.

## Задача 1 — кодек экстринсика (`src/lib/substrate-extrinsic.ts`)

1. Тест `tests/substrate-extrinsic.test.ts`: `compactEncode` на границах
   0/1/63/64/16383/16384/2³⁰−1/2³⁰/10¹²; `transferKeepAliveCall` для палеты 6
   даёт 41 байт и голден-хекс
   `0x0603001111…070010a5d4e8`; `fakeSignedExtrinsic` даёт 143 байта тела без
   режима и 144 с ним, голдены взяты из живого прогона 7 ноября (узел Taler
   принял именно эти байты и посчитал комиссию).
2. Реализация: чистые функции, без сети и без подписи.
3. Коммит.

## Задача 2 — чтение комиссии (`src/lib/substrate-rpc.ts`)

1. Тест в `tests/substrate-rpc.test.ts` на поддельном fetch: успех с первого
   варианта; отказ без режима → успех с режимом; отказ в обоих →
   `decode_failed`; недоступный узел → `rpc_unreachable`.
2. `readRuntimeVersion(url)` → `{ specName, specVersion, transactionVersion }`.
3. `queryTransferFee({ url, pallet, decimals })` → `{ planck, tokens, metadataHashMode }`.
4. Коммит.

## Задача 3 — реестр сетей

1. Тест `tests/substrate-chains.test.ts`: у taler/polkadot/kusama заданы
   `balancesPallet` 6/5/4 и `transactionVersion` 2/26/26.
2. Поля в `SubstrateChain`, комментарий про живую проверку 7 ноября.
3. Коммит.

## Задача 4 — факты сети (`src/lib/coin-card-chain-facts.ts`)

1. Тесты в `tests/coin-card-chain-facts.test.ts`: версия транзакций разошлась →
   `transferFeeError = "runtime_changed"`, комиссия `null`, остальные факты на
   месте; успех пишет planck и tokens; сбой комиссии не роняет прогон;
   `FEE_USD` в `mismatches` только когда расхождение больше и 10 %, и цента;
   без `CoinCardPriceIndex` USD не считается и `FEE_USD` не ставится.
2. Реализация в `readChainFacts` + `syncChainFacts`.
3. Коммит.

## Задача 5 — миграция

`prisma/migrations/20261107.../migration.sql`: три столбца
`transferFeePlanck TEXT`, `transferFeeTokens DOUBLE PRECISION`,
`transferFeeError TEXT` в `CoinCardChainFacts`. `prisma migrate deploy` +
`generate`. Коммит.

## Задача 6 — рендер и локали

1. `src/components/coin-card/native-chain-block.tsx` — строка комиссии
   (монеты + `≈ $…`, если есть цена; подпись «перевод одной монеты»).
2. `src/components/coin-card/sections/payments-block.tsx` — факт предпочитается
   заявлению, расхождение рядом.
3. Ключи `coin.network.transferFee`, `coin.network.transferFeeHint`,
   `coin.payments.feeClaimed` на 10 локалей.
4. Коммит.

## Задача 7 — прогон и деплой

1. `npx vitest run` — весь набор зелёный.
2. Прогон вручную: `syncChainFacts` для taler → в базе комиссия
   `2 633 280` планка ≈ `0,0000026 TAL` (сверить с живым `payment_queryInfo`).
3. `npm run build`, `pm2 restart trientes-web trientes-worker`, `pm2 save`.
4. `curl` карточки: строка комиссии видна на `/ru/coin/taler` и `/en/coin/taler`.
5. `git push origin main`, абзац в CLAUDE.md.
