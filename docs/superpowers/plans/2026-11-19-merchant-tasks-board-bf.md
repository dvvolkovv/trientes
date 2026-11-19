# План слайса BF — задачи команды мерчанта

Спека: `docs/superpowers/specs/2026-11-19-merchant-tasks-board-design.md`.

1. **Правила без Prisma** — `src/lib/company-tasks/rules.ts`: статусы, приоритеты,
   потолки, `validateTask`, `canTransition` (таблица § 2.2), `taskRights` (три ступени
   доступа § 2.1), `isOverdue`, `dueFromDate` (конец дня UTC), `boardColumns`.
   Тесты — `tests/company-tasks-rules.test.ts`, пишутся первыми.
2. **Схема и миграция** — две модели и два enum, миграция `20261119180000_merchant_tasks`
   руками + `migrate deploy` (чекаут — прод, `migrate dev` умеет предлагать сброс базы).
3. **Чтение** — `src/lib/company-tasks/read.ts`: доска с фильтрами и участком, одна
   задача с обсуждением, отчёты по исполнителям и точкам одним `groupBy`.
4. **Действия** — `src/app/actions/company-tasks.ts`: создать, переназначить, поправить
   срок/приоритет, переход статуса, отменить, написать реплику. Калитка — `editorCompany`
   + `taskRights`; журнал BE (`TASK_*`); уведомления `notifyUser` на языке получателя.
5. **Экраны** — `tasks/page.tsx` (доска + фильтры + форма + отчёты),
   `tasks/[taskId]/page.tsx` (задача + переходы + обсуждение), ссылка в полосе разделов
   на `companies/[id]/page.tsx`.
6. **i18n** — namespace `cabinetTasks` и `notify.task*` в `messages/en.json`,
   затем `npm run i18n`.
7. **Живой прогон** — временные владелец, сотрудник, предприятие, точка, товар, склад:
   назначение вне участка, взятие, сдача, попытка самому принять, приём постановщиком,
   отмена без причины, реплика с уведомлением, отчёты, фильтры; всё убрать за собой.
8. **Выкладка** — `npm run build`, `pm2 restart trientes-web` (воркер не трогается: ни
   один новый модуль им не импортируется), `pm2 save`, коммит, пуш, запись в CLAUDE.md.
