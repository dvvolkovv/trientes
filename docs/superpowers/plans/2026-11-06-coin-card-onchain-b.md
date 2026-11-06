# Слайс B — автопроверка контрактов: план

**Спека:** `docs/superpowers/specs/2026-11-06-coin-card-onchain-b-design.md`

## Границы и отклонения

1. Только EVM. Не-EVM сеть → `checkError = chain_unsupported`, `verifiedAt` не ставится.
2. Селекторы захардкожены константами (это фиксированные префиксы keccak) — keccak-зависимости в проекте нет и тянуть её ради шести констант не нужно.
3. `transferTax` не детектируем (см. спеку).
4. `tokenomics.total` перезаписывается из сети только для канонического контракта с известными decimals.

## Файлы

| Файл | Что |
| ---- | --- |
| `src/lib/evm-abi.ts` | новый — селекторы, кодирование вызова, декодеры строки/uint, поиск селектора в байткоде |
| `src/lib/evm-chains.ts` | новый — реестр сетей, нормализация `chain`, env-override |
| `src/lib/evm-rpc.ts` | новый — JSON-RPC поверх инъектируемого fetch, таймаут и ретрай |
| `src/lib/coin-card-onchain.ts` | новый — чтение факта контракта, сравнение с заявлением, флаги, прогон по базе |
| `prisma/schema.prisma` + миграция `20261106230000_coin_card_onchain` | аддитивные поля `CoinCardContract` |
| `worker/index.ts` | `runContractVerify()` + `cron.schedule("10 5 * * *")` |
| `src/app/actions/coin-card-onchain.ts` | ручная сверка с гейтом и окном 10 минут |
| `src/components/coin-card/sections/contracts-section.tsx` | рендер сводки сверки |
| `src/components/coin-card-manage/onchain-recheck.tsx` | кнопка в кабинете |
| `messages/*.json` (10) | `coinCard.onchain.*` |
| `tests/evm-abi.test.ts`, `tests/evm-chains.test.ts`, `tests/coin-card-onchain.test.ts` | тесты чистых функций |

## Задачи

1. **Схема и миграция** — поля `onchainName/Symbol/Decimals/TotalSupply`, `onchainFlags[]`, `mismatches[]`, `checkedAt`, `checkError`.
2. **`evm-abi.ts` + тесты** — декодер динамической строки и `bytes32`, `uint256`→строка, `uint8`, `hasSelector`, разбор слота EIP-1967.
3. **`evm-chains.ts` + тесты** — алиасы сетей, env-override, неизвестная сеть.
4. **`evm-rpc.ts`** — `rpcCall(url, method, params, {fetchImpl, timeoutMs})`, один ретрай, классификация ошибок в коды `checkError`.
5. **`coin-card-onchain.ts` + тесты** — `readContractFacts()`, `compareClaims()`, `flagsFromBytecode()`, `applyOnchainTotal()`, `verifyCardContracts({prisma, fetchImpl, limit, now})`.
6. **Воркер** — функция и крон, лимит 50 за прогон.
7. **Серверное действие** — `recheckCardContracts(cardId)`: гейт по `canEditSection(member,"CONTRACTS")`, `too_soon` при `checkedAt` < 10 мин, иначе прогон по контрактам карточки.
8. **Рендер** — публичная секция и кнопка в кабинете.
9. **Переводы** — 10 локалей.
10. **Проверка и выкладка** — `npx tsc --noEmit`, `npm test`, `npm run build`, миграция, `pm2 restart trientes-web trientes-worker`, `pm2 save`, push. Воркер обязателен: новый код в `src/lib` импортируется воркером.
