# Личный кабинет: бизнес-аккаунты и точки компании на карте (Слайс 1)

**Дата:** 2026-05-23
**Раздел:** новый `/{locale}/business` + расширение навигатора и админки

## Контекст и общая картина

trientes сегодня — витрина крипто-данных (только чтение). Цель — превратить его
в платформу с личными кабинетами для **юридических** и **физических** лиц.

Полная задумка делится на независимые подсистемы (проектируем и выкатываем по
очереди):

| # | Подсистема | Статус |
|---|---|---|
| 0 | Фундамент: типы аккаунтов (INDIVIDUAL/COMPANY) + сущность «Компания» | **этот слайс** |
| 1 | Профиль компании + модерация | **этот слайс** |
| 2 | Точки компании на карте (магазины/банкоматы/POS/отделы продаж) | **этот слайс** |
| 3 | Листинг своего цифрового актива (токен → список монет) | позже |
| 4 | Кабинет физлица + предпочтения | позже |
| 5 | Ценовые/рыночные алерты | позже |
| 6 | Гео-алерты по точкам (радиус/маршрут) | позже |
| — | Онлайн-услуги без геопозиции (каталог) | позже |

**Этот слайс = #0 + #1 + #2.** Остальное — отдельные спеки.

## Принципы (согласовано)

- Заявки подают **только юрлица** (аккаунты типа COMPANY).
- **Вариант A:** регистрация компании открытая, профиль создаётся сразу, но
  **публично ничего не видно**, пока админ не одобрит конкретную точку. Контроль
  качества — на этапе публикации (как в `CoinRequest`).
- Каждая точка проходит **ручную модерацию** админом (Approve/Reject + причина),
  всё пишется в `AdminAuditLog`.
- Максимальный реюз: `CoinRequest`/`RequestStatus`/`AdminAuditLog` (модерация),
  pin-drop навигатора (выбор места), карточка POI (рендер), приём merge точек по
  bbox (как у RichAmster).

## Данные (одна миграция, аддитивная)

```
enum AccountType { INDIVIDUAL COMPANY }   // User.accountType, default INDIVIDUAL
enum PointType   { SHOP ATM POS SALES_OFFICE }
// статус точки переиспользует существующий RequestStatus (PENDING/APPROVED/REJECTED)

model Company {
  id           String  @id @default(cuid())
  ownerUserId  String  @unique          // 1:1 с владельцем
  owner        User    @relation(...)
  legalName    String
  displayName  String
  logoUrl      String?
  description  String? @db.Text          // история/о компании
  country      String?
  address      String?
  phone        String?
  email        String?
  website      String?
  socials      Json?                      // [{network,url}]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  points       CompanyPoint[]
}

model CompanyPoint {
  id             String        @id @default(cuid())
  companyId      String
  company        Company       @relation(...)
  type           PointType
  name           String
  description    String?       @db.Text
  lat            Float
  lon            Float
  address        String?
  acceptedCoinIds String[]                 // монеты, которые точка принимает
  logoUrl        String?
  openingHours   String?
  phone          String?
  website        String?
  socials        Json?
  status         RequestStatus @default(PENDING)
  reviewedById   String?
  reviewedAt     DateTime?
  rejectReason   String?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@index([status])
  @@index([companyId])
  @@index([lat, lon])                       // bbox-выборка одобренных точек
}
```
`AdminAction` += `APPROVE_POINT`, `REJECT_POINT`. На `User` — обратные связи
`company Company?`, `reviewedPoints CompanyPoint[]`.

## Потоки

1. **Регистрация компании.** Залогиненный пользователь открывает `/business`,
   жмёт «Зарегистрировать компанию» → форма профиля → создаётся `Company`,
   `User.accountType = COMPANY`. Без предварительной верификации (Вариант A).
2. **Заявка на точку.** В кабинете «Мои точки» → форма: тип, название, описание,
   **место булавкой на карте** (pin-drop навигатора задаёт lat/lon; адрес можно
   подтянуть обратным геокодингом), принимаемые монеты (мультивыбор из списка
   монет), логотип/фото, часы, контакты/соцсети (переопределяют профиль). Статус
   `PENDING`. Лимит: ≤ N (напр. 20) PENDING-точек на компанию (как 10-pending в
   заявках на монеты).
3. **Модерация.** Новая вкладка админки `/admin/business` — очередь PENDING с
   полными данными + карта-превью. Approve → `APPROVED` (публикуется); Reject →
   `REJECTED` + причина. Запись в `AdminAuditLog`. Уведомление админу: очередь в
   админке + опциональный best-effort пинг в Telegram-бот.
4. **Публикация.** Навигаторный POI-API (`/api/crypto-map/poi?bbox=…&coin=&symbol=`)
   дополнительно выбирает `CompanyPoint` со `status=APPROVED` в пределах bbox и
   подмешивает к OSM + curated. Маппинг типа: SHOP/SALES_OFFICE/POS → `merchant`,
   ATM → `atm`. `coinSpecific = acceptedCoinIds.includes(coin)` (подсветка на
   странице соответствующей монеты). Рендер — существующая карточка POI (логотип,
   адрес, часы, телефон, соцсети-клик, «Маршрут сюда», «Окрестности»).

## Компоненты

- `/{locale}/business/page.tsx` — кабинет: профиль + список точек со статусами.
- `business/register` + `business/points/new` (или модалки) — формы; форма точки
  переиспользует карту навигатора с pin-drop.
- Server actions: `registerCompany`, `upsertCompanyProfile`, `submitCompanyPoint`,
  `moderateCompanyPoint` (admin). Валидация/санитизация URL и соцсетей —
  существующими `safeHttpUrl`/`sanitize`.
- `/{locale}/admin/business/page.tsx` + пункт в админ-навигации.
- POI-API + lib: функция выборки одобренных точек по bbox и маппинга в `Poi`.
- i18n: namespace `business` (+ `common.business`) ×10 локалей.

## Безопасность / краёвые случаи

- Публично — только `APPROVED`. PENDING/REJECTED видит лишь владелец и админ.
- Валидация координат (диапазоны), санитизация текста/URL/соцсетей.
- Лимит PENDING-заявок на компанию (антиспам).
- **Подтверждение владения** точкой/брендом — вне этого слайса; пока полагаемся на
  решение админа (может запросить документы оффлайн). Заложить поле под будущее не
  требуется — добавим при #3 при необходимости.
- Только владелец компании редактирует её профиль/точки; только ADMIN модерирует.

## Границы слайса

- **В слайсе:** тип аккаунта, `Company` + регистрация/профиль, `CompanyPoint` +
  подача с картой, модерация в админке, публикация на навигаторе.
- **Не в слайсе:** онлайн-услуги без координат (отдельный каталог), листинг токена
  (#3), кабинет/алерты физлица (#4–6), команды (несколько сотрудников на компанию),
  KYB/верификация компании, email-уведомления (Resend не настроен).

## Тестирование

- Юнит: валидация заявки точки (координаты, обязательные поля, лимит PENDING);
  статус-переходы модерации; bbox-фильтр + маппинг `CompanyPoint`→`Poi`; merge с
  OSM/curated без дублей.
- Сборка + typecheck. Ручная проверка: регистрация компании → заявка с булавкой →
  одобрение в админке → точка видна на навигаторе с карточкой и кликом в соцсети.

## Деплой

Прод — этот checkout. Миграция через `prisma migrate deploy` + `prisma generate`.
`npm run build` → `pm2 restart trientes-web` (POI-API/кабинет — веб; воркер
перезапускаем только если затронут импортируемый им `src/lib`) → `pm2 save` →
`git push origin main`.
