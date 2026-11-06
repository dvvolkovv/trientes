# Миграция Trientes с Aeza на DigitalOcean

Дата: 2026-11-06

## Контекст

`trientes.org` работает на Aeza `85.192.25.242`. В рабочий runtime входят Next.js, PM2 web/worker/bot, PostgreSQL, Redis, nginx/TLS, Telegram webhook, статический `/exchange`, uploads/downloads, Android build environment и вспомогательные локальные данные. Почта уже находится на существующем DigitalOcean Mailcow `mail.selyanska.eu` и не переносится на новый web-сервер.

Цель — перенести весь runtime и DNS-хостинг `trientes.org` на DigitalOcean с плановым простоем 10–30 минут, нулевой потерей данных при плановом cutover и безопасной возможностью отката.

## Объём

Входит:

- DNS-хостинг `trientes.org` и последующий перенос NS на DigitalOcean;
- новый Droplet вместо Aeza;
- приложение, база, Redis, PM2, nginx/TLS, cron/backups и runtime-файлы;
- локальные репозитории и пользовательские данные, включая Android build state;
- смена target IP обратного SSH-туннеля с Mac;
- последующая, отдельно согласуемая Mailcow-интеграция из свежего `main`.

Не входит:

- `trientes.com` и его DNS/почта;
- DOKS, validators и RPC-инфраструктура;
- изменения `rpc1/rpc2.trientes.com`;
- перенос самого Mailcow или создание второго почтового сервера;
- Telegram `setWebhook` при сохранении домена;
- изменение Android/iOS URL или выпуск новых приложений;
- MX/SPF/DMARC/DKIM и изменения почтового кода до отдельного этапа C.

## Выбранный подход

Используется **clean rebuild + rehearsal**. Новый сервер устанавливается с нуля, а восстановление PostgreSQL, Redis, nginx, TLS, сборка и тесты проверяются до production-окна. Тяжёлые операции выполняются заранее, поэтому финальное окно содержит только финальные snapshots, restore, проверки и изменение A-записей.

Перенос дискового образа отклонён из-за размера, рисков загрузчика/cloud-init и переноса ненужного состояния. Одноразовый перенос без rehearsal допускается только как аварийный сценарий и не является планом этой миграции.

## Целевая инфраструктура

- Регион: **FRA1**.
- Droplet: **s-4vcpu-8gb**, 4 vCPU, 8 GiB RAM, 160 GB disk.
- OS: **Ubuntu 24.04 LTS** с последующей настройкой совместимых версий Node 22, PostgreSQL 16, Redis 8.x, nginx, PM2 и Certbot.
- Пользователь приложения: `dv`; пути остаются `/home/dv/...`; timezone — `Etc/UTC`.
- Droplet backups: **daily**, $14.40/мес; Droplet $48/мес; итого $62.40/мес без налогов.
- Существующий ежедневный `pg_dump` с retention 14 дней сохраняется независимо от DO backups.
- Managed PostgreSQL, Load Balancer, DOKS и дополнительные volumes не требуются.

Размер сохраняет текущие 4 vCPU/8 GiB и не уменьшает ресурсы до анализа накопленных 4696 restarts web-процесса. 160 GB даёт запас для runtime и 9.5 GB исторических дампов.

## Исходное состояние и данные

На момент инвентаризации:

- `/home/dv/trientes` — clean `main`, синхронизированный с `origin/main`;
- PostgreSQL 16.14, DB около 1.188 GB, основная часть — `CoinSnapshot`;
- Redis 8.0.5, около 3.5 MB, 1181 keys, RDB около 1.5 MB;
- Auth.js sessions хранятся в PostgreSQL; Telegram bot sessions и verbose settings — в Redis;
- baseline test suite: 61 test file / 449 tests passed;
- PM2: `trientes-web`, `trientes-worker`, `trientes-bot`;
- nginx проксирует Next.js на `127.0.0.1:3000`, bot на `127.0.0.1:4100`, а также обслуживает uploads, downloads и `/exchange`;
- `/exchange-api` использует внешний `rpc2.trientes.com` и не переносится;
- Telegram webhook привязан к `https://trientes.org`, поэтому `setWebhook` не требуется;
- UFW разрешает только 22/80/443;
- активный backup — `/home/dv/pg-backup.sh` в cron ежедневно в 03:00 UTC, retention 14 дней;
- исторические дампы занимают около 9.5 GB.

### Обязательный manifest переноса

- production checkout на зафиксированном commit;
- фактический `/home/dv/trientes/.env`, а не `.env.example`;
- `/home/dv/.pgpass`, необходимые SSH private/public keys и `authorized_keys`;
- `/home/dv/.claude` и защищённая аутентификация Claude CLI для продолжения bot sessions;
- живые конфиги:
  - `/etc/nginx/sites-available/trientes`;
  - `/etc/nginx/sites-enabled/trientes`;
  - `/etc/nginx/conf.d/trientes-exchange.conf`;
  - `/etc/nginx/snippets/trientes-exchange.conf`;
- `/etc/letsencrypt` с сохранением прав, symlinks и renewal configuration;
- `/var/www/trientes-uploads`;
- `/var/www/trientes-downloads`, включая symlink latest APK;
- `/var/www/trientes-exchange`;
- `/home/dv/trientes/public/uploads`, включая приватный KYB;
- `/home/dv/trientes/incoming`, bot logs и `/home/dv/trientes-artifacts`;
- `/home/dv/trientes-android` вместе с `.git`, build counter и debug keystore;
- `/home/dv/bin`, `/home/dv/pg-backup.sh`, crontab и backup authentication;
- исторические дампы и свежий обязательный dump;
- нерабочие локальные каталоги/репозитории, которые нужно сохранить как холодный архив, даже если они не требуются runtime.

`node_modules`, `.next`, `.next-preview`, Android SDK, Gradle/npm caches и воспроизводимые build caches не переносятся как обязательные данные: зависимости и SDK устанавливаются заново. Worktree `listing-mailcow` не переносится: уникальных коммитов там нет, а почтовая реализация продолжится позже из свежего `main`.

Для повторяемых rsync-операций создаётся manifest с source/destination, владельцами, правами и symlinks. `--delete` разрешён только после dry-run и только внутри явно перечисленных каталогов.

## Этапы миграции

### Этап 0 — подготовка и rehearsal, без изменения публичного DNS

1. Зафиксировать commit SHA, Git status, версии, PM2 config, `prisma migrate status`, PostgreSQL encoding/locale/extensions, cron, runtime paths и baseline ресурсов.
2. Исследовать restart rate web за последние 24 часа, PM2 settings, OOM, exceptions, port collisions, health/deploy scripts и дубликаты process definitions. Активный crash loop/OOM является блокером.
3. Создать целевой Droplet и настроить пользователя, пакеты, firewall, Node, PostgreSQL 16, Redis 8.x, nginx, Certbot и PM2 systemd.
4. Перенести секреты, конфиги и выполнить основной file pre-sync.
5. Восстановить rehearsal PostgreSQL dump и Redis RDB.
6. Установить dependencies из lockfile, выполнить Prisma generate, build и полный test suite.
7. Запускать только web. Worker и bot не запускаются и не должны появиться в resurrect list.
8. Проверить HTTPS через `curl --resolve`, nginx/TLS, health, static routes и outbound dependencies с нового IP.
9. Устранить расхождения и повторить критические проверки до успешного go/no-go.

### Этап A — перенос DNS-хостинга на DigitalOcean

1. Получить от владельца полный экспорт зоны IONOS. Публичные DNS-запросы и отклонённый AXFR не доказывают полноту зоны.
2. Проверить DNSSEC/DS у регистратора. При наличии активной DNSSEC-конфигурации остановиться до отдельного согласованного плана.
3. Создать зону `trientes.org` в DO и перенести все записи без изменения маршрутизации:
   - `@ A` и `www A` остаются `85.192.25.242`, TTL 300;
   - IONOS MX, SPF и DMARC CNAME остаются без изменений;
   - Mailcow DKIM пока не публикуется;
   - все TXT, CNAME, SRV, CAA, AAAA и поддомены из экспорта сохраняются.
4. Сверить canonicalized export с DO: имя, тип, значение, priority, TTL, TXT chunking и trailing dots.
5. Проверить каждую запись через `ns1`, `ns2`, `ns3.digitalocean.com`, не полагаясь на `ANY`.
6. Владелец меняет NS у регистратора на DO. Текущие IONOS NS сохраняются для rollback, IONOS-зона не удаляется и не меняется.
7. Дождаться публичной DO-делегации. При идентичных зонах этот этап не должен вызывать простоя.

### Этап B — финальный VPS cutover

1. Заморозить deploys и изменения конфигурации.
2. Остановить запись на Aeza и сделать финальные PostgreSQL, Redis и file snapshots.
3. Восстановить их на новом сервере и проверить counts, sequences, timestamps, `prisma migrate status`, Redis keys/TTL и файловые checksums.
4. Запустить только новый web и повторить HTTPS/health smoke tests.
5. Изменить в DO только `@ A` и `www A` на новый IP. При появлении production AAAA его судьба учитывается одновременно.
6. Запустить новые bot и worker после подтверждения остановки старых; выполнить окончательный `pm2 save`.
7. Обновить target IP Mac reverse SSH tunnel после проверки нового SSH.
8. Выполнить внешние проверки. MX/SPF/DMARC/DKIM и почтовые env не меняются.

### Этап C — Mailcow integration после стабилизации

Начинается отдельно после успешной стабилизации этапа B и нового approval. Используется свежий `main`, а не старый worktree. MX/SPF/DMARC/DKIM и приложение переводятся отдельными проверяемыми изменениями с учётом MX TTL 3600. До этапа C почтовый runtime остаётся в прежнем состоянии.

## Перенос PostgreSQL

Для rehearsal и финала:

1. Проверить PostgreSQL major 16, encoding, locale, extensions и application role.
2. Снять консистентный custom-format `pg_dump` и SHA-256.
3. Восстанавливать через `pg_restore --exit-on-error` в новую пустую БД, а не поверх rehearsal или production данных.
4. Не использовать `--clean` против действующей production БД.
5. Сравнить counts по критическим таблицам и `CoinSnapshot`, max timestamp/id, users/accounts/sessions/tokens, sequences, extensions и migration metadata.
6. `prisma migrate status` должен совпадать со старым состоянием. Не запускать новые migrations автоматически для устранения расхождения во время переноса сервера.

Число migration files само по себе acceptance-критерием не является.

## Перенос Redis

Redis не считается полностью disposable из-за Telegram sessions.

1. На rehearsal проверить загрузку скопированного RDB целевым Redis.
2. В финальном окне после остановки приложений выполнить `SAVE` или дождаться успешного `BGSAVE`.
3. Определить фактические `dir` и `dbfilename`, остановить старый Redis и скопировать неизменный RDB с checksum.
4. На новом сервере установить RDB при остановленном Redis, выставить владельца и запустить сервис.
5. Проверить `PING`, `DBSIZE`, отсутствие load errors, Telegram session keys и их TTL.

Auth.js sessions восстанавливаются с PostgreSQL и не зависят от Redis.

## Финальное окно 10–30 минут

Все тяжёлые операции завершаются до T0.

- **T0–T+3:** запретить web writes; остановить old web и bot; worker завершает in-flight jobs и останавливается. Если graceful stop невозможен, окно продлевается или отменяется до snapshot.
- **T+3–T+8:** параллельно выполнить финальный `pg_dump`, Redis SAVE/RDB copy и rsync delta.
- **T+8–T+18:** передать и восстановить dump в пустую БД, восстановить Redis, проверить counts и migrate status.
- **T+18–T+23:** запустить только new web, проверить `nginx -t`, HTTPS `curl --resolve`, health и read-only smoke.
- **T+23–T+30:** изменить A-записи, запустить new bot/worker, выполнить внешние smoke checks и финальный `pm2 save`.

Это ориентир, а не основание торопить restore. До смены A действует abort checkpoint: при превышении буфера или ошибке новые worker/bot не запускаются, A не меняется, старый стек возвращается в работу.

После cutover старый runtime не принимает writes, даже от клиентов с закэшированным старым IP. Старый nginx может возвращать контролируемый 503/maintenance.

## TLS, nginx и PM2

До смены DNS используется защищённая копия действующего ECDSA certificate/private key, что позволяет проверить SNI, Host и chain без `curl -k`. Проверяются SAN, expiry, HTTP→HTTPS, HSTS, Next.js route, bot route, uploads/downloads/exchange и внешний `/exchange-api`.

Из-за годового HSTS `includeSubDomains` недопустим временный запуск с невалидным TLS. Публичный directory listing и доступ к `.env`, `.git`, backups, KYB или `.claude` запрещены.

Старый PM2 dump/resurrect state не переносится. На новом сервере процессы создаются из `ecosystem.config.js`. До cutover активен только web; `pm2 save` не должен сохранять worker/bot для неожиданного автозапуска. После cutover сохраняется окончательный process list.

Worker никогда не работает одновременно на Aeza и DO.

## Безопасность

- Секреты передаются только по SSH, предпочтительно напрямую Aeza → DO без открытых промежуточных архивов.
- `.env`, `.pgpass`, private keys, Telegram/OAuth secrets и содержимое `.claude` не выводятся в shell history, логи, memory или чат.
- `.pgpass` и private keys — `0600`; защищённые каталоги — `0700`; backup dumps — `0600`; TLS private key остаётся root-only.
- Сначала проверяются новая SSH-сессия, sudo и DO console recovery, затем отключаются password authentication и root password login.
- UFW и DO Cloud Firewall разрешают inbound 22 только с известных admin IP при их стабильности, а 80/443 — публично.
- Порты 3000/4100/5432/6379 не публикуются; PostgreSQL/Redis и bot остаются loopback. Next.js не должен быть доступен извне напрямую.
- Outbound сохраняется для Telegram, OAuth, feeds, WebSocket, alerts, NTP, package updates и текущего почтового пути.
- Mail ports на новом web Droplet не открываются.
- IPv6 учитывается в firewall и внешних проверках.

## Приёмка после миграции

### DNS/TLS/runtime

- Все три DO NS отвечают корректно; `@` и `www` указывают на новый IP через authoritative и публичные resolvers.
- Нет забытого AAAA на Aeza; MX/SPF/DMARC не изменились до этапа C.
- TLS SAN/expiry/redirects/HSTS корректны; Certbot renewal настроен и проверен.
- Web, worker и bot online только на новом сервере; старый автозапуск отключён.
- Health, counts, timestamps, sequences и migrate status соответствуют финальному snapshot.
- PM2 restart rate не растёт; ресурсы и worker queues в норме.

### Auth и Telegram

- Существующая Auth.js session продолжает работать; fresh login/logout и domain-based OAuth callbacks проверены.
- `getWebhookInfo` сохраняет `https://trientes.org`, без нового `last_error_date` и неожиданного backlog; `setWebhook` не выполняется.
- Разрешённое тестовое сообщение получает ровно один ответ; перенесённая Telegram session продолжается.

### Worker и внешние сервисы

- Проверены outbound HTTPS feeds, Binance WebSocket, reconnect, свежие timestamps и однократное выполнение schedules.
- Alerts не дублируются; `/exchange-api` продолжает использовать `rpc2.trientes.com`.
- Нет внешнего IP allowlist, содержащего только Aeza IP.

### Файлы и мобильные интеграции

- Разрешённые uploads доступны; KYB/protected files недоступны анонимно и по предсказуемым путям.
- Downloads, APK content type, latest symlink и `/exchange` работают.
- Android local repo, `.git`, build counter и debug keystore присутствуют; Android/iOS используют прежний `https://trientes.org`.
- Mac reverse SSH tunnel указывает на новый IP; тестовый build lane доступен.

### Backups

- Cron снова выполняется в 03:00 UTC с retention 14 дней; backup directory недоступна через nginx.
- Первый новый дамп создан и восстановлен в отдельную временную БД с проверкой counts/migrate status.
- DO backups включены; scheduled backup виден.
- Restart rate сравнивается через 1 час, 24 и 48 часов.

## Go/no-go блокеры

- Нет полного IONOS zone export или не проверен DNSSEC/DS.
- Не пройдены PostgreSQL/Redis rehearsal, build или полный test suite.
- Есть расхождения counts, sequences или migration status.
- Продолжается активный web crash loop/OOM.
- Не проверены live nginx, TLS private key, symlinks, protected uploads или внешние IP allowlists.
- Worker/bot могут автоматически запуститься на новом сервере до cutover.
- Старый сервер нельзя безопасно вернуть в работу до смены A.
- Прогноз restore превышает выделенное окно.

Незавершённая Mailcow integration не блокирует этапы A/B, но запрещает любые mail changes внутри них.

## Rollback

### До смены A

Остановить новый web, запустить старый стек. A остаётся на Aeza; новые worker/bot не запускались. При проблеме DO-делегации NS можно вернуть к IONOS с учётом parent NS TTL.

### После смены A, но до новых writes

Вернуть A на Aeza, остановить новый web и запустить старый стек. Если pre-DNS smoke уже изменил новые данные, откат больше не считается бездатовым.

### После новых writes

Простой возврат A запрещён. Предпочтителен fix forward. Если rollback обязателен:

1. Заблокировать writes и остановить new web/bot/worker.
2. Снять новый PostgreSQL dump, Redis RDB и reverse files delta.
3. Восстановить данные на Aeza и проверить counts.
4. Запустить старый web-only через `curl --resolve`, вернуть A.
5. Запустить старые bot/worker.

Это отдельное migration window, а не исходные 10–30 минут.

После этапа B старая IONOS-зона содержит Aeza IP. Поэтому NS rollback без предварительной синхронизации fallback-зоны также откатит web на старый сервер. Rollback A и rollback NS не выполняются как одна непродуманная операция.

## RTO и RPO

- NS при идентичных зонах: плановый простой 0.
- VPS cutover: RTO 10–30 минут плюс DNS-кэши отдельных клиентов.
- Плановый cutover: RPO 0 благодаря write freeze и финальным snapshots.
- Rollback после новых writes: RPO 0 только после reverse migration; RTO отдельный.
- Ежедневный `pg_dump`: аварийный DB RPO до 24 часов.
- Daily DO backups: полный image RPO до 24 часов в зависимости от расписания.

RTO аварийного восстановления всего Droplet не обещается до отдельного измеренного restore test.

## Судьба Aeza

Старый сервер сохраняется минимум 7 дней. PM2 applications остановлены; `pm2-dv` и backup cron не должны автоматически вернуть worker/bot после reboot. Финальные dump/RDB существуют также вне Aeza.

После стабильной работы DO, успешного restore test и нормального restart rate сервер можно выключить до конца retention period. Удаление или отмена Aeza выполняется только отдельным подтверждением владельца.

## Декомпозиция выполнения

Для реализации создаются отдельные утверждаемые runbook’и:

1. DNS delegation: zone diff, DNSSEC, DO NS verification, registrar step и NS rollback.
2. VPS migration: build/rehearsal, secret/file manifest, PostgreSQL/Redis, PM2, финальное окно и rollback.
3. Post-cutover acceptance: внешние проверки, monitoring 48 часов, backups/restore test и retention.
4. Mailcow integration: существующий отдельный spec, пересмотренный из свежего `main` после стабилизации.

Эта спецификация фиксирует архитектуру и не разрешает начинать создание ресурсов или изменение DNS без следующих утверждённых планов.
