# Перевод пользовательской прозы — план (Слайс H)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проза, которую ввёл проект или компания, показывается на языке интерфейса — с пометкой, что это машинный перевод, и ссылкой на оригинал.

**Architecture:** Общая библиотека `src/lib/localized-prose.ts` переводит набор строк одним запросом и кеширует его в Redis по хешу набора. Чистая часть (сбор набора, ключ кеша, слияние обратно, валидация языка источника) живёт в `src/lib/prose-fields.ts` и покрыта тестами без сети. `translate.ts` получает `translateStrings` и `detectSourceLocale`.

**Tech Stack:** Next.js 16.2.6, Prisma 5.22, Redis (ioredis), OpenAI (gpt-4o-mini), Vitest.

**Спека:** `docs/superpowers/specs/2026-11-06-user-prose-translation-design.md`

---

## Задача 1: Чистая часть — набор прозы, ключ, слияние (TDD)

**Files:** Create `src/lib/prose-fields.ts`, Test `tests/prose-fields.test.ts`

- [ ] **Шаг 1:** Тест на `collectProse`, `proseHash`, `mergeProse`, `normalizeSourceLocale`:
  пустые/`null` поля выброшены; хеш меняется при правке любого поля; слияние
  возвращает непереведённые поля как были; `"ru"` принимается, `"klingon"` → `null`.
- [ ] **Шаг 2:** Прогнать → FAIL. **Шаг 3:** Написать модуль. **Шаг 4:** → PASS. **Шаг 5:** Коммит.

## Задача 2: Перевод набора строк и определение языка

**Files:** Modify `src/lib/translate.ts`

- [ ] **Шаг 1:** Добавить `en: "English"` в `LANG_NAMES` — источник может быть не английским.
- [ ] **Шаг 2:** `translateStrings(obj, locale, timeoutMs)` — один запрос, JSON на входе и
  выходе, ключи сохраняются, лишние/пропавшие ключи игнорируются (берём только
  те, что просили). Возвращает `null` при любом сбое.
- [ ] **Шаг 3:** `detectSourceLocale(text, timeoutMs)` — ответ строго из списка локалей,
  иначе `null`.
- [ ] **Шаг 4:** `npx tsc --noEmit`; коммит.

## Задача 3: Общая библиотека с кешем

**Files:** Create `src/lib/localized-prose.ts`

- [ ] **Шаг 1:** `localizedProse({ns,id,locale,sourceLocale,fields})` по образцу
  `coin-description.ts`: ранние выходы, кеш `i18nprose:{ns}:{id}:{locale}:{hash}`
  на 30 дней, мягкий дедлайн 8 с, тихая деградация до оригинала.
- [ ] **Шаг 2:** `ensureSourceLocale(text, cacheKey)` — определение языка с кешем,
  чтобы не платить за него на каждый рендер.
- [ ] **Шаг 3:** `npx tsc --noEmit`; коммит.

## Задача 4: Поле `sourceLocale` у карточки

**Files:** Modify `prisma/schema.prisma`, Create migration, Modify `src/lib/coin-card-sections.ts`, `coin-card-form-spec.ts`

- [ ] **Шаг 1:** `CoinCard.sourceLocale String?`; миграция
  `20261106230000_coin_card_source_locale` (`ALTER TABLE ... ADD COLUMN`).
- [ ] **Шаг 2:** `prisma migrate deploy && prisma generate && prisma migrate status`.
- [ ] **Шаг 3:** Добавить путь `sourceLocale` в `SECTION_PATHS.IDENTITY`, обработку в
  `normalizeSectionPayload` (через `normalizeSourceLocale`) и поле в `FORM_SPEC.IDENTITY`.
- [ ] **Шаг 4:** `npx vitest run tests/coin-card-sections.test.ts tests/coin-card-form-spec.test.ts` → PASS.
- [ ] **Шаг 5:** Коммит.

## Задача 5: Карточка монеты переводится

**Files:** Modify `src/app/[locale]/coin/[slug]/page.tsx`, `src/components/coin-card/card-sections.tsx`, `card-description.tsx`, `sections/{marketing,tokenomics}-section.tsx`, Create `src/components/coin-card/translated-badge.tsx`

- [ ] **Шаг 1:** На странице собрать набор прозы карточки, вызвать `localizedProse`,
  слить обратно и отдать в компоненты уже переведённую карточку; `?orig=1` отключает.
- [ ] **Шаг 2:** `TranslatedBadge` — маркер «машинный перевод» + ссылка «оригинал».
- [ ] **Шаг 3:** Маркер в заголовках «О проекте», «Проект и дорожная карта», «Токеномика».
- [ ] **Шаг 4:** Если `sourceLocale` пуст — определить и записать (fire-and-forget,
  как `ensureUsername`).
- [ ] **Шаг 5:** Коммит.

## Задача 6: Компания и финтех

**Files:** Modify `src/app/[locale]/companies/[id]/page.tsx`, `src/app/[locale]/fintech/[slug]/page.tsx`

- [ ] **Шаг 1:** `company.description` через `localizedProse` (`ns: "company"`).
- [ ] **Шаг 2:** `fintech.description` и `feesSummary` (`ns: "fintech"`).
- [ ] **Шаг 3:** Маркер перевода на обеих страницах.
- [ ] **Шаг 4:** Коммит.

## Задача 7: Переводы интерфейса и выкладка

- [ ] **Шаг 1:** Ключи `common.machineTranslated`, `common.showOriginal` в 10 локалях.
- [ ] **Шаг 2:** `npm test`, `npx tsc --noEmit`, `npx eslint` по изменённым файлам.
- [ ] **Шаг 3:** `npm run build && pm2 restart trientes-web && pm2 save`.
- [ ] **Шаг 4:** Живая проверка: карточка Taler на de/ja/en переведена, `?orig=1`
  возвращает русский, второй заход берёт кеш.
- [ ] **Шаг 5:** `git push origin main`.
