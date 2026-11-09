# План: конвейер листинга (слайс W)

Спека: `docs/superpowers/specs/2026-11-09-coin-card-listing-conveyor-design.md`.

## Шаг 1 — префикс SS58 сверяется у трёх сетей

- [x] `src/lib/substrate-rpc.ts`: `readChainProperties` ищет префикс
      регистронезависимо по именам `ss58format` и `ss58prefix`.
- [x] Тест: `{"SS58Prefix":1284}`, `{"ss58format":137}`, `{"ss58Format":0}` дают
      число; отсутствие ключа даёт `null`; нечисловое значение даёт `null`.

## Шаг 2 — реестры растут на шестнадцать сетей

- [x] `src/lib/cosmos-chains.ts`: +11 строк (cosmos, osmosis, akash, juno,
      axelar, neutron, stride, dymension, persistence, agoric, band).
- [x] `src/lib/substrate-chains.ts`: +5 строк (acala, darwinia, vara, unique,
      avail), `balancesPallet: null` до подтверждения индекса.
- [x] `src/lib/coin-card-seed.ts`: +16 строк посева.
- [x] Тесты таблицы посева обновлены под новый размер.

## Шаг 3 — монеты в каталоге

- [x] Монеты, которых нет в `Coin`, добавить как `ADMIN_ADDED`
      (`scripts/add-coin.ts`), цена и логотип подтянутся синком.

## Шаг 4 — комиссия перевода у новых сетей Substrate

- [x] `scripts/probe-substrate-pallet.ts` по каждой из пяти сетей; индекс и
      `transactionVersion` вписать только там, где подтвердился дважды.

## Шаг 5 — прогон листинга

- [x] `src/lib/coin-card-listing-sweep.ts`: чистая функция решения
      `shouldPublish(card, facts, supply, now)` + `runListingSweep({prisma})`,
      делающий три шага спеки.
- [x] Тесты на `shouldPublish`: открывает чистую карточку старше суток;
      держит закрытой при расхождениях, при `checkError`, при пропавшем выпуске,
      при устаревшем чтении, при возрасте меньше суток, при наличии куратора.
- [x] `worker/index.ts`: `cron.schedule("25 4 * * *", runListingSweep)`,
      лимиты прогонов фактов и выпуска поднять с 50 до 100 карточек.

## Шаг 6 — прогон и проверка

- [x] `scripts/seed-chain-cards.ts` (посев) → `--fill` → `--dump` глазами →
      `--publish`.
- [x] Страницы новых монет отдают 200 и показывают блок фактов.

## Шаг 7 — закрепить

- [x] `npm run build`, `pm2 restart trientes-web trientes-worker`, `pm2 save`.
- [x] CLAUDE.md: слайс W одним абзацем.
- [x] Коммит и `git push origin main`.
