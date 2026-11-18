# План слайса AT — KYB заводит дело, повторная подача открывает дело, спам закрывается пачкой

Спека: `docs/superpowers/specs/2026-11-18-compliance-gaps-design.md`.

## 1. Схема и миграция

- `ComplianceCase.reopenedAt DateTime?`
- `CaseEventKind` += `REOPENED`, `CLOSED_AS_SPAM`
- `AdminAuditAction` += `CLOSE_CASES_AS_SPAM`
- Миграция `20261118170000_case_reopen_and_spam` — руками, применить
  `prisma migrate deploy` (чекаут — прод).

## 2. Повторное открытие дела

- `src/lib/cases/reopen.ts` — чистая `reopenPatch(now, subjectType)`: статус,
  `dueAt`/`slaSeconds` от `now`, `reopenedAt`, обнуление решения, подписей,
  `clockStoppedAt`, `assigneeId`.
- `ensureCaseCore`: найдено дело → открыто (`isOpen`) значит вернуть как есть;
  закрыто — применить патч, удалить `CaseCheck` дела, снять `RESUBMIT` с
  документов, записать `REOPENED`.
- Тесты в `tests/case-reopen.test.ts` + дополнить `tests/case-ensure.test.ts`.

## 3. KYB

- `submitKyb`: читать `displayName`/`ownerUserId`, после записи звать `ensureCase`.
- `withdrawKyb`: открытое дело KYB → `CLOSED`, событие `STATUS_CHANGED { why }`.
- `scripts/backfill-cases.ts`: `kybStatus = PENDING` → тип `KYB`.

## 4. Точка на повторной модерации

- `updateCompanyPoint`: при `needsModeration` звать `ensureCase` (POINT).

## 5. Спам пачкой

- `src/lib/cases/spam.ts` — чистое: `SPAM_CLOSABLE` (типы), `spamBlockers`
  (пустой выбор, >50, короткая причина, запрещённый тип).
- Флаг `silent?: boolean` у экшенов отказа шести типов + проброс через
  `applyDecision`.
- `src/app/actions/case-spam.ts` — `closeCasesAsSpam`: право `APPROVE` в очереди,
  по делу: `applyDecision(..., silent)` → `CLOSED` без решения + `CLOSED_AS_SPAM`;
  `isAlreadySettled` закрывает дело и без объекта; одна строка аудита на пачку.
- UI: `src/components/admin/queue-spam.tsx` (клиентский: галочки, причина,
  кнопка 48 px по `ADMIN_COLUMN`/`ADMIN_BUTTON`), врезка в страницу очереди
  только для разрешённых типов и уровня `APPROVE`.
- Карта прав: `closeCasesAsSpam` → `APPROVE` во всех очередях (тест полноты).
- Тесты: `tests/case-spam.test.ts`, обновить `tests/authz-map.test.ts`.

## 6. Строки и выкладка

- `messages/en.json`: `admin.queues.spam.*`, `admin.case.journal.reopened`,
  `admin.case.journal.closedAsSpam`; затем `npm run i18n`.
- `npm test`, `npx tsc --noEmit`, `npm run build`,
  `env -u max_memory_restart pm2 restart trientes-web` (воркер — `src/lib` задет,
  значит тоже), `pm2 save`.
- Живой прогон по спеке, затем чистка 31 дела бирж.
- Коммит и `git push origin main`; слайс в `CLAUDE.md`.
