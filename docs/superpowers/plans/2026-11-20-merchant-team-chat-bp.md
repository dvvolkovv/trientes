# План: общий чат команды мерчанта (слайс BP)

Спека: `docs/superpowers/specs/2026-11-20-merchant-team-chat-design.md`.

## Шаг 1 — данные

- `prisma/schema.prisma`: `CompanyChatMessage`, `CompanyChatRead`, связи у `Company` и `User`.
- Миграция руками: `prisma/migrations/20261120210000_merchant_team_chat/migration.sql`,
  применить `migrate deploy` (чекаут — прод, `migrate dev` умеет предлагать сброс базы).

## Шаг 2 — чистые правила и тесты (сначала тесты)

`src/lib/company-chat/rules.ts`:

- `chatRightsFor(company)` → `{ read, post }`: читают и пишут все члены, снятое
  надзором или удалённое предприятие — только чтение (§ 2.2, § 2.8).
- `validateMessage(body, { todayCount })` → `body_required` / `body_too_long` / `daily_limit`.
- `parseMentions(body, members)` → идентификаторы членов: разбор без учёта регистра, по
  границам слова, без повторов, без автора, чужой логин — просто текст (§ 2.4).
- `canWithdraw(message, viewer)` → автор или владелец, уже отозванное — нет (§ 2.5).
- `unreadFrom(messages, viewer)` → число чужих неотозванных сообщений после `lastReadAt`.

Тест: `tests/company-chat-rules.test.ts`.

## Шаг 3 — чтение и запись

- `src/lib/company-chat/read.ts`: страница истории (50, курсор «раньше»), список членов
  для подстановки `@логин`, число непрочитанных для плитки (один запрос).
- `src/lib/company-chat/notify.ts`: упоминание — `notifyUser` на языке кабинета
  получателя (`notify.chat.mention.*`), сбой уведомления разговор не роняет.
- `src/app/actions/company-chat.ts`: `postChatMessage`, `withdrawChatMessage`,
  `markChatRead`. Отзыв чужого пишет `CHAT_MESSAGE_DELETED` в журнал предприятия.
- `src/app/api/company-chat/[companyId]/route.ts`: опрос новых после курсора.

## Шаг 4 — экраны

- `src/app/[locale]/cabinet/companies/[id]/chat/page.tsx` — комната.
- `src/components/chat/chat-room.tsx` — список, составитель, опрос (15 с, только пока
  вкладка видна), чипы членов для подстановки упоминания.
- Плитка `chat` в `src/lib/cabinet/company-nav.ts` (группа `order`, `everyone`), значок
  непрочитанного на плитке группы и на самой плитке.

## Шаг 5 — слова

- `messages/en.json`: `cabinetChat.*`, `business.tiles.chat`, `business.tileUnit.chat`,
  `cabinetJournal.actions.CHAT_MESSAGE_DELETED`, `notify.chat.mention.*`.
- `npm run i18n` — все `SUPPORTED_LOCALES`.
- `tests/merchant-labels.test.ts`: новый код журнала в списке.

## Шаг 6 — проверки

- `npm test`, `npx tsc --noEmit`, `npm run build`.
- Живой прогон: временные владелец, редактор и наблюдатель, временное предприятие.
  Проверить: пишут все трое; упоминание уведомляет только названного; непрочитанное
  личное (у одного погашено, у другого нет); отзыв своего и чужого; журнал видит только
  отзыв чужого; предел длины и суточный предел вслух; снятое надзором предприятие не
  пишет; опрос приносит новое; экран 390 px без горизонтальной прокрутки
  (`tests/e2e/cabinet-no-hscroll.spec.ts`). Всё убрать за собой.
- Выкладка: `npm run build` + `env -u max_memory_restart pm2 restart trientes-web`
  (воркер не трогаем — новых модулей он не импортирует), `pm2 save`, запись в CLAUDE.md,
  коммит и `git push origin main`, голосовой отчёт.
