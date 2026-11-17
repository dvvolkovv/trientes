@AGENTS.md

# Always-on behaviors

- **Audio reply every turn.** Generate a Russian voice summary (OpenAI TTS → mp3) and emit `📎 attach: <abs-path>` in the reply (write the mp3 to `/home/dv/trientes-artifacts/audio/`, not the repo root) so the Telegram bot sends it. No exceptions, even for short answers or errors — the user reads with difficulty and voice is the primary channel ([[feedback_audio_summaries]]).
- **Persist the session across bot restarts.** Whenever `trientes-bot` is restarted (manually or after a 143/SIGTERM timeout), the next invocation must resume the prior Claude Code session (`claude --resume` / saved session id) instead of starting fresh — never lose conversation state on restart.
- **Фронт DEX (/exchange) — отдельный репозиторий `/home/dv/trientes-dex-ui`** (GitHub `dvvolkovv/trientes-dex-ui`). Перед любой правкой страницы обмена прочитай его `CLAUDE.md`. Файлы в `/var/www/trientes-exchange` руками не править никогда — только `npm run deploy -- org` из `/home/dv/trientes-dex-ui/dex-ui`.

# Project history (server only)

If the file `~/.claude/projects/-home-dv-trientes/memory/project_trientes_phase1.md` exists, read it — it documents phases 1-9 of the build (stack, deployed URLs, design language, worker cadences, server addresses, and known gotchas). On laptop checkouts the path won't exist; that's fine, skip silently.

# Phase 10 — Business cabinet (slice 1: legal entities)

Shipped 2026-05-24. Lets COMPANY-type accounts register a profile and submit crypto-accepting locations (shops, ATMs, POS, sales offices) that, once an admin approves them, are merged into the Crypto Navigator POI feed.

- **Spec:** `docs/superpowers/specs/2026-05-23-business-cabinet-map-points-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-23-business-cabinet-map-points.md`
- **Live URLs:**
  - `/{locale}/business` — company cabinet (auth-gated → /login when signed out; renders register form when no Company; profile + points list + add-point form once registered).
  - `/{locale}/admin/business` — moderation queue (ADMIN-gated via `admin/layout.tsx`); Approve / Reject + reason; writes `APPROVE_POINT`/`REJECT_POINT` to `AdminAuditLog`.
- **Data:** `User.accountType` (INDIVIDUAL | COMPANY); `Company` (1:1 with owner User); `CompanyPoint` (status reuses `RequestStatus` PENDING/APPROVED/REJECTED). Migration `20260523180000_business_cabinet`. Only APPROVED points are public.
- **Navigator merge:** `/api/crypto-map/poi` queries approved points fresh on every request (no cache) and merges them company-first with the OSM result, so admin approvals are visible immediately. Since 2026-11-06 the OSM half is a **local mirror of BTC Map** (`OsmCryptoPoi`, synced nightly at 02:40 by the worker — `src/lib/btcmap.ts` + `src/lib/osm-poi-store.ts`), not a live Overpass query: the public Overpass instances have been saturated for months and were silently returning nothing. Basemap tiles come from **OpenFreeMap** (key-less) — CARTO's keyless endpoint now watermarks every tile. The mapper sanitizes `socials` URLs to http(s) only — defense-in-depth against `javascript:` XSS in popups.
- **Limits / guards:** ≤20 PENDING points per company; ownerUserId @unique with P2002 caught → `already_company`; coord nullish-check rejects `(0,0)` Null Island; reject reason ≥3 chars; `socials` JSONB validated at mapper, not at write (issue worth revisiting if abuse surfaces).
- **Scope deliberately not in this slice (separate slices later):** kabinet физлица (individual cabinet + preferences + alerts) — slice #4; token listing — #3; price/geo alerts — #5/#6; online services without coords; team accounts; KYB verification; email notifications.
- **i18n:** `common.business`, `admin.tabs.business`, `admin.business.{title,subtitle,empty}`, and the full `business.*` namespace across all supported locales (список один — `SUPPORTED_LOCALES` в `src/lib/locales.ts`).

# Phase 10 — Individual cabinet (slice 4а)

Shipped 2026-05-24. Lets INDIVIDUAL users register with username + password, manage profile/preferences in a single `/cabinet` page, and consolidates the old `/settings` form into a section there.

- **Spec:** `docs/superpowers/specs/2026-05-24-individual-cabinet-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-24-individual-cabinet.md`
- **Live URLs:**
  - `/{locale}/register` — username + password + optional email; redirects to `/cabinet` on success; logged-in users bounced to `/cabinet`.
  - `/{locale}/login` — credentials form on top, Google/GitHub/Telegram below; honors `?next=` for post-login redirect.
  - `/{locale}/cabinet` — auth-gated; three sections (`#profile`, `#settings`, `#alerts`); COMPANY-type accounts redirected to `/business`.
  - `/{locale}/settings` — 30x → `/cabinet#settings` (legacy URL kept working).
- **Auth routes (custom, not Credentials provider):** `POST /api/auth/password/{register,login}` mirror `/api/auth/telegram/callback` — verify input → upsert `User` + `Account{provider:"credentials"}` → `createDatabaseSession()` → set Auth.js cookie. Database session strategy unchanged; no JWT migration. Session creation extracted into `src/lib/session.ts` and reused by telegram-callback (DRY refactor).
- **Data:** `User.{username @unique, passwordHash, firstName, lastName, phone}`; `LoginAttempt` audit table (ip, identifier, success, userId?, createdAt; indexed on `(ip, createdAt)` and `(identifier, createdAt)`). Migration `20260524180000_individual_cabinet`.
- **Password security:** `bcryptjs` cost 12. `verifyPassword` always pays bcrypt cost (uses `DUMMY_HASH` when user not found) to prevent timing-based account enumeration.
- **Rate limits (DB-backed, sliding window via `LoginAttempt`):** login = ≥10 failures per IP **or** ≥5 per (IP, identifier) in 15 min → 429; register = ≥5 registrations per IP per hour → 429 (uses identifier=`__register__` row). Recorded **before** the actual write so duplicate-username probes still tick the counter.
- **OAuth users without a username:** `ensureUsername(userId)` lazily assigns one on first `/cabinet` visit from `User.name` (stripped to `[a-z0-9_]`, fallback `"user"`); retries up to 5 times with `${base}${random4}` on P2002.
- **Navbar:** for logged-in users the Business link is replaced by **Cabinet** (INDIVIDUAL) or **Business** (COMPANY) based on `accountType`; logged-out users still see the generic Business link.
- **i18n:** `common.cabinet`, full `cabinet.*` and `register.*` namespaces across all supported locales.
- **Worker:** not touched — none of the new files under `src/lib` (`username`, `password`, `rate-limit`, `session`, `client-ip`, `ensure-username`) are imported by `trientes-worker`. Web-only restart sufficed.
- **Вход в админку из кабинета** (2026-11-17): у записи с ролью `ADMIN` в `/{locale}/cabinet` появился раздел «Панель администратора» (`src/components/cabinet/admin-section.tsx`, ключи `cabinet.admin.*`) — ссылки на те же девять очередей, что в полосе закладок `/admin`. Ссылка в шапке была только в бургер-меню, и с телефона админ её не находил. Заодно `/{locale}/admin` перестал отправлять вошедшего не-админа на `/login` (оттуда его возвращало обратно) — теперь в `/cabinet`, а не вошедшего на `/login?next=`. Роль читается из базы при каждом запросе (`callbacks.session` в `src/auth.ts`), так что повышение видно сразу после перезахода. Живая причина жалобы оказалась не в правах: `biotecbank@me.com` уже был `ADMIN`, а в браузере владелец сидел под другой своей записью (`poolwatt`, вход на шесть минут позже) — прежде чем править права, надо смотреть **последний сеанс по IP**, а не только роль. Почта владельца добавлена в `ADMIN_WHITELIST` — повышение выживет, если он когда-нибудь войдёт через Google и строка `Account` создастся заново.
- **Сброс забытого пароля по письму** (2026-11-17): `/{locale}/forgot-password` → письмо со ссылкой → `/{locale}/reset-password/[token]` → новый пароль и сразу вход. Маршруты `POST /api/auth/password/{forgot,reset}`, чистая часть в `src/lib/password-reset.ts`, таблица `PasswordResetToken` (миграция `20261117060000_password_reset`). Решения, которые стоит помнить: в базе лежит **только sha256 токена** (дамп таблицы не должен давать вход), ссылка живёт час и срабатывает один раз (гасится условным `updateMany` с `usedAt: null` — два одновременных перехода не сменят пароль дважды), просьба о сбросе всегда отвечает `{ ok: true }` (иначе ответ выдавал бы список наших пользователей — сбой отправки письма только в лог), новая просьба гасит прежние невостребованные ссылки, после смены пароля **все прежние сеансы удаляются** (сброс затем и нужен, чтобы выгнать чужого), а пришедшему через Google заводится строка `Account{provider:"credentials"}` — без неё новый пароль был бы записан впустую. Ограничитель на тех же строках `LoginAttempt` с приставкой `__reset__`: 10 просьб с адреса и **3 на один ящик** в час (ящик чужой, засыпать его письмами нельзя), запись до работы. Язык письма — язык кабинета (`preferredLocale`), а не страницы: человек мог открыть сайт на чужом языке с чужого устройства. Живой случай в тот же день показал цену молчаливого ответа: владелец набрал `bioteccbank@me.com` вместо `biotecbank@me.com`, получил «посмотрите почту» и ждал письма, которого никто не писал. Поэтому форма принимает **имя входа наравне с адресом** (`parseResetIdentifier`; страница входа принимает оба — просьба о сбросе обязана принимать столько же), а экран «письмо ушло» **показывает набранное обратно** отдельной строкой моноширинным — опечатку должно быть видно глазом. Сломанный адрес и негодное имя отвергаются вслух (`identifier_invalid`): это ничего не говорит о том, есть ли такой кабинет. Строка ограничителя пишется на **найденный ящик**, а не на набранное, иначе один ящик можно было бы засыпать письмами, называя его то адресом, то именем; порог на сам ящик молчаливый (громкий отказ выдавал бы, что ящик наш).

# Phase 10 — остальные слайсы (кратко)

Всё ниже уже в проде; подробности — в спеках и планах под `docs/superpowers/`.

- **Unified cabinet + exchange foundation** (слайс 2) — plan `2026-05-25-unified-cabinet-and-exchange-foundation.md`.
- **Карточка биржи + синк CoinPaprika** (слайс 3) — `/{locale}/exchanges/[slug]`, plan `2026-05-26-exchange-card-and-cp-sync.md`.
- **Алерты по цене и гео** (слайсы 5/6) — `worker/index.ts` гоняет `runAlerts()` каждую минуту (`cron.schedule("* * * * *")`), логика в `src/lib/alerts-eval.ts`; каналы Telegram → email → web-push (`src/lib/notify.ts`).
- **Фин-тех каталог** (слайс 7) — `/{locale}/fintech`, spec+plan `2026-05-30-fintech-directory*`; HQ-пины домешиваются в POI-фид навигатора.
- **Нативные Substrate-монеты** (слайс S, 2026-11-07) — spec+plan `2026-11-07-coin-card-substrate*`. У монеты, которая является нативной единицей своей сети (Taler), контракта нет, поэтому слайсы B и E её не видели. Привязка — поле `CoinCard.nativeChain` (ключ из реестра `src/lib/substrate-chains.ts`: taler, polkadot, kusama; узел переопределяется через `SUBSTRATE_RPC_<KEY>`). Читаем по обычному HTTP JSON-RPC: `Balances.TotalIssuance` → проверенный выпуск, `System.Account` → балансы адресов исключений (SS58 с проверкой префикса), `system_properties` → тикер и знаки, `Timestamp.Now` на двух блоках → измеренное время блока, разница лучшей и финализированной голов → финальность. Ключи хранилища выводятся в коде (`src/lib/substrate-codec.ts`, свой xxhash64/twox128 + blake2_128concat), а не вставлены хексом. Прогоны в воркере: факты сети `35 * * * *`, выпуск `45 * * * *` (`CoinCardSupply.method = "SUBSTRATE_V1"`, `address` = хэш генезиса). Заявление проекта в `payments` не затирается: рендер предпочитает факт и показывает заявление рядом при расхождении >10%. Комиссия перевода читается слайсом T (ниже).
- **Проверенная комиссия перевода** (слайс T, 2026-11-07) — spec+plan `2026-11-07-coin-card-transfer-fee*`. Комиссию считает сам узел: собираем экстринсик `Balances.transfer_keep_alive` одной монеты с подписью-пустышкой и спрашиваем `payment_queryInfo`. Неподписанный экстринсик бесплатен (узел отвечает `partialFee: "0"`), поэтому подпись обязательна, хотя и фиктивная; набор подписанных расширений у сетей разный (`CheckMetadataHash` есть у Polkadot и Kusama, нет у Taler), поэтому вариант подбирается попыткой. Индекс палеты балансов (taler 6, polkadot 5, kusama 4) пришпилен в `src/lib/substrate-chains.ts` и охраняется `transactionVersion`: разошлась — комиссия становится `runtime_changed`, а не показывается устаревшей. Факт живёт в `CoinCardChainFacts.transferFee*`, читается тем же прогоном `35 * * * *`. USD **не хранится** (цена меняется каждые 10 минут) — считается в рендере из `CoinCardPriceIndex`; у монеты без рынков видна только комиссия в монетах. Расхождение с заявленным `payments.feeUsdTypical` — код `FEE_USD` в `mismatches`, значимым считается разница больше и 10 %, и цента. Живые числа 7 ноября: Taler 0,00000263 TAL, Polkadot 0,0159 DOT, Kusama 0,000533 KSM. Декодера метаданных рантайма в проекте по-прежнему нет, экстринсики никуда не отправляются.
- **Карточки, проверенные в сети, на 21 монете** (слайс V, 2026-11-09) — spec+plan `2026-11-09-coin-card-verified-rollout*`. Карточки заводим мы, а не проект: таблица посева — код (`src/lib/coin-card-seed.ts`), скрипт `scripts/seed-chain-cards.ts` (без флага — посев в PENDING идемпотентно, `--fill` — прочитать сеть, `--dump` — таблица для сверки глазами, `--publish` — открыть только те, где факты сошлись; фильтр `--family=SUBSTRATE|COSMOS`). Куратора и компании у такой карточки нет — плашка `SEEDED` говорит это прямо и ведёт на claim. Одиннадцать сетей Substrate (polkadot, kusama, bittensor, astar, hydradx, peaq, creditcoin, enjin, polymesh, moonbeam, moonriver) читаются кодом слайсов S и T; выпуск Polkadot и Kusama берётся с Asset Hub (`SUBSTRATE_ISSUANCE_RPC_<KEY>`). Polkadot и Kusama в первом прогоне посева не участвовали по неочевидной причине: каталог монет наполняется категорией **layer-1** в CoinGecko (`fetchTop100L1`), а DOT и KSM у них лежат не в ней, поэтому строк `Coin` просто не было — монеты добавлены вручную как `ADMIN_ADDED` (`scripts/add-coin.ts`), и только после этого посев их увидел. Комиссия перевода не читается у трёх сетей Substrate и это честный `fee_unsupported`: у hydradx не совпал набор подписанных расширений, у moonbeam и moonriver адреса 20-байтные и `MultiAddress` в вызове перевода не применяется. Вторая семья — **Cosmos SDK** (`src/lib/cosmos-chains.ts` + `src/lib/cosmos-rest.ts`, обычный REST, переопределение `COSMOS_REST_<KEY>`): celestia, injective, dydx, kava, atomone, provenance, initia, saga, secret. Идентичность сети у Cosmos — **chain-id**, а не хэш генезиса (`CoinCardChainFacts.family/chainId/minGasPrice`, миграция `20261109060000_chain_facts_cosmos`, `genesisHash` стал nullable); финальность достигается в том же блоке; комиссию перевода этой семье никто не считает — узел сообщает только минимальную цену газа, она показывается с базовым деномом. Тикер и знаки Cosmos берутся из реестра денома узла, и у injective, kava, secret его нет — тогда поля просто не проверены (подставлять своё значение нельзя). Выпуск Cosmos — `method = "COSMOS_V1"`, `address = chainId`; охранник доли (`supply_share`) не даёт выдать выпуск одной сети за весь выпуск монеты, такая карточка показывает строку «выпуск в этой сети». Монета без рыночного снимка (Secret, AtomOne, Saga) отдаёт страницу «только карточка» — раньше это был 404. Отставание финализации больше `FINALITY_LAG_MAX = 600` блоков в секунды не превращается: живой прогон поймал у публичного узла Astar отставание 9810 блоков, то есть застрявшую финализацию, а не скорость сети.
- **Конвейер листинга** (слайс W, 2026-11-09) — spec+plan `2026-11-09-coin-card-listing-conveyor*`. Карточек, проверенных в сети, стало **37**: добавлены одиннадцать сетей Cosmos (cosmoshub, osmosis, akash, juno, axelar, neutron, stride, dymension, persistence, agoric, band) и пять Substrate (acala, darwinia, vara, unique, avail), все значения сняты живым запросом. Ключ Cosmos Hub — `cosmoshub`, а не `cosmos`: родовое слово семьи сетью не считается (охранник в `resolveCosmosChain`). Главное в слайсе не сети, а **прогон `runListingSweep()`** (`src/lib/coin-card-listing-sweep.ts`, воркер `25 4 * * *`): он сам заводит монету для строки посева (`ADMIN_ADDED`, тикер и название — из реестра сети, потому что каталог наполняется категорией layer-1 CoinGecko и она неполна), сам заводит карточку в PENDING и сам публикует её, но только если карточке больше суток, факты и выпуск прочитаны без ошибок, расхождений нет и чтение свежее трёх часов; иначе карточка ждёт человека, а причина отказа пишется в лог (`publishBlocker`). Лимиты часовых прогонов фактов и выпуска поднялись с 50 до 100 карточек. Префикс SS58 теперь читается при любом написании ключа (`ss58Format`, `SS58Prefix`, `ss58format`) — Moonbeam, Moonriver и Vara впервые реально сверяются, а не молчат. Живой прогон вскрыл три дефекта, и все починены: у Neutron CoinGecko отдаёт `total_supply` 6,2e27 (база в поле монет) и охранник доли прятал верный выпуск — опорное число выбирает `pickAggregated`; узел Neutron не реализует `base/node/v1beta1/config` (501) и из-за необязательной цены газа падало всё чтение фактов; карточка, у которой первое чтение сорвалось, застревала в `genesis_mismatch` навсегда, потому что пустая записанная идентичность сравнивалась как «узел переехал». Комиссия перевода читается только у avail (палета 6); у acala и unique перевод не декодируется ни при одном индексе, у vara подтверждение слабое (комиссии двух вызовов расходятся в 1,56 раза), у darwinia адреса 20-байтные — везде честный `fee_unsupported`. Отвергнуты в этом слайсе: centrifuge (у CoinGecko запись CFG с нулевым оборотом), sei/evmos/kujira/stargaze/thorchain (нет публичного REST нужного вида), mantra (на своей сети 210 696 OM из ~1,8 млрд), bifrost (узел публикует префикс 0 вместо 6).
- **Посев рынков карточек** (слайс X, 2026-11-09) — spec+plan `2026-11-09-coin-card-market-seed*`. Слайс C (восемь коннекторов к биржам и взвешенная медиана) в проде не считал ничего: рынок заявляет проект, а у 36 карточек, посеянных нами, проекта нет — `CoinCardMarket`, `CoinCardPriceIndex` и `CoinCardPricePoint` были пусты, и вместе с ними молчали комиссия перевода в долларах, капитализация и график. Теперь рынок заявляем мы: `src/lib/coin-card-market-seed.ts` ищет пары монеты в тех же снимках бирж и пишет `CoinCardMarket` **без цены** — цену ставит сверка слайса C, автор значения один. Главная опасность — тикер-двойник (`SAGA`, `BAND`, `UNQ` на биржах носят и другие активы, а охранник `base_mismatch` тут бессилен): найденная цена сверяется с опорной из последнего `CoinSnapshot` (CoinGecko как **проверка порядка величины**, в карточку это число не попадает), допуск 25 %, опора старше 48 часов не защищает (`no_reference`). Второй охранник родился из живого прогона: спор сначала считался по объёму, и застрявшая `BUSD`-пара (`POLYX/BUSD` — цена вчетверо выше стейбл-пар, объём 548 тыс., ровно 4000 сделок) убивала карточку с четырьмя здоровыми рынками; теперь спор считается **по биржам** — биржа, не согласная с опорой ни одной парой, считается несогласной, и если таких не меньше, чем согласных, карточка не сеется (`reference_conflict`). Крипто-котировки (`BTC`, `ETH`) от себя не сеем: цена такой пары приходит через два наших числа, и `KSM/BTC` с `POLYX/BTC` разошлись со стейбл-парами на 55–60 %. Итог живого прогона: 171 рынок на 22 карточках, индекс каждой сошёлся с ценой монеты в пределах 0,84 %; не сеются 6 монет без свежей опоры (Moonbeam, Moonriver, Secret, AtomOne, Saga, Initia), 4 без пар (Provenance, Juno, Stride, Unique) и 4 со спором (Acala, HydraDX, Neutron, Persistence — у Acala и Neutron Binance с настоящим объёмом расходится с CoinGecko в 6–8 раз, это вопрос к данным). Прогон в воркере — `40 4 * * *`, сразу после конвейера листинга, и он сам зовёт сверку слайса C. Скрипт `scripts/seed-card-markets.ts` (`--dump`, `--card=`).
- **Семья Bitcoin** (слайс Y, 2026-11-09) — spec+plan `2026-11-09-coin-card-bitcoin-family*`. Третья семья сетей: `src/lib/bitcoin-chains.ts` + `src/lib/bitcoin-rest.ts`, карточки у bitcoin, litecoin, dogecoin, dash, digibyte. Слайс не про ещё один ридер, а про решение по каждому факту: **выпуск в UTXO-цепи мы не показываем**. Его доказывает только `gettxoutsetinfo` (сумма всего UTXO-множества), и публичный узел его не выполняет — живой запрос к `bitcoin-rpc.publicnode.com` (полная нода, 891 ГБ) обрывается через 30 с ошибкой брокера. Расписание эмиссии отвергнуто: это наше вычисление, а не факт сети, и у Dogecoin оно просто неверно (до блока 600 000 награда была случайной). Поэтому в `CoinCardSupply` пишется `method = "BITCOIN_V1"`, `checkError = "supply_unsupported"`, у `SupplySyncStats` появилось поле `unsupported` (не `failed`: это свойство семьи, а не сбой), а `publishBlocker` и `--publish` этот код пропускают — иначе карточка Bitcoin ждала бы человека вечно. **Идентичность — хэш блока 0 и контрольный блок:** генезис у форков общий (BCH, BSV, BTG родились из блока 0 Bitcoin), поэтому у bitcoin в реестре пришпилен блок 800 000, и подмена узла на форк даёт `genesis_mismatch`. **Финализации нет:** числа остаются `null`, в карточке стоит «вероятностная» — соглашение о шести подтверждениях принадлежит получателю, а не сети. **Комиссия — модель с названными слагаемыми:** цену за байт оценивает узел, размер эталонного перевода (1 вход, 2 выхода: 141 vB segwit, 226 Б legacy) задан реестром. Два транспорта, один набор фактов: ESPLORA (`mempool.space`, `litecoinspace.org`, `digiexplorer.info`) и BLOCKCYPHER (dogecoin, dash — Esplora для них не нашлось). Классификация сбоя своя и важная: **4xx — ответ узла** (`rpc_error`, повтора нет), **5xx и 429 — связь** (`rpc_unreachable`, один повтор); без этого отсутствующий у Litecoin `/fee-estimates` ронял бы все факты цепи. Тикер и знаки из этих API не читаются и не подставляются из реестра (тот же случай, что injective/kava/secret). Живые числа 9 ноября: BTC блок 727 с (замер по 100 блокам — цепь шла медленнее десяти минут, по 1000 блокам 663 с), комиссия 141 сатоши ≈ $0,105; LTC 175,6 с; DOGE 66,3 с, 0,1506 DOGE; DASH 153,9 с; DGB 13 с. Отвергнуты: bitcoin-cash (генезис общий с BTC плюс нет публичного API нужной формы — Trezor Blockbook отдаёт серверу 403 Cloudflare), zcash, bitcoin-gold, ravencoin, vertcoin, monacoin, namecoin, syscoin — живого адреса не нашлось. Адрес узла переопределяется `BITCOIN_API_<KEY>`.
- **Нативные монеты EVM** (слайс Z, 2026-11-09) — spec+plan `2026-11-09-coin-card-evm-native*`. Четвёртая семья и первая, у которой **финализация настоящая**: тег `finalized` отдаёт блок, который сеть считает необратимым. Код EVM в проекте был с слайса B, но он читает контракты токенов, а у нативной монеты контракта нет — поэтому ETH, BNB, AVAX, POL и прочие для карточек не существовали. Теперь 14 карточек: ethereum, bsc, polygon, avalanche, cronos, sonic, berachain, sei, hyperliquid, mantle, celo, flare, ronin, kaia (всего сетевых карточек **56**). Ридер — `src/lib/evm-chain-read.ts` (головы, замер времени блока, цена газа), реестр остался **один** (`evm-chains.ts`): это тот же протокол, что сверяет контракты, и второй реестр для тех же адресов разошёлся бы — у сети просто появились закреплённые `chainId`, `genesisHash?`, `symbol`, `decimals`, `transferGas`. **Идентичность — `chainId`, и проверка жёсткая:** он закреплён консенсусом (входит в подпись как защита от повтора), поэтому несовпадение — подмена адреса, а не переезд сети, и числа не пишутся вовсе; в Cosmos то же поле читается из заголовка блока как самоназвание узла и там это мягкое расхождение. Хэш генезиса — дополнительная проверка там, где узел отдаёт блок 0 (Cronos и Hyperliquid не отдают, и это не сбой); сравнение без учёта регистра — узел Sei отвечает заглавными. **Комиссия самая чистая из четырёх семей:** цену газа оценивает узел, а 21 000 газа за перевод без данных — константа протокола, а не выбранный нами размер, как в Bitcoin. **Выпуска нет** (`EVM_NATIVE_V1` / `supply_unsupported`): у нативной монеты нет `totalSupply()`, сумму балансов не считает никто. **Порог застрявшей финализации переехал из блоков в секунды** (`FINALITY_SECONDS_MAX = 2 ч` вместо `FINALITY_LAG_MAX = 600`) — это касается всех семей: у цепи с блоком 0,25 с шестьсот блоков это две минуты, то есть прежний порог отрезал бы настоящую финальность, а живые Mantle (612 блоков = 20 мин) и Ronin (611 = 20 мин) теперь показываются, тогда как Astar (16,4 ч) и Celo в сорванном чтении (519 512 блоков) по-прежнему нет. Отрицательное отставание (финализированная голова впереди лучшей — живой случай Sei и Hyperliquid, головы читаются двумя запросами) приводится к нулю. Живые числа: ETH блок 12 с, финализация 1020 с, комиссия 0,0000141 ETH ≈ $0,03; BNB 0,45 с и финализация 0,9 с; у Cronos, Sonic, Sei, Hyperliquid, Flare, Kaia финализация в том же блоке. Не входят **L2 на чужой монете** (Arbitrum, Optimism, Base — их нативная монета тот же ETH, карточка одна на монету; в посеве их нет, и это закреплено тестом), **Gnosis** (нативная единица — стейблкоин xDAI) и **Tron**: у него есть `/jsonrpc` с методами `eth_*`, но публичный TronGrid без ключа отвечает 429 на второй запрос подряд. Адрес узла переопределяется `EVM_RPC_<KEY>`; `bsc-rpc.publicnode.com` повторяемо отдаёт нашему серверу 403, поэтому в реестре `bsc-dataseed.bnbchain.org`.
- **Ночной отчёт здоровья** (слайс AA, 2026-11-09) — spec `2026-11-09-health-report-design.md`. Воркер в `0 6 * * *` (09:00 МСК) присылает владельцу в Telegram одно сообщение: замолчавшие прогоны (возраст того, что каждый пишет — строка в базе или **остаток TTL** ключа Redis; журнала запусков в проекте нет), коды ошибок чтения сетей и выпуска по 56 карточкам, доли `5xx`/`429`/`404` в `/var/log/nginx/access.log` за окно, которое лог реально покрывает (после ротации это не сутки — отчёт говорит сколько), и живой `GET` трёх страниц снаружи. Свежий прогон и живая страница в отчёте **не упоминаются** — отчёт на двадцать одинаковых строк перестают читать. Шлём не через `notifyUser`: у обоих админов сайта Telegram не привязан, почта выключена — адресаты в `HEALTH_REPORT_CHAT_IDS` (по умолчанию `BOT_ALLOWED_USER_IDS`), то есть тот же бот и чат, где владелец говорит с ассистентом. Право на лог дано ACL (`setfacl` на `/var/log/nginx` + default-ACL, чтобы ротация его не теряла), а не группой `adm`: группы берутся процессом при старте, а бота посреди сессии перезапускать нельзя. Нет прав — отчёт выходит без раздела nginx, а не падает. Руками: `npx tsx scripts/health-report.ts [--send]`.
- **Цена Taler с нашего обмена и оборот за вычетом заморозки** (слайсы AB и AC, 2026-11-11) — spec `2026-11-11-own-dex-market-design.md` и `2026-11-11-taler-circulating-vesting-design.md`. У Taler нет ни одной биржи: монета торгуется только на нашем обмене, и сверка слайса C (она считает цену по снимкам бирж) оставляла карточку без цены, индекса и графика. Пятый источник — **сам обмен**: он стоит в отдельной сети Trientes (`rpc1/rpc2`, монета TRI), читается через `state_call` теми же приёмами, что слайсы S и T (`SwapApi_tickers/_coins/_pairs/_quote`); запись монеты переменной длины разбирается **с хвоста** и принимается, только когда знаки сошлись с реестром тикеров. Цена — **середина двух направлений** (маркет-мейкер держит разные спрос и предложение; шире 10 % — отказ), размер пробной заявки подбирается, крипто-котировки не берём. Объём сеть не публикует вовсе — поле пустое, а не нулевое. Автор значения один: рынок помечен биржей `Trientes DEX` (`isOwnDexMarket`), сверка слайса C его не трогает, в индекс он идёт своей ценой, пока свежее трёх часов. Прогон `50 * * * *`, и он же разносит обмен по всем карточкам: монета, которой обмен торгует только к BTC или ETH (живой случай — Litecoin), получает строку рынка **без цены** — «этой монетой торгуют у нас» утверждение само по себе, а доллар через второе наше же число не считается; сбой чтения стейбловой пары остаётся сбоем и прежнюю цену не стирает. В разделе «Рынки» свой обмен идёт первой строкой, с логотипом. **Капитализация считается по обороту, и оборот — факт сети:** заморозка у Taler сделана палетой `vesting` (восемь счетов, 136 111 109,75 TAL каждый, срок на блоке 52 560 000 — десять лет при шести секундах на блок), и `src/lib/substrate-vesting.ts` обходит всю карту расписаний **на одном блоке** (ключи и значения — с одним `at`, иначе сумма относилась бы к двум состояниям сети). Ключ без значения — отказ, а не ноль: ноль занизил бы заморозку и завысил оборот. Сбой заморозки срывает чтение выпуска целиком (`vesting_unreadable`), прежние числа карточки остаются: выпуск без вычета хуже, чем вчерашний верный. Включено **только у taler** (`SubstrateChain.vestingLocked`) — у чужой сети карта может быть на тысячи счетов, и оборванный обход занизит заморозку молча. **FDV теперь считается только по заявленному `tokenomics.max`**: прежний запасной вариант (текущий выпуск) у монеты без потолка возвращал в карточку замороженную часть, а у монеты без исключений дословно повторял капитализацию. Живые числа 11 ноября: цена 11 985,30 $, выпуск 1 435 891 583,42 TAL, заморожено 1 088 888 878, оборот 347 002 705,42, капитализация ≈ 4,16 трлн $ — она целиком следует из цены маркет-мейкера, и это вопрос к цене, а не к расчёту.
- **Логотипы бирж в рынках и монеты на карточке биржи** (слайс AD, 2026-11-12) — spec `2026-11-12-exchange-logos-and-coins-design.md`. Две дыры, видные глазом. Первая: в разделе «Рынки» логотип был у одной строки из девяти — у нашего обмена, а имя биржи становилось ссылкой только при `tradeUrl`, который заполнен у 5 рынков из 406. Теперь у каждой строки логотип из каталога бирж и **внутренняя** ссылка на карточку биржи; связь «коннектор → строка каталога» пришпилена в реестре (`directoryId` в `src/lib/cex-registry.ts`), потому что id расходятся у половины бирж (`coinbase` → `gdax`, `bybit` → `bybit_spot`, `mexc` → `mxc`, `okx` → `okex`) и из данных не выводятся. Вторая: карточка биржи не показывала ни одной монеты — раздел пар читает `ExchangeMarket`, а эта таблица **пуста по всем биржам** (её наполняли детальные вызовы CoinPaprika, 60 запросов в час на весь мир). Список монет считается из **снимка тикеров биржи** (`src/lib/exchange-coins.ts` + `src/components/exchange-card/coins.tsx`), и идём от монеты к снимку, а не наоборот: символ пары у каждой биржи свой, разбирать его на базу и котировку — гадание, зато коннектор умеет собрать кандидатов символа. Отсюда честная формулировка «монеты нашего каталога, которые биржа торгует»: 64–109 монет на биржу живым прогоном. Охранник тикера-двойника тот же, что в слайсе X (цена сверяется с последним `CoinSnapshot`, допуск 25 %, опора старше 48 ч не защищает), монета без свежей опоры в список не идёт и считается вслух строкой под таблицей. Котировки только стейбловые. Живой прогон вскрыл дефект производительности: `coin.findMany` со связью `snapshots: { take: 1 }` по 201 монете на 450 тыс. снимков — 6,2 с и 355 МБ, pm2 убивал веб по памяти и страницы отдавали 502; `LEFT JOIN LATERAL` (`src/lib/coin-reference.ts`, тот же приём, что в `readTop100`) — 92 мс и 18 МБ. Там же нашлось, что у запущенного процесса `max_memory_restart` отстал от `ecosystem.config.js` (300 МБ вместо 768 МБ) — веб перезапущен из файла.
- **Свой обмен в карточке: ссылка на пару, суточный объём, «Топ бирж»** (слайс AE, 2026-11-12) — spec `2026-11-12-own-dex-pair-link-volume-design.md`. Четыре дыры, замеченные глазом. Знак валюты в рельсе своего листинга стоял дважды (`${formatPrice(...)}` при том, что форматтер сам ставит `$`) и не слушался выбранной валюты — рельс получил валюту и курсы со страницы. Ссылка рынка нашего обмена вела на `/exchange/` без пары, то есть на биткойн; теперь это хеш-путь `#/swap/<отдаёте>-<получаете>` с монетой карточки на принимающей стороне (`TAL/USDT` → `#/swap/USDT-TAL`), и он пишется каждым прогоном, а не только при создании строки. Суточный объём, который слайс AB объявил непубликуемым, на самом деле есть — но не в реестре сети, а в **ряде свечей службы заявок** (`/exchange-api/candles/<пара>/1h`): доллар считается по цене закрытия каждой свечи, пустой ряд даёт `null`, а не ноль, сбой чтения прежнее число не стирает; живое число 12 ноября — **$195,95** у `TAL/USDT`, а у рынков обмена для BTC, ETH, DOT и LTC ряда нет и объём остаётся пустым. Раздел «Топ бирж» появился у монеты без рыночного фида: `cardTopExchanges()` строит те же строки из рынков карточки, `TopExchange.volumeUsd` стал nullable и таблица показывает «—» вместо `$0.00`. Перевод локалей — одной командой `npm run i18n` (`--all` по `SUPPORTED_LOCALES`), прогон идемпотентный. **Taler в основном списке монет не появился намеренно:** строку `Coin` завести несложно, но рейтинг по капитализации ставит его первым (≈4 163 млрд $ против 1 489 млрд $ у Bitcoin при суточном объёме сделок в 196 $) — это вопрос к цене маркетмейкера, а не к расчёту, и решение за владельцем.
- **Оборот без стейкинга и знаки бирж в «Топ бирж»** (слайс AF, 2026-11-12) — spec `2026-11-12-locked-supply-and-exchange-marks-design.md`. Просьба была вычесть из оборота стейкинг, а не только вестинг. Живой обход показал, что **вычитать сложением нельзя**: сеть не суммирует блокировки, а берёт наибольшую, и у Taler вестинг (1 088 888 878 TAL) и стейкинг (1 088 963 410 TAL) — это одни и те же монеты, заложенные теми же восемью счетами. Поэтому исключением стал не вид заморозки, а то, что сеть считает неподвижным: **сумма максимумов по счетам карты `Balances.Locks`** (`src/lib/substrate-locks.ts`, флаг `locksExcluded` в реестре сетей; читатель расписаний `substrate-vesting.ts` удалён вместе с кодом ошибки `vesting_unreadable` → `locks_unreadable`). Имя блокировки добито **пробелами** (`staking `), а не нулями — иначе хвост уезжает в подпись строки расчёта. Итог живого прогона: 284 счёта, неподвижно 1 088 963 410 из 1 435 891 583, оборот **346 928 172,74 TAL** вместо 347 002 705,42 — разница 0,02 %, капитализация 4,1620 вместо 4,1629 трлн $. **То есть исключение стейкинга проблему огромной капитализации не решает и решить не может:** она следует из цены маркетмейкера (11 997 $ за монету при суточном объёме сделок 196 $), а не из учёта оборота. Вторая половина слайса: в таблице «Топ бирж» у каждой строки появился логотип и внутренняя ссылка на карточку биржи — связь «имя из фида → каталог» по **имени** (`exchangeDirectoryByName`), поэтому логотипы есть у всех бирж фида (BTCC, CoinUp.io, BloFin, Pionex…), а не только у восьми наших коннекторов; наш обмен написан оранжевым со своим логотипом.
- **Языки интерфейса** (2026-11-11) — одиннадцатая локаль **hr** (хорватский). Переводы заводит скрипт `scripts/translate-messages.ts <locale>` (`--force`, `--dump`, `--restyle`): форму файла задаёт `messages/en.json`, поэтому расхождение по ключам невозможно по построению, а глоссарий в системном сообщении держит термин одним словом во всём интерфейсе. Граница файлов — `tests/messages-parity.test.ts`: загрузчик подмешивает английский как базу, так что пропущенный ключ не падает, а тихо выходит на сайт по-английски; тест требует повтор формы en, сохранность плейсхолдеров и долю совпадений с английским ниже 25 %. Список локалей один — `SUPPORTED_LOCALES`; своя копия в коде уже однажды отставала на язык.
- **Карточка точки на весь экран и ведение с телефона** (слайс AI, 2026-11-15) — spec `2026-11-15-poi-sheet-fullscreen-navigation-design.md`. Карточка точки была попапом MapLibre шириной 240 px внутри окна карты: на телефоне в неё не попадал палец, а управление маршрутом было размазано по трём местам страницы (режим — над картой, сводка и «Вести» — под ней, «проложить сюда» — в попапе). Теперь это React-лист (`src/components/coin-detail/poi-sheet.tsx`): на телефоне он открывается **на весь экран устройства**, на десктопе — панель слева внутри карты (справа стоят кнопки масштаба и «моё положение»). Управление маршрутом живёт только в нём: таблетки «пешком / авто / транспорт» (56 px) пересчитывают маршрут **к точке карточки**, под ними сводка и пошаговые подсказки, в липком подвале — «Маршрут сюда» и «Поехали». Подписи кнопок не повторяются ни в одном состоянии (`footerActions`, юнит-тест) — иначе клик по имени был бы неоднозначен и для человека, и для e2e. Как только линия нарисована, лист **стыкуется** к низу (55vh), а карта на телефоне разворачивается `fixed inset-0`, иначе над листом видна не карта, а кусок страницы; маршрут вписывается в видимую часть — `fitRoute()` меряет высоту самой карточки и отдаёт её в `padding.bottom`. Ведение включается во всех трёх режимах (требование `route.mode === "walk"` снято; у транспорта манёвров нет, поэтому голос молчит, но остаток, ETA и «вы приехали» работают) и идёт во весь экран: баннер манёвра сверху, снизу полоса с остатком, ETA, 🔊, «Пересчитать» и «Стоп» с учётом `env(safe-area-inset-bottom)`. Побочно: панель «Доступно в CC» на телефоне начинается свёрнутой — раскрытая она занимала 256 px из ~320 и закрывала карту. Попапный HTML (`buildCard`/`hydratePhoto` и `.cmap-*` стили) удалён, в навигаторе осталась одна сборка сырого HTML — логотип куратской точки.
- **Плитка кредиткой, логотип в шапке и память страницы** (слайс AJ, 2026-11-15) — spec `2026-11-15-poi-card-tile-and-route-memory-design.md`. Три жалобы глазом. Первая — настоящая ошибка: страницу листалки выбирал не человек, а сетевой ответ. `buildRoute().then` и `routeTo()` насильно ставили страницу «Карта», и человек, успевший уйти на «Место», через секунду возвращался обратно — то же самое при каждом пересчёте (фикс GPS, перетаскивание булавки, смена режима). Маршрут при этом всегда жил отдельно от страницы (`route` + `destKey` + `routePoi`), так что «помнить маршрут» ничего не стоило: страницу просто перестали трогать, и её меняют только закладка, жест и открытие карточки (всегда на «Месте», в том числе из кнопки «Открыть карточку» под картой). Вторая: баннер на «Месте» был лентой `h-40` (на 390 px это 2,24 : 1) — теперь плитка в пропорции ISO 7810 ID-1 (`aspect-[856/540]`, одна константа `TILE_CLASS` в `src/lib/poi-tile.ts` на оба места), во всю ширину, с раскрытием снимка на весь экран. Третья: окно карты занимало всю карточку, а кнопки висели полосой поверх — теперь окно это та же плитка, а управление маршрутом стоит **под ней** на непрозрачном фоне. Свёрнутая плитка карты **берёт нажатие на себя** (нажатие на пустое место карты означает «поставь сюда мою булавку», и в окошке с кредитку это была бы ловушка), раскрытая палец отдаёт карте и сворачивается ручкой сверху; жест разбирает чистая `settleTile()` — вертикаль принадлежит плитке, горизонталь листалке. `fitRoute()` больше не меряет полосу управления, а мерит **саму плитку** (`tilePadding`) — одно правило на оба состояния, у раскрытой прямоугольник просто больше; пока маршрута нет, точка ставится в середину окна (`tileOffset` → `map.easeTo({ offset })`). В шапке появился логотип заведения: `Poi.logoUrl` — логотип точки, иначе компании (финтех и куратские точки свой уже имели), у точки зеркала BTC Map его нет и остаётся кружок слоя. Ведение не трогали: во время движения карточка по-прежнему прячется.
- **Компас по движению, непрозрачная страница заведения и подсказка над картой** (слайс AL, 2026-11-15) — spec `2026-11-15-compass-heading-and-sheet-surface-design.md`. Три жалобы глазом. Первая: компаса телефона в навигаторе не было нигде, кнопка под картой умела только «север вверх», и едущий на юг видел свою дорогу сверху вниз, то есть «назад». Теперь у синей точки есть **луч курса** (своя метка `src/lib/heading-beam.ts` — опции `showUserHeading` в MapLibre 6 больше нет; `rotationAlignment: "map"`, собирается узлами, а не строкой разметки), а кнопка стала переключателем с тремя действиями (`src/lib/compass-mode.ts`): повёрнутую пальцами карту первое нажатие выпрямляет, второе включает слежение за курсом, следующее выключает — середина не лишняя, кнопка одна и без неё из повёрнутой карты нет выхода. Курс выбирается по скорости (`src/lib/heading.ts`): едешь — GPS, стоишь — компас телефона (граница та же `MOVING_MPS` = 0,6 м/с; неизвестная скорость — это не «стоит»; поворот меньше 3° — дрожание датчика). Компас слушается обоими событиями (`deviceorientationabsolute` и `deviceorientation` с `webkitCompassHeading`), относительная ориентация отбрасывается — её ноль не север, а разрешение на iOS спрашивается **из нажатия**, из эффекта нельзя. Во время ведения слежение молчит, пока человек едет: карту там крутит курс маршрута. Живой прогон поймал две ошибки — метка добавлялась на карту до появления координаты (`undefined.lng`) и градиент луча светил из нижнего края метки, где конуса нет. Вторая жалоба: **карта просвечивала сквозь страницу заведения** — фон листа зависел от страницы, а страница меняется только в конце жеста, поэтому «Место» ехало поверх живой карты без подложки; фон переехал с корня на сами страницы (`bg-card` у каждой, кроме карты), шапка полупрозрачна только у отстоявшейся карты. Третья: **подсказка манёвра наезжала на карту** и закрывала тот перекрёсток, к которому вела — теперь это строка над картой (в полном экране своя полоса с `env(safe-area-inset-top)`, карта занимает остаток). Попутно: полотно MapLibre позиционировано абсолютно, а контейнер был `static` — без своего начала отсчёта карта растягивалась на весь `fixed`-экран и накрывала строку собой.
- **Жест с любого места, баннер во весь экран и логотип на точке** (слайс AK, 2026-11-15) — spec `2026-11-15-poi-swipe-banner-logo-design.md`. Листалка карточки точки заедала по двум разным причинам, и обе чинятся разным: браузер забирал начавшийся наискось жест себе (лечится `touch-action: pan-y` на корне листа), а сама карточка слушала жест только с дорожки страниц и только от края экрана на странице «Карта». Теперь обработчики на корне (шапка и закладки листают тоже), а край нужен **только раскрытому** окну карты — у свёрнутой плитки перетаскивать нечего; пороги опущены под живой палец (8 px, перевес оси 1,2, переворот на пятой части ширины). Попутно вскрылось, что **раскрытая карта пальца не получала вовсе**: лист во весь экран ловит нажатия и с прозрачным фоном, поэтому на странице карты корень стал `pointer-events: none`, а события берут только непрозрачные части; раскрытой карте оставлены две полоски по 24 px у краёв как поле жеста. Плитка (и баннер, и окно карты) получила закруглённые углы одной строкой `TILE_SHELL`; окно карты — дыра, и рамку вокруг него красит тень самой плитки (`box-shadow: 0 0 0 100vmax`), из-за чего понадобился явный порядок рисования: шапка и закладки `relative z-10`, полоса управления `relative`. Нажатие на баннер раскрывает его **на весь экран** (`poi-banner-overlay.tsx`), ручка поднимает его вверх и открывает под ним витрину заведения с кнопкой «это моё предприятие» у незанятой точки; оверлей живёт **порталом в `document.body`** — дорожка страниц сдвигается `transform`, а трансформированный предок делает `position: fixed` отсчётом от себя, и «во весь экран» получалось шириной в три страницы (поймано живым прогоном). На точке со знаком заведения теперь виден **логотип** (белый кружок 28 px с кольцом цвета слоя): это элемент DOM, а не значок слоя карты, потому что значку нужен растр с заголовком CORS, а половина знаков — svg и чужие хосты; цена — фильтры слоёв применяются к метке руками (`showsLogoMarker`, накрыто тестом), адрес проверяется как ссылки витрины, битый знак снимает метку и оставляет круг слоя.
- **Ведение общественным транспортом за руку** (слайс AM, 2026-11-15) — spec `2026-11-15-transit-hand-guidance-design.md`. Режим «транспорт» рисовал линию и молчал: подсказки собираются из манёвров OSRM, а составной маршрут приходит от MOTIS и манёвров не содержит. Теперь ответ MOTIS разбирается целиком (`TransitLeg`: остановки посадки и выхода с координатами, платформа, `headsign`, расписание ноги, `realTime`, промежуточные остановки, длина геометрии), и у маршрута появилось время прибытия. **Турн-бай-турн внутри пешей ноги мы не изобретаем:** живой ответ отдаёт двадцать девять шагов `CONTINUE` на триста метров с пустыми улицами — настоящая в них только смена уровня (лестница из вестибюля метро), поэтому поворот произносится, только если маршрутизатор его назвал. Подсказка считается **по ногам и по остановкам** (`src/lib/transit-guidance.ts`): идёшь — «идите 320 м до Staroměstská», дошёл — «садитесь на метро A в сторону Nemocnice Motol, платформа 2», едешь — «выходите на Dejvická, 3 остановки», осталась одна — «следующая остановка ваша», приехал — «выходите здесь». Полосы объявлений у рейса не метровые, а по остановкам: «через четыреста метров выходите» в метро не значит ничего. До поездки то же самое видно ниткой (`transit-itinerary.tsx`), и она раскрыта сразу. **ETA в транспорте — по расписанию**, а не «остаток линии ÷ темп хода»: темп измерен пешком, а до выхода тридцать километров. **Перестройки на ходу в транспорте нет** (`AUTO_REROUTE.transit = false`): GPS в тоннеле уходит на сотни метров, и человек в едущем вагоне получал бы новый маршрут с другой пересадкой каждые пятнадцать секунд; кнопка «Пересчитать» остаётся. Живой прогон в Праге прошёл всю цепочку фраз по одному разу и вскрыл два дефекта (часы в формате браузера вместо языка страницы; одна фраза дважды на ноге в шестнадцать метров — `SpokenPhrases`). Ключ кэша маршрутов стал `cmap:route:v2:…`: записи прежней формы ведение считать не умеет.
- **Главная:** бегущая строка под шапкой + зверь настроения рынка (бык/медведь, обводка по фото). **`/{locale}/compare`** — сравнение монет, ссылка есть в бургер- и десктоп-меню и в `sitemap.xml`.

**Известные дыры (нужно решение владельца, не код):**
- **Рынки держатся на неофициальном фиде CNBC** (`quote.cnbc.com`, без ключа) — см. обновление от 2026-11-06 в `docs/superpowers/specs/2026-05-23-markets-stooq-design.md`. Stooq и Yahoo блокируют IP сервера, CME банит за автоматический доступ (их ToS). Ключ **Twelve Data** получен 2026-11-09 и лежит в `.env` как `TWELVE_DATA_API_KEY`, но код его не читает: тариф Basic (8 запросов/мин, 800/сутки) из 10 инструментов табло отдаёт только XAU/USD, остальные на нём недоступны (ETF доступны). Решение владельца — остаться на CNBC, ключ держать в резерве. Ещё вариант — **FRED** (официально, но только дневное закрытие).

# Phase 11 — Админка как управление делами (слайс AN)

Шипнуто 2026-11-17. Спека `docs/superpowers/specs/2026-11-17-compliance-case-management-design.md`,
план `docs/superpowers/plans/2026-11-17-compliance-cases-foundation.md`.

Админка была девятью закладками с таблицами, непригодными для телефона, и в ней нельзя
было ни ответить заявителю, ни увидеть, кто что сверил, ни померить труд. Взята мировая
модель комплайнса — **управление делами** (Sumsub, Alloy, Persona): заявка это не строка
в таблице, а дело с очередью, сроком, листом проверок, перепиской, двумя подписями и
неизменяемым журналом. **Главное решение: один слой дела поверх всех типов заявок**, а не
шесть почти одинаковых реализаций в девяти таблицах.

- **Живые адреса:** `/{locale}/admin/queues` (плитки очередей, вход в админку теперь сюда),
  `/{locale}/admin/queues/[queue]` (список дел), `/{locale}/admin/cases/[id]` (раскрытие).
- **Данные:** `ComplianceCase` (@@unique subjectType+subjectId — у объекта ровно одно дело),
  `CaseEvent` (только вставка), `CaseTimeEntry`; миграция `20261117120000_compliance_cases`.
  Статус самого объекта (`CoinCard.status`, `Company.status`…) остаётся источником правды
  для публикации — дело ведёт процесс, а не заменяет его.
- **Два разных числа времени, и путать их нельзя.** *Срок перед заявителем* (`dueAt`,
  `slaSeconds`) — часы **останавливаются** на `WAITING_APPLICANT` (`pausePatch`/`resumePatch`
  сдвигают `dueAt` ровно на простой), иначе молчание заявителя съедало бы срок проверяющего.
  *Время в руках* (`handledSeconds`) — сумма сеансов: страница бьёт раз в минуту, нет биения
  5 минут → сеанс закрывается **последним биением, а не «сейчас»**, простой работой не
  считается. Измерение честно приблизительное (меряет время с открытым делом, а не
  размышление), поэтому правка руками разрешена только с причиной и ложится в журнал.
- **Сбой заведения дела не роняет подачу заявки** (`ensureCase` ловит и пишет в лог):
  заявка человека дороже строки в очереди, осиротевшую подберёт идемпотентный
  `scripts/backfill-cases.ts`. Живой посев 17 ноября завёл 33 дела.
- **Правила вида в одном месте** (`src/lib/admin-ui.ts`, накрыто тестом): действие — всегда
  кнопка высотой 48 px во всю ширину, а не подчёркнутое слово (пальцем в слово не попасть);
  содержимое — колонка по центру, на компьютере та же колонка шире.
- **Срок в рабочих днях** считается без праздничного календаря — суббота и воскресенье всё,
  что мы знаем наверняка (`SLA_BUSINESS_DAYS`: обычная заявка 5, KYB 10, точка 3).
- **Старые экраны очередей не тронуты** и работают до слайса AP.
- **Что дальше:** AR — надзор над залистованным предприятием (AP и AQ шипнуты).
- **Найдено живым прогоном:** в очереди бирж 31 заявка PENDING с мусорными именами от
  ботов (gmail с точками-алиасами, случайные юзернеймы). Форма `/exchange` подачи заявки
  ничем не защищена — вопрос к владельцу, ставить ли капчу и чистить ли очередь.

## Слайс AO — переписка по делу и колокольчики

Шипнуто 2026-11-17. План `docs/superpowers/plans/2026-11-17-compliance-case-messaging.md`,
спека та же (`2026-11-17-compliance-case-management-design.md`, раздел «Переписка (портал RFI)»).
До него дело было монологом: ответить заявителю из админки было нельзя, а заявитель не знал
о своей заявке ничего.

- **Живые адреса:** нитка — раздел 3 в `/{locale}/admin/cases/[id]` (журнал съехал на 4:
  разговор нужнее журнала); `/{locale}/admin/notifications` — колокольчики сотрудника;
  `/{locale}/cabinet/cases/[id]` — та же нитка глазами заявителя, вход из раздела
  «Ваши заявки» в `/cabinet` (`/business` — редирект на `/cabinet#companies`, свой раздел
  там не нужен).
- **Данные:** `CaseMessage` (side STAFF|APPLICANT, `attachments` JSONB, два штампа
  прочтения), `AdminNotification` (kind APPLICANT_REPLIED|DUE_SOON|CASE_OVERDUE|
  APPLICANT_SILENT), `ComplianceCase.firstResponseAt`, два вида события журнала
  (`MESSAGE_SENT`, `MESSAGE_RECEIVED`); миграция `20261117190000_case_messaging`
  (писана руками и применена `migrate deploy`: чекаут — прод, `migrate dev` умеет
  предлагать сброс базы).
- **Вложения приватны, и это сознательный отход от спеки.** Спека говорила «те же корни,
  что у логотипов и фото точек»; взято строже: `CASE_ATTACHMENTS_ROOT`
  (`/var/www/trientes-private/cases`) и отдача через `GET /api/case-attachment/[caseId]/[name]`
  с проверкой «админ или заявитель этого дела». Публичный `/uploads/` отдаёт nginx вообще
  без проверки, а в переписке комплайнса ходят уставы и паспорта — та же спека велит держать
  KYB-документы вне публичных корней. Имя файла придумываем мы (24 hex + расширение), и это
  единственная защита пути склейки — `isSafeAttachmentName`. svg в белый список не входит:
  это исполняемая разметка. **При переносе на другую машину каталог надо воссоздать**, как
  `trientes-uploads`.
- **Флажок «нужен ответ»** (включён по умолчанию) — только с ним дело уходит в
  `WAITING_APPLICANT` и часы срока встают. Без флажка статус и часы не трогаются: иначе
  любезная приписка «спасибо, смотрим» заморозила бы срок навсегда и дело выпало бы из
  поля зрения. Решённое дело (`APPROVED`/`REJECTED`/`CLOSED`) сообщением не открывается
  заново — это дело человека, а не реплики в нитке.
- **Непрочитанное считается по стороне, а не по человеку** (так в спеке): у сообщения два
  штампа, поэтому любой админ, открывший дело, гасит «непрочитано» для всей смены. Личное
  живёт в `AdminNotification`. Значок (🔔 с числом) стоит на плитке очереди и в строке дела;
  подсчёт — один `groupBy` по делам экрана, а не запрос на строку.
- **Звонок про молчание — новый повод, которого в спеке не было.** Часы стоят — значит,
  просрочки не случится никогда, и дело могло висеть месяцами. Поэтому `WAITING_APPLICANT`
  дольше 14 дней (то же число, которым спека меряет молчание в AQ) звонит взявшему дело.
  Прогон `runCaseDueSweep` в воркере на `10 * * * *`: просрочка важнее приближения, дело
  без взявшего молчит (безадресный звонок будил бы всех админов), один повод по одному делу
  звонит один раз (проверка по всем звонкам, а не только непрочитанным), непрочитанный
  звонок тем же поводом не плодится, а обновляется.
- **Заготовки — на языке кабинета заявителя**, а не страницы сотрудника: текст прочитает он
  (прецедент — письмо сброса пароля). Письмо/Telegram заявителю — там же, `notify.caseMessage.*`.
  Текст служебных уведомлений сотруднику по-английски, как во всех прежних вызовах `notifyUser`.
- **Заявителю статус пишется другими словами:** `cabinet.cases.status.WAITING_APPLICANT` —
  «ждём ваш ответ», а не «ждём заявителя». Поэтому namespace свой, а не переиспользование
  `admin.case.status.*`.
- **Попутно:** `pickLocale` вынесен из маршрута сброса пароля в `src/lib/locales.ts` — своя
  копия списка локалей в проекте уже однажды отставала на язык. Переписку видит только тот,
  кто подал заявку (`applicantUserId`): редактор компании нитку владельца не читает.
- **Живой прогон 17 ноября** (временное дело, заведено и удалено): наше сообщение →
  `WAITING_APPLICANT` и часы встали; ответ заявителя → `IN_REVIEW`, часы пошли, `dueAt`
  сдвинулся ровно на 120 минут простоя; прогон сроков дал один `CASE_OVERDUE`, повторный —
  молчание; два звонка про ответ схлопнулись в одну строку; каскад убрал за собой всё.
  Снаружи: `401` на вложение без сеанса, `400` на имя с выходом из каталога.

## Слайс AP — лист проверок, две подписи, аналитика по сотрудникам

Шипнуто 2026-11-17. План `docs/superpowers/plans/2026-11-17-compliance-checks-signatures.md`,
спека та же (`2026-11-17-compliance-case-management-design.md`, разделы «Правило четырёх
глаз» и «Часы: два разных числа»). До него дело умело вести переписку, но решение
по-прежнему принималось на старой таблице одним нажатием одного человека без следа того,
что именно сверили.

- **Живые адреса:** разделы 3 «Проверки», 4 «Документы» и 6 «Решение» в
  `/{locale}/admin/cases/[id]` (журнал съехал на 7); `/{locale}/admin/staff` — труд
  сотрудников числами, закладка «Staff» второй в полосе админки.
- **Данные:** `CaseCheck` (@@unique caseId+key), `CaseDocument` (@@unique caseId+url),
  подписи и решение в `ComplianceCase` (`reviewedById/At`, `approvedById/At`,
  `soleSignOff`, `decision`, `decisionReason`), виды событий `REVIEWED`/`CHECK_SET`/
  `DOCUMENT_VERDICT`; миграция `20261117210000_case_checks_signatures` (руками +
  `migrate deploy`).
- **Лист проверок живёт в коде, состояние — в базе** (`src/lib/cases/checklists.ts`,
  8 листов по типу заявки, 28 пунктов). Строка `CaseCheck` появляется только когда
  сотрудник по пункту высказался. Заведи строки при открытии дела — и список замрёт
  на том виде, в каком был в день подачи: новый пункт не появится у уже открытых дел.
  Ключи нарочно общие между типами (`websiteLive`, `sanctionsScreened`,
  `noMisleadingClaims`) — одна подпись на один вопрос; тест требует подпись каждому
  ключу и запрещает подписи без пункта.
- **«Проблема» одобрение не блокирует.** Блокирует только пункт без ответа. Решение
  требует, чтобы по каждому обязательному пункту был дан *ответ*, а не чтобы все
  ответы были «да»; механически блокируй FAIL — и проверяющий, которому надо пустить
  заявку с одним честным «нет», переправит FAIL в NA, и показатель начнёт врать.
  **FAIL и NA требуют примечания** (≥3 символа, порог причины отказа): «не применимо»
  без причины через год не значит ничего.
- **Отказ второй подписи не требует** — он ничего не публикует, а заявитель может
  подать заново; требование двух глаз на отказ держало бы годную заявку, пока второй
  сотрудник не придёт. Причина обязательна.
- **Подпись одним лицом.** Правило требует двух живых людей, поэтому у единственного
  сотрудника одобрение проходит с `soleSignOff = true` и словами в журнале
  «утверждено одним лицом, второго не было». Молчаливое послабление было бы хуже
  отсутствия правила. Сейчас в базе три `ADMIN`, так что путь не срабатывает — но он
  накрыт тестом, а не ждёт первого увольнения.
- **Документы в деле заново не загружаются.** `CaseDocument` собирается из двух уже
  существующих источников — `Company.kybDocuments` и вложения сообщений **заявителя**
  (наши собственные вложения судить незачем); приватный корень из AO остаётся
  единственным местом файлов. Сбор идемпотентен и зовётся при открытии дела; строка
  **не удаляется**, даже если документ исчез из источника: его видели и по нему
  высказались, снос стёр бы вердикт. Вердикт `RESUBMIT` блокирует и подпись, и
  одобрение.
- **Решение сначала применяется к объекту, и только потом пишется в дело**
  (`src/lib/cases/decide.ts` зовёт те же проверенные экшены старых экранов, а не
  переписанную копию их логики). Объект уже решён вне дела или исчез (`not_pending`,
  `not_found`) — дело закрывается как `CLOSED` **без решения**, иначе оно висело бы в
  очереди навсегда; у 33 дел посева это живой случай.
- **Старые экраны перестали показывать ожидающие заявки** (`QueueMoved` на
  `/admin/requests`, `/admin/exchanges`, `/admin/fintech`, `/admin/coin-cards` и в
  трёх видах `/admin/business`). Решение, принятое там, прошло бы мимо листа проверок,
  мимо переписки и мимо второй подписи — две двери к одному решению означают, что
  правила четырёх глаз нет. История решений (вкладки «approved»/«rejected»), владение
  карточками, правки, удалённые записи и курируемый финтех на этих экранах остались;
  у отклонённого финтеха кнопка «approve» в истории тоже осталась — это отмена
  прежнего решения, а не первое решение.
- **Труд считается на того, кто вёл дело** (`reviewedById ?? assigneeId`), вторая
  подпись — отдельное число: сложи их, и утвердивший чужое дело за минуту выглядел бы
  как закрывший его. В числа идут **только настоящие решения** (`decision != null`) —
  дело, закрытое из-за решённого вне дела объекта, решением сотрудника не является.
  Среднее время до первого ответа считается только по делам, где ответ был (иначе ноль
  врал бы), а «время в руках» прямо на экране названо приблизительным.
- **Ролей комплайнса по-прежнему нет**, хотя спека обещала их в этом слайсе: правило
  четырёх глаз различает людей, а не роли, разделять пока нечего, и роль, выданная не
  тому из трёх админов, заблокировала бы одобрение вообще. Вводить вместе с третьим
  живым сотрудником.
- **Живой прогон 17 ноября** (временное дело и временный админ, оба удалены): «проблема»
  без причины отвергнута вслух; FAIL закрыл обязательный пункт и одобрение не
  заблокировал; «проверил» перевело дело в `READY_FOR_APPROVAL`, после чего «Одобрить»
  погасло с надписью под кнопкой «вы проверяли это дело, утвердить должен кто-то
  другой»; отказ по делу с исчезнувшим объектом закрыл дело как `CLOSED` без решения;
  журнал читается рассказом («пункт «Screened against sanctions lists»: problem»).
  Прогон же вскрыл дефект: у закрытого без решения дела подпись раздела говорила
  «ждём вторую подпись» — добавлен `summaryClosed`.

## Слайс AQ — жалобы на точки

Шипнуто 2026-11-17. План `docs/superpowers/plans/2026-11-18-point-reports-aq.md`,
спека та же (`2026-11-17-compliance-case-management-design.md`, раздел «Жалобы на
точки»). До него посетитель, нашедший закрытый магазин, не мог сказать об этом
никому: карточка точки показывала адрес и часы и молчала.

- **Живые адреса:** кнопка «Сообщить о проблеме» на странице «Место» в карточке точки
  навигатора; `POST /api/point-report`; раздел «Жалобы» в `/{locale}/admin/cases/[id]`
  у дел очереди `pointReports`.
- **Данные:** `PointReport` (pointId, reporterUserId?, reporterIpHash, reason, comment?,
  photoUrl?), поля надзора у `CompanyPoint` (`underReviewAt`, `suspendedAt`,
  `suspendReason`), четыре вида события журнала (`POINT_REPORTED`, `POINT_ASKED`,
  `POINT_WARNED`, `POINT_SUSPENDED`), вид звонка `POINT_REPORTED`, коды аудита
  `SUSPEND_POINT`/`UNSUSPEND_POINT`; миграции `20261118060000_point_reports` и
  `20261118070000_point_supervision_audit` (руками + `migrate deploy`).
- **Жалоба принимается только на нашу точку** (`company/<id>`, `reportablePointId`).
  У точки зеркала BTC Map нет ни владельца, которому писать, ни способа её снять:
  ночной синк вернёт её обратно, и кнопка обещала бы то, чего мы не сделаем.
- **Фото от анонима не принимаем.** Колонка `photoUrl` заведена (спека её называет),
  но форма её не показывает и маршрут не принимает: загрузка файла от человека,
  которого мы не знаем, — отдельная дыра, а приватный корень вложений из AO рассчитан
  на автора, который у нас есть.
- **Снять точку по одной жалобе нельзя** — иначе конкурент закроет любой магазин
  одним нажатием. Порог — **три независимые жалобы за 60 дней**, и независимость
  считается по человеку, если он вошёл, и по адресу, если нет (`independentReporters`):
  один человек с телефона и с ноутбука иначе был бы двумя. Плюс не чаще одной жалобы
  в сутки с адреса на одну точку.
- **Лестница эскалации** (`escalationFor`, прогон `runPointReportSweep()` в воркере на
  `20 5 * * *`): порог достигнут → точка получает пометку «проверяется» (видна в
  карточке, но с карты не снята) и предприятию уходит вопрос в ту же нитку дела; нет
  ответа 14 дней → предупреждение; ещё 14 дней молчания → точка снимается с карты с
  записью причины. **Ответ предприятия лестницу останавливает** — дальше решает
  человек, а не часы: разговор начался, и автоматическое снятие посреди него было бы
  хамством. Раз в сутки, а не в час: шаги считаются днями.
- **Состояние лестницы читается из журнала дела**, а не из новых колонок: `CaseEvent`
  неизменяем и уже есть, а колонка под каждый шаг потребовала бы держать её в согласии
  с журналом руками.
- **Снятие — надзор, а не отмена решения модератора:** `CompanyPoint.status` остаётся
  `APPROVED`, с карты точку убирает `suspendedAt` в запросе фида. Вернуть её — одно
  действие, а не повторный проход через очередь.
- **Решение по делу жалобы названо своими словами:** «одобрить» тут значит
  «подтвердить жалобу и снять точку», «отклонить» — «вернуть точку»; подписи кнопок
  свои (`admin.case.decision.pointReport.*`), иначе это читалось бы как «одобрить
  точку». Номера разделов на странице дела стали считаться (`nextNo()`), потому что
  раздел «Жалобы» есть только у своего типа дела.
- **С жалобщиком переписки нет** (так в спеке): `applicantUserId` дела — владелец
  предприятия, с ним и ведётся диалог. Звонок сотрудникам — один, на первой жалобе по
  делу: каждая следующая звонила бы по десять раз за вечер, а делать с одной жалобой
  всё равно нечего.
- **Живой прогон 17 ноября** (на настоящей точке, всё убрано за собой) прошёл цепочку:
  повтор с того же адреса отвергнут (`too_soon`), при двух жалобах прогон молчит, при
  трёх — пометка, вопрос владельцу по-русски (язык его кабинета), дело в
  `WAITING_APPLICANT` с остановленными часами, журнал
  `OPENED → POINT_REPORTED ×3 → POINT_ASKED`, повторный прогон молчит. Прогон вскрыл
  дефект: `notifyApplicantOfMessage` читал строки через `getTranslations`, а тот вне
  запроса падает (`not supported in Client Components`) — сообщение в нитке появлялось,
  а владелец о нём не узнавал. Появился `src/lib/messages-raw.ts` (чтение перевода без
  контекста запроса, английский как база — как в `src/i18n.ts`), и письмо заявителю
  теперь читается им же.

# Phase 10 — Командные аккаунты

У компании может быть несколько сотрудников. Роли `CompanyRole`: **OWNER** (всё, включая команду и KYB), **EDITOR** (профиль и точки), **VIEWER** (только чтение). Доступ везде решается через `CompanyMember`, а не через `Company.ownerUserId` (поле осталось для модерации и аудита).

- **Где:** `/{locale}/cabinet/companies/[id]` → секция «Команда». Гейты — `src/lib/business.ts` (`getViewerCompanyById`, `canEditCompany`, `canManageMembers`).
- **Два способа позвать человека:**
  1. По юзернейму или email — `inviteMember()` в `src/app/actions/company-members.ts`; работает, только если аккаунт уже есть.
  2. **Ссылка-приглашение** — `src/app/actions/company-invites.ts` + `src/lib/company-invites.ts`; для тех, у кого аккаунта нет. Одноразовая, живёт 14 дней, ≤20 активных на компанию, отзывается владельцем. Приём — `/{locale}/invite/[token]`; у гостя ссылки на `/login?next=…` и `/register?next=…`, после регистрации он возвращается на страницу приглашения. Гонку двух переходов по одной ссылке снимает условный `updateMany` (`acceptedAt: null`) — членство получает только первый.
- **Защита от потери контроля:** последнего OWNER нельзя ни понизить, ни удалить (`last_owner`).
- **Редиректы после входа** чистятся через `safeNext()` (`src/lib/safe-next.ts`) — `//evil.com` и `/\evil.com` отбрасываются.
- **Модель:** `CompanyMember` (миграция `20260531080000_company_members`, бэкфилл владельцев) и `CompanyInvite` (миграция `20261105170000_company_invites`).
- **Уведомления:** при добавлении и при приёме приглашения владельцам уходит `notifyUser` (Telegram, email и web-push).

**Гигиена репозитория:** голосовые отчёты и скриншоты ассистента в корне НЕ хранятся — писать их в `/home/dv/trientes-artifacts/{audio,screens}/` (туда же убран архив прежних 181 файла). Корневые `*.png` / `*.mp3` на всякий случай в `.gitignore`.

# Языки интерфейса — правило

Правка `messages/en.json` без перевода остальных выходит на сайт по-английски
(загрузчик подмешивает английский как базу). После любой правки английского
файла — `npm run i18n`; прогон идемпотентный, уже переведённое не трогает.
Граница — `tests/messages-parity.test.ts`.

# Почта

- Своего почтового сервера нет: домен `trientes.org` заведён на Mailcow Селянской — `mail.selyanska.eu` (`165.245.254.8`, отдельный дроплет DO). MX, SPF, DKIM (`dkim._domainkey`) и DMARC — в DO-зоне `trientes.org`.
- Ящики: `listing@` (заявки на листинг) и `noreply@` (отправитель сайта); алиасы `postmaster@`, `abuse@`, `dmarc@` → `listing@`.
- Управление доменом: доменный админ Mailcow `trientes-admin`, вход на `https://mail.selyanska.eu/domainadmin/` (создан 2026-11-09). Видит только `trientes.org`: ящики, алиасы, пароли, квоты; `selyanska.eu` и `nadi.me` ему недоступны. Пароль есть только у владельца, на сервере и в репозитории его нет. Пароль `noreply@` без одновременной замены `SMTP_PASS` в `.env` и рестарта `trientes-web`/`trientes-worker` не менять, иначе сайт перестанет слать почту.
- Сайт шлёт через `src/lib/email.ts` (nodemailer, SMTP 587 + STARTTLS, логин `noreply@trientes.org`). Ключи — `SMTP_*` в `.env`; без `SMTP_USER`/`SMTP_PASS` письма молча пропускаются (`email_not_configured`).
- Новая заявка на `/request` → письмо на `LISTING_REQUESTS_TO` (по умолчанию `listing@trientes.org`), код в `src/lib/listing-desk.ts`. Форма на `/request` — мастер карточки монеты (`CoinCardWizard`): письмо уходит после шага 1, когда `createCoinCard` создал карточку в PENDING, со ссылкой на `/en/admin/coin-cards` (шаги 2–4 заявитель может дозаполнять позже). Старый `submitCoinRequest` (`CoinRequestForm`, сейчас нигде не показан) шлёт такое же письмо со ссылкой на `/en/admin/requests`. Сбой письма заявку не роняет: только `console.error` с `cardId`/`requestId`.
- Пароли ящиков в чат, логи и коммиты не выводить.

# Загрузки пользователей (важно)

Next.js запекает содержимое `public/` в сборку, поэтому файлы, записанные туда
**после** `npm run build`, отдаются как 404 — это ломало логотипы карточек монет,
фото точек и KYB-документы (баг жил незамеченным, потому что до 2026-11-06 ни
одной загрузки в проде не было).

Решение: файлы лежат в `/var/www/trientes-uploads/{coin-cards,points}` и отдаются
напрямую nginx (`location ~ ^/uploads/(coin-cards|points)/`). Корни заданы в `.env`:
`COIN_CARD_LOGO_ROOT` и `POINT_PHOTOS_ROOT`. KYB-документы сознательно **не**
попадают под это правило — они приватные и по URL недоступны.

При переносе проекта на другую машину эти два каталога и блок nginx нужно
воссоздать, иначе загрузки снова начнут отдавать 404.

# Deploy & push (server only)

This `/home/dv/trientes` checkout **IS the live production box** (trientes.org), not a clone. There is no separate deploy step over the wire — the site serves straight from this directory via PM2.

- **Deploy = local build + pm2 restart.** After changing code: `npm run build`, then `pm2 restart trientes-web`. For any change under `src/lib` that the worker imports, **also restart `trientes-worker`** — it runs via `tsx` and pins lib source at boot, so a web-only restart leaves the worker executing stale lib code (it will keep overwriting Redis caches with old-shaped data). `pm2 save` after.
- **Always push from here yourself.** The deploy key has write access; `git push origin main` works from this server. The laptop no longer pushes — never defer a push to it and never leave commits unpushed.

Full procedure, cadences, and the worker stale-lib gotcha: see the `project_trientes_deploy_from_server.md` memory.

# iOS builds (via the Mac at home)

This server cannot build iOS apps (Linux). For iOS work, drive the Mac at
home through the existing reverse SSH tunnel — `/home/dv/bin/mac-ios`
SSHes back through `localhost:2222` and invokes a fastlane lane on the
Mac:

```bash
/home/dv/bin/mac-ios --lane build_sim            # ~2 min — simulator smoke + unit tests
/home/dv/bin/mac-ios --lane release_testflight   # ~5 min — signed IPA → TestFlight
```

Always invoke with the absolute path — non-interactive `claude -p` does
not load `~/.profile`, so `~/bin` is not on PATH.

Source of truth: `~/trientes-ios/` on the Mac. Bundle ID `org.trientes.ios`.
Apple Dev account is **separate** from poolwatt's — team `MU88T5DUW2`
(TRUST CHANGE SP Z O O), ASC API key at `~/.trientes-ios-secrets/` on the Mac.

# Android builds (on this server)

Unlike iOS, Android builds run directly on this Linux server. A Capacitor
app at `~/trientes-android/` wraps `https://trientes.org` in a WebView
and produces a debug-signed APK.

```bash
/home/dv/bin/android-build                # build + publish (default)
/home/dv/bin/android-build --no-publish   # build only, no copy to /downloads/
```

Downloads land at:
- `https://trientes.org/downloads/trientes.apk` — always latest
- `https://trientes.org/downloads/trientes-build-<N>.apk` — versioned
- `https://trientes.org/downloads/` — autoindex listing

Builds keep on disk the newest 20 versioned APKs (~80 MB ceiling).

# Future project — «Нигингур» (global legal marketplace)

Working name: **Нигингур** (Nigingur) — from the Sumerian concept of a lawkeeper / righteous judge (see the memory file for the etymology caveat: this exact form isn't attested; the documented Sumerian legal terms are `di-ku5` = judge, `níĝ-si-sá` = justice/equity, `níĝ-gi-na` = truth). Brand chosen anyway for uniqueness and mythic weight.

**Vision:** an "Uber for lawyers" — a global marketplace where any lawyer, notary, or legal consultant can register, fill in a professional card, and be matched in real time to citizens who submit a legal request through a web form. Client submits problem → system routes to available lawyers by jurisdiction / specialty / language → instant online consultation (chat/video/call) → payment flows through platform.

**Not yet built.** Currently a concept only. Save further design decisions, roadmap, and iteration notes under the `project_nigingur_legal_marketplace` memory file, not in this CLAUDE.md.

**Brand & logo direction:** ancient Sumerian symbol of law rendered as a **chromed metal medallion**. Anchored on the historically authentic **rod-and-ring** symbol (the ancient Mesopotamian emblem of divine law — seen on the Hammurabi and Ur-Nammu stelae) plus the **rayed sun disc of Utu/Shamash** (Sumerian god of justice, patron of judges). Simple, memorable, symmetrical, ceremonial.
