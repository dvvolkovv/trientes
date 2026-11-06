# Удаление компаний и точек — план (Слайс G2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Компанию и точку приёма можно удалить: владелец и админ сайта — сразу, сотрудник — только через подтверждение владельцев. Удаление мягкое, и удалённое исчезает из всех без исключения выборок.

**Architecture:** `deletedAt` на `Company` и `CompanyPoint`; узкая мультиподпись в `CompanyDeletionRequest` + `CompanyDeletionApproval`. Вся логика решений — чистые функции в `src/lib/company-deletion.ts`, арифметика голосов переезжает из `coin-card-multisig.ts` в общий `src/lib/multisig.ts` (реюз, не копия). Фильтр «не удалено» — единственный источник истины `src/lib/soft-delete.ts`, подмешиваемый во все читающие выборки.

**Tech Stack:** Next.js 16.2.6, Prisma 5.22 + PostgreSQL, next-intl (10 локалей), Vitest.

**Спека:** `docs/superpowers/specs/2026-11-06-company-deletion-design.md`
**Предыдущий слайс:** `docs/superpowers/plans/2026-11-06-multi-company-and-merchant-choice.md`

**Замечание о детализации:** план перечисляет все задачи, файлы и решения, а код приводит для недетерминированной части (чистые функции, модель, фрагменты фильтра). Механические правки выборок перечислены пофайлово списком — их форма одинакова и показана один раз.

---

## Задача 1: Общая арифметика мультиподписи (реюз, не копия)

- [ ] **Шаг 1:** Создать `src/lib/multisig.ts`, перенеся из `coin-card-multisig.ts` без изменения поведения: `TallyOutcome`, `tally`, `thresholdReachable`.
- [ ] **Шаг 2:** В `coin-card-multisig.ts` оставить реэкспорт (`export { tally, thresholdReachable, type TallyOutcome } from "@/lib/multisig";`), чтобы ни один существующий вызов не поменялся — так же, как `invite-tokens.ts` вынесли из `company-invites.ts`.
- [ ] **Шаг 3:** `npx vitest run tests/coin-card-multisig.test.ts` → PASS без правок теста.
- [ ] **Шаг 4:** Коммит.

## Задача 2: Миграция и схема

- [ ] **Шаг 1:** В `prisma/schema.prisma`: `deletedAt DateTime?` + `deletedById String?` + `@@index([deletedAt])` в `Company` и в `CompanyPoint`; три enum'а; две модели (поля — по спеке); `AdminAction` += `DELETE_COMPANY`, `DELETE_POINT`; обратные связи `Company.deletionRequests`.
- [ ] **Шаг 2:** `./node_modules/.bin/prisma validate` → valid.
- [ ] **Шаг 3:** Написать `prisma/migrations/20261106220000_company_deletion/migration.sql` руками (автодиффу нельзя — протащит дрейф): `ALTER TYPE ... ADD VALUE` по одному значению, `CREATE TYPE`, `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, `ADD CONSTRAINT`.
- [ ] **Шаг 4:** `prisma migrate deploy && prisma generate && prisma migrate status` → `up to date`.
- [ ] **Шаг 5:** Коммит.

## Задача 3: Решения об удалении (чистые функции, TDD)

**Files:** Create `src/lib/company-deletion.ts`, Test `tests/company-deletion.test.ts`

- [ ] **Шаг 1:** Тест на `routeDeletion`, `deletionThreshold`, `canVoteOnDeletion`, `deletionExpiry`, `validateDeletionReason`:

```ts
expect(routeDeletion({ role: "OWNER", isSiteAdmin: false, ownerCount: 2 })).toBe("apply");
expect(routeDeletion({ role: "EDITOR", isSiteAdmin: false, ownerCount: 2 })).toBe("request");
expect(routeDeletion({ role: "VIEWER", isSiteAdmin: false, ownerCount: 2 })).toBe("forbidden");
expect(routeDeletion({ role: null,     isSiteAdmin: true,  ownerCount: 2 })).toBe("apply");
expect(routeDeletion({ role: null,     isSiteAdmin: false, ownerCount: 2 })).toBe("forbidden");
expect(deletionThreshold({ ownerCount: 1, requesterIsOwner: false })).toBe(1);
expect(deletionThreshold({ ownerCount: 3, requesterIsOwner: true })).toBe(2);
expect(deletionThreshold({ ownerCount: 1, requesterIsOwner: true })).toBe(1); // не ноль
```

- [ ] **Шаг 2:** Прогнать → FAIL. **Шаг 3:** Написать модуль (`DELETION_TTL_DAYS = 14`, `MAX_DELETION_REASON = 500`). **Шаг 4:** Прогнать → PASS. **Шаг 5:** Коммит.

## Задача 4: Фильтр «не удалено» во всех выборках

**Files:** Create `src/lib/soft-delete.ts`; Test `tests/soft-delete.test.ts`

- [ ] **Шаг 1:** `src/lib/soft-delete.ts`:

```ts
// Единственный источник истины «что считается живым». Фрагменты, а не хелперы
// поверх Prisma: подмешивание в where остаётся явным на каждом месте вызова.
export const NOT_DELETED = { deletedAt: null } as const;
/** Точка видна, только если и она, и её компания живы. */
export const LIVE_POINT = { deletedAt: null, company: { deletedAt: null } } as const;
```

- [ ] **Шаг 2:** Тест: фрагменты имеют ровно эту форму (защита от опечатки в ключе).
- [ ] **Шаг 3:** Подмешать в каждую выборку. Форма правки одна и та же — добавить `...NOT_DELETED` (для компаний) или `...LIVE_POINT` (для точек) в `where`. Места:
  - `src/lib/business.ts` — `listViewerCompanies`, `getViewerCompanyById`
  - `src/lib/company-points.ts` — `searchApprovedPointsByName`, `fetchApprovedPointsInBbox`
  - `src/lib/coin-card-acceptance.ts` — `getAcceptanceSummary`
  - `src/lib/coin-card-merchant-viewer.ts` — выборка членств и `groupBy` точек
  - `src/app/[locale]/companies/page.tsx`, `.../companies/[id]/page.tsx`, `.../companies/[id]/opengraph-image.tsx`
  - `src/app/[locale]/services/page.tsx`
  - `src/app/[locale]/admin/business/page.tsx` (и компании, и точки)
  - `src/app/[locale]/cabinet/companies/[id]/page.tsx` (список точек)
  - `src/app/api/search/route.ts`, `src/app/sitemap.ts`
  - `src/app/actions/company.ts` (все три действия), `company-members.ts`, `kyb.ts`, `admin-company.ts`, `admin-points.ts`
- [ ] **Шаг 4:** `grep -rn "prisma.company\.\|prisma.companyPoint\." src/` и глазами сверить, что не осталось выборки без фильтра.
- [ ] **Шаг 5:** `npx tsc --noEmit` чисто; коммит.

## Задача 5: Серверные действия удаления

**Files:** Create `src/app/actions/company-deletion.ts`; Modify `src/app/actions/admin-company.ts`, `admin-points.ts`

- [ ] **Шаг 1:** `requestOrDeleteCompany({ companyId, reason? })` и `requestOrDeletePoint({ pointId, reason? })`: роль через `getViewerCompanyById`/членство → `routeDeletion` → либо мягкое удаление в транзакции с записью в `AdminAuditLog`, либо создание `CompanyDeletionRequest` (один `PENDING` на объект → иначе `request_exists`).
- [ ] **Шаг 2:** `voteOnDeletion({ requestId, vote })` — только `OWNER`, один голос (`@@unique`), после голоса `tally`: `PASSED` → применить удаление и `APPLIED`; `FAILED` → `REJECTED`.
- [ ] **Шаг 3:** `withdrawDeletion({ requestId })` — только заявитель, только `PENDING` → `WITHDRAWN`.
- [ ] **Шаг 4:** Защита `last_owner_company`: единственный владелец не удаляет компанию, в которой остались другие члены.
- [ ] **Шаг 5:** Админские `adminDeleteCompany`/`adminDeletePoint` с обязательной причиной ≥3 символов и `DELETE_COMPANY`/`DELETE_POINT` в журнале.
- [ ] **Шаг 6:** Уведомления владельцам через `notifyUser` (как в командных аккаунтах).
- [ ] **Шаг 7:** Коммит.

## Задача 6: Интерфейс

- [ ] **Шаг 1:** `src/components/business/delete-point-button.tsx` — кнопка у каждой точки в `PointsList`; подпись зависит от роли («Удалить» / «Запросить удаление»).
- [ ] **Шаг 2:** `src/components/business/delete-company-block.tsx` — в конце карточки компании, с подтверждением вводом отображаемого названия.
- [ ] **Шаг 3:** `src/components/business/deletion-requests-section.tsx` — список `PENDING`-запросов с кнопками подтвердить/отклонить/отозвать.
- [ ] **Шаг 4:** Админка: кнопки удаления с причиной в `/admin/business`.
- [ ] **Шаг 5:** Коммит.

## Задача 7: Истечение запросов в воркере

- [ ] **Шаг 1:** `src/lib/company-deletion-expiry.ts` с `expireStaleDeletionRequests(prismaLike, now)` по образцу `coin-card-expiry.ts`; тест на `PrismaLike`.
- [ ] **Шаг 2:** Вызов рядом с `expireStaleRevisions` в `worker/index.ts`.
- [ ] **Шаг 3:** Коммит. **Воркер перезапустить обязательно** — он импортирует `src/lib`.

## Задача 8: Переводы

- [ ] **Шаг 1:** Ключи `business.delete.*` (кнопки, подтверждение, запросы, статусы, ошибки) и `admin.business.delete*` в 10 локалях; проверить паритет скриптом из плана G1.
- [ ] **Шаг 2:** Коммит.

## Задача 9: Проверка и выкладка

- [ ] **Шаг 1:** `npm test`, `npx tsc --noEmit`, `npx eslint` по изменённым файлам.
- [ ] **Шаг 2:** `npm run build && pm2 restart trientes-web trientes-worker && pm2 save`.
- [ ] **Шаг 3:** Живая проверка в транзакции с откатом: удалённая точка уходит из POI-фида и из счётчика приёма; удалённая компания уносит свои точки.
- [ ] **Шаг 4:** `git push origin main`.
