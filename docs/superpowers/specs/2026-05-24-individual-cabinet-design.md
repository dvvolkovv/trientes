# Кабинет физлица: регистрация + профиль + переезд настроек (Слайс 4а)

**Дата:** 2026-05-24
**Раздел:** новая регистрация e-mail/пароль + `/{locale}/cabinet` + редирект `/settings`

## Контекст

Слайс №4 общего плана (см. `2026-05-23-business-cabinet-map-points-design.md`,
строка 20) — кабинет физлица. Делим его на под-слайсы; **этот документ = 4а**:
поднимаем регистрацию по логину/паролю, делаем кабинет с тремя секциями
(Профиль / Настройки / заглушки под Избранные и Алерты), переносим существующую
страницу `/settings` внутрь кабинета. Избранные и алерты — отдельные слайсы 4б+.

## Принципы (согласовано голосом)

- Регистрация по никнейму (латиница+цифры, 3–32 символа, уникальный) + паролю
  (≥8 символов). E-mail необязателен.
- OAuth-провайдеры (Google / GitHub / Telegram) остаются. Для них при первом
  входе автогенерим никнейм из `name`/`username` (с дедупликацией); пользователь
  может его переименовать.
- Новая страница `/{locale}/cabinet` — единственный кабинет физлица. Доступна
  только залогиненным.
- Существующая `/{locale}/settings` редиректит на `/cabinet#settings`. Форма
  языка/валюты/темы переезжает внутрь кабинета.
- Безопасность: bcrypt для пароля, rate-limit логина по IP. Восстановление
  пароля по e-mail — не в этом слайсе (Resend ещё не подключён).
- Только физлица. Аккаунт типа `COMPANY` при заходе на `/cabinet` редиректится
  на `/business` (зеркально к текущему поведению `/business`).

## Данные (одна аддитивная миграция `20260524_individual_cabinet`)

```prisma
model User {
  // существующие поля без изменений; добавляем:
  username     String?  @unique          // 3-32, [a-z0-9_], сгенерён или выбран
  passwordHash String?                   // bcrypt hash; NULL для OAuth-only
  firstName    String?
  lastName     String?
  phone        String?
  // email уже @unique и nullable — оставляем как есть
}

model LoginAttempt {
  id        String   @id @default(cuid())
  ip        String                       // нормализованный IPv4/IPv6
  identifier String                      // username или email, к которому пытались войти
  success   Boolean
  createdAt DateTime @default(now())
  @@index([ip, createdAt])
  @@index([identifier, createdAt])
}
```

`username` остаётся `null` до того, как пользователь зарегистрируется паролем
(тогда обязательное поле формы) или войдёт через OAuth и мы автогенерируем.
Backfill в миграции не нужен — старых password-аккаунтов нет, а у OAuth-юзеров
username проставится при первом заходе на `/cabinet` через `ensureUsername()`.

## Регистрация и логин

### Credentials-провайдер
Добавляем `Credentials` в `src/auth.ts` рядом с Google/GitHub:

```ts
Credentials({
  credentials: { identifier: {}, password: {} },
  async authorize(creds, req) {
    const id = String(creds.identifier ?? "").trim().toLowerCase();
    const pw = String(creds.password ?? "");
    if (!id || !pw) return null;
    const ip = clientIp(req);
    if (await isRateLimited(ip, id)) return null;
    const user = id.includes("@")
      ? await prisma.user.findUnique({ where: { email: id } })
      : await prisma.user.findUnique({ where: { username: id } });
    const ok = !!user?.passwordHash && (await bcrypt.compare(pw, user.passwordHash));
    await prisma.loginAttempt.create({ data: { ip, identifier: id, success: ok } });
    return ok ? { id: user.id, email: user.email, name: user.name } : null;
  },
})
```

**Стратегия сессий.** NextAuth v5 Credentials-провайдер несовместим с
`session.strategy: "database"` (адаптер не выдаёт `sessionToken`). Два пути:
1. **Переключить весь сайт на `strategy: "jwt"`** (рекомендую). JWT хранится в
   cookie, БД-таблица `Session` остаётся, но не используется для credentials.
   OAuth-юзеры тоже работают через JWT — `session` callback идентичен,
   `session.user.id`/`role` берётся из токена (заполняется в `jwt` callback из
   `user` при первом логине, потом из `token`).
   **Цена миграции:** все текущие пользователи разлогиниваются один раз (старые
   database-сессии становятся невалидны). Учитывая, что сайт ещё молодой и
   активных юзеров мало, считаем приемлемой.
2. Альтернатива (если хотим сохранить database): после `authorize` вручную
   создавать `Session` row и ставить cookie через `cookies()`. Это требует
   ручного управления TTL/ротацией, дублирует логику адаптера и ломается при
   обновлениях NextAuth. **Не рекомендую.**

Идём по пути 1: правим `src/auth.ts` (strategy, `jwt` callback), `Credentials`
провайдер становится first-class. Account row с `provider="credentials"`
создаём при регистрации, чтобы видеть метод входа в UI.

### Server actions
- `registerWithPassword(form)` — валидация, проверка свободного username, hash,
  создание `User` (`accountType=INDIVIDUAL`) + `Account{provider:"credentials"}`,
  затем `signIn("credentials", { redirect:false })`.
- `loginWithPassword(form)` — обёртка над `signIn("credentials")` с
  rate-limit-проверкой и нормальной ошибкой формы.
- `changePassword(oldPw, newPw)` — для уже залогиненного, в секции профиля.
- `setUsername(next)` — переименование (раз в N дней — лимит не вводим в этом
  слайсе, только проверка уникальности).
- `updateProfile({ firstName, lastName, phone, email })` — обновление полей,
  e-mail — с пометкой «requires verification»; верификации пока нет, поэтому
  меняем сразу, но **сбрасываем `emailVerified=null`** и логируем смену.

### Rate-limit логина
- Лимит: **10 неудачных попыток** с одного IP за 10 минут → блок на 15 минут
  (вернём `null` из `authorize`). Хранение — таблица `LoginAttempt`, не Redis
  (не хотим разъезда при перезапуске). Очистка — лениво в том же запросе
  (`deleteMany { createdAt < now - 1h }`).
- Идентификатор лимита: пара `(ip, identifier)` И `(ip, *)` — оба считаются;
  превышение любого = блок. Это душит как точечный брут, так и веер.
- Регистрация: лимит **5 регистраций с одного IP за час**.

### UI входа
`/{locale}/login` получает форму e-mail/username + password сверху и существующие
OAuth-кнопки снизу. Поле «Создать аккаунт» — отдельная страница
`/{locale}/register` (или модалка; решим в плане).

## Кабинет `/{locale}/cabinet`

Серверный компонент, гейтит auth-ом (по образцу `/settings`). Если
`accountType=COMPANY` → `redirect("/business")`. Содержит **три секции**, якори
`#profile`, `#settings`, `#alerts`:

### 1. Профиль (`#profile`)
Поля: `username` (с инлайн-редактором), `firstName`, `lastName`, `phone`,
`email`. Аватар = `image` (read-only пока, OAuth подтягивает сам).
Дополнительно: блок «Сменить пароль» (только если `passwordHash != null`;
для чистых OAuth — кнопка «Задать пароль», создаёт `passwordHash` + `Account`
с provider=credentials).

### 2. Настройки (`#settings`)
Переезд `SettingsForm` (язык/валюта/тема) без изменений. Заголовок секции,
тот же server action.

### 3. Избранные и Алерты (`#alerts`)
Две карточки-заглушки:
- «Избранные монеты» → ссылка на существующий `/watchlist`.
- «Алерты» → серый блок «Coming soon (Slice 4б)».
Сейчас просто visual placeholder, без логики.

### Навигация
- Пункт «Cabinet» в шапке для залогиненного физлица (рядом с текущим
  «Business»; для COMPANY показывается «Business», для INDIVIDUAL — «Cabinet»).
- В user-dropdown заменить «Settings» на «Cabinet» (та же иконка/место).

### Редирект `/settings`
`src/app/[locale]/settings/page.tsx` оставляем как тонкий редирект на
`/{locale}/cabinet#settings`. Так не ломаем внешние ссылки и `authConfig.ts`
matcher (но добавим `cabinet` в `needsAuth`-regexp).

## Компоненты и файлы

- `prisma/schema.prisma` — поля + модель `LoginAttempt`.
- `prisma/migrations/20260524180000_individual_cabinet/migration.sql`.
- `src/auth.ts` — `Credentials` провайдер, `clientIp`/`isRateLimited` хелперы.
- `src/auth.config.ts` — добавить `cabinet|register` в `needsAuth`-regex
  (`register` пропускаем, он публичный; `cabinet` гейтим).
- `src/lib/username.ts` — валидация, нормализация, `generateFromName(name)`,
  `ensureUsername(userId)` (вызывается при заходе в кабинет, если у юзера нет
  username — генерим и сохраняем; гонка ловится `P2002` retry до 5 раз с
  суффиксом-числом).
- `src/lib/password.ts` — `hashPassword`, `verifyPassword`, обёртки над bcrypt.
- `src/lib/rate-limit.ts` — `checkLoginRateLimit`, `checkRegisterRateLimit`.
- `src/app/actions/account.ts` — `registerWithPassword`, `setUsername`,
  `updateProfile`, `changePassword`, `setPasswordFirstTime`.
- `src/app/[locale]/register/page.tsx` — форма регистрации.
- `src/app/[locale]/cabinet/page.tsx` — серверная страница.
- `src/components/cabinet/profile-section.tsx`, `cabinet/settings-section.tsx`,
  `cabinet/alerts-section.tsx` — три секции.
- `src/components/login-buttons.tsx` — добавить форму credentials сверху.
- `src/app/[locale]/settings/page.tsx` — редирект на `/cabinet#settings`.
- `src/components/header.tsx` (или где live nav) — пункт «Cabinet» для
  INDIVIDUAL-юзеров.
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — namespace `cabinet.*`
  + `common.cabinet`, `common.register` ×10.

## Безопасность / краёвые случаи

- **Хэш:** bcrypt cost 12. Никогда не возвращаем `passwordHash` наружу
  (исключаем в `select`).
- **Тайминг-атаки:** при неуспехе `authorize` — фиксированная задержка ~100 мс
  + bcrypt сравнение даже если user не найден (сравниваем с заранее
  захэшированным dummy).
- **Перечисление аккаунтов:** на `/register` сообщение «не получилось,
  попробуйте другой никнейм» — без раскрытия, занят username или email.
- **Локализация username:** только `[a-z0-9_]`, нижний регистр; ввод
  пользователя нормализуем `toLowerCase()`. Зарезервированные имена
  (`admin`, `root`, `cabinet`, `business`, `api`, `login`, `register`,
  `settings`) — отказ.
- **CSRF/SSR:** server actions next.js + same-site cookies → ок.
- **Привязка credentials к существующему OAuth-аккаунту:** если email уже
  использовался Google-юзером, при попытке `register` с тем же email — ошибка
  «уже зарегистрирован, войдите через Google». Если уже залогинен и хочет
  установить пароль — действие `setPasswordFirstTime` создаёт `Account`
  credentials, не трогая существующие.
- **COMPANY на `/cabinet`:** редирект в `/business`. И наоборот, INDIVIDUAL на
  `/business` уже редиректится текущим кодом — не трогаем.

## Границы слайса

- **В слайсе:** username+password регистрация/логин, поля профиля, страница
  `/cabinet` с 3 секциями, переезд `SettingsForm`, редирект `/settings`,
  rate-limit, i18n ×10.
- **Не в слайсе:** восстановление пароля по e-mail (Resend), верификация
  e-mail, 2FA, смена аватара, удаление аккаунта, привязка/отвязка соцпровайдеров
  из кабинета, история входов в UI, избранные и алерты (это 4б), команды
  (несколько пользователей под одним аккаунтом).

## Тестирование

- Юнит: валидация username (длина/символы/резерв), генератор `generateFromName`
  + дедуп через `P2002` retry, hash/verify пароля, rate-limit пороги
  (`checkLoginRateLimit` с моком таблицы).
- Интеграция: `registerWithPassword` создаёт User+Account, повторная
  регистрация того же username возвращает ошибку; `loginWithPassword` после
  10 фейлов блокирует следующий запрос; OAuth-юзер заходит → `ensureUsername`
  выставляет уникальный username.
- Сборка + typecheck. Ручная проверка: регистрация → редирект на `/cabinet` →
  смена темы/валюты в секции Settings → проверка `/settings` редиректит на
  `/cabinet#settings`; вход тем же паролем; вход через Google → username
  автогенерён → переименование username работает.

## Деплой

Прод — этот checkout. Шаги:
1. `prisma migrate deploy` + `prisma generate`.
2. `npm run build` → `pm2 restart trientes-web`. Воркер не трогаем
   (`src/lib/username.ts` и `password.ts` им не используются; если в плане это
   изменится — перезапустить `trientes-worker` тоже).
3. `pm2 save`, `git push origin main`.
4. Прогнать ручной флоу: регистрация → /cabinet → смена темы → выход → вход
   паролем → Google-юзер → автоген username.
