# План: семья Bitcoin в карточках монет (слайс Y)

Спека: `docs/superpowers/specs/2026-11-09-coin-card-bitcoin-family-design.md`.

## Шаги

1. **Реестр сетей** — `src/lib/bitcoin-chains.ts`: тип `BitcoinChain`
   (`key`, `label`, `api: ESPLORA | BLOCKCYPHER`, `defaultApiUrl`, `genesisHash`,
   `checkpoint?`, `symbol`, `decimals`, `txVsize`, `feeTargetBlocks`),
   пять сетей, `resolveBitcoinChain`, `bitcoinApiUrlFor` (переопределение
   `BITCOIN_API_<KEY>`). Тест: ключи уникальны, адреса без слэша на конце,
   генезис — 64 hex, у bitcoin есть контрольный блок.
2. **Ридер** — `src/lib/bitcoin-rest.ts`: `readBitcoinTip`, `readBitcoinBlockAt`,
   `readBitcoinGenesis`, `measureBitcoinBlockSeconds`, `readBitcoinFeeRate`
   (sat/vB), оба транспорта, инъектируемый fetch. Классификация сбоя: 4xx →
   `rpc_error`, 5xx/обрыв → `rpc_unreachable` с одним повтором. Тесты на
   поддельных узлах обеих форм, включая отсутствующий `/fee-estimates` и
   текстовые ответы.
3. **Факты сети** — третья ветка `readBitcoinChainFacts` в
   `src/lib/coin-card-chain-facts.ts`: `family: "BITCOIN"`, идентичность по
   генезису и контрольному блоку (`genesis_mismatch` при расхождении),
   `finalizedNumber`/`finalityLag`/`finalitySeconds` остаются `null`, комиссия =
   цена за байт × `txVsize`. Тесты: успешное чтение, подменённая цепь, сбой
   комиссии не роняет остальные факты.
4. **Выпуск** — ветка в `syncNativeChainCard`: строка `method: "BITCOIN_V1"`,
   `checkError: "supply_unsupported"`, `address` = хэш генезиса. Тест: строка
   записана, провенанс `supply.circulating` не поставлен.
5. **Конвейер листинга** — `publishBlocker` принимает `supply_unsupported`;
   `coinFromRegistry` и `chainFamily` знают третий реестр. Тесты на оба правила.
6. **Рендер** — `native-chain-block.tsx`: для `family === "BITCOIN"` строка
   финализации «вероятностная», подпись комиссии «эталонный перевод: 1 вход,
   2 выхода»; метка сети из третьего реестра. Новые ключи в десяти локалях.
7. **Посев** — пять строк в `SEED_CARDS`, `--family=BITCOIN` в скрипте.
8. **Живой прогон** — посев, чтение сети, сверка глазами (`--dump`), публикация
   сошедшихся; затем посев рынков (слайс X) по новым карточкам.
9. **Сдача** — `npm test`, `npx tsc --noEmit`, `npm run build`,
   `pm2 restart trientes-web trientes-worker`, `pm2 save`, коммит, пуш,
   дописать CLAUDE.md.

## Риски

- **Публичный Esplora забанит сервер.** Лечится `BITCOIN_API_<KEY>`; у Bitcoin
  есть три живых зеркала (`mempool.space`, `blockstream.info`, `mempool.emzy.de`).
- **BlockCypher без ключа — 100 запросов в час.** Прогон фактов берёт 4–5
  запросов на цепь в час, то есть ~10 из 100 на две цепи. Превышение вернёт 429
  → `rpc_unreachable`, карточка сохранит прошлые числа.
- **Время блока в PoW скачет** (временную метку ставит майнер). Замер по 100
  блокам сглаживает; номер блока замера показан в карточке, как в слайсах S и V.
