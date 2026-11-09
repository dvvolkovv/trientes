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
- **i18n:** `common.business`, `admin.tabs.business`, `admin.business.{title,subtitle,empty}`, and the full `business.*` namespace across all 10 locales (en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN).

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
- **i18n:** `common.cabinet`, full `cabinet.*` and `register.*` namespaces across all 10 locales.
- **Worker:** not touched — none of the new files under `src/lib` (`username`, `password`, `rate-limit`, `session`, `client-ip`, `ensure-username`) are imported by `trientes-worker`. Web-only restart sufficed.

# Phase 10 — остальные слайсы (кратко)

Всё ниже уже в проде; подробности — в спеках и планах под `docs/superpowers/`.

- **Unified cabinet + exchange foundation** (слайс 2) — plan `2026-05-25-unified-cabinet-and-exchange-foundation.md`.
- **Карточка биржи + синк CoinPaprika** (слайс 3) — `/{locale}/exchanges/[slug]`, plan `2026-05-26-exchange-card-and-cp-sync.md`.
- **Алерты по цене и гео** (слайсы 5/6) — `worker/index.ts` гоняет `runAlerts()` каждую минуту (`cron.schedule("* * * * *")`), логика в `src/lib/alerts-eval.ts`; каналы Telegram → email → web-push (`src/lib/notify.ts`).
- **Фин-тех каталог** (слайс 7) — `/{locale}/fintech`, spec+plan `2026-05-30-fintech-directory*`; HQ-пины домешиваются в POI-фид навигатора.
- **Нативные Substrate-монеты** (слайс S, 2026-11-07) — spec+plan `2026-11-07-coin-card-substrate*`. У монеты, которая является нативной единицей своей сети (Taler), контракта нет, поэтому слайсы B и E её не видели. Привязка — поле `CoinCard.nativeChain` (ключ из реестра `src/lib/substrate-chains.ts`: taler, polkadot, kusama; узел переопределяется через `SUBSTRATE_RPC_<KEY>`). Читаем по обычному HTTP JSON-RPC: `Balances.TotalIssuance` → проверенный выпуск, `System.Account` → балансы адресов исключений (SS58 с проверкой префикса), `system_properties` → тикер и знаки, `Timestamp.Now` на двух блоках → измеренное время блока, разница лучшей и финализированной голов → финальность. Ключи хранилища выводятся в коде (`src/lib/substrate-codec.ts`, свой xxhash64/twox128 + blake2_128concat), а не вставлены хексом. Прогоны в воркере: факты сети `35 * * * *`, выпуск `45 * * * *` (`CoinCardSupply.method = "SUBSTRATE_V1"`, `address` = хэш генезиса). Заявление проекта в `payments` не затирается: рендер предпочитает факт и показывает заявление рядом при расхождении >10%. Комиссия перевода читается слайсом T (ниже).
- **Проверенная комиссия перевода** (слайс T, 2026-11-07) — spec+plan `2026-11-07-coin-card-transfer-fee*`. Комиссию считает сам узел: собираем экстринсик `Balances.transfer_keep_alive` одной монеты с подписью-пустышкой и спрашиваем `payment_queryInfo`. Неподписанный экстринсик бесплатен (узел отвечает `partialFee: "0"`), поэтому подпись обязательна, хотя и фиктивная; набор подписанных расширений у сетей разный (`CheckMetadataHash` есть у Polkadot и Kusama, нет у Taler), поэтому вариант подбирается попыткой. Индекс палеты балансов (taler 6, polkadot 5, kusama 4) пришпилен в `src/lib/substrate-chains.ts` и охраняется `transactionVersion`: разошлась — комиссия становится `runtime_changed`, а не показывается устаревшей. Факт живёт в `CoinCardChainFacts.transferFee*`, читается тем же прогоном `35 * * * *`. USD **не хранится** (цена меняется каждые 10 минут) — считается в рендере из `CoinCardPriceIndex`; у монеты без рынков видна только комиссия в монетах. Расхождение с заявленным `payments.feeUsdTypical` — код `FEE_USD` в `mismatches`, значимым считается разница больше и 10 %, и цента. Живые числа 7 ноября: Taler 0,00000263 TAL, Polkadot 0,0159 DOT, Kusama 0,000533 KSM. Декодера метаданных рантайма в проекте по-прежнему нет, экстринсики никуда не отправляются.
- **Карточки, проверенные в сети, на 19 монетах** (слайс V, 2026-11-09) — spec+plan `2026-11-09-coin-card-verified-rollout*`. Карточки заводим мы, а не проект: таблица посева — код (`src/lib/coin-card-seed.ts`), скрипт `scripts/seed-chain-cards.ts` (без флага — посев в PENDING идемпотентно, `--fill` — прочитать сеть, `--dump` — таблица для сверки глазами, `--publish` — открыть только те, где факты сошлись; фильтр `--family=SUBSTRATE|COSMOS`). Куратора и компании у такой карточки нет — плашка `SEEDED` говорит это прямо и ведёт на claim. Девять сетей Substrate (bittensor, astar, hydradx, peaq, creditcoin, enjin, polymesh, moonbeam, moonriver) читаются кодом слайсов S и T; выпуск Polkadot и Kusama берётся с Asset Hub (`SUBSTRATE_ISSUANCE_RPC_<KEY>`). Вторая семья — **Cosmos SDK** (`src/lib/cosmos-chains.ts` + `src/lib/cosmos-rest.ts`, обычный REST, переопределение `COSMOS_REST_<KEY>`): celestia, injective, dydx, kava, atomone, provenance, initia, saga, secret. Идентичность сети у Cosmos — **chain-id**, а не хэш генезиса (`CoinCardChainFacts.family/chainId/minGasPrice`, миграция `20261109060000_chain_facts_cosmos`, `genesisHash` стал nullable); финальность достигается в том же блоке; комиссию перевода этой семье никто не считает — узел сообщает только минимальную цену газа, она показывается с базовым деномом. Тикер и знаки Cosmos берутся из реестра денома узла, и у injective, kava, secret его нет — тогда поля просто не проверены (подставлять своё значение нельзя). Выпуск Cosmos — `method = "COSMOS_V1"`, `address = chainId`; охранник доли (`supply_share`) не даёт выдать выпуск одной сети за весь выпуск монеты, такая карточка показывает строку «выпуск в этой сети». Монета без рыночного снимка (Secret, AtomOne, Saga) отдаёт страницу «только карточка» — раньше это был 404. Отставание финализации больше `FINALITY_LAG_MAX = 600` блоков в секунды не превращается: живой прогон поймал у публичного узла Astar отставание 9810 блоков, то есть застрявшую финализацию, а не скорость сети.
- **Главная:** бегущая строка под шапкой + зверь настроения рынка (бык/медведь, обводка по фото). **`/{locale}/compare`** — сравнение монет, ссылка есть в бургер- и десктоп-меню и в `sitemap.xml`.

**Известные дыры (нужно решение владельца, не код):**
- **Рынки держатся на неофициальном фиде CNBC** (`quote.cnbc.com`, без ключа) — см. обновление от 2026-11-06 в `docs/superpowers/specs/2026-05-23-markets-stooq-design.md`. Stooq и Yahoo блокируют IP сервера, CME банит за автоматический доступ (их ToS). Нормальное решение — бесплатный ключ **Twelve Data** (800 запросов/сутки, внутридневные OHLC) или **FRED** (официально, но только дневное закрытие). Нужен ключ от владельца.

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

# Почта

- Своего почтового сервера нет: домен `trientes.org` заведён на Mailcow Селянской — `mail.selyanska.eu` (`165.245.254.8`, отдельный дроплет DO). MX, SPF, DKIM (`dkim._domainkey`) и DMARC — в DO-зоне `trientes.org`.
- Ящики: `listing@` (заявки на листинг) и `noreply@` (отправитель сайта); алиасы `postmaster@`, `abuse@`, `dmarc@` → `listing@`.
- Сайт шлёт через `src/lib/email.ts` (nodemailer, SMTP 587 + STARTTLS, логин `noreply@trientes.org`). Ключи — `SMTP_*` в `.env`; без `SMTP_USER`/`SMTP_PASS` письма молча пропускаются (`email_not_configured`).
- Новая заявка на `/request` → письмо на `LISTING_REQUESTS_TO` (по умолчанию `listing@trientes.org`) со ссылкой на `/en/admin/requests`. Сбой письма заявку не роняет: только `console.error` с `requestId`.
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
