# Собственный листинг монет: карточка, команда, права, мультисиг (Слайс A)

**Дата:** 2026-11-06
**Раздел:** замена `/{locale}/request` → визард листинга; новая секция
`/{locale}/cabinet/coins/[id]`; расширение публичной карточки `/{locale}/coin/[slug]`;
новая очередь модерации `/{locale}/admin/coin-cards`

## Контекст

Сегодня «предложить монету» — это 4 поля (`src/components/coin-request-form.tsx`):
название, тикер, CoinGecko ID, причина. Одобрить заявку физически нельзя без
CoinGecko ID (`src/lib/admin/approve-request.ts:31` → `no_coingecko_id`), потому
что всё остальное — логотип, описание, ссылки, ранг, цена — подтягивается синком
из CoinGecko (`src/lib/coingecko.ts:47`). Для монет из топа это работает; для
новых токенов, которых в CoinGecko нет, не работает вообще.

**Цель:** свой листинг уровня CoinMarketCap / CoinGecko, где любой проект
оформляет полноценную карточку сам, владеет ею, подключает сотрудников с правами
по разделам, а решения внутри команды принимаются мультиподписью.

**CoinGecko не выключается одним движением** — на нём держатся тысячи
существующих монет. Независимость означает: новым, самостоятельно залистингованным
монетам CoinGecko не нужен никогда, а собственный ценовой индекс (слайс C)
становится основным там, где у нас есть рынки. CoinGecko остаётся резервным
источником для старого массива.

## Нарезка на подсистемы

| #   | Слайс                   | Содержание                                                                                                       | Статус         |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------- |
| A   | Карточка + команда      | модель карточки, визард подачи, публичный рендер с провенансом, ревизии, участники, права по разделам, мультисиг | **этот слайс** |
| B   | Автопроверка контрактов | чтение `name`/`symbol`/`decimals`/`totalSupply` через публичные RPC, флаги риска                                 | позже          |
| C   | Свой агрегатор рынков   | коннекторы к публичным API бирж, собственный ценовой индекс (VWAP-медиана)                                       | позже          |
| D   | Claim listing           | доказательство контроля: подпись с адреса деплоера / TXT-запись домена / пост с офиц. аккаунта                   | позже          |
| E   | Токеномика              | аллокация по долям + календарь разлоков                                                                          | позже          |
| F   | «Где принимается»       | связка карточки с POI-навигатором                                                                                | позже          |
| G   | Донаты                  | кнопка поддержки сервиса (статические адреса → NOWPayments)                                                      | позже          |

**Этот слайс = A.** Остальное — отдельные спеки. Слайс A намеренно включает
_модель данных_ для разделов, которые наполняют B/C/E/F, но не их источники
данных: поля существуют и заполняются вручную проектом со меткой
`SELF_REPORTED`, а B/C/E позже дописывают в те же поля метку `VERIFIED` /
`AGGREGATED`.

## Принципы (согласовано с владельцем)

1. **Провенанс каждого числа — главный дифференциатор.** У каждого значения в
   карточке есть метка источника: самозаявлено проектом / проверено в блокчейне /
   агрегировано по N рынкам. Видна пользователю, с временем обновления.
2. **Два статуса владения, а не один.** Первый подавший — _куратор_, не
   владелец. Подтверждённый проект вытесняет куратора. Защита от сквоттинга
   листингов (иначе случайный человек навсегда получает права на карточку Solana
   и может их продать).
3. **Права по разделам карточки, не по кнопкам.** Один отвечает за биржи, другой
   за маркетинг, третий за приём платежей в магазинах.
4. **Поля высокого риска всегда через модератора.** Подмена адреса контракта —
   основной вектор скама.
5. **Мультисиг не декорация.** Если включён, его нельзя обойти владельцем
   единолично; изменение самой политики мультисига тоже требует мультисига.
6. **Публичная история изменений.** Кто, когда, какое поле, было → стало.
7. **Максимальный реюз.** `CompanyMember` / `CompanyInvite` (роли, одноразовые
   ссылки-приглашения, защита последнего владельца), `RequestStatus`,
   `AdminAuditLog`, `notifyUser`, загрузка файлов
   (`src/app/api/business/point/upload/route.ts`), `safeNext`.

## Содержание карточки: девять блоков

| Раздел (enum `CoinCardSection`) | Поля                                                                                                                                                               | Риск                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `IDENTITY`                      | name, symbol, slug, logo (файл), tagline (1 строка), description (md), launchDate, tags[], consensus, hashAlgo                                                     | низкий, кроме `symbol`/`slug` |
| `CONTRACTS`                     | per-chain: chain, address, decimals, standard, isCanonical, explorerUrl                                                                                            | **высокий**                   |
| `TOKENOMICS`                    | circulating / total / max supply, **методика**: excludedAddresses[], emission, burnMechanism, allocation[], unlocks[]                                              | **высокий**                   |
| `MARKETS`                       | CEX: exchange, pair, priceUsd, volume24h, volumeShare, outlier, tradeUrl. DEX: chain, dex, poolAddress, liquidity, volume24h                                       | **высокий**                   |
| `SECURITY`                      | audits[] (firm, date, reportUrl, scope), riskFlags (mintable, pausable, blacklist, transferTax, upgradeableProxy, lpLocked), teamDoxxed, legalEntity, jurisdiction | **высокий**                   |
| `TEAM`                          | members[] (name, role, links), investors[], fundingRounds[], partners[]                                                                                            | низкий                        |
| `LINKS`                         | website, docs, whitepaper, github, explorers[], x, telegram, discord, reddit, blog, youtube + размер сообщества по каналу                                          | низкий                        |
| `MARKETING`                     | pitch, roadmap[] (веха, дата, статус), news[] (посты проекта), mediaKit (логопак, фирменные цвета), videoUrl, events[]                                             | низкий                        |
| `ACCEPTANCE`                    | связка с `CompanyPoint` — где монета принимается физически                                                                                                         | низкий                        |

`ACCEPTANCE` — наше уникальное преимущество: база точек приёма крипты у нас уже
есть, у CoinMarketCap и CoinGecko такого нет вообще. В слайсе A это только
модель и ручной ввод; автоматическая связка — слайс F.

## Данные (одна аддитивная миграция)

```
enum CoinCardSection {
  IDENTITY CONTRACTS TOKENOMICS MARKETS SECURITY TEAM LINKS MARKETING ACCEPTANCE
}

enum CoinCardRole {
  OWNER    // всё: контент, команда, права, политика мультисига, claim
  ADMIN    // весь контент, приглашает EDITOR/VIEWER; владельцев не трогает
  EDITOR   // только разделы из sections[]
  VIEWER   // чтение, включая черновики (юристы, инвесторы)
}

enum CoinCardTrust {
  UNVERIFIED        // карточка ведётся куратором
  CONTRACT_VERIFIED // адрес контракта сверен с блокчейном (слайс B)
  PROJECT_CLAIMED   // проект доказал контроль (слайс D)
  FULLY_VERIFIED    // claim + аудит + раскрытая команда + юрлицо
}

enum ProvenanceKind { SELF_REPORTED VERIFIED_ONCHAIN AGGREGATED ADMIN_SET }

enum CoinCardVote { APPROVE REJECT }

// Что меняет ревизия: контент карточки или саму политику мультисига.
enum CoinCardRevisionKind { CONTENT POLICY }

enum CoinCardRevisionStatus {
  DRAFT             // автосохранение визарда, никому не видно кроме команды
  PENDING_SIGNERS   // ждёт мультиподписи внутри команды
  PENDING_ADMIN     // подписана командой, ждёт модератора сайта
  APPLIED
  REJECTED
  EXPIRED           // не собрала порог за REVISION_TTL_DAYS
  WITHDRAWN         // отозвана автором
}

// Карточка монеты. Отвязана от Coin.id = CoinGecko id: свой cuid + slug.
model CoinCard {
  id             String        @id @default(cuid())
  slug           String        @unique
  coinId         String?       @unique   // связь с существующим Coin, если монета уже в списке
                                         // обратная сторона: Coin.card CoinCard? @relation
  companyId      String?                 // необязательная привязка к Company
  stewardUserId  String?                 // первый подавший; вытесняется при claim
  trust          CoinCardTrust @default(UNVERIFIED)
  status         RequestStatus @default(PENDING)   // публикуется только APPROVED
  completeness   Int           @default(0)         // 0..100, для прогресс-бара
  // --- IDENTITY ---
  name           String
  symbol         String
  tagline        String?
  description    String?       @db.Text
  logoUrl        String?
  launchDate     DateTime?
  tags           String[]      @default([])
  consensus      String?
  hashAlgo       String?
  // --- остальные блоки: вложенные таблицы + JSONB для списков ---
  links          Json?         // {website, docs, whitepaper, github, x, telegram, ...}
  tokenomics     Json?         // {circulating, total, max, excludedAddresses[], emission, burn}
  teamInfo       Json?         // {members[], investors[], rounds[], partners[]}
  marketing      Json?         // {pitch, roadmap[], news[], mediaKit, videoUrl, events[]}
  security       Json?         // {audits[], riskFlags{}, teamDoxxed, legalEntity, jurisdiction}
  provenance     Json?         // {"<field path>": {kind, source, at}}
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  contracts  CoinCardContract[]
  markets    CoinCardMarket[]
  members    CoinCardMember[]
  invites    CoinCardInvite[]
  revisions  CoinCardRevision[]
  policy     CoinCardPolicy?

  @@index([status, createdAt])
  @@index([trust])
}

model CoinCardContract {
  id           String   @id @default(cuid())
  cardId       String
  card         CoinCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  chain        String              // "ethereum" | "solana" | "bsc" | "ton" | ...
  address      String
  decimals     Int?
  standard     String?             // "ERC-20" | "SPL" | "TRC-20" | ...
  isCanonical  Boolean  @default(false)
  explorerUrl  String?
  verifiedAt   DateTime?           // заполняет слайс B
  @@unique([cardId, chain, address])
  @@index([chain, address])
}

model CoinCardMarket {
  id           String   @id @default(cuid())
  cardId       String
  card         CoinCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  kind         String              // "CEX" | "DEX"
  exchangeId   String?             // FK-по-значению на Exchange.id, если биржа нам известна
  exchangeName String              // свободный ввод, если нет
  pair         String
  tradeUrl     String?
  chain        String?             // для DEX
  poolAddress  String?             // для DEX
  priceUsd     Float?              // заполняет слайс C; в A — null
  volumeUsd24h Float?
  claimedAt    DateTime @default(now())   // "проект заявил листинг здесь"
  confirmedAt  DateTime?                  // сверено агрегатором (слайс C)
  @@unique([cardId, kind, exchangeName, pair])
  @@index([cardId])
}

// Участник команды карточки. Образец — CompanyMember (prisma/schema.prisma:101).
model CoinCardMember {
  id          String            @id @default(cuid())
  cardId      String
  card        CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  userId      String
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        CoinCardRole      @default(VIEWER)
  sections    CoinCardSection[] @default([])  // значимо только для EDITOR
  isSigner    Boolean           @default(false) // входит в группу мультиподписи
  invitedById String?
  createdAt   DateTime          @default(now())
  approvals   CoinCardApproval[]
  @@unique([cardId, userId])
  @@index([userId])
}

// Одноразовая ссылка-приглашение. Образец — CompanyInvite (prisma/schema.prisma:118).
model CoinCardInvite {
  id           String            @id @default(cuid())
  cardId       String
  card         CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  role         CoinCardRole      @default(VIEWER)
  sections     CoinCardSection[] @default([])
  isSigner     Boolean           @default(false)
  token        String            @unique
  createdById  String
  expiresAt    DateTime
  acceptedById String?
  acceptedAt   DateTime?
  revokedAt    DateTime?
  createdAt    DateTime          @default(now())
  @@index([cardId, createdAt])
}

// Политика мультиподписи карточки. 1:1 с картой, создаётся лениво.
model CoinCardPolicy {
  cardId    String            @id
  card      CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  multisig  Boolean           @default(false)
  threshold Int               @default(1)       // M из N подписантов
  sections  CoinCardSection[] @default([])      // пусто = применяется ко всем изменениям
  updatedAt DateTime          @updatedAt
}

// Пакет изменений. Одна ревизия = одно сохранение одной секции визарда.
model CoinCardRevision {
  id            String                 @id @default(cuid())
  cardId        String
  card          CoinCard               @relation(fields: [cardId], references: [id], onDelete: Cascade)
  kind          CoinCardRevisionKind   @default(CONTENT)
  section       CoinCardSection?       // null только при kind = POLICY
  authorId      String
  author        User                   @relation(fields: [authorId], references: [id], onDelete: Cascade)
  status        CoinCardRevisionStatus @default(DRAFT)
  highRisk      Boolean                @default(false)
  diff          Json                   // [{path, before, after}]
  thresholdAt   Int?                   // снимок threshold на момент подачи
  signerCountAt Int?                   // снимок N на момент подачи
  expiresAt     DateTime?
  adminId       String?
  adminNote     String?
  decidedAt     DateTime?
  appliedAt     DateTime?
  createdAt     DateTime               @default(now())
  approvals     CoinCardApproval[]
  @@index([cardId, createdAt])
  @@index([status, createdAt])
}

model CoinCardApproval {
  id         String           @id @default(cuid())
  revisionId String
  revision   CoinCardRevision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  memberId   String
  member     CoinCardMember   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  decision   CoinCardVote
  comment    String?
  createdAt  DateTime         @default(now())
  @@unique([revisionId, memberId])   // один участник — один голос
  @@index([revisionId])
}
```

Новые значения `AdminAction`: `APPROVE_COIN_CARD`, `REJECT_COIN_CARD`,
`APPLY_COIN_REVISION`, `REJECT_COIN_REVISION`, `FORCE_COIN_REVISION`,
`DISABLE_COIN_MULTISIG`, `TRANSFER_COIN_CARD`.

## Владение: куратор vs подтверждённый владелец

- Первый подавший карточку получает `CoinCardMember{role: OWNER}` **и**
  `CoinCard.stewardUserId = его id`, но `trust = UNVERIFIED`.
- Публично на карточке — плашка: «ведётся сообществом, проект не подтвердил
  причастность».
- Когда проект доказывает контроль (слайс D), `trust` → `PROJECT_CLAIMED`,
  заявитель становится `OWNER`, а прежний куратор понижается до `EDITOR`
  (не удаляется автоматически — дальше решает проект). Событие пишется в
  `AdminAuditLog` как `TRANSFER_COIN_CARD`.
- До слайса D передачу делает админ сайта руками — тем же действием.

## Права: роль + разделы

Гейты живут в `src/lib/coin-card-access.ts` (по образцу `src/lib/business.ts`):

```
getViewerCard(cardId, userId)      → {card, member} | null
canEditSection(member, section)    → OWNER/ADMIN: всегда; EDITOR: section ∈ member.sections; VIEWER: нет
canManageMembers(member)           → OWNER (полностью) | ADMIN (только EDITOR/VIEWER)
canManagePolicy(member)            → OWNER
isSigner(member)                   → member.isSigner
```

Гарантии:

- Последнего `OWNER` нельзя ни понизить, ни удалить → `last_owner`
  (точно как в `src/app/actions/company-members.ts`).
- `ADMIN` не может ни создать, ни изменить, ни удалить `OWNER`.
- `sections` игнорируются для не-`EDITOR` ролей (нормализуются в пустой массив
  при записи, чтобы не было «мёртвых» прав после смены роли).

Прав на отдельное поле **нет сознательно**: интерфейс становится нечитаемым,
модерация невозможна, реальной потребности нет. Если понадобится — раздел
дробится на два, модель не ломается.

## Мультисиг: офф-чейн M-из-N по аккаунтам

**Явное ограничение слайса A:** подписанты — это аккаунты Trientes, не адреса
кошельков. Привязка подписантов к кошелькам и чтение порога из настоящего
Gnosis Safe — потенциальное развитие в слайсе D, когда появится проверка подписей.

**N** = `count(CoinCardMember where cardId, isSigner: true)`.
**M** = `CoinCardPolicy.threshold`.

Жизненный цикл ревизии:

```
EDITOR сохраняет секцию
  → CoinCardRevision{status: DRAFT, diff, highRisk}
  → подача (submit):
      multisig выключен или section ∉ policy.sections (при непустом списке)
        → highRisk или trust < PROJECT_CLAIMED ? PENDING_ADMIN : APPLIED
      multisig включён и применим
        → PENDING_SIGNERS, expiresAt = now + REVISION_TTL_DAYS (14)
           снимок thresholdAt = M, signerCountAt = N
           если автор сам подписант — его APPROVE ставится автоматически
  → подписанты голосуют (CoinCardApproval, один голос на участника)
      approvals(APPROVE) >= thresholdAt
        → highRisk или trust < PROJECT_CLAIMED ? PENDING_ADMIN : APPLIED
      approvals(REJECT) > signerCountAt - thresholdAt
        → REJECTED  // порог арифметически недостижим, держать нечего
  → expiresAt прошёл и порог не собран → EXPIRED (чистит воркер)
```

Правило отказа выведено из арифметики, а не назначено произвольно: ревизия
закрывается ровно тогда, когда собрать `M` одобрений уже невозможно. Отдельного
«права вето» ни у кого нет.

Снимки `thresholdAt` / `signerCountAt` обязательны: иначе изменение состава
подписантов на ходу меняет исход уже идущего голосования.

Гарантии и крайние случаи:

- `1 <= threshold <= N`, иначе `threshold_out_of_range`.
- Снятие флага подписанта или удаление участника, после которого `N < threshold`,
  **блокируется** → `threshold_unreachable`; владелец обязан сначала понизить
  порог. Явный отказ лучше молчаливого авто-понижения.
- **Изменение самой `CoinCardPolicy` при включённом мультисиге само проходит
  через мультисиг**: ревизия с `kind = POLICY`, `section = null`,
  `highRisk = true`, в `diff` — изменения порога, состава подписантов и списка
  секций. Такая ревизия применима только при наборе порога и **не требует
  модератора сайта** — это внутреннее дело команды. Иначе мультисиг обходится
  одним кликом владельца и является декорацией.
- Включение мультисига с нуля — обычное действие `OWNER` (обходить ещё нечего).
- **Аварийный выход:** если подписанты недоступны (ушли, потеряли доступ),
  админ сайта по обращению владельца может принудительно применить ревизию
  (`FORCE_COIN_REVISION`) или выключить мультисиг (`DISABLE_COIN_MULTISIG`).
  Оба действия пишутся в `AdminAuditLog` и **видны в публичной истории карточки** —
  тихого обхода не существует.
- Уведомления подписантам («нужна ваша подпись») и автору (исход) — через
  существующий `notifyUser` (Telegram + web-push; email молчит, пока нет
  `RESEND_API_KEY`).

## Риск полей и модерация

`src/lib/coin-card-risk.ts` — единственный источник истины, какие пути полей
высокорисковые: всё в `CONTRACTS`, `TOKENOMICS`, `MARKETS`, `SECURITY`, плюс
`IDENTITY.symbol` и `IDENTITY.slug`.

| Состояние карточки       | Низкий риск       | Высокий риск |
| ------------------------ | ----------------- | ------------ |
| `UNVERIFIED` (куратор)   | модератор         | модератор    |
| `PROJECT_CLAIMED` и выше | публикуется сразу | модератор    |

Очередь `/{locale}/admin/coin-cards` показывает ревизию как diff («было → стало»,
кто автор, кто подписал) — не как новую заявку. Approve применяет `diff` к
`CoinCard`, Reject требует причину ≥3 символов (как у точек компании).

## Визард подачи

`/{locale}/request` переписывается в 4 шага с автосохранением черновика
(`CoinCardRevision{status: DRAFT}`), а не в одну страницу на 60 полей:

1. **Основа** (минимум для публикации): название, тикер, логотип, сайт, tagline,
   описание.
2. **Сети и контракты**: хотя бы один контракт либо явная отметка «нативная
   монета собственного блокчейна».
3. **Токеномика и рынки**: supply + методика, где торгуется.
4. **Доверие, команда, маркетинг**: аудиты, команда, ссылки, дорожная карта.

Карточка уходит на модерацию уже после шага 1; шаги 2–4 досылаются ревизиями.
`completeness` (0..100) считается в `src/lib/coin-card-completeness.ts` по
взвешенному списку заполненных полей и показывается прогресс-баром — он же
мотивирует дозаполнять. Никто не заполнит 60 полей за один присест.

Старая форма и модель `CoinRequest` **сохраняются** на время: существующие
`PENDING` заявки должны дорабатываться в старой админке. Миграция данных —
скриптом, отдельным шагом плана, после того как визард работает.

## Публичная карточка

`/{locale}/coin/[slug]` получает новые секции, встроенные в существующий
`section-nav.tsx`. Ключевой элемент — **бейдж провенанса у каждого значения**:
«самозаявлено» / «проверено в блокчейне» / «по N рынкам», с временем обновления
в тултипе. Плюс:

- плашка уровня доверия (`CoinCardTrust`) вверху карточки;
- блок «История изменений» — публичный, из `CoinCardRevision` со статусом
  `APPLIED` (кто, когда, какое поле, было → стало);
- блок «Где принимается» со счётчиком точек и переходом на карту с фильтром по
  монете (данные — слайс F; в A рендерится, только если точки заданы руками).

## Границы слайса A

**Входит:** модель данных целиком, визард, публичный рендер с провенансом,
ревизии и их модерация, участники, права по разделам, приглашения, мультисиг,
публичная история изменений, уведомления.

**Не входит:** автопроверка контрактов через RPC (B), агрегатор рынков и
собственный ценовой индекс (C), доказательство владения подписью/DNS (D),
календарь разлоков (E), автосвязка с POI (F), донаты (G), выключение CoinGecko.

## Ошибки и валидация

Коды возврата серверных действий (единый стиль с `coin-request.ts`):
`unauth`, `forbidden`, `not_found`, `card_exists`, `symbol_required`,
`symbol_too_long`, `slug_taken`, `contract_required`, `contract_invalid`,
`chain_unknown`, `supply_inconsistent` (circulating > total > max),
`url_invalid`, `too_many_pending`, `last_owner`, `threshold_out_of_range`,
`threshold_unreachable`, `already_voted`, `not_a_signer`, `revision_closed`,
`invite_expired`, `invite_used`, `too_many_invites`.

Лимиты: ≤3 карточки в статусе `PENDING` на пользователя; ≤20 активных
приглашений на карточку; ≤20 контрактов и ≤200 рынков на карточку; логотип
≤6 МБ png/jpg/webp (как в `point/upload`); `tagline` ≤120 символов;
`description` ≤20000.

## Тестирование

Чистые функции — модульно, без базы (как `src/lib/coin-request.ts` и
`approve-request.ts` с `PrismaLike`):

- `coin-card-risk.ts` — классификация путей полей.
- `coin-card-completeness.ts` — 0 на пустой карточке, 100 на полной, монотонность.
- `coin-card-access.ts` — матрица роль × раздел; `ADMIN` не трогает `OWNER`.
- `multisig.ts` — порог достигнут / недостижим / истёк; авто-подпись автора;
  неизменность снимков при смене состава подписантов на ходу; `last_owner`;
  `threshold_unreachable`.
- `coin-card-diff.ts` — построение и применение `diff`.

Интеграционно (с базой): гонка двух переходов по одной ссылке-приглашению
(условный `updateMany` по `acceptedAt: null`, как в `company-invites.ts`);
двойной голос одного подписанта (`@@unique([revisionId, memberId])`).

## Открытые вопросы, сознательно отложенные

- Автоматическое удаление куратора при claim (сейчас — понижение до `EDITOR`).
- Публичная страница «кто ведёт карточку» (сейчас состав команды непубличен).
- Платный приоритет рассмотрения — **сознательно не делаем**: это превращает
  донат в платный листинг, другая юридическая и репутационная история.
