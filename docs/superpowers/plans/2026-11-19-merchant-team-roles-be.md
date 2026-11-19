# План: команда мерчанта — роли, точки, журнал (слайс BE)

Спека: `docs/superpowers/specs/2026-11-19-merchant-team-roles-design.md`.

## Шаг 1 — чистые правила и схема

- `src/lib/company-team/permissions.ts`: `TEAM_SECTIONS`, `TeamLevel`, `permissionsFor`,
  `can(perms, section, level)`, `parsePermissions` (запрет по умолчанию),
  `ROLE_TEMPLATES`, `pointScopeAllows`, `movementScopeAllows`.
- Тесты: `tests/company-team-permissions.test.ts` — владелец всё; наследие EDITOR/VIEWER;
  своя роль; неизвестный ключ и мусорный уровень → NONE; полнота шаблонов (у каждого
  шаблона значение по каждому разделу); сужение по точкам (склад без точки, оба конца
  движения).
- Prisma: `CompanyTeamRole`, `CompanyMemberPoint`, `CompanyActionLog`,
  `CompanyMember.roleId?`; миграция `20261119xxxxxx_merchant_team_roles` руками +
  `migrate deploy`.

## Шаг 2 — калитка и журнал

- `editorCompany` отдаёт права (`permissions`), `canWrite(gate, section)` c обязательным
  разделом; старая подпись удаляется.
- `src/lib/company-team/journal.ts`: `logCompanyAction` (ловит сбой), `readJournal`.
- Проставить раздел во всех вызовах: `products.ts`, `warehouses.ts`, `offers.ts`,
  `loyalty.ts`, `company.ts` (профиль и точки), `point-claim.ts`.
- Записать журнал во всех этих действиях + `company-members.ts`, `company-invites.ts`.

## Шаг 3 — действия команды

- `src/app/actions/company-team.ts`: `saveTeamRole`, `deleteTeamRole`,
  `setMemberRole` (своя роль / наследие), `setMemberPoints`. Только владелец; себя не
  понижать; последнего владельца не трогать.

## Шаг 4 — экраны и переводы

- `/{locale}/cabinet/companies/[id]/team`, `/{locale}/cabinet/companies/[id]/journal`.
- Полоса разделов: показывать по праву; секция «Команда» на `[id]/page.tsx` → ссылка.
- `messages/en.json`: `cabinetTeam.*`, `cabinetJournal.*`; затем `npm run i18n`.

## Шаг 5 — проверка

- `npm test`, `npm run build`, `pm2 restart trientes-web` (воркер не трогает новые
  модули — проверить импортом).
- Живой прогон: временная запись + предприятие + точки + склады; кладовщик не правит
  цену, маркетолог не правит остаток, точка сужает склады, журнал пишет строки; всё
  убрать за собой.
- Коммит, `docs:` в CLAUDE.md, push.
