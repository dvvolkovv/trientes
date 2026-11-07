# Слайс D — доказательство владения карточкой: план

**Спека:** `docs/superpowers/specs/2026-11-07-coin-card-claim-d-design.md`

**Цель:** проект машинно доказывает контроль (подпись владельца контракта, TXT
домена или файл `.well-known`), после чего владение карточкой переходит к нему
без участия админа.

## Границы и отклонения

1. Только EVM-подпись. Solana/TON — отдельный слайс.
2 «Пост с официального аккаунта» заменён файлом `/.well-known/` (см. спеку).
3. Отзыв подтверждения — по-прежнему руками админа, новой кнопки нет.
4. Две новые зависимости: `@noble/secp256k1`, `@noble/hashes`.

## Файлы

| Файл | Что |
| ---- | --- |
| `src/lib/evm-signature.ts` | новый — EIP-191 хеш, восстановление адреса, derive адреса из pubkey |
| `src/lib/claim-domain.ts` | новый — домен из `links.website`, DoH-резолвер TXT, чтение `.well-known` |
| `src/lib/coin-card-claim.ts` | новый — текст вызова, токен, правила перехода `trust`, проверка доказательства, лимиты |
| `prisma/schema.prisma` + миграция `20261107140000_coin_card_claim` | `ClaimMethod`, `ClaimStatus`, модель `CoinCardClaim`, связи у `CoinCard` и `User` |
| `src/app/actions/coin-card-claim.ts` | новый — `startClaim`, `checkClaim`, `cancelClaim` |
| `src/components/coin-card-manage/claim-section.tsx` | новый — выбор способа, инструкции, поле подписи, кнопка проверки |
| `worker/index.ts` | `runClaimSweep()` + `cron.schedule("20 * * * *")` |
| `messages/*.json` (10) | `coinCard.claim.*` |
| `tests/evm-signature.test.ts`, `tests/claim-domain.test.ts`, `tests/coin-card-claim.test.ts` | тесты чистых функций и прогона на `PrismaLike` |

## Задачи

1. **Зависимости и схема** — `npm i @noble/secp256k1 @noble/hashes`; enum'ы,
   модель `CoinCardClaim`, обратные связи, аддитивная миграция.
2. **`evm-signature.ts` + тесты** — `hashPersonalMessage(text)`,
   `recoverAddress(text, signature)` → адрес или код ошибки; `v` 27/28 и 0/1;
   битая длина подписи → `signature_invalid`.
3. **`claim-domain.ts` + тесты** — `websiteDomain(links)`; `fetchTxtRecords(domain, {fetchImpl})`
   через Cloudflare DoH с резервом Google; `fetchWellKnown(domain, {fetchImpl})`
   с лимитом 1 КБ; коды `dns_no_record | dns_unreachable | well_known_missing | well_known_unreachable`.
4. **`coin-card-claim.ts` + тесты** — `claimToken()`, `claimMessage({slug, username, token})`,
   `nextTrust(current, contractVerified)`, `verifyProof(claim, deps)`,
   `canStartClaim(...)`, окно 60 с и лимит попыток.
5. **Серверные действия** — `startClaim(cardId, method)` с лимитами и
   `already_claimed`; `checkClaim(claimId, signature?)` с проверкой,
   инкрементом попыток и передачей владения в транзакции; `cancelClaim(claimId)`.
6. **Передача владения** — upsert `OWNER`, понижение куратора до `EDITOR`,
   `stewardUserId`, `trust`, `AdminAuditLog{TRANSFER_COIN_CARD}`, закрытие
   прочих `PENDING`-заявок, уведомления обоим.
7. **Кабинет** — секция «Подтверждение владения»: инструкции по способу, поле
   подписи, кнопка, счётчик попыток, срок, последняя ошибка.
8. **Воркер** — `runClaimSweep()`: `PENDING` с `expiresAt < now` → `EXPIRED`.
9. **Переводы** — 10 локалей.
10. **Проверка и выкладка** — `npx tsc --noEmit`, `npm test` (включая живую
    проверку подписи тестовым ключом), `npm run build`, миграция,
    `pm2 restart trientes-web trientes-worker`, `pm2 save`, push.
