# Плитка карточки точки и память маршрута: Implementation Plan

**Goal:** Карточка точки перестаёт перелистываться сама (страницу выбирает только
человек), снимок на «Месте» и окно карты на «Карте» становятся плиткой в
пропорции банковской карты с раскрытием на весь экран, а в шапке появляется
логотип заведения.

**Спека:** `docs/superpowers/specs/2026-11-15-poi-card-tile-and-route-memory-design.md`

**Tech Stack:** Next.js (App Router — см. `AGENTS.md`), React 19 client
components, MapLibre GL, Tailwind, Prisma, vitest (`npm test`), Playwright
(`npm run test:e2e`), next-intl + `npm run i18n`.

---

## Карта файлов

| Файл | Ответственность | Статус |
|---|---|---|
| `src/lib/poi-tile.ts` | `TILE_CLASS`, `settleTile`, `tilePadding`, `tileOffset` | создать |
| `tests/poi-tile.test.ts` | жест плитки, отступы `fitBounds`, сдвиг центра | создать |
| `src/lib/crypto-map.ts` | `logoUrl` в типе `Poi`, `null` у точек зеркала | править |
| `src/lib/company-points.ts` | логотип точки → логотип компании | править |
| `src/lib/fintech-pois.ts` | логотип организации | править |
| `src/components/coin-detail/poi-photo-overlay.tsx` | снимок на весь экран | создать |
| `src/components/coin-detail/poi-sheet-ui.ts` | `useTileGesture` — общий жест двух плиток | править |
| `src/components/coin-detail/poi-pane-card.tsx` | баннер плиткой, раскрытие снимка | править |
| `src/components/coin-detail/poi-pane-map.tsx` | плитка-окно, управление под ней, ручка сворачивания | править |
| `src/components/coin-detail/poi-sheet.tsx` | логотип в шапке, проводка состояния плитки | править |
| `src/components/coin-detail/crypto-navigator.tsx` | страницу не трогаем; `fitRoute` мерит плитку; центровка точки | править |
| `messages/en.json` + `npm run i18n` | подписи раскрытия и сворачивания | править |
| `tests/e2e/poi-sheet-panes.spec.ts` | маршрут не перелистывает; плитка кредиткой; раскрытие | править |

---

### Task 1: Чистая логика плитки

- [ ] **Step 1:** написать `tests/poi-tile.test.ts`: `TILE_CLASS` — одна строка
      `aspect-[856/540]`; `settleTile` сворачивает раскрытую плитку жестом вниз
      и раскрывает свёрнутую жестом вверх, игнорирует дрожание и горизонтальный
      перевес, слушается скорости на отрыве; `tilePadding` переводит рамку
      плитки в отступы и ужимает их пропорционально, когда они не влезают;
      `tileOffset` даёт сдвиг центра от центра экрана к центру плитки.
- [ ] **Step 2:** прогнать — тест падает (файла нет).
- [ ] **Step 3:** написать `src/lib/poi-tile.ts`.
- [ ] **Step 4:** `npm test -- poi-tile` — зелено.
- [ ] **Step 5:** коммит `feat(navigator): чистая логика плитки карточки точки`.

### Task 2: Логотип в типе точки

- [ ] **Step 1:** тесты: `tests/company-points.test.ts` — у точки компании
      `logoUrl` берётся с точки, иначе с компании, иначе `null`;
      `tests/crypto-map.test.ts` — у точки зеркала BTC Map `logoUrl === null`.
- [ ] **Step 2:** прогнать — падают.
- [ ] **Step 3:** добавить поле в `Poi`, заполнить во всех пяти производителях
      (`parseOverpassElements`, `companyPointToPoi`, `fintech-pois`,
      `curatedToPoi`, `featureToPoi`).
- [ ] **Step 4:** `npm test` + `npx tsc --noEmit` — зелено.
- [ ] **Step 5:** коммит `feat(navigator): у точки есть логотип заведения`.

### Task 3: Подписи раскрытия

- [ ] **Step 1:** в `messages/en.json` ключи `cryptoMap.expandMap`,
      `collapseMap`, `expandPhoto`.
- [ ] **Step 2:** `npm run i18n` — перевод всех локалей.
- [ ] **Step 3:** `npm test -- messages-parity` — зелено.
- [ ] **Step 4:** коммит `i18n(navigator): подписи раскрытия плитки`.

### Task 4: Снимок на весь экран

- [ ] **Step 1:** создать `poi-photo-overlay.tsx`: чёрный фон, картинка целиком,
      крестик, Escape, жест вниз через `settleTile`.
- [ ] **Step 2:** `useTileGesture` в `poi-sheet-ui.ts` — общий разбор жеста.
- [ ] **Step 3:** `npx tsc --noEmit`.
- [ ] **Step 4:** коммит `feat(navigator): снимок места раскрывается на весь экран`.

### Task 5: Баннер в пропорции карты

- [ ] **Step 1:** в `poi-pane-card.tsx` снимок и его заглушка получают
      `TILE_CLASS`, во всю ширину страницы, нажатие раскрывает оверлей.
- [ ] **Step 2:** `npm test -- poi-sheet-buttons` (в карточке нет голых ссылок).
- [ ] **Step 3:** коммит `feat(navigator): баннер места — плитка в пропорции карты`.

### Task 6: Окно карты плиткой

- [ ] **Step 1:** `poi-pane-map.tsx` раскладывается в колонку: плитка (дыра) и
      полоса управления под ней; свёрнутая плитка берёт нажатие и раскрывается,
      раскрытая отдаёт палец карте и сворачивается ручкой сверху.
- [ ] **Step 2:** `poi-sheet.tsx` отдаёт плитке `ref` и состояние, а в шапке
      рисует логотип.
- [ ] **Step 3:** `npx tsc --noEmit`.
- [ ] **Step 4:** коммит `feat(navigator): окно карты — плитка кредиткой, кнопки под ней`.

### Task 7: Навигатор перестаёт листать за человека

- [ ] **Step 1:** убрать `setPoiPage("map")` из `routeTo` и из ответа
      `buildRoute`; кнопка «Открыть карточку» открывает «Место».
- [ ] **Step 2:** `fitRoute` мерит плитку через `tilePadding`.
- [ ] **Step 3:** эффект центровки точки в окне (`tileOffset`) на смену
      страницы и состояния плитки.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm test`.
- [ ] **Step 5:** коммит `fix(navigator): маршрут больше не перелистывает карточку`.

### Task 8: E2E и выкладка

- [ ] **Step 1:** в `tests/e2e/poi-sheet-panes.spec.ts`: ответ маршрутизатора не
      перелистывает страницу; плитка карты в пропорции карты и раскрывается;
      прежний тест «палец достаёт до карты» проверяет раскрытую плитку.
- [ ] **Step 2:** `npm run test:e2e -- poi-sheet-panes` и соседние карты-спеки.
- [ ] **Step 3:** `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- [ ] **Step 4:** `pm2 restart trientes-web` (воркер не трогается — ни один из
      изменённых файлов `src/lib` им не импортируется; проверить grep'ом).
- [ ] **Step 5:** живая проверка страницы монеты снаружи.
- [ ] **Step 6:** `git push origin main`.
