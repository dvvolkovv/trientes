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
- **Вход через Taler ID** (2026-11-19, `src/lib/taler-id.ts`, кнопка `src/components/taler-id-button.tsx` на `/login` и `/register`): OIDC-провайдер `talerid`, издатель `https://api.talerid.io/oauth`, PKCE S256 + state + nonce, scope строго `openid profile email` (самозаведённый клиент Taler ID других не получает). Профиль — из `/oauth/me` (`idToken: false`): в id_token у Taler ID один `sub`. Почта берётся **только при `email_verified: true`** — тогда вход привязывается к существующей записи с тем же адресом (`allowDangerousEmailAccountLinking`) и срабатывает `ADMIN_WHITELIST` в `linkAccount`; неподтверждённая почта не сохраняется вовсе. Включается парой `TALERID_CLIENT_ID` / `TALERID_CLIENT_SECRET` в `.env` (без них провайдера и кнопки нет), redirect URI клиента — `https://trientes.org/api/auth/callback/talerid`. Своей ссылки «создать аккаунт» у страницы входа Taler ID нет: Taler ID заводится в его приложении. Тесты — блок «Taler ID sign-in» в `tests/auth-nextauth-regression.test.ts`. **nginx:** в `location /` сайта (`/etc/nginx/sites-available/trientes`) стоят `proxy_buffer_size 16k`, `proxy_buffers 8 16k`, `proxy_busy_buffers_size 32k` — ответ server action на кнопку несёт cookie PKCE/state/nonce и адрес Taler ID, при буфере 4k по умолчанию nginx отдавал 502 «upstream sent too big header» (2026-11-19). Не убирать; копия конфига до правки — `/etc/nginx/trientes.site.bak-20261119`.
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
- **Языки интерфейса** (2026-11-11) — одиннадцатая локаль **hr** (хорватский); двенадцатая **sk** — см. уборку AU ниже. Переводы заводит скрипт `scripts/translate-messages.ts <locale>` (`--force`, `--dump`, `--restyle`): форму файла задаёт `messages/en.json`, поэтому расхождение по ключам невозможно по построению, а глоссарий в системном сообщении держит термин одним словом во всём интерфейсе. Граница файлов — `tests/messages-parity.test.ts`: загрузчик подмешивает английский как базу, так что пропущенный ключ не падает, а тихо выходит на сайт по-английски; тест требует повтор формы en, сохранность плейсхолдеров и долю совпадений с английским ниже 25 %. Список локалей один — `SUPPORTED_LOCALES`; своя копия в коде уже однажды отставала на язык.
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
- **Что дальше:** слайсы AN–AR шипнуты; следующего в этой линии пока нет.
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

## Слайс AS — права комплайнса по очередям и настоящая вторая подпись

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-17-compliance-staff-roles-design.md`,
план `docs/superpowers/plans/2026-11-17-compliance-staff-roles-as.md`. До него роль была одна
(`ADMIN`) и означала всё: нанятый проверять карточки монет видел KYB-документы, пользователей
и журнал аудита, а «правило четырёх глаз» различало людей, а не право утверждать.

- **Живые адреса:** раздел «Сотрудники и доступ» и форма приглашения на `/{locale}/admin/staff`
  (только владелец); `/{locale}/staff-invite/[token]` — приём ссылки.
- **Данные:** значения `Role.{STAFF,OWNER}` (`ADMIN` оставлен и читается политикой как
  владелец — убрать значение enum внутри одной миграции нельзя, а оставить его бесправным
  значило бы запереть живую запись владельца); `StaffMember` (должность, обязанности, срок
  пересмотра, отзыв с причиной), `StaffGrant` (`userId × очередь × уровень`, необязательный
  срок), `StaffInvite` (пакет доступа, в базе только sha256 ссылки); `AdminNotification.subjectId`
  (миграция `20261118150000_notification_subject`) — звонок `ACCESS_REVIEW_DUE` первый, который
  говорит не о деле, а о человеке, и привязать его к `caseId` нечем.
- **Три уровня на очередь, запрет по умолчанию.** `VIEW` смотрит, `HANDLE` ведёт (берёт дело,
  пишет заявителю, отвечает по пунктам, ставит первую подпись), `APPROVE` утверждает; нет
  строки `StaffGrant` — очередь человеку не видна вовсе. Политика — чистые функции
  (`src/lib/authz/policy.ts`), охранник над Prisma — `guard.ts`, карта «экран → требование» —
  `map.ts` (ею же проверяется полнота). **Доступ читается из базы на каждом запросе**, поэтому
  снятое право действует сразу: живой прогон снял `coinCards` у сотрудника, и тем же сеансом,
  без перезахода, очередь и страница дела стали 404.
- **Истёкший срок права гасит его сам** — проверка в политике, а не в прогоне: прогон мог бы не
  состояться, и право прожило бы лишний день. Живой прогон: `APPROVE` с датой окончания в
  прошлом не даёт ничего, плиток на `/admin/queues` не остаётся.
- **Вторая подпись считается по тем, кто вправе утверждать именно в этой очереди**
  (`countApprovers`), а не по числу админов: иначе «четыре глаза» обеспечивал бы человек,
  который к этой очереди не допущен. Путь «утверждено одним лицом» из AP остался и накрыт
  тестом.
- **Конфликт интересов** (`src/lib/authz/conflict.ts`): сотрудник не ведёт дело объекта, с
  которым связан — членство в предприятии, курирование карточки, своя заявка. Живой прогон:
  до членства `null`, с членством `conflict_of_interest`, после снятия снова `null`.
- **Выдавать права может только владелец** (`requireOwner`), и себе — нельзя (`self_grant`),
  владельцу — нечего (`owner_target`). Матрица 8 × 4 одна и та же в приглашении и в правке
  прав: выдача и правка должны выглядеть одинаково. Четыре готовые должности только заполняют
  матрицу, после них галочки правятся руками.
- **Две двери, как в командах предприятий:** по логину или адресу (запись уже есть — права
  выдаются сразу) и ссылкой (`/staff-invite/[token]`, 14 дней, одноразовая, ≤20 активных, в
  базе sha256). Гонку двух переходов снимает условный `updateMany` по `acceptedAt: null`.
  Ссылка показывается **один раз** — повторно её не узнать. Все три негодных состояния
  объясняются своими словами (`revoked` / `accepted` / `invalid`), проверено снаружи.
- **Отзыв доступа строку сотрудника не удаляет** (журнал решений должен читаться), гранты тоже
  остаются — вернуть доступ это одно действие, а не повторная выдача восьми прав. Причина
  обязательна (≥3 символа). Отозванный уходит из `/admin` в `/cabinet` тем же сеансом, а его
  решения в аналитике труда по-прежнему посчитаны.
- **Пересмотр доступа — полгода** (частота ревизии доступа в SOC 2 и ISO 27001; отдельного
  интервала «высокого риска» у человека нет, своей колонки под него тоже). Прогон
  `runStaffAccessReviewSweep()` в воркере на `45 5 * * *` звонит **владельцам** (сотрудник не
  пересматривает себя), один повод на сотрудника не плодится, отозванный доступ прогон не
  трогает. Живой прогон: четыре владельца получили по звонку, повторный прогон их не
  размножил, «Пересмотр пройден» перенёс срок на 18 мая 2027 и погасил непрочитанные.
- **Найдено живым прогоном и починено:** одобрение, которое отверг сам объект
  (`too_incomplete`, `logo_required`, `slug_taken`), показывалось как «Не удалось сохранить» —
  проверяющий нажимал кнопку снова, а дело было в незаполненной заявке; теперь у каждого кода
  свои слова. И `formatHandled` подписывал время по-русски на любом языке («1 мин» на
  английском экране) — единицы стали строками перевода (`admin.case.handledUnits`).
- **Найдено живым прогоном, не код:** веб перезапускался каждые 10–30 минут по памяти (952
  рестарта, и каждый — окно 502). Причина не в `ecosystem.config.js`, а в том, что в окружении
  процессов экспортирован `max_memory_restart=314572800`, и **pm2 ставит env выше конфига**;
  значение воспроизводило себя при каждом старте, потому что каждый новый процесс наследует
  env от pm2. Лечится запуском без неё: `env -u max_memory_restart pm2 start
  ecosystem.config.js --only trientes-web` (и `pm2 save` так же). Веб теперь 768 МБ, воркер
  512 МБ, как в конфиге; бот не перезапускался — его трогать посреди сессии нельзя.
- **Что дальше по этой линии:** второй фактор входа для сотрудников (спека называет его
  следующим слайсом). Отдельно, не кодом: понизить две дублирующие записи владельца до `USER`,
  оставив `biotecbank` — пока записей три, правило четырёх глаз обходится одним человеком.

## Слайс AT — KYB заводит дело, повторная подача открывает дело, спам закрывается пачкой

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-18-compliance-gaps-design.md`,
план `docs/superpowers/plans/2026-11-18-compliance-gaps-at.md`. Не новые возможности, а
долг: очередь обещает «всё, что ждёт решения», и обещание было неверным в трёх местах.

- **KYB никому не был виден.** `submitKyb` не звал `ensureCase`, в
  `scripts/backfill-cases.ts` KYB не было, а старый экран ожидающих в AP заменён на
  `QueueMoved` — очередь `kyb` была готова целиком (право `kybDecision`, лист из шести
  пунктов, срок 10 рабочих дней, `applyDecision case "KYB"`) и **пуста по построению**.
  Дело KYB — отдельное от дела листинга компании: у дела `@@unique(subjectType,
  subjectId)`, и это два разных решения с разными сроками. Отзыв заявки
  (`withdrawKyb`) закрывает дело как `CLOSED` **без решения**: документы стёрты, и
  открытое дело звало бы проверяющего смотреть пустоту, а в аналитике труда отзыв не
  должен выглядеть работой сотрудника.
- **Повторная подача не возвращала дело в очередь.** `ensureCaseCore` идемпотентен, и
  это верно для повторной подачи того же объекта, но не для возврата объекта на
  модерацию: правка одобренной точки стирает решение и возвращает её в `PENDING`
  (`pointEditNeedsModeration`), KYB после отказа подаётся заново. Теперь найденное
  **решённое** дело открывается заново (`src/lib/cases/reopen.ts`): `NEW`, срок от
  повторной подачи, `reopenedAt`, решение и обе подписи стёрты, дело уходит из чьих-то
  рук в общий котёл. `openedAt` **не меняется** — первое обращение человека это факт, и
  возраст в плитке очереди считается от него. **Ответы листа проверок удаляются**:
  объект изменился, «да» по прежней версии ответом не является, а оставь строки — и
  одобрение прошло бы без единого живого взгляда (сами ответы остаются в журнале
  событиями `CHECK_SET`, журнал неизменяем). С документов снимается **только**
  `RESUBMIT`: присылка и есть ответ на эту просьбу, а не снятый вердикт блокировал бы
  одобрение навсегда. Открытое дело повторный вызов не трогает вовсе.
- **Спам читался по одному.** 31 заявка бирж от ботов (найдены живым прогоном AN):
  капча AR закрыла дверь, но лежащее требовало провести тридцать одно дело через лист
  и две подписи. В списке очереди появился выбор дел и одно действие «закрыть как
  спам» (`src/lib/cases/spam.ts` — чистые правила, `src/app/actions/case-spam.ts` —
  экшен, `src/components/admin/queue-spam.tsx` — галочки; строки дел по-прежнему рисует
  сервер и передаёт детьми, иначе клиентская копия карточки разошлась бы). Решения:
  объект отвергается **тем же** экшеном, что и человеком, но **молча** (флаг `silent`
  у шести экшенов отказа — письмо боту на случайный gmail-алиас портит репутацию
  домена, с которого мы пишем настоящим заявителям); дело закрывается `CLOSED` **без
  решения**, потому что спам не работа комплайнса и аналитика труда не должна считать
  его пачкой решений; лист и вторая подпись не требуются, но требуется право `APPROVE`
  в очереди и причина (≥3 символа); аудит пишет и обычный `REJECT_*` по объекту, и
  одну строку `CLOSE_CASES_AS_SPAM` на всю пачку. **`KYB` и жалобы на точки так не
  закрываются**: KYB подаёт уже заведённое предприятие («спам» означал бы «мы не
  смотрели документы»), а жалобу подтверждают или отклоняют своими словами. Пачка —
  не больше 50 за раз.
- **Живой прогон 18 ноября** (временная запись владельца, сеанс, предприятие и заявка
  биржи — всё убрано за собой): дело KYB завелось со сроком 10 рабочих дней и видно в
  плитке; повторная подача дала `OPENED → REOPENED`, срок пересчитан, `openedAt`
  прежний, ответы листа пусты, `RESUBMIT` снят, исполнитель снят; вызов на живом деле
  не изменил ни срока, ни числа событий; в UI отказ без причины отвергнут вслух,
  закрытие пачки дало «1 закрыто как спам», заявка стала `REJECTED`, дело `CLOSED` без
  решения, в журнале `CLOSED_AS_SPAM`, в аудите две строки; на очереди KYB кнопки
  «спам» нет.
- **Ждёт решения владельца, не кода:** 31 дело бирж от ботов по-прежнему в очереди —
  отвергать чужие заявки пачкой без слова владельца не стали. Инструмент готов, нужно
  одно нажатие.
- **Что дальше по этой линии:** второй фактор входа для сотрудников (спека AS называет
  его следующим). Вне слоя дел остаются три пути модерации — заявка на владение
  карточкой монеты (`CoinCardClaim`), правки карточки (`CoinCardRevision`) и просьба об
  удалении предприятия (`CompanyDeletionRequest`): все три сейчас пусты, и затаскивать
  их в дела стоит тогда, когда появится первая живая заявка, иначе это код, не
  проверенный живым прогоном.

## Уборка AU — чистая очередь, 55 проверенных карточек, словацкий язык

Шипнуто 2026-11-18. Не слайс, а уборка по просьбе владельца: «наведи порядок с
монетами, очисти все заявки, поудаляй прежние предприятия, поправь ошибки и
добавь словацкий». Спеки нет; разборы решений — ниже и в коммите `cb3f09b`.

**База вычищена.** Удалены все 34 дела комплайнса, оба предприятия (POOLWATT и
Arcon) с точками, членствами и приглашениями, 31 заявка на листинг биржи, одна
отклонённая заявка на монету, 38 записей ботов и пробных учёток скриптов, строки
аудита об исчезнувших объектах. Осталось 14 живых учёток, 55 карточек монет (54 строки посева плюс Taler),
202 монеты, 581 биржа и 28 записей финтех-каталога. Снимок затронутых таблиц до
уборки — `/home/dv/trientes-artifacts/db/pre-cleanup-20261118.sql.gz` (ночная
копия всей базы делается `/home/dv/pg-backup.sh` в 03:00, ~674 МБ).
Ботов узнаёт правило «gmail-адрес с точками-алиасами + случайное имя входа из
15+ букв + есть пароль»; из 31 заявки бирж настоящей выглядела одна
(Richamster.com), но подавалась она с gmail-адреса, а сама биржа уже есть в
каталоге CoinPaprika — удалена вместе с остальными.
**Удаление — не решение по делу:** экшены комплайнса не звались вовсе, строки
снесены SQL в одной транзакции. `AdminAuditLog` пришлось чистить **до** записей
людей: у `actorId` стоит `ON DELETE RESTRICT`, и пробная учётка с строкой
`TRANSFER_COIN_CARD` блокировала всю транзакцию.

**Три дефекта сетей, найденных живым запросом.**
- **Stride снят из посева** (`SEED_CARDS` и реестр Cosmos; карточка удалена).
  Единственный отвечающий REST — `stride-api.polkachu.com` — отдаёт **чужую
  сеть**: `agoric-3`, moniker `hello-agoric-relayer`, `bond_denom: ubld`.
  То же самое отдаёт `public.stakewolle.com/cosmos/stride/rest`; все прочие
  адреса из chain-registry (publicnode, lavenderfive, autostake, stakeandrelax,
  citizenweb3, uquad) не отвечают или 5xx. Охранник идентичности сработал верно
  (`genesis_mismatch`, чужие числа в карточку не попали), но карточку, которую
  нечем проверить, в посеве не держим — тот же разбор, что у sei/evmos/kujira в
  слайсе W. Диагностика заняла время из-за ложного следа: `curl` из песочницы
  отдавал `{"error":"bad_reason"}` с кодом 000 — это тело **прошлого** ответа в
  `/tmp`, а не ответ узла; при code=000 curl файл не перезаписывает.
- **Initia** переехала с `rest.initia.xyz` (502 на каждый запрос) на
  `initia-api.polkachu.com`.
- **Enjin** обновил рантайм (spec 1080, `transactionVersion` 19 вместо 18) —
  комиссия стала `runtime_changed`, то есть охранник сработал как задумано.
  Индекс палеты балансов проверен живым `payment_queryInfo` на новой версии и
  не изменился, в реестре поднята только версия.

Итог: у всех 55 карточек факты и выпуск читаются без ошибок. Непрочитанными
честно остаются комиссия перевода у 28 карточек (`fee_unsupported` — свойство
семьи или набора расширений) и выпуск у 19 (`supply_unsupported` — Bitcoin и
нативные монеты EVM).

**Корневая причина «no_reference»: монета с карточкой могла не иметь цены
никогда.** `syncPrices` пишет `CoinSnapshot` только тем монетам, что пришли в
ответе CoinGecko по категории layer-1, а `syncAdminAddedPrices` — только
заведённым руками. Монета, которая когда-то была в категории, а потом выпала из
сотни, остаётся в каталоге как `AUTO_L1` и цены не получает ни от одного
прогона: Moonbeam, Moonriver, Secret, AtomOne и Saga стояли с **опубликованной**
карточкой и нулём снимков за всю жизнь. Из-за этого посев рынков слайса X
отказывал по `no_reference` (опорная цена — защита от тикера-двойника), а в
карточке молчали капитализация, график и комиссия в долларах. Появился
`syncCardedCoinPrices` (`src/lib/sync/orchestrator.ts`, прогон `12 * * * *`,
правило выбора — чистая `staleCardedIds`, порог свежести час: главный прогон
ходит раз в десять минут, поэтому монета из сотни под правило не попадает
никогда). **В общий список монет (`adminAddedList`) эти монеты не кладутся
намеренно:** таблица на главной называется «Top Layer-1», и дописать в неё
монету из-за сотни — значит сменить обещание таблицы, а не починить цену;
карточке и посеву хватает снимка в базе и ключа монеты в Redis. После починки
посев завёл 22 рынка на 4 карточках: **48 карточек из 55 с рынками и индексом
цены** (было 44). Остаются 4 без пар на биржах (AtomOne, Provenance, Juno,
Unique) и 3 со спором цены (Acala, HydraDX, Neutron — у них Binance с настоящим
объёмом расходится с CoinGecko в 6–8 раз; это вопрос к данным, а не к коду).

**Табло рынков переехало с CNBC на Yahoo.** `quote.cnbc.com` с 16 ноября 23:08
отвечает нашему адресу **403 на любой запрос** — с браузерным UA, с referer и
origin тоже; табло 34 часа показывало прошлый снимок, и это видно глазом.
Открытая служба графиков Yahoo (`/v8/finance/chart/<symbol>`) нашему адресу
отвечает (прежде не отвечала — записано в спеке табло; адрес сменился при
переезде на DO), и все десять инструментов проверены живым запросом: `^DJI`,
`^IXIC`, `^GSPC`, `ES=F`, `CL=F`, `NG=F`, `GC=F`, `SI=F`, `PL=F`, `PA=F`.
Два решения вытащил живой прогон: **служба режет частоту** (десять
параллельных запросов прошли на четырёх, остальные 429; после разведки она
отказывала и одиночным запросам несколько минут), поэтому запросы идут **по
одному с паузой 1,2 с**; и **обход начинается со сдвигом** (`rotation` в
модуле) — под ограничителем успевает пройти первая горстка, и обход от начала
списка означал бы, что металлы в конце не обновляются никогда. Неполный ответ
это не беда: `syncMarkets` сливает его с прошлым снимком, и карточка несёт свой
штамп времени. Ключ снимка стал `snapshot:markets:v2` — символы переехали с
записи CNBC (`.SPX`, `@GC.1`) на запись Yahoo, и слияние с прежним снимком дало
бы двадцать карточек вместо десяти. Twelve Data по-прежнему не используется:
на тарифе Basic из десяти инструментов доступен один (XAU/USD).
**Что проверить потом:** при ограничителе за прогон проходит 1–2 инструмента,
то есть табло наполняется часами. Если окажется, что бюджет Yahoo больше, чем
показала разведка (её запросы его и выжгли), трогать ничего не нужно — обход со
сдвигом сам соберёт все десять.

**Двенадцатый язык — словацкий** (`sk`, «Slovenčina», голос `sk-SK`), все 2568
строк переведены `scripts/translate-messages.ts` со своим глоссарием. Карты
языков `LANG_NAMES` (`src/lib/translate.ts`) и `WIKI_LOCALE`
(`src/lib/wikipedia.ts`) стали **обязательными по типу** (`Record<Locale, …>` и
`Record<Exclude<Locale, "en">, …>`): прежде это были `Record<string, string>`, и
новый язык молча получал английскую прозу и английскую статью Википедии. Это
ровно та болезнь, о которой уже сказано выше («своя копия списка локалей
однажды отставала на язык») — теперь она не компилируется.

**Дыры, через которые интерфейс выходил английским на любом языке** (найдены
своим обходом JSX — текстовый узел может быть многострочным, и поиск по одной
строке такие пропускает): подписи полей раздела «Настройки» в кабинете
(Language / Currency / Theme) и сами названия тем (`light`/`dark`/`system`
показывались значениями из базы); кикеры разделов на восьми публичных страницах
(«Section · I», «Newsflow», «History») и слово «Admin» на восьми экранах
админки; подзаголовок страницы входа; заголовок таблицы монет «Top Layer-1.»;
подпись ранга и строка «Layer-1 · Native asset» в шапке монеты; подписи для
чтения с экрана (открыть/закрыть меню, валюта, закрытие окна); кнопки и
подсказки старых экранов точек и KYB. Новые ключи — `common.kicker.*`,
`common.a11y.*`, `common.meta.*`, `login.subtitle`, `home.topCoinsHeading`,
`detail.rankBadge`, `detail.assetKicker`, `admin.points.*`.
Сознательно **не** переводятся: картинки превью для соцсетей
(`opengraph-image.tsx` — английские по построению), названия магазинов
приложений, примеры в placeholder'ах (`BTC`, `example.org`, `ERC-20`,
`FOO/USDT`), аббревиатуры CEX/DEX и «Lightning».

**Метаданные страницы на языке страницы.** Корневой `app/layout.tsx` стоит выше
отрезка локали и языка не знает — его английский `<title>` уходил во все
одиннадцать языков. Появился `generateMetadata` в `[locale]/layout.tsx`
(заголовок и описание из того же файла переводов, число языков — из
`SUPPORTED_LOCALES.length`, вписанное руками «across 11 languages» уже
разошлось со списком). Две ловушки, обе поймал живой прогон:
**метаданные раскладки наследует каждая страница под ней**, поэтому `canonical`
в раскладке объявил `/sk/markets` дубликатом `/sk` — ссылки на переводы
переехали к самой главной (`[locale]/page.tsx`); и заголовок надо отдавать как
`title.absolute`, а не строкой или `default`, иначе корневой шаблон
«%s · Trientes» превращает его в «Trientes — … · Trientes».
Попутно вскрылся **более старый дефект**: в корневой раскладке стоял
`alternates: { canonical: SITE }`, то есть **каждая страница без своих
метаданных объявляла себя дубликатом главной** — `/{locale}/markets`,
`/exchanges`, `/fintech`, `/compare`, `/watchlist` все канонизировались на
`https://trientes.org`. Корневой `canonical` убран, этим пяти страницам даны
свои заголовок, описание, `canonical` и `hreflang`.

**Починен `scripts/backup-db.sh`:** перенаправление внутри `[[ ]]` — ошибка
синтаксиса bash, и скрипт не запускался вовсе. Ночные копии базы делает другой
скрипт (`/home/dv/pg-backup.sh`, cron `0 3 * * *`), так что копии не терялись.

**Ждёт решения владельца, не кода:** три учётки с ролью `OWNER` (две
дублирующие записи владельца) — пока их три, правило четырёх глаз обходится
одним человеком; и спор цены у Acala, HydraDX и Neutron (расхождение Binance с
CoinGecko в 6–8 раз).

## Уборка AV — чтение обмена, обход табло, замершие пары, один владелец

Шипнуто 2026-11-18, в тот же день, что AU. Спеки нет; разборы — здесь и в
коммитах `04f0e3d`, `6f66f3c`, `1d452e9`, `dd36f55`. Ничего нового не добавлено:
четыре места, где прод тихо показывал неправду, и они нашлись не глазом, а
чтением живых прогонов воркера.

**Чтение своего обмена молчало пять дней.** С 13 ноября часовой прогон писал
`own-dex markets ok: 0 written, 55 failed {"registry_unreadable":55}`, и у
карточки Taler не было живой цены (последняя — 11 951,82 $ от 13 ноября 08:50).
Узел отвечал нормально; ломался разбор списка монет. Прежний `decodeCoins`
искал **хвост** записи перебором и опирался на две догадки, которые живая сеть
опровергла разом: что знаки монеты равны знакам её тикера (у USDT и USDC на
сети BNB их 18 против 6, объявленных тикером) и что следом идёт монета с
номером на единицу больше (новые монеты получили номера **34 и 35 после 16**).
Теперь запись опознаётся по своему **началу** — номер, число сети, признак
моста и имя моста латиницей (`BtcBridgeMainnet`, `EthBridgeBnb`, `TronBridge`),
— а хвост не ищется, а проверяется: записи идут подряд, значит это 35 байт
перед началом следующей. Ложное начало внутри чужого адреса возможно, поэтому
разбивка выбирается **с возвратом**: годна только та, где записей ровно
столько, сколько объявил ответ, каждый хвост сошёлся с реестром тикеров и
последняя запись кончается концом ответа. Живой прогон: 17 тикеров, 19 монет,
22 пары за 124 мс; 9 карточек с рынком обмена вместо нуля; **Avalanche и
Hyperliquid впервые получили строку своего обмена** — эти монеты на обмене и
появились. Урок на будущее: догадка о форме чужих данных обязана падать громко
и **в отчёте**, а не в логе (см. ниже).

**Обход табло рынков начинался заново с каждым перезапуском воркера.** Сдвиг
жил в переменной модуля, воркер перезапускается по нескольку раз в день —
значит хвост списка (платина, палладий) не обновлялся никогда: в снимке стояло
шесть инструментов из десяти. Теперь порядок — чистая функция от прошлого
снимка (`marketFetchOrder`): ещё не снятый инструмент впереди всех, дальше по
давности штампа; снимок читается **до** запроса и он же задаёт обход, состояния
в модуле не осталось. Второе: замер показал, что бюджет Yahoo — около одной
котировки в полминуты и **от паузы между запросами не зависит** (с паузой 5 с
прошла одна из шести, с 1,2 с — одна-две из десяти), поэтому после **трёх 429
подряд обход прекращается**: прогон стал 5,4 с вместо 11,5 с, шесть запросов в
чужую службу не уходят. Живой прогон сразу взял `CL=F`, которого в снимке не
было.

**Спор цены у Acala и Neutron оказался не спором данных, а замершей парой.**
Снятая с торгов пара из снимка тикеров **не исчезает**: Binance отдаёт её
последнее состояние, и оно выглядит как обычная котировка. `ACA/USDT` показывал
0,0018 $ при настоящей цене 0,000158, `NTRN/USDT` то же самое; окно «за 24
часа» у обоих закрылось 13 ноября, а объём 371 тыс. и **ровно 4001 сделка**
относились к тому дню (та же подпись, что у застрявшей `BUSD`-пары из слайса
X — тогда её приняли за особенность одной пары). Опорная цена отвергала такую
пару только потому, что расхождение было одиннадцатикратным, — а вместе с ней
отвергалась вся биржа и вся карточка. **Замри цена ближе к настоящей — и снимок
выдал бы её за сегодняшнюю:** шесть таких пар действительно стояли
подтверждёнными рынками и шли в индекс BNB, TIA, S, SAGA и ENJ. Поэтому
отсекаем **по штампу, а не по расхождению**: у тикера появился `closedAt`
(конец окна в миллисекундах эпохи; отдают Binance, MEXC и OKX), `dropFrozen`
выбрасывает пару с окном старше шести часов. Пара **без** штампа остаётся —
«не знаю, когда» это не «знаю, что давно»; штамп из будущего тоже (часы биржи
могут спешить). Живой прогон: шесть замерших пар ушли (возраст 128–129 ч, у
всех ровно 4000 сделок), ни одной живой не потеряно; **Acala впервые получила
настоящий рынок** (`gate:ACA/USDT` 0,0001586 против опоры 0,00015844) и стала
**49-й карточкой с индексом цены**; Neutron честно остался без пар. У HydraDX
спор настоящий и охранник прав: Gate отдаёт `HDX/USDT` по 338,22 — это другой
актив под тем же тикером.

**Ночной отчёт замолчавший источник рынков не видел.** Он смотрел на свежесть
«ценового индекса карточек», а индекс считается по тем рынкам, что ответили.
Добавлены два прогона: «рынок своего обмена» (самая свежая строка нашего
обмена, норма 3 ч) и «рынки карточек, ветхая строка» (самая давняя проверка
среди всех строк) — второй заметит любой будущий источник, перестающий их
трогать. Живой прогон отчёта вскрыл сорвавшееся чтение Hyperliquid
(`decode_failed`: узел отдал прошлый блок пустым); повторный прогон прошёл, у
всех 55 карточек факты читаются без ошибок.

**Владелец остался один.** Из трёх записей с ролью `OWNER` две понижены до
`USER` (`dvvolkovv@gmail.com` — Google, `d.volkov@cityfarmer.ru` — Google без
имени входа, сеанс истёк в июне); осталась `biotecbank@me.com`. Пока записей
было три, правило четырёх глаз обходил один человек. Теперь `countOtherApprovers`
по всем типам дел даёт 0, то есть одобрение идёт путём `soleSignOff = true` —
«утверждено одним лицом, второго не было» в журнале. Это и есть честное
состояние: путь из слайса AP наконец достижим, а не замаскирован дубликатами.
Понижение обратимо одной строкой `UPDATE`. **Важно:** `ADMIN_WHITELIST` в
`.env` не менялся, и `dvvolkovv@gmail.com` в нём остался — повторное
`linkAccount` (не обычный вход) вернёт ему `OWNER`.

## Слайс BE — команда мерчанта: конструктор ролей, участки, журнал действий

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md`,
план `docs/superpowers/plans/2026-11-19-merchant-team-roles-be.md`. Четвёртый слайс линии
мерчантов (ТЗ 6.6). До него у предприятия было три роли на всё, заведённые в фазе 10 под
один раздел, и **все новые разделы охранял один и тот же `canWrite`**: кладовщик, позванный
вести приход на полку, вправе был поменять цену всей номенклатуры и объявить кэшбэк 50 %.

- **Живые адреса:** `/{locale}/cabinet/companies/[id]/team` (члены, участки, конструктор
  ролей) и `/{locale}/cabinet/companies/[id]/journal` — обе видит **владелец**; полоса
  разделов кабинета теперь показывает ссылку только при праве на раздел.
- **Данные:** `CompanyTeamRole` (@@unique companyId+name, набор прав JSONB),
  `CompanyMemberPoint` (участок), `CompanyActionLog` (только вставка),
  `CompanyMember.roleId?`; миграция `20261119160000_merchant_team_roles`.
- **Разделов пять, и заведены только те, которым есть что охранять:** `card`, `points`,
  `products`, `warehouses`, `pricing`. ТЗ называет ещё эквайринг, отчётность и рекламу —
  их в проекте нет, и право, за которым нет ни одного действия, это обещание, а не
  доступ (прецедент BC: «`minQty` в схеме не заводим, пока нечему его читать»).
  **Цена и кэшбэк — один раздел:** кто ставит цену 10 $, тот объявляет и «−5 %
  кэшбэком»; разделить их значило бы дать маркетологу сдвинуть выручку на 50 %, не имея
  права тронуть цену. Уровней два (`VIEW`/`EDIT`): второй подписи внутри предприятия нет,
  модерацию делает платформа. Нет уровня — раздела в кабинете **не видно вовсе**.
- **Команда, KYB и удаление предприятия правами не настраиваются** — остаются у
  владельца. Право «выдавать права» в конструкторе прав означало бы, что приглашённый
  повышает себя сам (то же решение в AS: `requireOwner`, запрет `self_grant`).
- **Наследие фазы 10 сохранено дословно:** нет своей роли — `EDITOR` правит все пять
  разделов, `VIEWER` смотрит. Бэкфилл «завести каждому предприятию по роли» завёл бы роли
  тем, кто о них не просил; новое поведение включается в момент, когда владелец назначил
  роль.
- **Назначение своей роли ставит базовую роль `VIEWER`** — чтобы снос роли **понижал**, а
  не повышал: иначе удалённая роль у бывшего редактора вернула бы ему права на всё
  (`roleId` снимается в `SET NULL`). Живой прогон это и проверил: после сноса роли член
  остался `VIEWER` с `roleId: null`.
- **Шаблоны ролей — четыре, а не шесть** (`ROLE_TEMPLATES`, в коде, как лист проверок в
  AP и лестница уровней в BD): администратор, кладовщик, маркетолог, наблюдатель.
  Кассира и бухгалтера из ТЗ не заводим — кассы и отчётности нет, а шаблон с пустым
  набором прав это насмешка. Шаблон только заполняет галочки; сохранённая роль хранит
  свой набор и от шаблона больше не зависит (поправленный шаблон не меняет права живого
  кладовщика за спиной владельца). Роль без единого права отвергается вслух
  (`permissions_empty`): с ней человек не видит кабинета вовсе.
- **Участок по точкам продаж:** пусто — все точки. Непустой список сужает `points` (свои
  точки) и `warehouses` (склады **на своих точках**); **склад без точки** (оптовый,
  сторонний) в участок не попадает — он принадлежит предприятию целиком, и в этом смысл
  слов ТЗ «доступы по точкам продаж для сетей». Движение записывается, только когда **оба
  конца** в участке. `card`, `products` и `pricing` точками не сужаются: паспорт и цена —
  свойства предприятия, а не участка, и сужать их значило бы заявить «у этой полки своя
  цена», чего в данных нет. Форма склада под участком не предлагает ни «не на точке», ни
  оптового склада: обманка хуже отказа.
- **Калитка одна, и раздел у неё обязательный параметр:** `canWrite(gate, "warehouses")`.
  Старую подпись без раздела **удалили**, а не оставили как «любой раздел» — забытый
  вызов должен падать на сборке, а не тихо пускать кладовщика в цену. `editKind` паспорта
  читает теперь права, а не роль.
- **Журнал — одна строка «кто, что и когда»** и 31 код действия; он **не заменяет**
  историю правок паспорта (`ProductEdit`, BB) и движения (`StockMovement`, BC), где лежат
  различия и количества. Автор снимается `SET NULL`, а не `RESTRICT`: уборка AU уже
  упиралась в `AdminAuditLog.actorId` с `RESTRICT`. Сбой записи журнала работу не роняет
  (`logCompanyAction` ловит и пишет в лог) — прецедент `ensureCase` в AN. Незнакомый код
  показывается как есть: журнал неизменяем, и строка старого вида должна остаться читаемой.
- **Два дефекта, которые поймал только живой прогон:** раздел KYB показывал **список
  поданных документов любому члену** — кладовщик видел уставы и паспорта (теперь раздел
  виден только владельцу); блок «моё предложение» на странице паспорта был привязан к
  праву на **паспорт**, а не на цену — маркетолог с правом на цену не увидел бы формы
  вовсе, а продуктолог без права на цену видел бы форму, которую действие отвергает.
- **Живой прогон 19 ноября** (временные владелец, сотрудник, предприятие с двумя точками,
  тремя складами и паспортом — всё убрано за собой): приглашённый редактор фазы 10 видел
  всё, как прежде; роль «кладовщик» из шаблона сузила кабинет до «Товары» и «Склады»,
  участок из одной точки убрал вторую полку и центральный склад из списков, чужая полка и
  страницы «Кэшбэк», «Команда» отдали 404, приход 10 на свою полку записался, паспорт
  сказал «правка недоступна»; роль «маркетолог» дала профиль, предложение и ставку (3 %
  сохранились), но убрала склады, точки и KYB; журнал прочитался рассказом с авторами —
  три действия владельца и два сотрудника.
- **Чего в слайсе нет намеренно:** задачи, доска и отчёты по ним (ТЗ 6.6 — своя модель и
  свои экраны, следующий слайс), внутренний чат команды, дашборд (половина его чисел —
  продажи и сообщения покупателей — берётся с эквайринга и переписки, которых нет),
  ответы сотрудников покупателям от имени магазина (такой переписки в проекте нет вовсе).

## Слайс BF — задачи команды мерчанта: доска, назначение, отчёты

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-merchant-tasks-board-design.md`,
план `docs/superpowers/plans/2026-11-19-merchant-tasks-board-bf.md`. Пятый слайс линии
мерчантов. BE дал владельцу **кто что вправе делать** и **кто что сделал**; между ними не
было третьего — *кто что должен сделать*: поручение жило голосом или в чужом мессенджере.

- **Живые адреса:** `/{locale}/cabinet/companies/[id]/tasks` (доска, фильтры, форма,
  отчёты) и `/{locale}/cabinet/companies/[id]/tasks/[taskId]` (задача, переходы,
  обсуждение); ссылка «Задачи» в полосе разделов — **у каждого члена**.
- **Данные:** `CompanyTask` (статус, приоритет, срок, постановщик, назначенный, взявший,
  сдавший, закрывший, причина отмены, привязки к точке/товару/складу),
  `CompanyTaskComment`, два enum; миграция `20261119180000_merchant_tasks`.
- **Раздел прав шестой (`tasks`), но правило «нет строки — ничего не видно» к нему
  применяется не дословно.** Роли BE заведены до этого слайса, и строки `tasks` у них нет:
  задача, назначенная кладовщику, оказалась бы невидимой тому, кому адресована. Поэтому
  ступеней три — **без уровня видно и ведётся только своё**, `VIEW` открывает доску
  участка, `EDIT` ставит задачи другим, принимает и отменяет. Запрет по умолчанию остался
  там, где он что-то значит: ставить задачу другому без `EDIT` нельзя.
- **Выполненной задачу объявляет не исполнитель.** «На проверке» имеет смысл только если
  закрывает работу постановщик или носитель `EDIT`, **и не тот, кто сдавал** — иначе это
  слово, которое никто не читает. Переходы — одна чистая `canTransition`, и те же правила
  решают, какие кнопки рисовать: вторая копия правила в браузере разошлась бы с первой.
  `DONE` — конец, переоткрытия нет (вернувшаяся работа это новая задача со своим сроком);
  отмена требует причины (≥3 знака), приём — нет.
- **«Кто получил» и «кто взял» — два разных поля** (ТЗ просит видеть оба). Задача без
  исполнителя законна («кто возьмёт»), взявший становится исполнителем, а пустой
  `assignedAt` остаётся следом того, что лично её никто не поручал.
- **Назначение за пределы участка отвергается вслух** (`assignee_out_of_scope`): задача с
  привязкой к точке, назначенная тому, кто её не видит, была бы задачей-невидимкой. Свои
  задачи при этом видны **всегда**, даже если точка позже вышла из участка — иначе
  поручение пропадает молча в день, когда владелец переставил участки.
- **Срок — дата, а не час:** часового пояса у предприятия в данных нет, «к 18:00»
  означало бы неизвестно чей вечер; хранится концом дня по UTC, дата в прошлом отвергается
  (сегодняшний день считается будущим). **Просрочка — свойство, а не статус.**
- **Привязок три, а не четыре:** точка, товар, склад. Акций в проекте нет (BD их не
  заводил), и `promoId`, который никто не читает, был бы обещанием, а не привязкой — то же
  решение, что `minQty` в BC и права на эквайринг в BE.
- **Листинга задачи не требуют** (в отличие от паспорта, цены и остатка): это внутренняя
  работа, витрине она ничего не обещает, и предприятие в модерации уже готовит открытие.
  Снятое надзором или удалённое — только чтение.
- **Обсуждение внутри задачи есть, общего чата команды нет** (своя модель, своё
  непрочитанное — отдельная линия). Уведомления — `notifyUser` теми же каналами, что
  приглашение в команду, и **на языке кабинета получателя**; колокольчика у мерчанта нет
  (`AdminNotification` — таблица сотрудников платформы). Автору своего действия не пишем.
- **Отчёты — числа, которые у нас есть:** по исполнителю и по точке — открыто, просрочено,
  на проверке, сделано за 30 дней. Среднего времени выполнения нет: закрытых задач пока
  ноль, и «0 ч» объявляло бы измерение, которого не было (прецедент `levelFor(null)` в BD).
- **Потолки:** 300 незакрытых задач на предприятие, 200 новых в сутки (счёт до работы, как
  `DAILY_MOVEMENTS` в BC), 100 реплик на задачу. Задача **не удаляется**: отменённая
  остаётся строкой, как движение склада и строка журнала.
- **Четыре дефекта, которые поймал только живой прогон, все починены:** сдавший задачу не
  видел ни кнопок, ни слов — раздел действий был скрыт целиком, и человек смотрел на «на
  проверке» без объяснения; кнопка возврата из «на проверке» была подписана «Взять»
  (подпись-ложь — появился свой ключ `moves.RETURN`); у закрытой задачи оставалась форма
  переназначения, которую действие всё равно отвергает (обманка хуже отказа, правило BE);
  журнал предприятия показывал `TASK_CREATED` кодом — новым кодам положены слова.
- **Живой прогон 19 ноября** (временные владелец, кладовщик, продуктолог, предприятие с
  двумя точками, полкой и паспортом — всё убрано за собой): назначение на точку вне
  участка отвергнуто вслух; на своей точке задача завелась с приоритетом, сроком и тремя
  привязками; кладовщик увидел её, взял, написал реплику, сдал — и на экране получил
  «утвердить должен кто-то другой», кнопки «Выполнено» у него нет; владелец принял
  (`Сделано`, «закрыл владелец»); продуктолог без права на задачи увидел «Задачи,
  назначенные вам» и пустую доску, а чужая задача по прямой ссылке отдала 404; задача
  «кто возьмёт» завелась без исполнителя; отмена без причины отвергнута, с причиной
  закрыла задачу и показала причину; отчёты дали «сделано за 30 дней: 1» по исполнителю и
  по точке; журнал прочитался рассказом с авторами; русский и телефонный вид проверены.
- **Чего в слайсе нет намеренно:** общий чат команды и дашборд (половина его чисел — с
  эквайринга, которого нет), повторяющиеся задачи и шаблоны поручений, вложения в задаче,
  задачи от правила «если — то» (ТЗ 6.7 — после продаж), ответы покупателям от имени
  магазина.

## Слайс BG — акции магазина, подписки и рассылка с антиспамом

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-merchant-promos-antispam-design.md`,
план `docs/superpowers/plans/2026-11-19-merchant-promos-antispam-bg.md`. Шестой слайс линии
мерчантов. BB–BF дали мерчанту сказать о себе **внутри кабинета**; обратиться к покупателю
он не мог никак. **Это первый слайс, где мы пишем людям от чужого имени, поэтому он больше
про ограничители, чем про возможности.**

- **Живые адреса:** `/{locale}/cabinet/companies/[id]/promos` (акции, числа, кнопка
  рассылки), раздел «Акции» и кнопка «Следить» на `/{locale}/companies/[id]`, строка акции
  в разделе «Где взять» на `/{locale}/product/[slug]`, строка акции в карточке точки
  навигатора, раздел «Подписки» (`#subscriptions`) в `/{locale}/cabinet`,
  `/{locale}/promo/[id]` — единственный переход, он же счётчик.
- **Данные:** `CompanyFollow` (@@unique userId+companyId, `muted`), `MerchantPromo`
  (срок, привязки к товару и точке, `archivedAt`, `sentAt`), `PromoSend`, `PromoDelivery`
  (enum `PromoDeliveryOutcome`), `PromoClick`, `User.notifyPromos`; миграция
  `20261119200000_merchant_promos`.
- **Акция и рассылка — две разные вещи, и по одной акции рассылка делается один раз.**
  Повторная рассылка того же текста и есть спам в чистом виде; запретить его правилом
  дешевле, чем ловить лимитами — вторая рассылка означает новую акцию со своим сроком и
  своим расходом квоты.
- **Аудитория только по согласию.** `CompanyFollow` создаётся нажатием человека, и
  рассылку получает только подписчик: рассылок «по всей базе» в проекте нет и быть не
  может — живых учётных записей пятнадцать, и первая массовая рассылка стоила бы домену
  репутации, с которой мы пишем настоящим заявителям (прецедент AT: спам отвергаем молча).
- **Антиспам — четыре числа, все наши** (`src/lib/promos/antispam.ts`; ТЗ зовёт их
  «настраиваемыми платформой», то есть константами в коде, как лестница BD и лист AP):
  `PROMO_SENDS_PER_DAY = 1` (вилка ТЗ 1–5, берём нижнюю границу — поднять легко, вернуть
  отписавшегося нельзя), `PROMO_MIN_GAP_HOURS = 20` (без зазора «одна в сутки» = 23:59 и
  00:01), `PROMO_RECEIVES_PER_DAY = 5` на **человека** от всех магазинов (десять магазинов
  по одной рассылке — десять сообщений, и ни один правила не нарушил), `PROMO_TEXT_MAX = 600`.
  Потолки считаются по факту отправленного и **до** работы (прецедент `DAILY_MOVEMENTS` в BC);
  потолок получателя считается только по **доставленному** — пропуск сообщением не был.
- **Отключений три, и порядок проверки — порядок их силы:** общий выключатель человека
  (`User.notifyPromos`) старше отключения по магазину (`muted`), оба старше потолка, а
  канальные выключатели фазы 10 (`notifyTelegram`/`notifyEmail`/`notifyWebPush`) старше всех
  — выключивший почту не получит почту и от магазина.
- **Ссылок в тексте акции нет** (`hasLink`, отказ `text_has_link`): сообщение приходит из
  нашего бота и с нашего домена, значит за ссылку в нём отвечаем мы. Проверяются схема,
  `www.`, почта, домен с косой чертой и голый домен со знакомым TLD — ровно то, что станет
  нажимаемым у получателя. Переход один, и ставим его мы.
- **Гео-баннера и гео-рассылки нет честно** (ТЗ 4.2 и 6.5 их называют): фоновой
  геолокации нет ни в браузере, ни в нашей Capacitor-обёртке без нативного плагина, а
  координаты человека — персональные данные, которых мы не храним нигде и ради баннера
  заводить не станем. Вместо рассылки по радиусу акция **видна рядом сама** — строкой в
  карточке точки навигатора: это гео-витрина, и она не требует знать о человеке ничего.
  Вид булавки акция не меняет (цвет каёмки занят источником, середина — категорией).
- **Показы не считаем и так и говорим.** ТЗ просит «показы и переходы», но показ элемента
  честно считает только счётчик в браузере, которого у нас нет, а приписать показ акции
  просмотру страницы — врать (страницу открывают боты, акций на ней несколько). Три
  честных числа лучше четырёх с одним выдуманным: доставки по каналам, пропуски **с
  причиной** и переходы.
- **Своей модерации у акции нет** — её объявляет уже залистованное предприятие тем же
  правом, которым BB правит паспорт и BC цену; гасят её те надзоры, что уже есть
  (`promoVisible`). Снятый паспорт или снятая точка гасят **привязку, а не акцию**.
  Архив вместо удаления: разосланное обещание люди получили, и числа должны остаться.
- **Раздел прав седьмой — `promos`.** В BE его не завели сознательно («право, за которым
  нет действий, — обещание, а не доступ»); теперь действия есть. Шаблон «маркетолог»
  получает `promos: EDIT`, кладовщик — ничего. Привязка к точке вне участка отвергается
  вслух (`point_out_of_scope`), привязка к товару без своего предложения —
  `product_not_offered`.
- **Текст акции не переводим** (решение BB: состав скидки — утверждение продавца), наша
  обёртка в сообщении — на языке кабинета получателя (прецедент письма сброса пароля).
- **Два дефекта, которые поймал только живой прогон:** переход по ссылке акции отдавал
  `ERR_SSL_PROTOCOL_ERROR` — за nginx `req.url` указывает на localhost, и
  `new URL(target, req.url)` склеивал внутренний адрес (теперь `PUBLIC_ORIGIN` с
  запасным `https://trientes.org`, как в подтверждении почты); и кнопка рассылки при
  израсходованной квоте **гасла без объяснения** — тот же дефект, что живой прогон BF
  нашёл у задачи «на проверке» (появился `sendBlocked` со своими словами). Третий поймал
  старый тест карточки точки: моя строка акции была подчёркнутой ссылкой, а там всё —
  кнопки под палец.
- **Новый тест границы** `tests/merchant-labels.test.ts`: у каждого раздела прав есть
  название и дверь в кабинете, у каждого шаблона роли — имя, у каждого кода журнала —
  фраза, и в переводах нет фраз для исчезнувших кодов. Живой прогон BF уже ловил
  `TASK_CREATED` кодом на экране — теперь это не компилируется мимо.
- **Живой прогон 19 ноября** (временные владелец, три подписчика, кладовщик, предприятие с
  точкой, товаром и предложением — всё убрано за собой): ссылка в тексте отвергнута
  («Уберите ссылку…»), та же фраза без ссылки принята; витрина показала акцию с товаром и
  точкой; фид карты отдал точку с акцией; снятие предприятия надзором убрало акцию с
  витрины, возврат вернул; подписка/отписка кнопкой на витрине; раздел «Подписки» в
  кабинете по-русски с «Отключить»/«Отписаться» и общим выключателем; рассылка дала
  «Подписчиков на момент отправки: 3 · доставлено: 0 · пропущено: 3» (у временных записей
  нет ни одного канала — честный `SKIPPED_NO_CHANNEL`, плюс один `muted` и один `off`),
  после неё кнопки рассылки у этой акции нет вовсе, квота стала «0 из 1», а у второй акции
  кнопка погасла с подписью «Сегодняшняя рассылка исчерпана — следующая будет завтра»;
  архив и возврат; переход по `/ru/promo/<id>` привёл на паспорт товара и записал клик;
  журнал прочитался рассказом («Предложение отправлено подписчикам · Скидка на чай»);
  кладовщик без права `promos` получил 404 и не увидел ссылки в полосе кабинета; на
  экране 390 px горизонтальной прокрутки нет.
- **Чего в слайсе нет намеренно:** платные слоты и приоритетный показ (нет платежей —
  решение линии: денежной логики не заводим), сегменты по покупкам и сценарии удержания
  (ТЗ 6.7 — нужны покупки), жалоба на акцию как дело комплайнса (прецедент AT: не
  затаскиваем в дела то, чего ещё не было ни разу живьём), начисление кэшбэка по акции
  (с эквайрингом).

## Слайс AR — надзор над предприятием и капча «Соберите знак»

Шипнуто 2026-11-17. Спека `docs/superpowers/specs/2026-11-17-captcha-and-company-supervision-design.md`,
план `docs/superpowers/plans/2026-11-17-captcha-and-company-supervision-ar.md`. Две
независимые половины: капча закрывает дыру, найденную живым прогоном AN
(«31 заявка PENDING с мусорными именами от ботов»), надзор — последний пункт
разделения на слайсы в спеке управления делами.

### Капча «Соберите знак»

- **Дыра была не там, где казалось.** Формы подачи все за входом; боты завели
  себе кабинеты сами — `/register` открыт, и единственной преградой были пять
  регистраций с адреса в час. Поэтому капча стоит на трёх **анонимных** дверях:
  `POST /api/auth/password/register`, `POST /api/auth/password/forgot`,
  `POST /api/point-report`. **Вошедший её не видит никогда** — он уже прошёл
  дверь. Вход (`login`) намеренно без неё: там свой ограничитель по неудачам, а
  капча на входе бьёт по забывшему пароль чаще, чем по подборщику.
- **Клиент о сеансе ничего не знает:** `GET /api/captcha` вошедшему отвечает
  `{ needed: false }`, и компонент не рисует ничего. Это дешевле, чем тащить
  свойство «вошёл ли» через полстраницы навигатора.
- **Честно про силу.** Точка сборки нарисована на экране, значит известна и
  роботу, читающему DOM. Капча бьёт по тупому спаму, который постит прямо в
  маршрут, — а это ровно наш случай. Значение имеет серверная часть: задача
  подписана HMAC с длинами полей (`src/lib/captcha-store.ts`), живёт 5 минут,
  привязана к адресу, **одноразовая** (Redis), точка сборки каждый раз новая,
  ответ быстрее 800 мс не принимается.
- **Redis лёг — дверь не запираем.** Подпись и срок остаются, одноразовость
  теряется: дыра в пять минут меньше, чем «никто не может зарегистрироваться».
  Пишется `captcha_store_unavailable`.
- **Задача гасится последней** — после проверки попадания: иначе промахнувшийся
  мимо допуска оставался бы без задачи. А отказ по капче в форме меняет ключ
  компонента (`captchaAttempt`) и берёт новую: иначе человек упирался бы в
  «проверка не пройдена» навсегда.
- **Картинка — наш знак, а не сторонний виджет:** `public/captcha-mark.png`
  (глиф из `public/logo.png`, порог альфы 200 + обрезка по рамке, скрипт
  `scripts/make-captcha-mark.ts`) режется `clip-path` по своим швам на рога с
  крышей, среднюю галочку и нижнюю дугу. Один растр в маске CSS, цвет частей
  задаёт фон. Клавиатура обязательна (Tab → стрелки → Enter): капча без неё
  запирает дверь человеку, который не может тянуть пальцем.
- Живой прогон 17 ноября снаружи: без капчи `captcha_required`, мгновенный ответ
  `captcha_too_fast`, мимо места `captcha_invalid`, в место `ok`, повтор той же
  задачи `captcha_invalid`, подделанная точка сборки `captcha_invalid`.
  Призрак знака пришлось поднять с 34 % до 50 % — на живом экране его не было
  видно вовсе.

### Надзор над залистованным предприятием

- **Живой адрес:** `/{locale}/admin/companies/[id]` — три числа (точек на карте,
  жалоб за 90 дней, предупреждений), надзор со сроком пересмотра, связь,
  объекты, листинг. Ссылки — из строки компании в `/admin/business` и из дела.
- **Данные:** `Company.{suspendedAt,suspendReason,suspendedById}`,
  `ComplianceCase.nextReviewAt`, события `COMPANY_WARNED`/`COMPANY_SUSPENDED`/
  `COMPANY_RESTORED`/`REVIEW_PASSED`, звонок `REVIEW_DUE`, коды аудита
  `SUSPEND_COMPANY`/`UNSUSPEND_COMPANY`/`WARN_COMPANY`/`REVIEW_PASSED`;
  миграции `20261118100000_company_supervision` и `…110000_…_audit`.
- **Снятие — надзор, а не отмена решения модератора:** `status` остаётся
  `APPROVED`, с витрины предприятие убирает `suspendedAt` (как точку в AQ).
  Вернуть — одно действие.
- **Найденная дыра: на статус компании не смотрел никто.** Правило видимости
  собрано в `src/lib/company-visibility.ts` (`PUBLIC_COMPANY`,
  `LIVE_CARD_COMPANY`) и подмешано в фид карты, поиск точек по названию,
  каталог услуг, каталог и страницу компаний, витрину и страницу карточки
  монеты, бейдж, sitemap, выбор карточки в навигаторе и форме финтеха — и в
  **глобальный поиск**, который живой прогон поймал последним: снятая компания
  всё ещё находилась по имени. У карточки без компании (`companyId = null`,
  все 56 посеянных) не меняется ничего. Подмешивать `LIVE_CARD_COMPANY` в
  `where`, где уже есть свой `OR`, нельзя — в поиске он идёт через `AND`.
- **Дело пересмотра не заводим:** у дела `@@unique(subjectType, subjectId)`,
  второго дела у той же компании быть не может. Вместо этого `nextReviewAt` в
  самом деле: 12 месяцев, при высоком риске 6 (срок выводится из `risk`, своей
  колонки под интервал нет). Ставится при одобрении дела компании; у
  залистованных раньше — наверстывается прогоном молча.
- **Прогон идёт от предприятий, а не от дел** (`runCompanyReviewSweep`,
  `35 5 * * *`): у залистованного до слайса AN дела нет вовсе, и прогон по делам
  не увидел бы его никогда. Такому предприятию заводится дело **уже решённое**
  (`status: APPROVED`, но `decision: null`): решение принималось на старом
  экране, и записать его в дело значило бы приписать сотруднику работу, которой
  не было — аналитика считает именно `decision != null`. Открытым заводить
  нельзя тем более: оно повисло бы в очереди просроченным.
- **Звонок адресный:** проверявший → взявший → утвердивший дело → одобривший
  компанию на старом экране. Некому звонить и дело заведено наверстыванием —
  оно **открывается заново** и ложится в очередь: пересмотр это работа, и она
  не должна пропадать в логе. Дело, решённое уже в системе, заново не
  открывается (повторное одобрение прошло бы мимо объекта).
- **Автоматической приостановки нет и не будет:** лестница есть у точки (AQ), а
  предприятие снимает только человек. Предприятие — это договор, его не
  разрывают часы.
- **Предупреждение живёт в журнале**, а не в своей таблице; само сообщение пишет
  `sendStaffMessage`, а не копия его логики (там первая отзывчивость, остановка
  часов и уведомление владельца). Владелец видит причину снятия плашкой в
  `/cabinet/companies/[id]`.
- **Живой прогон 17 ноября** на настоящей компании (всё убрано за собой):
  предупреждение → `OPENED → MESSAGE_SENT → COMPANY_WARNED` и строка аудита;
  снятие → точка ушла из фида, услуги и каталог пусты, страница компании 404,
  поиск молчит, плашка «Снято с витрины» с причиной; возврат → точка на карте;
  «Пересмотр пройден» → следующий срок 17 ноября 2027.

## Пожертвования на главной (слайс AV)

Шипнуто 2026-11-18. Спеки нет — просьба владельца «вынеси на главную возможность
донатить, взять можно из DEX, она уже работает».

- **Живой адрес:** раздел «Поддержка» на `/{locale}` между лентой новостей и
  таблицей монет: три суммы нажатием и «другая сумма».
- **Денежной логики на сайте нет и не будет.** Заявку создаёт экран
  пожертвований обмена (`/exchange/#/donate`, репозиторий `trientes-dex-ui`,
  магазин `donate` службы оплаты `pay` из его `config.json`): ссылка ведёт туда
  с выбранной суммой (`#/donate?amount=20`), экран подставляет её в поле и ведёт
  человека на страницу платежа счёта. Повторить `POST /donate/<магазин>` у себя
  значило бы завести второго автора денежной заявки.
- **Суммы называет служба, а не мы** (`src/lib/donations.ts`, `GET /donate/<магазин>`):
  сегодняшние пределы ходят за запасом монеты выплаты и её ценой — 18 ноября это
  «от 10 до 75,84 $», и жёстко вписанные $100 отправляли бы человека на отказ.
  Набор сумм показывается только внутри пределов, ответ читается строго (поле не
  той формы делает ответ не ответом), а **служба молчит, отвечает не своей формой
  или пожертвования закрыты — раздела на главной нет вовсе**: приглашение,
  ведущее на «сейчас не принимаем», хуже отсутствия приглашения.
- **Главная ждать не может:** таймаут 3 с, удачное чтение лежит в Redis минуту,
  **молчание — полминуты** (без этого каждый показ главной ждал бы таймаут
  заново). Нет Redis — раздел просто читает службу каждый раз.
- **Доллары остаются долларами:** служба считает пожертвование в $, и пересчёт в
  выбранную на сайте валюту обещал бы платёж, которого не будет.
- **Ключи в `.env`:** `DONATE_PAY_API` (`https://pay.trientes.com`) и
  `DONATE_MERCHANT` (`m_…`) — оба из `config.json` выкладки обмена. Нет ключей —
  раздела нет; в репозитории их нет.
- **Проверено живым прогоном 18 ноября:** на `/ru` раздел с $10/$20/$50 и
  «Сегодня от $10 до $75.84», переход по `$20` открыл экран обмена с нажатой
  кнопкой «20 $» и полем «20». Платёж не создавался — заявок для проверок не
  делаем.
- **Словацкий у обмена появился 18 ноября** (см. уборку AW ниже): `?lang=sk`
  больше не пропускается молча.

## Своя точка на карте и фирменные булавки (слайс AY)

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-18-point-claim-and-brand-pins-design.md`.
Просьба владельца: довести до ума карточку заведения, открывающуюся с карты, и
обозначить точки BTC Map фирменными кружками.

- **Живые адреса:** `/{locale}/claim/<node:123>` — «это моё предприятие»
  (кнопка из витрины карточки точки); дальше всё в уже существующем кабинете
  `/{locale}/cabinet/companies/[id]` и в очереди `points`.
- **Данные:** `CompanyPoint.osmId` (ключ зеркала, `node:123`), миграция
  `20261118190000_point_claim_osm`.
- **Кнопка «это моё предприятие» прежде вела в пустой кабинет** — без
  упоминания точки: заведение заводило свою точку руками, и на карте вставало
  **две булавки** (своя рядом с зеркальной). Теперь заявка знает, о какой точке
  речь, а **поля берёт сервер из нашего зеркала**, а не браузер заявителя (имя,
  адрес, часы, связь, монеты из тегов OSM; монета, которой нет в каталоге, в
  поле не идёт). Дальше точка идёт **обычным путём** — PENDING, дело в очереди,
  те же лимиты и та же вторая подпись: вторая дверь к решению не появилась.
- **Одна точка — одна булавка:** после одобрения фид прячет зеркальную
  (`fetchClaimedOsmKeysInBbox`). Фильтр по выбранной монете к этому запросу не
  применяется: точку представляет хозяин, и если он монету не заявил, честный
  ответ — «тут её не принимают», а не вторая булавка из чужих данных. Сбой
  чтения оставляет дубль, а не пустую карту.
- **Отклонённая заявка точку не держит** (`claimBlockedBy`) — заведение вправе
  подать снова; ожидающая и одобренная держат, иначе одно место досталось бы
  двум предприятиям.
- **В булавке два знака, и путать их нельзя** (`src/lib/poi-brand.ts`,
  `poi-layers.ts`). **Каёмка — кто за точкой стоит:** оранжевая у нашего
  предприятия, серая (металлик) у каталога финтеха, белая у зеркала BTC Map;
  правило про **источник, а не вывеску** — банк из зеркала остаётся белым.
  **Пульсирующая середина — что это за место:** банкоматы, банки и обменники
  оранжевым, магазины зелёным, заправки синим (заправка — единственное место,
  где категория сильнее слоя: в OSM это `amenity=fuel`, к нам она приходит
  «магазином»). «Принимают выбранную монету» показывает **толщина** каёмки:
  цвет уже занят источником. Булавка — два слоя MapLibre (`poi-<layer>` и
  `poi-<layer>-core`), фильтры применяются к обоим.
- **Пульс: пятнадцать кадров в секунду, а не шестьдесят** — каждая запись
  свойства перерисовывает карту целиком; при `prefers-reduced-motion` пульса
  нет вовсе; карта за краем экрана не дышит (`IntersectionObserver`) — на
  странице монеты навигатор ниже сгиба. Сам кадр считает чистая `pulseFrame`,
  иначе правило не накрыть тестом.
- **В деле видно, что заявка на чужую точку:** строки `claims BTC Map point` и
  ссылка на OpenStreetMap. Новых пунктов в лист проверок не добавлено: они
  общие для всех точек.
- **Ловушка сборки:** клиентский компонент витрины импортировал ключ из
  `point-claim`, а тот тянет `crypto-map` с `node:dns` — Turbopack упал
  («does not support external modules»). Ключ вынесен в отдельный
  `src/lib/osm-key.ts`; правило общее — чистая мелочь, нужная браузеру, не
  должна жить в модуле с серверными импортами.
- **Живой прогон 18 ноября** (временная запись с предприятием, убрано за
  собой): вход с `?next=` вернул на заявку, «Это мой бизнес» завело точку
  `Café Sladkovský` с адресом и часами из зеркала и дело со сроком 23 ноября;
  до одобрения фид отдавал зеркальную точку, после — только `company/…`;
  уборка вернула зеркальную на место.
- **Не сделано осознанно:** реклама заведения в карточке (отдельный слайс),
  доказательство владения кодом/письмом (пока решает человек в очереди),
  заявка без входа.

## Закладка карточной монеты и оценка монет звёздами (слайс AX)

Шипнуто 2026-11-18. Спеки нет — просьба владельца: «чтобы сам Talеr в списке
можно было добавить в избранное, там звёздочки нет, и плюс сделаем оценку всем
монетам, чтобы клиенты могли оставлять в виде звёздочек».

- **Живые адреса:** звёздочка закладки у каждой строки `/{locale}` и в шапке
  страницы монеты, живущей одной карточкой; раздел «Рейтинг» (`#rating`) на
  `/{locale}/coin/<slug>` в обоих видах страницы — и у монеты рыночного фида,
  и у карточной.
- **Данные:** `CardWatchlist` (userId × `CoinCard.slug`) и `CoinRating`
  (`coinKey`, userId, stars, @@unique(userId, coinKey)); миграция
  `20261118170000_coin_ratings_card_watchlist` (руками + `migrate deploy`).
- **Закладка карточной монеты легла в свою таблицу, а не в `Watchlist`:** там
  `coinId` — внешний ключ на `Coin`, а у монеты, живущей одной карточкой,
  строки `Coin` нет по замыслу (рыночного фида у неё не существует) — поэтому
  кнопка у строки Taler прежде не рисовалась вовсе. Тот же приём уже был у бирж
  (`ExchangeWatchlist`). Наборы закладок **не сливаются в один**
  (`readUserWatchedCardSlugs` отдельно от `readUserWatchedIds`): ключи из разных
  пространств (`Coin.id` против `CoinCard.slug`), и в общем наборе закладка
  одной монеты могла бы зажечь звёздочку другой. Страница закладок читает такие
  строки из карточки (`readCardRowsBySlugs`) — отфильтровать их из рыночного
  фида нечем; номера списка (`listNo`) у них там нет, в столбце стоит «—»:
  номер принадлежит главной.
- **Ключ оценки — адрес страницы монеты** (`/coin/<coinKey>`), а не внешний
  ключ: монета бывает строкой `Coin`, карточкой или обеими сразу, а страница у
  неё одна, и оценка не должна зависеть от того, с какой стороны монета
  заведена. В базе все `Coin.slug` равны `Coin.id`, у карточки свой
  `slug @unique` — адрес единственная общая опора. Существование монеты
  проверяется действием (годится строка `Coin` или **опубликованная** карточка),
  иначе ключом можно было бы насыпать оценок чему угодно.
- **Одна оценка на человека, и её можно забрать:** нажатие на другую звезду
  меняет оценку, на свою же — снимает. Промах пальцем не должен держаться в
  средней вечно. Полузвёзд нет: средняя считается нами и стоит рядом цифрами
  (до десятой доли — вторая цифра у дюжины голосов означала бы точность,
  которой нет), а звёзды целые.
- **Одна шкала показывает два разных числа, и цвет их различает:** пока
  посетитель не оценивал, приглушённо закрашена **средняя**; как только он
  поставил свою — видна **его** оценка цветом выделения. Одинаковый цвет
  выдавал бы среднюю за личную оценку.
- **В основном списке оценок нет намеренно:** звёздочка в строке уже значит
  «избранное», и вторая звёздочка рядом читалась бы как то же самое. Столбца
  рейтинга в таблице не заводили — это решение владельца, а не умолчание.
- **Живой прогон 18 ноября** (временная учётная запись, убрана за собой):
  звёздочка у строки Taler на главной зажглась и монета появилась в
  `/ru/watchlist`; на `/ru/coin/taler` оценка «4» дала «4.0 · Оценок: 1» и
  «Ваша оценка: 4 из 5», пережила перезагрузку страницы, повторное нажатие той
  же звезды вернуло «Пока нет оценок»; удаление учётной записи снесло и
  закладку, и оценку каскадом.

## Уборка AW — Taler в основном списке, карта к точкам приёма, словацкий у обмена

Шипнуто 2026-11-18. Спеки нет: просьба владельца «поставь Taler в основной
список на позицию номер 8, и не надо писать капитализацию — только деньги,
которые в обороте» плюс закрытие долгов, перечисленных в отчёте того же дня.

**Taler стоит восьмой строкой и капитализации у него нет.** Монета без строки
`Coin` в списке не появлялась вовсе (рыночного фида у неё нет по замыслу), а
рейтинг по капитализации поставил бы её первой: 4,16 трлн $ при суточном обороте
в двести долларов — это цена одного маркетмейкера, а не размер рынка. Поэтому
строку даёт карточка: `src/lib/pinned-coins.ts` читает `CoinCardPriceIndex`,
выпуск сети и наш же часовой ряд цен, а `insertPinned` ставит её на названное
место. Решения, которые стоит помнить:
- **Капитализации нет вовсе, в её столбце стоит оборот в монетах** (349.43M).
  Карточка это решила раньше (`circulatingCoins`, `CirculatingLine`), и список
  обязан говорить то же самое; тип строки списка стал `ListRow` с
  `marketCapUsd: number | null` — `MarketRow` рыночного фида не тронут, его
  капитализация по-прежнему обязательна. **Тикер рядом с числом не пишется**
  (решение владельца 18 ноября): столбец числовой, а что это за число, говорит
  подсказка `listing.circulating`; на телефоне число стоит рядом с номером
  строки («#8 · 349.43M»).
- **Номер в списке — порядок списка, а не место в мировом рейтинге**
  (`ListRow.listNo`, ставит `insertPinned` после вставки). Прежде столбец
  показывал `rank` CoinGecko, и на главной он разрежён (1, 2, 4, 6, 7, 8, 10…),
  потому что страница показывает категорию layer-1, а не весь рынок: на экране
  это читалось как пропуски строк, а у закреплённой монеты места в рейтинге нет
  вовсе и стояло «—». Теперь числа идут подряд, Taler носит номер 8, следующая
  монета 9. `rank` остаётся ключом сортировки и не затирается — иначе строка
  рыночного фида потеряла бы своё настоящее место. Нумерует только главная
  (через `insertPinned`); в закладках строк мало и своих мест у них нет, там
  по-прежнему виден `rank`.
- **Место считается по порядку рейтинга, а не по порядку в массиве.** Живой
  прогон поймал это сразу: `readTop100` склеивает два снимка, USDT и USDC лежат
  в хвосте массива, но на экране стоят третьей и пятой — и Taler уехал на
  десятое место вместо восьмого.
- **Закладки у строки нет:** `Watchlist.coinId` — внешний ключ на `Coin`, а
  такой строки у монеты, живущей одной карточкой, нет. Кнопка обещала бы
  невозможное.
- **Цена старше шести часов в список не идёт** (строки просто нет): прогон
  своего обмена ходит раз в час, а молчавший пять дней читатель (живой случай
  13–18 ноября) не должен оставлять в списке цену прошлой недели.
- **Изменение за сутки и за неделю считается по нашему ряду с узким допуском**
  (15 % срока): в ряду бывают дыры, и «за неделю» от цены пятидневной давности —
  не изменение за неделю, а молчание честнее. 18 ноября суточное изменение
  поэтому пустое, недельное (−0,90 %) считается от точки 11 ноября.
- **В настроении рынка (бык/медведь) монета без капитализации не участвует** —
  вес взять нечем.
- Кэш закреплённых строк — Redis `snapshot:list:pinned` на пять минут; нет
  Redis — читается база, это два запроса.

**Владелец остался один по-настоящему.** Уборка AV записала, что
`dvvolkovv@gmail.com` понижен до `USER`, но в базе он так и стоял `OWNER` (живая
проверка 18 ноября). Теперь понижен, а его адрес **убран из `ADMIN_WHITELIST`** —
иначе повторный `linkAccount` вернул бы роль. В списке остались
`telegram:50138659` (путь восстановления владельца, строк `Account` с таким
провайдером в базе нет) и `email:biotecbank@me.com`. Копия прежнего `.env` —
`/home/dv/trientes-artifacts/env-backup-20261118.txt`.

**Решение владельца 2026-11-19: `dvvolkovv@gmail.com` — владелец.** По его прямой
просьбе роль `OWNER` возвращена, а `email:dvvolkovv@gmail.com` снова в `ADMIN_WHITELIST`
(копия `.env` до правки — `/home/dv/trientes-artifacts/env-backup-20261119T080712Z.txt`).
Записи выше о том, что он понижен и что «владелец остался один», устарели: владельцев
двое, `dvvolkovv@gmail.com` и `biotecbank@me.com`. **Не понижать и не убирать из списка
без прямой просьбы владельца** — 18 ноября уборка уже откатила это повышение, приняв
его за остаток.

**Словацкий у обмена** (репозиторий `trientes-dex-ui`, коммит `2ce9cb5` в
`main`): `sk` добавлен в `LANGS`, `LANG_LABELS`, `FILES` (без последнего словарь
не грузится вовсе — поймал тест) и переведён скриптом обмена (1489 ключей).
Множественное число словацкого — **четвёртая форма правил**, а не копия русской:
1 — `one`, 2–4 — `few`, от пяти и выше обычное множественное, а не `many`
(«5 jednotiek LP» против «5 единиц»). **На живой обмен это пока не выложено:**
`npm run deploy -- org --send=…` трижды отказал на перфтесте квитанции
(`receipt/pdf.test.ts`, 20 000 символов без пробела: 2,3 с при пороге 2 с на
этой четырёхъядерной машине под нагрузкой). Тест не ослабляем и не отключаем —
это правило их репозитория; нужно либо выкладка с незанятой машины, либо слово
владельца.

**Попутно, то же 18 ноября (коммиты `1b37ac9`, `e3cbe43`):** ссылка «где именно»
в разделе приёма карточки ведёт в саму точку (`&point=<id>`, видимость сверяется
теми же правилами, что у фида); бейдж для чужих сайтов считает ширину надписи по
таблице символов плюс `textLength`/`lengthAdjust` в SVG (по-русски «Принимаем
TAL» наезжало на адрес и читалось «Принимаем TALentes.org»), кеш бейджа снижен с
суток до часа; кнопка «Открыть на карте» открывает **прямоугольник точек, где
монету принимают** (`getAcceptanceArea`), а не место, где стоит нажавший —
единственный магазин Taler в Швейцарии, и в кадре Мадрида его не было вовсе;
карта появилась на странице «только карточка», но лишь когда прямоугольник есть.
Сводка приёма перестала считать точки, снятые надзором.

**Ждёт решения владельца, не кода:** спор цены у HydraDX и Neutron (Gate отдаёт
`HDX/USDT` по 338 $ — это другой актив под тем же тикером; у Neutron после
отсечения замерших пар живых пар не осталось), и выкладка обмена со словацким
(см. выше).

## Уборка AZ — табло перестало голодать, словацкий выложен на обмен

Шипнуто 2026-11-18, тем же днём. Спеки нет: очередь долгов, названных в отчёте
AW, по порядку.

**Платина и палладий не обновлялись на табло ни разу.** В снимке стояло восемь
инструментов из десяти, и живой запрос показал, что служба их отдаёт (`PL=F` —
200 с данными). Дело было в очереди обхода: она считалась по штампу котировки
(`regularMarketTime`), а **штамп принадлежит рынку, а не нам** — у рынка,
который стоит закрытым или торгуется в другие часы, он не двигается. Такой
инструмент навсегда оставался самым ветхим, навсегда стоял первым, а
ограничитель Yahoo режет именно **начало** обхода: не спросили → штамп не
обновился → снова первый → снова 429. **Голодание закрепляло себя**, и правка
слайса AV («самый ветхий первым») его не лечила, а создавала: до неё обход шёл
от начала списка, и металлы в хвосте не обновлялись по другой причине.
Теперь очередь строится по **нашему собственному факту** — о чём и когда мы
спрашивали (`marketFetchOrder(asked)`, ключ `snapshot:markets:asked`, TTL 7
суток). Спрос записывается, **даже когда ни одна котировка не прошла**: иначе
очередь не двигается, и это была бы та же болезнь. Жертвенный слот начала
обхода достаётся всем по разу. `fetchMarkets` возвращает `MarketSweep`
(`quotes` + `asked`), потому что получивший 429 — тоже спрос. Живой прогон:
три спроса (`^DJI`, `^IXIC`, `^GSPC`), все 429, карта записана, снимок табло не
тронут; очередь следующего прогона — `ES=F CL=F NG=F GC=F SI=F PL=F PA=F ^DJI
^IXIC ^GSPC`, то есть металлы доходят до спроса за час-полтора, а не никогда.

**Словацкий на обмене выложен.** Вчерашний отказ был не в коде: перфтест
квитанции (20 000 символов без пробела, порог 2 с) не укладывался на занятой
машине; на свободной прошёл за 1,2 с. Попутно пришёл снимок DEX с новой строкой
`order.substrate.addressNetworkPolkadot` (предупреждение «только Asset Hub, не
Polkadot Relay Chain»): во всех языках она есть, в словацком не было — язык
заводили мы, и снимок о нём не знает. Переведена их же скриптом
(`scripts/translate-dict.mjs sk`), тест паритета это и поймал.
**Ловушка, стоившая часа:** `npm test` в репозитории обмена падал 644 тестами
с `act is not a function` — это артефакт оболочки, а не кода: у процесса бота
`NODE_ENV=production`, и Vite берёт продакшн-сборку React, где `act` не
экспортируется. Скрипт выкладки гоняет тесты с `NODE_ENV: 'test'`
(`scripts/deploy.mjs:193`) — руками надо так же.

## Слайс BA — второй фактор входа для сотрудников

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-18-staff-second-factor-design.md`
(плана отдельным файлом нет: слайс делался одним проходом). До него право
залистовать биржу, пустить предприятие на витрину или выдать права другому
человеку было защищено **одним паролем**: ограничитель входа бьёт по подбору,
но не по украденному паролю — вор набирает верный с первого раза.

- **Живые адреса:** `/{locale}/mfa/setup` — заведение, `/{locale}/mfa` — ввод кода,
  раздел «Вход и безопасность» в `/{locale}/cabinet` (только у сотрудника),
  второй фактор в строке сотрудника на `/{locale}/admin/staff` (снимает владелец).
- **Данные:** `StaffMfa` (ключ, подтверждение, `lastStep`, снятие с причиной),
  `StaffMfaRecoveryCode` (sha256, одноразовые), `Session.mfaAt`, `MfaKind`,
  коды аудита `STAFF_MFA_ENABLED`/`STAFF_MFA_DISABLED`; миграция
  `20261118190000_staff_mfa` (руками + `migrate deploy`).
- **TOTP, а не письмо с кодом:** через почту у нас идёт сброс пароля, то есть
  второй фактор совпал бы с первым путём восстановления. SMS ломается подменой
  SIM и требует шлюза, которого нет.
- **Фактор проверяется на сеансе, а не внутри входа.** Провайдеров входа четыре
  (пароль, Google, GitHub, Telegram), и встраивать проверку в каждый — четыре
  места, где можно забыть. Штамп `Session.mfaAt` читает `requireStaff()` —
  та же калитка, где читается право на очередь, поэтому фактор спрашивается у
  любого экрана **и любого действия** админки сразу.
- **Требование по роли, а не по уровню:** сотрудник с `HANDLE` пишет заявителям
  от имени проекта и видит их документы — это тот же привилегированный доступ,
  что и право утверждать.
- **Заведение — дверь, а не настройка:** «включу потом» означает «не включу».
  Правило «куда отправить непущенного» вынесено в `adminRedirectFor`
  (`src/lib/authz/map.ts`) и накрыто тестом: новый повод отказа, забытый в
  раскладке, молча уводил бы человека в кабинет, хотя он всего лишь не показал код.
- **Ключ в базе зашифрован** (AES-256-GCM, `MFA_SECRET_KEY` в `.env`): хешировать
  его нельзя — по нему считается код, — поэтому дамп таблицы без ключа приложения
  входа не даёт. Нечитаемая строка отвечает `unreadable`, а не «код не подходит»:
  иначе человек набирал бы верные коды вечно.
- **Код одноразовый.** Принятый шаг пишется в `lastStep` условным `updateMany`
  по прежнему значению: без этого подсмотренный через плечо код годился бы все
  тридцать секунд, а с допуском ±1 шаг — полторы минуты. Допуск ровно один шаг:
  шире — только для подсматривающего.
- **Дыра, найденная в собственном коде до выкладки:** действие
  `startMfaEnrollment` не спрашивало калитку, и украденного пароля хватало бы,
  чтобы завести сеанс и **перезаписать ключ своим** — то есть обойти фактор через
  дверь его же заведения. Экран `/mfa/setup` это и так не показывает, но
  серверное действие вызывается прямым запросом. Правило стало чистой
  `enrollmentAllowedFor(gate)` («фактора нет» или «код в этом сеансе показан») и
  накрыто тестом.
- **Коды восстановления** — десять, одноразовые, в базе только sha256,
  показываются один раз. Снятие фактора владельцем гасит **все сеансы** записи:
  иначе снятый фактор оставался бы «показанным» в живом сеансе.
- **Аварийный выход — `scripts/disable-mfa.ts`** (`--list`, `--user= --reason=`).
  Владелец у нас один, и потерянный телефон вместе с кодами запер бы его
  навсегда: снять фактор может только *другой* владелец, а его нет. Скрипт и есть
  этот другой, и работает он только с машины, где лежит база; в журнал пишется
  `[сервер]` с причиной.
- **QR в этом слайсе не рисуем:** ссылка `otpauth://` нажатием с телефона заводит
  фактор в один шаг, а ключ буквами остаётся для случая «кабинет на компьютере».
  Своего кодировщика QR в репозитории сайта нет (он есть в репозитории обмена), и
  тащить 360 строк в слайс про вход не стали.
- **Passkeys не взяты первыми** намеренно (строго лучше, но это вторая
  реализация и привязка к устройству): `StaffMfa.kind` оставляет место.

## Слайс BB — паспорт товара мира и каталог товаров

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-18-product-passport-catalog-design.md`,
план `docs/superpowers/plans/2026-11-18-product-passport-catalog-bb.md`. Первый слайс
линии мерчантов из ТЗ «карточки мерчантов, криптоэквайринг и CRM»
(`incoming/20261118-202837-Техническое_задание…`). Эквайринг владелец подключит сам,
когда будет готова его панель мерчанта, — поэтому слайс нарочно строит только то, что от
оплаты не зависит.

- **Живые адреса:** `/{locale}/products` — каталог, `/{locale}/product/[slug]` — паспорт,
  `/{locale}/product/[slug]/claim` — заявка производителя,
  `/{locale}/cabinet/companies/[id]/products[/<id|new>]` — кабинет, очередь **`products`**
  (📦) в `/{locale}/admin/queues`.
- **Три разные вещи, и смешивать их нельзя:** паспорт товара (что это за вещь),
  предложение продавца (цена, кэшбэк — **следующий слайс**), остаток и движение (склады,
  перевозчик в пути — **следующий слайс**). Цена и остаток — свойства продавца, а не вещи:
  положи цену в паспорт, и второй продавец той же бутылки воды обязан завести второй
  паспорт, а «карточка мира» распадается на карточки магазинов.
- **Данные:** `Product` (+`gtin @unique`, `ownerCompanyId`, `suspendedAt`, `mergedIntoId`,
  `tokenChain/tokenAsset`), `ProductEdit` (только вставка), `ProductClaim`,
  `ProductRevision`, `ProductReport`; `CaseSubjectType` += `PRODUCT_CLAIM`/`PRODUCT_REPORT`;
  миграции `20261118210000_product_passport`, `…213000_product_case_kinds`,
  `…214000_product_audit_actions`. Паспорт **переживает предприятие**, которое его набрало
  (`SET NULL`, не каскад): карточка мира продавцу не принадлежит.
- **Кто правит: начинает продавец, закрепляет производитель.** Пока хозяина нет, правит
  любое **залистованное** предприятие сразу, без очереди — очередь на каждую правку убила
  бы наполнение каталога. Защита не очередью, а тремя вещами: правит только прошедшее нашу
  модерацию и не снятое надзором предприятие (роль не VIEWER), у каждой правки автор и
  время в неизменяемой истории, откат — **новая** запись, а не удаление старой, и на
  паспорт можно пожаловаться. Забрал производитель (`ProductClaim` → дело в очереди с
  листом проверок и двумя подписями) — чужие правки становятся `ProductRevision`, и решает
  их **хозяин, а не администратор платформы**: это спор двух предприятий о свойствах их
  товара. Хозяин, отклоняющий верные правки, ловится жалобой.
- **Опознание товара — штрихкод.** `parseGtin` требует контрольную цифру (EAN-13, UPC-12 →
  EAN-13, EAN-8): опечатка в одном знаке иначе заводит паспорт-двойник, который потом
  сливать руками тысячами. Занятый код отвергается **вслух** со ссылкой на найденный
  паспорт (`gtin_taken`), а не обнуляется молча. Товар без кода (услуга, развес, ручная
  работа) живёт своим паспортом; дубли сливает администратор (`mergedIntoId`, страница
  отдаёт 308), слияние обратимо, цепочки слияний запрещены.
- **Статуса PENDING у паспорта нет** — правка идёт без очереди, значит паспорт виден
  сразу; убрать его может только надзор (`suspendedAt`, страница 404, из каталога и
  `sitemap.xml` исчезает).
- **«Токенизированная продукция» — название, которое соврало бы с первого дня:** токенов
  нет. Вместо него считается **готовность** (`tokenizationReadiness` — чистая функция):
  название, категория, описание ≥120 знаков, фото, штрихкод, подтверждённый производитель,
  документ; страница перечисляет недостающее. Появились `tokenChain/tokenAsset` — показываем
  токен. **Выпускает сеть, не сайт:** право собственности это деньги, а у денег один автор.
- **Видео своё, а не чужой проигрыватель** (решение владельца): mp4 ≤30 МБ, одно на товар,
  корень `PRODUCT_MEDIA_ROOT` (`/var/www/trientes-uploads/products`), nginx-блок расширен
  до `(coin-cards|points|products)`. Проверяются **магические байты** (`ftyp`), а не
  заявленный `Content-Type`: файл потом отдаёт nginx. **Длительность не проверяется** —
  `ffprobe` на сервере нет, и выдумывать проверку, которой не делаем, нельзя; предел
  честно в байтах. `svg` в белый список не входит.
- **Голос — браузерный синтез** (`speechSynthesis`), язык из `Product.language`, а не
  страницы: описание написано мерчантом на своём языке. Нет голоса под этот язык — кнопки
  нет вовсе. Серверный синтез (как в отчётах ассистента) не взят: платный вызов на каждый
  товар и каждый язык плюс хранение и гашение при правке описания.
- **Описания не переводим машинно:** состав продукта — утверждение, за которое мы не
  отвечаем. Интерфейс вокруг переведён на все `SUPPORTED_LOCALES` (`products.*`,
  `cabinetProducts.*`, `admin.products.*`).
- **Три дефекта поймал живой прогон, все починены:** `emptyProduct` жила в клиентском
  модуле, и серверная страница падала («it can only be rendered as a Component») — правило
  общее: чистая мелочь, нужная обеим сторонам, живёт в своём модуле (`products/form-values.ts`);
  JSONB отдаёт ключи объекта своим порядком (`{key, unit, value}` вместо `{key, value, unit}`),
  и сравнение простым `JSON.stringify` писало в историю «свойства изменились» при **каждом**
  сохранении — сравнение стало устойчивым к порядку ключей и к `null`/отсутствию поля; в
  заголовке дела стоял cuid предприятия вместо названия.
- **Живой прогон 18 ноября** (два предприятия, два сотрудника, всё убрано за собой):
  паспорт Coca-Cola с живым штрихкодом 5449000000996 заведён первым предприятием; второе,
  набрав тот же код, получило ссылку на существующий паспорт, а не второй — дубля нет;
  правка вторым предприятием записалась сразу с автором в истории; заявка производителя
  завела дело со сроком 25 ноября (5 рабочих дней), лист из пяти пунктов, «проверил» и
  «утвердил» — **разные люди** (`soleSignOff = false`), после одобрения `ownerCompanyId`
  проставлен и в аудите `APPROVE_PRODUCT_CLAIM`; после этого правка первого предприятия
  стала предложением («ваша правка отправлена производителю»), хозяин её принял; жалоба
  завела дело на 23 ноября, повтор с того же адреса `too_soon`, «неверные данные» без слов
  `comment_required`, звонок ушёл трём сотрудникам один раз; решение «подтвердить жалобу»
  без причины отвергнуто вслух, с причиной — паспорт снят, страница 404, каталог пуст,
  аудит `SUSPEND_PRODUCT`; дубль отдал 308 на главный паспорт; снаружи: жалоба без капчи
  `captcha_required`, загрузка без сеанса 401.
### Дополнение BB-2 — сканер штрихкода камерой и голосовой набор описания

Шипнуто 2026-11-18. Спека `docs/superpowers/specs/2026-11-18-barcode-scan-and-dictation-design.md`.
Просьба владельца: паспорт заводят стоя у полки с телефоном, а форма требовала набрать
тринадцать цифр с упаковки и описание большими пальцами по стеклу.

- **Живые адреса:** кнопка «Сканировать» у поля штрихкода в
  `/{locale}/cabinet/companies/[id]/products/<id|new>`, кнопки «Диктовать» у описания,
  применения и состава там же, «Сканировать» рядом с поиском в `/{locale}/products`.
- **Читателей кода два, и порядок не случаен:** сперва браузерный `BarcodeDetector`
  (Chrome на Android разбирает наклонённый код лучше), где его нет — **а это весь Safari,
  то есть все iPhone** — наш разбор кадра (`src/lib/barcode/{ean,scan}.ts`). Поэтому своё,
  а не wasm-сборка ZXing ради тринадцати цифр; прецеденты своих кодеков в проекте уже есть.
- **Контрольная цифра — охранник обоих читателей** (`parseGtin`), и код должен
  прочитаться **дважды**: осечка, случайно сложившаяся в годный код, заводит паспорт
  чужого товара. **Тусклый кадр не разбирается вовсе** (размах яркости строки < 40):
  в сумерках случайные полосы складываются в случайные цифры.
- Разбираются **не весь кадр, а строки и столбцы** от середины наружу: линейный код
  одинаков по всей высоте, а столбцы нужны затем, что телефон держат и поперёк. Задняя
  камера просится как `ideal`, а не `exact` — на ноутбуке её нет. Нет камеры — нет кнопки;
  набор цифр руками остаётся всегда. Снятый код сразу идёт в проверку «такой уже есть».
- **Диктовка дописывается в конец, поле остаётся обычным полем** — это и есть
  «редактирование сути»: человек говорит суть, потом правит руками. Промежуточная догадка
  речи — серым **под** полем: в самом поле она затирала бы правку. Знаков препинания от
  себя не ставим, заглавная — только после точки. Язык распознавания — язык описания, а
  не страницы (как у озвучивания). Safari обрывает распознавание после каждой фразы →
  перезапуск, но не после отказа в микрофоне (иначе вечный запрос разрешения) и не после
  четырёх пустых обрывов подряд.
- **Кодировщик штрихкода живёт в тесте** (`tests/fixtures/ean-symbol.ts`): сайт штрихкоды
  читает, а не печатает, и кодировщик здесь — определение формата для читателя.
- **Живой прогон 18 ноября:** Chrome с поддельной камерой (`--use-file-for-fake-video-capture`,
  кадр Y4M с настоящим EAN-13 Coca-Cola) на `/en/products` — код прочитан, проверен и
  спрошен у сервера за две секунды; тот же прогон на экране 390 px по-русски показал
  «Паспорт со штрих-кодом 5449000000996 пока не найден». Тест остался в репозитории
  (`tests/e2e/product-barcode-scan.spec.ts`).
- **Сознательно нет:** фонарика и наводки на резкость (нестандартные свойства трека,
  кнопка-обманка хуже её отсутствия), QR (на упаковке он ведёт на сайт производителя, а
  не к товару), разбора сильно наклонённого кода своим читателем (наклон выправляет рука),
  серверного распознавания речи и перевода надиктованного.

## Слайс BC — предложение продавца, склады и «где взять»

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-product-offers-warehouses-design.md`,
план `docs/superpowers/plans/2026-11-19-product-offers-warehouses-bc.md`. Второй слайс линии
мерчантов: BB завёл паспорт товара (**что** это за вещь), BC — две оставшиеся вещи из той же
тройки: **предложение продавца** (цена, единица, ставка кэшбэка, правила продажи) и
**остаток с движением** (склады, полки, перевозчик в пути). Эквайринга по-прежнему нет,
поэтому слайс строит только то, что от факта платежа не зависит.

- **Живые адреса:** раздел «Где взять» на `/{locale}/product/[slug]`; раздел «Товары» на
  `/{locale}/companies/[id]`; `/{locale}/crypto-map?product=<slug>`;
  `/{locale}/cabinet/companies/[id]/warehouses[/<wid>]`; блок «Моё предложение» на
  `/{locale}/cabinet/companies/[id]/products/[productId]`.
- **Данные:** `ProductOffer` (@@unique companyId+productId), `Warehouse`
  (WHOLESALE | SHELF | THIRD_PARTY, `pointId?`, `online`, `archivedAt`), `StockBalance`
  (@@unique warehouseId+productId), `StockMovement` (RECEIPT | ISSUE | TRANSFER | ADJUST ×
  IN_TRANSIT | DONE | CANCELLED, перевозчик, трек, сроки, `reverseOfId`); миграция
  `20261119060000_product_offers_warehouses`.
- **Полка — это склад, а не отдельная сущность**, и она обязана где-то стоять: своя
  одобренная точка или онлайн (`shelf_needs_place`). Раздел «где взять» считается ровно по
  полкам, и полка, которая нигде не стоит, обещала бы место, которого нет. **Сторонний
  склад в «где взять» не показывается никогда** — это чужое плечо логистики. Точка бывает
  только у полки; «онлайн» у оптового склада нормализуется в `false`, а не отвергается
  новой ошибкой.
- **Остаток — свёртка движений, и он хранится.** Считать по миллиону движений на каждый
  показ страницы нельзя, держать только баланс — значит не уметь объяснить, откуда он
  взялся. Пишется в той же транзакции, что движение; расхождение ловит
  `scripts/stock-audit.ts`, и он **печатает его, а не исправляет молча**: расхождение
  означает дефект в коде движений, и затирание баланса спрятало бы его от нас.
- **Товар у перевозчика — третье место, а не остаток получателя.** Названный перевозчик
  превращает перемещение в путь: с источника списано сразу, получателю зачислено только
  при приёме. Иначе едущий товар существует дважды или исчезает. **Отмена — встречное
  движение** (`reverseOfId`), а отменённая запись остаётся со статусом `CANCELLED`: журнал
  неизменяем, как история правок паспорта и `CaseEvent`.
- **Остаток в минус не уходит** (`insufficient_stock`), кроме поправки: пересчёт вправе
  обнаружить дыру, а везде иначе минус — ошибка ввода, то есть обещание «в наличии».
  Проверка идёт **дважды и по-разному**: до записи — чтобы отказать словами, ничего не
  записав; после применения внутри транзакции — потому что проверка «до» под двумя
  одновременными расходами пропускает оба, а `UPDATE … increment` строку блокирует.
  Поправка требует причины (≥3 знака) и только она принимает отрицательное количество.
- **Предложение модерацию не проходит:** его публикует уже залистованное предприятие — то
  же право, что правит паспорт без очереди в BB. Снимают три надзора, которые уже есть
  (предприятие снято, паспорт снят или слит, продавец поставил паузу); своей очереди,
  своей жалобы и своего `suspendedAt` у предложения нет. Правило видимости живёт чистой
  функцией `offerVisible`, а условия запроса — её ускорение.
- **Одно предложение одного предприятия на один товар.** Две цены одной вещи у одного
  продавца — и покупатель не знает, какая настоящая; разная фасовка это разные товары с
  разными штрихкодами (правило BB).
- **Цена в валюту сайта не пересчитывается** — прецедент пожертвований (слайс AV):
  пересчёт обещал бы платёж по нашему курсу, а платёж пойдёт через эквайринг. Валюта —
  фиатная часть того же `CURRENCIES`, второго списка валют не заводим. **Единица измерения
  — свойство предложения**, а не паспорта: один продаёт колбасу килограммами, другой
  палками.
- **Кэшбэк — ставка, а не начисление:** 0,1–50 % (выше почти наверняка набрали 500 вместо
  5,00 — отказ вслух), и рядом стоит строка «начисление заработает с оплатой через кошелёк
  платформы». Обещать «вы получите» нельзя: кошелька нет.
- **Покупателю — наличие, а не число.** Точный остаток это коммерческая тайна продавца и к
  тому же заявление, которого мы не проверяли; число видит сам продавец в кабинете. Ноль —
  это ноль: раздел не скрывается, а говорит «пока никто не продаёт» (как раздел приёма у
  монеты). Витрина предприятия, наоборот, пустой не показывается вовсе: предприятию без
  товаров рассказывать нечего.
- **Третий фильтр карты — `?product=<slug>`** (были монета и точка): фид отдаёт **только
  наши точки** с товаром на полке, зеркало BTC Map и каталог финтеха не домешиваются (о
  товарах они не знают). Монета при этом не фильтрует: человек ищет товар, а чем платить —
  отдельный вопрос, и ответ стоит в карточке точки. Пустой список точек означает «ни
  одной», а не «все»; сбой чтения даёт пустую карту, а не карту всех точек — вторая врала
  бы о товаре. Карта открывается прямоугольником полок с товаром (приём слайса AW).
- **Склад архивируется, а не удаляется**, и с остатком или грузом в пути архив
  запрещён (`warehouse_not_empty`, `transit_pending`): иначе товар исчезает молча.
  Потолки: 50 складов на предприятие, 500 движений в сутки (считаются до работы, как
  `DAILY_EDITS` в BB).
- **Предложение правится там, где правится товар** — два экрана на одну вещь это две
  двери, через которые данные расходятся. `editorCompany` вынесен из `actions/products.ts`
  в `src/lib/products/editor-company.ts`: то же право правит паспорт, цену и остаток, а
  вторая копия правила разошлась бы с первой.
- **Живой прогон 19 ноября** (временные запись, предприятие, точка и паспорт — всё убрано
  за собой): полка без места отвергнута вслух; полка на точке и оптовый склад завелись;
  ставка 500 % отвергнута, 5 % принята; приход 100; попытка выдать 150 отвергнута и число
  не тронуто; перемещение 40 с перевозчиком дало источнику 60, полке 0 и строку «в пути» с
  треком и сроком — паспорт в этот момент честно говорил «сейчас нет в наличии»; приём
  положил 40 на полку, и на паспорте появились «в наличии», место с городом и страной,
  «где именно» и «открыть на карте»; фид по товару отдал одну нашу точку там, где без
  фильтра их 37; поправка −3 без причины отвергнута, с причиной прошла (57); отмена
  транзита вернула 7 источнику встречным приходом; пауза предложения убрала его разом из
  паспорта, витрины и фида карты.
- **Дефект, который поймал только живой прогон:** сверка остатков считала отменённое
  перемещение «не бывшим» и пропускала целиком — а источник оно **уже списало** (отменить
  можно лишь отправленное), и возврат пришёл встречным приходом отдельной строкой. Из-за
  этого пересчёт давал 64 против верных 57. Починено в `scripts/stock-audit.ts`:
  отменённое перемещение по-прежнему списывает источник, зачисление делает только `DONE`.
- **Попутно:** веб перезапущен из `ecosystem.config.js` через `env -u max_memory_restart` —
  обычный `pm2 restart --update-env` снова подтянул из окружения лимит 300 МБ (болезнь
  записана в памяти `project_trientes_pm2_env_memory_limit`); теперь опять 768 МБ.
- **Что дальше по этой линии:** команда мерчанта из ТЗ 6.6 (конструктор ролей, задачи,
  чат, дашборд) и портал поставщика с автозаказом. Вне слайса сознательно остались: чеки и
  касса, заказ и доставка, серийные номера и партии, порог автозаказа (`minQty` в схеме не
  заводим, пока нечему его читать), выпуск токена, сторонний эквайринг магазина (факта
  платежа мы не видим — кэшбэка на такой покупке не будет).

## Слайс BD — лояльность наполовину: ставки и уровни

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-loyalty-rates-levels-design.md`,
план `docs/superpowers/plans/2026-11-19-loyalty-rates-levels-bd.md`. Третий слайс линии
мерчантов. Начисление кэшбэка идёт с факта оплаты, а факта оплаты у сайта нет — поэтому
слайс строит ровно ту половину, которая от платежа не зависит: **кто и сколько обещает**
(ставки) и **какая лестница объявлена** (уровни).

- **Живые адреса:** `/{locale}/cabinet/companies/[id]/loyalty` (ставки продавца, ссылка в
  той же полосе, где «Товары» и «Склады»); раздел «Кэшбэк» на `/{locale}/companies/[id]`;
  раздел «Кэшбэк и уровни» (`#loyalty`) в `/{locale}/cabinet`; действующая ставка в
  разделе «Где взять» на `/{locale}/product/[slug]` и на витрине предприятия.
- **Данные:** `Company.cashbackBasePercent Decimal?(5,2)`, `CashbackRule`
  (@@unique companyId+category); миграция `20261119140000_loyalty_rates`. Отдельной
  строки под ставку «на всё» не заводили: одна строка на предприятие — это колонка, а
  `@@unique` с `NULL` в Postgres ничего не держит (NULL-ы различны).
- **Побеждает ближайшая к товару ставка, а не наибольшая** (`effectiveCashback`): товар →
  категория → «на всё». Максимум выглядит выгоднее для покупателя, но тогда продавец не
  может **понизить** ставку на отдельный товар — его же общая встала бы сверху. Функция
  возвращает и источник (`offer`/`category`/`company`), и в кабинете у товара без своей
  ставки стоит строка «здесь действует ваша ставка категории: 7 %»: иначе продавец
  удивится на странице покупателя.
- **Пустое поле снимает ставку, а не пишет ноль.** «Кэшбэк 0 %» — обещание, которого
  никто не давал; отсутствие ставки это отсутствие обещания. Пределы (0,1–50 %) берутся
  импортом из правил предложения BC — второй список разошёлся бы с первым.
- **Ставки сами по себе покупателю видны только на карточке магазина** одной строкой
  («3 % на всё, до 7 % по категориям»); «до» не пишется, когда лучшая категория не лучше
  базы. Ни одной ставки — строки нет вовсе: обещание кэшбэка на товар, которого продавец
  не продаёт, это реклама без товара.
- **Уровни — лестница платформы, одна на сеть, в коде** (`src/lib/loyalty/levels.ts`, то
  же решение, что лист проверок в AP). Своя лестница у каждого магазина означала бы, что
  покупатель не может назвать свой уровень, не открыв тридцать карточек. Уровень даёт
  **надбавку платформы в процентных пунктах**, а не множитель к ставке продавца:
  множитель — чужие деньги, за «×1,2» платил бы тот, кого не спросили. Числа
  (0 / $500 +0,25 / $5 000 +0,5 / $25 000 +1 п.п.) — предложение, владелец меняет одной
  строкой.
- **`levelFor` принимает `null`, и это не ноль:** оборот в сети не считает никто, экран
  говорит «оборот ещё не считается». Ноль заявлял бы измерение, которого не было.
- **Модерации у ставки нет:** её объявляет уже залистованное предприятие тем же правом
  `editorCompany`/`canWrite`, которым BB правит паспорт и BC — цену; снимают те же три
  надзора (`offerVisible`). Смена ставки обновляет страницы всех товаров продавца, и
  потолок в 200 страниц пишется в лог — молчаливое обрезание читалось бы как «обновили
  все».
- **Живой прогон 19 ноября** (временные запись, предприятие, точка, паспорт, полка —
  убрано за собой): у паспорта без своей ставки проступила ставка «на всё» 3 %; ставка
  категории 7 % её перебила; своя ставка товара 1 % перебила обе и погасила подсказку в
  кабинете; 500 % отвергнуты вслух; снятие ставок по одной вернуло 3 %, потом пустоту —
  и раздел «Кэшбэк» исчез с карточки магазина; в кабинете покупателя лестница с
  «Базовый · сетевой оборот ещё не посчитан».
- **Два дефекта перевода, найденных живым прогоном:** русский получил «кешбэк» рядом с
  «кэшбэк» (в скрипт переводов добавлен ru-глоссарий), а «1 товаров в продаже» не
  согласовывалось ни в одном языке — ICU-множественное число прогон переводов **не
  осиливает** (такой строки в проекте не было ни одной, и она вышла на сайт
  по-английски), поэтому формулировка стала «В продаже: 1», без согласования.
- **Чего в слайсе нет намеренно:** акции и рассылки (ТЗ 6.5 — своя линия с аудиторией и
  лимитами); доля платформы в кэшбэке (коммерческое число владельца); кэшбэк в карточке
  точки навигатора (обещание относится к товару, и место ему там, где товар); свои группы
  товаров продавца (категория — уже готовая общая ось, вторую раньше первой не заводим);
  баланс, начисление, списание и взаиморасчёты сетевого кэшбэка — всё это с эквайрингом.


## Слайс BK — маршрут A→B: интересы, места по пути, подсказка за 1–2 км

Шипнуто 2026-11-20. Спека `docs/superpowers/specs/2026-11-20-route-interests-stops-design.md`,
план `docs/superpowers/plans/2026-11-20-route-interests-stops-bk.md`. ТЗ 4.4 целиком и
**первый слайс, который связывает навигатор с данными мерчантов**: BB завёл паспорт, BC —
цену и остаток, BD — ставки кэшбэка, BG — акции, но человек в дороге их не видел.

- **Живые адреса:** панель «По пути» в карточке точки навигатора (`/{locale}/crypto-map`,
  страница «Карта», под сводкой маршрута) и под картой, когда карточка закрыта; раздел
  «Интересы и маршруты» (`#interests`) в `/{locale}/cabinet`; `POST /api/crypto-map/along-route`.
- **Данные:** `UserInterest` (userId × ключ, `LIKE|DISLIKE`, @@unique), поля
  `User.routeCorridorMeters` (1500) и `User.routeAlertMeters` (1500); миграция
  `20261120060000_route_interests`.
- **Нового источника мест нет.** Места по пути берутся из того же фида — зеркало BTC Map,
  наши точки, финтех, — то есть это **крипто-принимающие** заправки и кафе, а не все
  подряд: общей базы POI у нас нет (Overpass насыщен месяцами), и обещать «все заправки по
  пути» значило бы врать. На экране это сказано строкой.
- **Ось интересов — пять ключей в коде** (`src/lib/interests.ts`: fuel, food, lodging,
  shop, cash), как лист проверок в AP и лестница BD. `shop` — **падающий остаток** слоя
  «магазин»: категория зеркала приходит свободным текстом из тегов OSM, и место, не
  попавшее ни в одно правило, честнее показать магазином, чем потерять.
- **У своей точки вид заведения по названию предприятия не угадывается** (поймано живым
  прогоном): в `Poi.category` у неё стоит **название компании**, а `CompanyPoint.type`
  знает только SHOP/ATM/POS/SALES_OFFICE. Предприятие «Benzina s.r.o.», торгующее одеждой,
  стало бы заправкой, а наша кофейня «Coffee & Co» — едой по совпадению слов. Поэтому своя
  точка это «магазин», кроме банкомата, и своего поля вида мы не заводили.
- **Молчание — это все пять интересов, а не ни одного** (`activeInterests`): человек,
  впервые строящий маршрут, ещё ничего о себе не сказал. Любой «нравится» сужает набор,
  «не нравится» вычитается всегда и сильнее «нравится». **Отметка не убирает булавку с
  карты** — карта показывает действительность; «не нравится» действует на список по пути
  и на голос.
- **Два числа человека:** коридор (200–10 000 м) и за сколько предупредить (500–5000 м).
  Это та часть «настройки радиуса» из ТЗ, которую мы делаем честно: **гео-баннера и
  фоновой геолокации нет** (решение BG), «привычных мест» в данных нет вовсе.
- **Отмеченная точка — напоминание, а не крюк.** Прокладывать маршрут через выбранные
  места значило бы менять длину, время и все манёвры, а каждый пересчёт обнулял бы
  подсказки ведения. На экране стоит «300 м в стороне, через 42 км», а не «+6 минут».
- **Отметки живут в браузере** (`localStorage`, ключ — цель маршрута): это поездка, а не
  коллекция, а навигатор нарочно работает без входа — таблица отдала бы отметки только
  вошедшим. Перезагрузка посреди дороги их не теряет (проверено живым прогоном).
- **Голос — один раз на точку за поездку**, порог `max(настройка, скорость × 60 с)`:
  на 110 км/ч полтора километра это 49 секунд, и фраза должна прозвучать до поворота.
  Проехал мимо — молчим, догонять поздно. **Кэшбэк в голос не идёт** (он на экране, а за
  рулём фраза должна быть короткой); заблокированного экрана у нас нет и мы его не обещаем.
- **Цена — только при фильтре по товару.** Литр бензина в наших данных существует только
  как `ProductOffer` с паспортом; «средняя цена по магазину» была бы выдумкой. При
  `?product=<slug>` список сужается до полок с товаром — ровно как фид карты в BC (зеркало
  и финтех о товарах не знают), и тогда сравнение «через 100 км или через 150» идёт по
  настоящей цене. Без товара сравниваются кэшбэк и крюк. Ставка товара старше ставки
  предприятия (`effectiveCashback`).
- **Порядок — по расстоянию вдоль маршрута:** это и есть сравнение из ТЗ, отдельной
  таблицы оно не требует. Потолок 40 строк, остаток назван вслух («ещё N по пути»),
  коснулись потолка выборки — сказано тоже.
- **Геометрия — чистый модуль** (`route-corridor.ts`): прореживание линии (250 м),
  прямоугольники кусков по 25 км с запасом на коридор (не один bbox на весь маршрут:
  Прага–Берлин это 300 × 300 км чужих точек), проекция «где по пути и насколько в
  стороне». Кусков не больше 48 — маршрут длиннее просто даёт куски крупнее, точный отбор
  всё равно в коде, поэтому молчаливого обрезания нет.
- **У транспорта остановок по пути нет** (человек в вагоне никуда не свернёт), маршрут
  короче 500 м панели не имеет, сбой чтения и «ничего по пути» — **разные** состояния,
  ответ лежит в Redis 10 минут по ключу линии, интересов, коридора и товара.
- **Дефект, который поймал только живой прогон:** панель стояла под картой, в блоке
  `!selected`, — а обычный путь человека это «нажал точку → карточка открыта → Маршрут
  сюда», и панели он не видел вовсе. Теперь узел собирается один раз и уезжает **в
  карточку точки**, рядом с остальным управлением маршрутом (правило AI), а под картой
  рисуется только когда карточка закрыта. Там же поймано «через 0 m» у места в начале
  пути (стало «в начале») и обрезанная строка подробностей.
- **Живой прогон 20 ноября** (временные запись, предприятие, точка, товар с ценой и
  полкой — всё убрано за собой): маршрут по Праге 5,9 км → 40 мест из 59, у гостя
  умолчания (коридор 1500, подсказка 1500); у вошедшего с «нравится: топливо, еда» и
  коридором 400 м — 4 места; своя точка в 836 м от линии дала кэшбэк 3 % («на всё»), а с
  фильтром по товару — **одну** строку с ценой 36,9 CZK/л и ставкой товара 5 %; транспорт
  и короткий маршрут отдают пусто, негодное тело — 400; на экране 390 px по-русски панель
  в карточке, отметка держится после перезагрузки, горизонтальной прокрутки нет.
- **Чего в слайсе нет намеренно:** крюк через отмеченную точку (многоточечный маршрут),
  гео-баннер на заблокированном экране и радиус вокруг «привычных мест» (нет фоновой
  геолокации), цена без товара, отдельная рассылка акций на маршруте (лимиты BG уже
  считают её), сохранённые маршруты.

## Уборка BH — список монет, исчерпанная квота CoinPaprika, сроки у чужих вызовов

Шипнуто 2026-11-19 вечером. Спеки нет: владелец заметил глазом, что «в разделе
коинс пропали монеты, нет биткойна», и попросил проверить сайт целиком.
Коммиты `4fec178`, `c6d57e5`, `97a6abf`. Три дефекта, и ни один не был виден в
коде — все три нашлись чтением живых прогонов и живым замером страниц.

**Главная отдавала половину списка, и это была не случайность.** Снимок списка
состоит из **двух половин с разным сроком жизни**: категория layer-1 (`topList`,
15 минут) и монеты, заведённые руками (`adminAddedList`, час). Читатель отдавал
любую уцелевшую (`l1.length > 0 || admin.length > 0`), поэтому достаточно было
одного 402 от CoinGecko, чтобы основная половина истекла, а вторая осталась: в
18:35–18:50 главная показывала 27 монет без биткойна и эфира, с разорванной
нумерацией и без строки BTC в бегущей строке. 429 у CoinGecko не редкость, а
будни — лимит бесплатного тарифа считается **по IP и общий у веба с воркером**,
за сутки их было 9, за 10 ноября 45. Теперь снимок годен только целиком, иначе
читается база (там снимки всех монет от последнего удачного прогона), а **пустая
основная половина считается сорванным чтением**: в категории layer-1 пустого
рынка не бывает; пустая половина заведённых руками — законный ответ (их может
не быть). Запасной путь отсекает снимки **старше шести часов** (порог
закреплённой строки из AW): в базе лежат и монеты, выпавшие из категории, их
цену не обновляет никто, и самой старой на живом проде было 680 часов. Прогон
цен больше не пишет пустой список: записанный пустым снимок читатель счёл бы
годным — та же дыра с другой стороны. Проверено живым удалением ключа Redis:
страница собралась из базы, 138 монет с биткойном.

**CoinPaprika исчерпала запас месяца, и из-за этого падал весь сайт.** Живой
запрос: `402 {"error":"This plan has 20000 monthly requests limit, your requests
rate is: 20003"}` на **любой** путь. Страница биржи зовёт подробности при
отрисовке, 402 считался «приходи позже» и повторялся через 10 и 30 секунд —
`/en/exchanges/matcha_base` отдавался **50,2 секунды** живым замером. Обход
Facebook-бота (`57.141.20.x`) по двенадцати языкам разом догонял веб до 800 МБ,
pm2 перезапускал его по памяти (17:03, 17:34, 18:36 — и так 15 раз за сутки), и
в каждое такое окно **все** посетители получали 502, а страницы бирж — 504.
Четыре границы, каждая на своём уровне: служба различает два 402 **по телу
ответа** (счётчик меньше предела — частота, повторяем; счётчик достиг предела —
месяц кончился, повтор бессмыслен) и после исчерпанного запаса **шесть часов не
звонит вовсе** (`CpQuotaBlockedError`, запас проверяется сам — звонок раз в
шесть часов стоит дешевле, чем ручное снятие); у страницы **срок три секунды**
(числа из базы у неё уже есть, прецедент — рельс пожертвований); **один запрос
на одну биржу** (двенадцать языков одной страницы — один вопрос, а не
двенадцать); и расписание прогона считается **от запаса месяца, а не от
частоты** — было два прогона в час по 26 запросов (37 тыс. в месяц против
запаса 20 тыс.), стало один по 11 (≈8 тыс.), при старте воркера прогон не
зовётся (его ответы ложатся в базу, а воркер перезапускается по нескольку раз в
день — 14 раз за сутки). После правки: 50,2 с → 0,29 с; 72 страницы бирж в
двенадцати языках разом — RSS 505 МБ, все ответы 200. Предел памяти веба поднят
с 768 МБ до 1 ГБ (перезапуск по памяти — это окно 502 для всех, а на машине
свободно 5,4 ГБ); запускать по-прежнему только через
`env -u max_memory_restart`.

**У чужих вызовов не было сроков вовсе.** `fetch` своего срока не имеет, а
страницу монеты, страницу биржи и маршрут графика рисует запрос в чужую службу:
замолчавшая служба держала бы отрисовку столько, сколько молчит — хуже, чем
конечные повторы CoinPaprika. Сроки появились у клиентов CoinGecko (15 с в
фоне, 6 с при отрисовке), CoinPaprika (10 с), коннекторов бирж и Binance (8 с),
Telegram из серверных действий (8 с) и ряда свечей обмена (8 с). У читателей
сетей (`json-rpc`, 8 с), новостей, индекса страха, табло, пожертвований и
Википедии сроки были и раньше. Граница — `tests/outbound-timeouts.test.ts`:
модуль с запросом наружу (прямым или через внедрённый `fetchImpl`) обязан нести
срок, иначе тест называет файл.

**Что проверено и оказалось в порядке:** все 11 прогонов свежие; у 55 карточек
факты и выпуск читаются (честные `supply_unsupported` ×19); на табло рынков
**все десять инструментов, включая платину и палладий** — правка AZ («очередь по
нашему спросу») работает; 24 публичные страницы отдают 200 за 0,1–1,6 с, вход и
кабинет — 307 на `/login`; база 1,2 ГБ, ночные копии идут (710 МБ, 19 ноября
03:05), диск 22 %, сертификат до 14 февраля.

**Три класса шума в логе nginx, которые не дефекты** (20 % ответов — 404, и это
нормально): `/exchange-api/book/TAL-USDT/stream` ×276 — у TAL нет рынка на
Binance, служба заявок честно отвечает 404, а фронт DEX сам растягивает
повторы до десяти минут (его код это прямо описывает); `/` ×90 — сканеры,
стучащие по IP с чужим `Host`, их забирает default-сервер nginx; `/.env`,
`/.git/config` — обычные боты.

**Найдено попутно, не починено (мелочь, но записано):**
`Exchange.fetchedAt` **свежестью каталога не является** — прогон CoinGecko в
ветке `update` его не пишет, а прогон CoinPaprika не пишет вовсе, поэтому
`max(fetchedAt)` = 16 ноября (день появления последней новой биржи). Строить на
нём проверку в ночном отчёте нельзя; чтобы отчёт видел замолчавшую CoinPaprika,
нужно писать факт отдельно.

**Ждёт решения владельца, не кода:** платный тариф CoinPaprika (сейчас
подробности бирж обновляются ~11 запросами в час вместо 52 — каталог из 581
биржи обходится за двое суток, и это нормально, но следующий месяц снова
кончится, если страницы будут читать много); спор цены у HydraDX и Neutron
(Gate отдаёт `HDX/USDT` по 338 $ — другой актив под тем же тикером); поднимать
ли потолок рассылки акций с одной в сутки до пяти; и на машине с 7 дней висит
`vite --port 5181` от репозитория DEX (583 МБ) — похоже, забытый сервер
разработки из прежней сессии, сам он ничему в проде не служит.

## Уборка BJ — отчёт видит замолчавшую CoinPaprika, исчезнувшая монета больше не стоит вызова

Шипнуто 2026-11-19 ночью, сразу за BH. Спеки нет: три пункта долга, названные в
отчёте того же дня, по порядку.

**Ночной отчёт не увидел бы, что CoinPaprika замолчала.** Отчёт мерит прогоны по
возрасту того, что каждый пишет, — журнала запусков в проекте нет. У обхода
каталога бирж такого следа **не существует**: строки `Exchange` трогает и прогон
CoinGecko (его `updatedAt` свеж всегда), `fetchedAt` в ветке правки не пишется
вовсе, а `marketsFetchedAt` пусто у всех 581 бирж — подробности CoinPaprika
рынков так и не отдали ни разу (`ExchangeMarket` пуста, как записал слайс AD).
Поэтому прогон теперь **пишет факт о себе сам**: `src/lib/sync/run-state.ts`,
ключ Redis `run:coinpaprika`, TTL месяц; таблицу под это не заводили — одна
проверка не стоит своей таблицы. Решения, которые стоит помнить:
- **Два часа хранятся отдельно, и путать их нельзя:** `okAt` — когда прогон
  прошёл до конца, `quotaAt` — когда служба отказала по исчерпанному запасу.
  Отказ по запасу прежний удачный час **не затирает**: по первому мерится
  свежесть, второй объясняет тишину.
- **Исчерпанный запас — состояние службы, а не замолчавший прогон.** При нём
  прогон из списка свежести **выпадает вовсе**, а в отчёте появляется раздел
  «Чужие службы» со своей строкой («запас исчерпан 3 ч, последняя удачная
  выборка 14 ч назад»). Строка «прогон замолчал» каждую ночь до обновления
  месячного запаса приучила бы не читать отчёт целиком — правило слайса AA.
- **Сбой записи факта прогон не роняет** (прецедент `logCompanyAction`), а
  негодная или пропавшая запись читается как «не записал ничего» — отчёт говорит
  это прямо, а не молчит.
- Обход каталога считает **подробности, на которые служба ответила**
  (`detailsOk`), отдельно от попыток. `fetchDetail` молчание службы превращает в
  `null` (не повод валить обход), и строка лога «10 details» одинаково выглядела
  при десяти ответах и при десяти отказах. **Новый счётчик немедленно вскрыл
  дефект, из-за которого вся правка была бы напрасной:** живой прогон 22:25 дал
  `0/10 details` — список бирж отвечал 200, а подробности **всем десяти**
  отвечали 402 «запас месяца исчерпан» (20003 из 20000), `fetchDetail` этот
  отказ проглатывал как «у биржи нет данных», и прогон записывал о себе `ok`.
  То есть отчёт по-прежнему сказал бы, что служба здорова. Теперь отказ по
  запасу **не тонет**: `isCpQuotaError` отличает отказ всей службе от отказа по
  одной бирже, `fetchDetail` его перебрасывает, обход перестаёт спрашивать
  подробности (спрашивать о следующей бирже бессмысленно — отказ не про неё),
  но **числа из списка пишет всем** — они пришли одним запросом и уже у нас,
  иначе объёмы 580 бирж стояли бы ветхими до обновления запаса. Прогон с таким
  исходом записывает `quota`, а не `ok`: `pairsCount` и рынки не обновятся ни у
  кого.
- **Запас месяца действительно исчерпан** (живой запрос 19 ноября: 20003 из
  20000), и к 22:30 402 отвечал уже и список. То есть каталог бирж обновляться
  не будет до обновления запаса — это и есть то решение владельца о платном
  тарифе, которое ждёт с уборки BH, а не наш дефект. Отчёт теперь говорит это
  словами, а не молчит.

**Монета, которой нет в каталоге источника, стоила по вызову за прогон вечно.**
`coinex-token` (CET) с 11 ноября отвечала `404 coin not found`, и каждый прогон
метаданных (при старте воркера и в `30 3 * * *`) тратил на неё вызов; лимит
бесплатного тарифа CoinGecko считается по адресу и общий у веба с воркером, то
есть вызов отбирался у живых посетителей. Теперь 404 — **приговор каталога, а не
сбой связи**: монета скрывается (`isActive = false`), и обход её больше не
видит. Охранник важнее самого правила: **скрываем только ту, которой и цены
никто не пишет** (нет снимка свежее семидневного окна). Монета из сотни
категории layer-1 получает цену каждые десять минут — её 404 означал бы сбой на
стороне службы, и этот путь её не тронет никогда; 429 не скрывает ничего вовсе
(это про частоту, а не про существование); без проверки цены 404 остаётся
обычным сбоем — не зная, жив ли ключ, монету не скрываем. Скрытие обратимо из
админки (`toggleCoinActive`). Живой прогон: `retired=1`, `failed=0` впервые за
неделю, в каталоге 201 активная монета.

**Забытый сервер разработки снят.** С 12 ноября на машине висел
`vite --port 5181` репозитория обмена (583 МБ) — остаток прежней сессии, проду
он не служил.

**Проверено живым прогоном 19 ноября:** отчёт на пустом факте сказал «каталог
бирж (CoinPaprika): не записал ничего»; настоящий прогон в 22:25 записал `ok` и
`0/10 details`; настоящий отказ службы был опознан (`CpHttpError`,
`quotaExhausted`), записан как `quota`, и отчёт сказал «Чужие службы •
CoinPaprika: запас исчерпан 0 мин назад, последняя удачная выборка 6 мин назад»,
оставив в списке свежести 11 прогонов вместо 12 — одна причина вместо двух строк
об одном; прогон метаданных скрыл `coinex-token`, впервые дал `failed=0` и в
каталоге осталось 201 активная монета; три живые страницы отдают 200 за
0,2–0,44 с.

## Слайс BI — портал поставщика и автозаказ

Шипнуто 2026-11-19. Спека `docs/superpowers/specs/2026-11-19-supplier-portal-autoorder-design.md`,
план `docs/superpowers/plans/2026-11-19-supplier-portal-autoorder-bi.md`. Седьмой слайс
линии мерчантов (ТЗ 6.7 и 11.2). BC дал склады, остатки и движения, но у прихода не было
**откуда**: поставщика в данных не существовало, «будет во вторник» жило голосом, а
кончившийся на полке товар не звал никого.

- **Живые адреса:** `/{locale}/cabinet/companies/[id]/supply` (заказы, поставщики, пороги
  автозаказа и — у поставщика — «Заказы нам») и `/{locale}/cabinet/companies/[id]/supply/[orderId]`;
  ссылка «Поставки» в полосе разделов по праву `supply`.
- **Данные:** `Supplier`, `SupplyOrder`, `SupplyOrderLine`, `ReorderRule`,
  `StockMovement.supplyLineId`; миграция `20261119220000_supplier_portal`.
- **Поставщик — не третий вид учётной записи.** Записей у нас две: человек и предприятие;
  третья означала бы свою регистрацию, свой сброс пароля и свою модерацию. Поставщик,
  который сам есть предприятие платформы, портал уже имеет — это его собственный кабинет;
  остальные живут записью-контактом, и кнопки «портал» у них нет (обманка хуже отказа,
  правило BE). Приглашения поставщика ссылкой нет: приглашённый заводил бы `Company` мимо
  очереди AN и надзора AR.
- **Заказ — документ, а не платёж:** цена справочная, сумма считается на экране, под ней
  строка «оплата проходит вне платформы». Ни счёта, ни долга, ни взаиморасчётов в данных
  нет — денежной логики линия не заводит.
- **Остаток меняет только приёмка покупателя.** Поставщик, нажавший «отгружено», сообщает
  факт, а не пополняет чужой склад. Приём идёт построчно (недовоз — обычное дело), по всем
  строкам принято — заказ закрывается сам, раньше его закрывает человек с причиной.
  `applyDeltas` вынесена из `src/app/actions/warehouses.ts` в `src/lib/warehouse/apply.ts`
  и зовётся обеими дверями: у остатка один автор (прецедент `editorCompany` в BC), а
  движение несёт `supplyLineId` — иначе через месяц не ответить, откуда взялся приход.
- **Автозаказ формирует черновик, а не заказ** (`runReorderSweep()`, воркер `30 5 * * *`):
  ТЗ говорит «система формирует заявку», а отправка — обещание купить, и его автором
  должен быть человек. Поставщик у правила обязателен (`supplier_required`): правило без
  адресата это сигнал, а сигналов мы не шлём. Запас в пути считается наравне с остатком, и
  незакрытый заказ по паре «склад × товар» гасит прогон целиком — без этого за неделю
  молчания кладовщика лежало бы семь одинаковых черновиков. Строки правил одного
  поставщика группируются в один черновик.
- **Накладная — приватный файл** (`SUPPLY_DOCS_ROOT`, `/var/www/trientes-private/supply`,
  отдача `GET /api/supply-doc/[orderId]/[name]` с проверкой членства в одном из двух
  предприятий сделки). Схема имени и белый список взяты у вложений AO **импортом**, а не
  копией; svg в список не входит. **При переносе на другую машину каталог надо
  воссоздать**, как `trientes-uploads` и корень вложений дел.
- **Раздел прав восьмой — `supply`.** Не `warehouses`: кладовщик, которому поручено вести
  приход на полку, не должен заказывать у поставщика — заказ это обещание заплатить (тот
  же мотив, которым BE отделил `pricing`). Участок сужает заказы по складу, но не
  поставщиков: поставщик принадлежит предприятию целиком. Листинга внутренняя работа не
  требует, но **отправка заказа предприятию платформы требует** — иначе кто угодно, едва
  зарегистрировавшись, писал бы чужим предприятиям.
- **Три дефекта, которые поймал только живой прогон, все починены:**
  1. **Заказ внешнему поставщику был тупиком.** У поставщика без портала второй стороны не
     существует вовсе, значит «подтвердить» и «отгружено» нажать некому — заказ замирал на
     «отправлено» навсегда, и товар с него не попадал на полку никогда, хотя спека прямо
     обещает «он сам ведёт его статусы». Теперь `canTransition` принимает `hasPortal`, и
     при `false` ходы поставщика разрешены покупателю — со своими словами на кнопках
     («Зафиксировать дату поставщика», «Отметить как отправлено поставщиком») и строкой,
     объясняющей, почему эти кнопки у него; уведомление в этом случае не шлётся (обе
     стороны — одни и те же люди). Отказ остался ходом портала: отказ внешнего поставщика
     покупатель записывает отменой с причиной — двух путей к одному факту не заводим.
  2. **Поле даты у поставщика было без подписи вовсе** — на экране пустой прямоугольник
     рядом с кнопкой, тогда как поле приёмки подписано («Принять, до 8»).
  3. **В журнале предприятия стоял cuid заказа** вместо имени второй стороны: строка «кто,
     что и когда» должна читаться рассказом (тот же дефект, что cuid предприятия в
     заголовке дела — живой прогон BB).
- **Попутно русские слова:** раздел звался в полосе «Поставка», а на своей странице
  «Закупки» — теперь везде «Поставки»; «ночной запуск создает заказ на покупку» стало
  «ночной прогон создаёт черновик заказа поставщику».
- **Живой прогон 19 ноября** (два временных предприятия — покупатель и поставщик с
  порталом, кладовщик с участком из одной точки, внешний поставщик, товар, две полки и
  центральный склад; всё убрано за собой): отправка без строк отвергнута вслух, повтор
  того же товара строкой — тоже; заказ порталу прошёл цепочку отправка → подтверждение
  срока поставщиком (две разные даты рядом: «вы запросили 24-го», «поставщик подтвердил
  25-е») → накладная pdf от поставщика → «отгружено» → приём 12 из 20 (остаток полки 12,
  движение `RECEIPT` с `supplyLineId`, паспорт товара показал «В наличии» и точку) →
  попытка принять 9 при остатке 8 отвергнута → закрытие недовоза с причиной; отказ без
  причины отвергнут вслух, с причиной — закрыл заказ и показал её покупателю; кладовщик с
  `VIEW` увидел заказы своей точки без единой кнопки («просматривать, но не действовать»),
  заказ на чужую полку по прямой ссылке отдал 404, а в его форме склад вне участка не
  предлагается вовсе; правило автозаказа отвергло «пополнить до», равное порогу, и
  завелось на 20 → 50; прогон создал черновик ровно на 38 (50 − 12 на полке), повторный
  прогон промолчал (`skippedOpenOrder: 1`), а после отказа поставщика — снова завёл;
  снаружи накладная отдала 401 без сеанса и 400 на имя с выходом из каталога, загрузка без
  сеанса — 401; на экране 390 px горизонтальной прокрутки нет.
- **Чего в слайсе нет намеренно:** оплата, счёт и долг (эквайринга нет); автоматическая
  отправка заказа; приглашение поставщика ссылкой; партии, серийные номера и срок
  годности; конструктор правил «если — то» (ТЗ 6.7 — ждёт продаж); открытый API и EDI
  (нужна вторая сторона, умеющая их читать); задача кладовщику на пополнение вместо
  черновика (черновик адресован тому, кто вправе заказать, а задача — тому, кто носит
  коробки).
