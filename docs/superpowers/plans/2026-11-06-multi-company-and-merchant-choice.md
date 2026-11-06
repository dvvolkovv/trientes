# Несколько компаний и выбор компании при заявке приёма — план (Слайс G1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Один аккаунт владеет сколькими угодно компаниями, а кнопка «Я принимаю эту монету» спрашивает, от чьего имени заводить точку, вместо того чтобы брать первую найденную компанию.

**Architecture:** Миграция снимает уникальный индекс `Company_ownerUserId_key` (схема уже без `@unique` — закрывается дрейф). Лимиты и выбор компании считаются чистыми функциями в `src/lib/company-limits.ts` и `src/lib/coin-card-merchant-cta.ts`, запросы — в `coin-card-merchant-viewer.ts` и `src/app/actions/company.ts`. UI меняется в трёх местах: секция приёма карточки, форма создания компании, форма точки.

**Tech Stack:** Next.js 16.2.6, Prisma 5.22 + PostgreSQL, next-intl (10 локалей), Vitest.

**Спека:** `docs/superpowers/specs/2026-11-06-multi-company-and-merchant-choice-design.md`
**Предыдущий слайс:** `docs/superpowers/plans/2026-11-06-coin-card-real-economy-f1.md`

---

## Задача 1: Снять уникальный индекс владельца

- [ ] **Шаг 1:** Убедиться, что индекс есть и схема уже без `@unique`:
  `psql "$DATABASE_URL" -c '\d "Company"' | grep ownerUserId` → должны быть и `_idx`, и `_key`.
- [ ] **Шаг 2:** Создать `prisma/migrations/20261106200000_company_multi_owner/migration.sql`:

```sql
-- Один человек владеет сколькими угодно компаниями. Уникальный индекс по
-- владельцу держал ограничение «одна компания на аккаунт» и больше не нужен:
-- права давно считаются по CompanyMember, а ownerUserId остался для модерации.
-- Обычный индекс Company_ownerUserId_idx сохраняется — по нему идут выборки.
DROP INDEX IF EXISTS "Company_ownerUserId_key";
```

- [ ] **Шаг 3:** `./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/prisma migrate status` → `up to date`, дрейфа нет.
- [ ] **Шаг 4:** Коммит.

## Задача 2: Лимиты компаний (чистая функция + TDD)

- [ ] **Шаг 1:** Тест `tests/company-limits.test.ts` на `checkCompanyLimits({ owned, pending })`:
  9 → ok; 10 → `too_many_companies`; 3 pending → `too_many_pending_companies`;
  pending проверяется раньше общего лимита только если общий не исчерпан.
- [ ] **Шаг 2:** Прогнать → FAIL.
- [ ] **Шаг 3:** `src/lib/company-limits.ts` с `MAX_COMPANIES_PER_USER = 10`,
  `MAX_PENDING_COMPANIES_PER_USER = 3`, чистой `checkCompanyLimits`.
- [ ] **Шаг 4:** Прогнать → PASS.
- [ ] **Шаг 5:** Подключить в `createCompany` (`src/app/actions/company.ts`): считать
  `companyMember.count({ userId, role: "OWNER" })` и то же со `company: { status: "PENDING" }`.
- [ ] **Шаг 6:** Ключи ошибок в 10 локалей (`cabinet.companies.errors.*`).
- [ ] **Шаг 7:** Коммит.

## Задача 3: Кнопка спрашивает, от чьего имени (TDD)

- [ ] **Шаг 1:** Тесты в `tests/coin-card-merchant-cta.test.ts` на новую форму:
  `register_company` при нуле компаний; `choose` с одной строкой; шесть компаний →
  пять в списке + `hasMore`; `ctaHref` для `choose` не вызывается (ссылки строятся
  на компанию) — вместо него `addPointHref(companyId, ctx)` и `newCompanyHref(ctx)`.
- [ ] **Шаг 2:** Прогнать → FAIL.
- [ ] **Шаг 3:** Переписать `src/lib/coin-card-merchant-cta.ts`: типы `MerchantCta`/
  `MerchantCompany`, `MERCHANT_COMPANY_LIMIT = 5`, `pickMerchantCompanies(rows)`,
  `addPointHref`, `newCompanyHref`, `manageHref`; `ctaHref` остаётся для `login`
  и `register_company`.
- [ ] **Шаг 4:** Прогнать → PASS.
- [ ] **Шаг 5:** `src/lib/coin-card-merchant-viewer.ts`: вернуть все компании, где
  пользователь OWNER или EDITOR, с числом точек, принимающих карточку
  (`groupBy` по `companyId` с `acceptedCardIds has cardId`), и суммой.
- [ ] **Шаг 6:** Перерисовать блок кнопок в `acceptance-section.tsx`.
- [ ] **Шаг 7:** Ключи `coinCard.acceptance.{addPointTo,orNewCompany,moreCompanies}` в 10 локалей.
- [ ] **Шаг 8:** Коммит.

## Задача 4: Монета не теряется при регистрации компании

- [ ] **Шаг 1:** `CreateCompanyForm` получает `nextCard?: string` и при успехе
  редиректит на `/{locale}/cabinet/companies/<id>?card=<nextCard>#add-point`.
- [ ] **Шаг 2:** `CompaniesSection` получает `cardParam` и прокидывает его в форму.
- [ ] **Шаг 3:** `/{locale}/cabinet/page.tsx` читает `searchParams.card`.
- [ ] **Шаг 4:** Ссылка «оформить новую компанию» в секции приёма ведёт на
  `/{locale}/cabinet?card=<cardId>#companies`.
- [ ] **Шаг 5:** `npx tsc --noEmit` чисто; коммит.

## Задача 5: Предупреждение о модерации компании

- [ ] **Шаг 1:** `PointForm` получает `companyStatus: "PENDING" | "APPROVED" | "REJECTED"`
  и рисует над кнопкой отправки предупреждение, когда статус не `APPROVED`.
- [ ] **Шаг 2:** `cabinet/companies/[id]/page.tsx` передаёт `company.status`.
- [ ] **Шаг 3:** Ключ `business.pointHiddenUntilCompanyApproved` в 10 локалей.
- [ ] **Шаг 4:** Коммит.

## Задача 6: Проверка и выкладка

- [ ] **Шаг 1:** `npm test` — всё зелёное.
- [ ] **Шаг 2:** `npx tsc --noEmit`, `npx eslint` по изменённым файлам.
- [ ] **Шаг 3:** `npm run build && pm2 restart trientes-web && pm2 save`.
- [ ] **Шаг 4:** Живая проверка: вторая компания создаётся; на карточке Taler виден
  список компаний; ссылка новой компании несёт `?card=`.
- [ ] **Шаг 5:** `git push origin main`.
