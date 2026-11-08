# DigitalOcean Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести production `trientes.org` с Aeza на подготовленный DigitalOcean Droplet за 10–30 минут простоя, без потери данных, двойных writers и необратимых изменений.

**Architecture:** Финальный release и build artifact сначала замораживаются и запечатываются. В окне останавливаются все writers на Aeza, создаются согласованные PostgreSQL/Redis/file snapshots, восстанавливается target, затем запускается single-writer стек и только после этого меняются A-записи в уже делегированной DO-зоне. MX/SPF/DMARC/DKIM и Nameservers не меняются; Mailcow переносится отдельным планом.

**Tech Stack:** DigitalOcean DNS/Droplet/Cloud Firewall, Ubuntu 24.04, Node.js 22, PostgreSQL 16, Redis 8.x, Next.js/PM2, nginx, rsync, Prisma, doctl.

**Specification:** `docs/superpowers/specs/2026-11-06-digitalocean-migration-design.md`

**Readiness:** `/Users/dmitry/.trientes-migration/stage0-readiness.md` и `merged-release-evidence.md`.

**Release:** `RELEASE_SHA` и `TARGET_BUILD_ID` назначаются только после merge security branch и повторной проверки target build. До их назначения cutover заблокирован; значения прежнего rehearsal release не наследуются.

**Source:** `dv@85.192.25.242`, `/home/dv/trientes`.

**Target:** `dv@159.65.118.122`, `/home/dv/trientes`.

---

### Task 1: Зафиксировать release и провести dependency triage

**Files:**
- Modify protected state: `/Users/dmitry/.trientes-migration/stage0.env`
- Create protected audit: `/Users/dmitry/.trientes-migration/security/npm-audit-full.json`, `npm-audit-production.json`, `audit-triage-${RELEASE_SHA}.md`

- [ ] **Step 1: Проверить идентичность production release и зафиксировать её**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить только после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из повторно проверенного target build}"
printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
ssh -o BatchMode=yes "dv@$OLD_IP" 'cd ~/trientes && git status --short --branch && git rev-parse HEAD && git fetch origin main && git rev-parse origin/main'
ACTUAL=$(ssh -o BatchMode=yes "dv@$OLD_IP" 'git -C ~/trientes rev-parse HEAD')
test "$ACTUAL" = "$RELEASE_SHA"
ssh -o BatchMode=yes "dv@$OLD_IP" "cd ~/trientes && git merge-base --is-ancestor '$RELEASE_SHA' origin/main && git diff --quiet '$RELEASE_SHA'..origin/main -- src package.json package-lock.json prisma"
TARGET_ACTUAL=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && git rev-parse HEAD && cat .next/BUILD_ID')
test "$TARGET_ACTUAL" = "$RELEASE_SHA $TARGET_BUILD_ID"
```

Expected: оба значения уже записаны в `stage0.env` после merge security branch, а не взяты из прежнего rehearsal. Production HEAD равен `RELEASE_SHA`, origin/main может содержать только более новые documentation commits, target HEAD и `.next/BUILD_ID` совпадают с проверенными значениями, working tree чист. Если main продвинулся в `src`, `package.json`, `package-lock.json` или `prisma`, либо target artifact изменился, остановиться и повторить release pipeline, а не подменять код молча.

- [ ] **Step 2: Сохранить полный и production-only audit без автоматического исправления**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
install -m 700 -d /Users/dmitry/.trientes-migration/security
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npm audit --json' > /Users/dmitry/.trientes-migration/security/npm-audit-full.json || true
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npm audit --omit=dev --json' > /Users/dmitry/.trientes-migration/security/npm-audit-production.json || true
chmod 600 /Users/dmitry/.trientes-migration/security/npm-audit-*.json
jq -e '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-full.json
jq -e '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-production.json
```

Expected: оба JSON валидны и содержат metadata. `npm audit fix`/`--force` не выполняются.

- [ ] **Step 3: Классифицировать critical/high по prod/dev, прямым/transitive, reachability и доступному исправлению**

```bash
jq -r '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-full.json
jq -r '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | {name: .key, severity: .value.severity, isDirect: .value.isDirect, via: .value.via, fixAvailable: .value.fixAvailable}' /Users/dmitry/.trientes-migration/security/npm-audit-full.json > /Users/dmitry/.trientes-migration/security/critical-high-full.jsonl
jq -r '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | {name: .key, severity: .value.severity, isDirect: .value.isDirect, via: .value.via, fixAvailable: .value.fixAvailable}' /Users/dmitry/.trientes-migration/security/npm-audit-production.json > /Users/dmitry/.trientes-migration/security/critical-high-production.jsonl
chmod 600 /Users/dmitry/.trientes-migration/security/critical-high-*.jsonl
```

После merge security branch и повторного audit создать `/Users/dmitry/.trientes-migration/security/audit-triage-${RELEASE_SHA}.md` с явными `RELEASE_SHA`, `TARGET_BUILD_ID`, датой audit и результатом `go/no-go`. Для каждой записи из обоих JSONL указать: prod/dev, direct/transitive, runtime reachability, advisory/link, available fix и решение `fix separately / written risk acceptance`. Отдельно перечислить остаточные dev-only high findings и обосновать их отсутствие в production dependency graph; старый triage не переиспользовать. Не выдавать количество findings за эксплуатируемость. Эксплуатируемая production-critical уязвимость — блокер cutover; остальные требуют письменного risk acceptance. Без нового release-specific triage и явного `go` cutover не начинать. Файл защитить `chmod 600`.

### Task 2: Запечатать проверенный build artifact и проверить восстановление

**Files:**
- Create protected archive: `/home/dv/migration-stage0/release-${RELEASE_SHA}.next.tar` и SHA-256
- Create protected per-file manifest: `/home/dv/migration-stage0/release-${RELEASE_SHA}.artifact-manifest.txt`
- Create protected restore backup: `/home/dv/migration-stage0/artifact-before-restore-test/`

- [ ] **Step 1: Создать архив именно проверенных `.next` и versioned MapLibre assets**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из проверенного target build}"
ssh -o BatchMode=yes "dv@$NEW_IP" "RELEASE_SHA='$RELEASE_SHA' TARGET_BUILD_ID='$TARGET_BUILD_ID' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
test "$(cat .next/BUILD_ID)" = "$TARGET_BUILD_ID"
maplibre_version=$(node -p "require('./node_modules/maplibre-gl/package.json').version")
map_dir=".generated/maplibre/$maplibre_version"
assets=(maplibre-gl-worker.mjs maplibre-gl-shared.mjs)
source_maps=(maplibre-gl-worker.mjs.map maplibre-gl-shared.mjs.map)
for asset in "${assets[@]}"; do
  test -s "$map_dir/$asset"
  cmp "node_modules/maplibre-gl/dist/$asset" "$map_dir/$asset"
done
for asset in "${source_maps[@]}"; do
  test ! -e "$map_dir/$asset"
done
test ! -e public/maplibre
install -d -m 700 /home/dv/migration-stage0
archive="/home/dv/migration-stage0/release-$RELEASE_SHA.next.tar"
manifest="/home/dv/migration-stage0/release-$RELEASE_SHA.artifact-manifest.txt"
test ! -e "$archive"
test ! -e "$manifest"
tar -C /home/dv/trientes -cf "$archive" .next "$map_dir"
find .next "$map_dir" -type f -print0 | sort -z | xargs -0 sha256sum > "$manifest"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256" "$manifest"
printf 'Sealed MapLibre version %s with %s assets\n' "$maplibre_version" "${#assets[@]}"
REMOTE
```

Expected: BUILD_ID совпадает; архив содержит `.next` и `.generated/maplibre/<version>/` (вне `public/`: эти файлы отдаёт только route `src/app/maplibre/[...path]/route.ts`); manifest содержит SHA-256 каждого файла обоих trees; оба runtime assets (`maplibre-gl-worker.mjs`, `maplibre-gl-shared.mjs`) побайтово совпадают с установленным MapLibre distribution; source maps в production build отсутствуют (`prebuild` копирует с `MAPLIBRE_INCLUDE_SOURCE_MAPS=0`), legacy `public/maplibre` отсутствует. Archive SHA-256 и MapLibre version сохранены в `merged-release-evidence.md`.

- [ ] **Step 2: Проверить восстановление BUILD_ID, manifest и MapLibre HTTP**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из проверенного target build}"
ssh -o BatchMode=yes "dv@$NEW_IP" "RELEASE_SHA='$RELEASE_SHA' TARGET_BUILD_ID='$TARGET_BUILD_ID' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
maplibre_version=$(node -p "require('./node_modules/maplibre-gl/package.json').version")
map_dir=".generated/maplibre/$maplibre_version"
archive="/home/dv/migration-stage0/release-$RELEASE_SHA.next.tar"
manifest="/home/dv/migration-stage0/release-$RELEASE_SHA.artifact-manifest.txt"
backup=/home/dv/migration-stage0/artifact-before-restore-test
pm2 stop trientes-web
test ! -e "$backup"
mkdir -m 700 -p "$backup"
mv .next "$backup/.next"
mv "$map_dir" "$backup/maplibre"
tar -C /home/dv/trientes -xf "$archive"
test "$(cat .next/BUILD_ID)" = "$TARGET_BUILD_ID"
sha256sum --quiet -c "$manifest"
diff -qr "$backup/.next" /home/dv/trientes/.next
diff -qr "$backup/maplibre" "/home/dv/trientes/$map_dir"
pm2 start ecosystem.config.js --only trientes-web
pm2 save
curl -fsS http://127.0.0.1:3000/api/health
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/en)" = 200
assets=(maplibre-gl-worker.mjs maplibre-gl-shared.mjs)
for asset in "${assets[@]}"; do
  url="http://127.0.0.1:3000/maplibre/$maplibre_version/$asset"
  headers=$(curl -sS -o /dev/null -D - "$url")
  grep -q '^HTTP/[0-9.]* 200' <<<"$headers"
  grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$headers"
  printf '200 immutable %s\n' "$url"
done
for asset_path in "$maplibre_version/maplibre-gl-worker.mjs.map" "$maplibre_version/maplibre-gl-shared.mjs.map" maplibre-gl-worker.mjs; do
  url="http://127.0.0.1:3000/maplibre/$asset_path"
  headers=$(curl -sS -o /dev/null -D - "$url")
  grep -q '^HTTP/[0-9.]* 404' <<<"$headers"
  grep -qi '^cache-control: no-store' <<<"$headers"
  printf '404 no-store %s\n' "$url"
done
REMOTE
```

Expected: восстановленный `.next` и versioned MapLibre tree (`.generated/maplibre/<version>/`) побайтово совпадают с backup и manifest, BUILD_ID совпадает, health/`/en` возвращают HTTP 200, оба runtime URLs `/maplibre/<version>/maplibre-gl-{worker,shared}.mjs` возвращают HTTP 200 с `Cache-Control: public, max-age=31536000, immutable`, а production source maps и unversioned `/maplibre/maplibre-gl-worker.mjs` возвращают 404 `no-store`; worker/bot не запущены. Любая разница — блокер; не запускать cutover с другим artifact.

### Task 3: Проверить readiness внешних зависимостей и final acceptance plan

**Files:**
- Create protected evidence: `/Users/dmitry/.trientes-migration/cutover-dependency-checks.md`

- [ ] **Step 1: Проверить фактические startup HTTP dependencies без запуска worker**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx tsx -e '"'"'import { fetchMarkets } from "./src/lib/markets"; const rows = await fetchMarkets(); if (rows.length === 0) throw new Error("CNBC markets empty"); console.log(`CNBC quotes: ${rows.length}`)'"'"''
ssh -o BatchMode=yes "dv@$NEW_IP" 'curl -fsS https://api.coingecko.com/api/v3/ping >/dev/null && curl -fsS https://api.coinpaprika.com/v1/global >/dev/null && curl -fsS https://api.alternative.me/fng/?limit=1 >/dev/null && curl -fsS https://cointelegraph.com/rss >/dev/null && curl -fsS https://www.coindesk.com/arc/outboundfeeds/rss/ >/dev/null && printf "Startup HTTP dependencies passed\n"'
```

Expected: CNBC quotes непустой, остальные endpoints HTTP 200. Любая ошибка — блокер до отдельной диагностики; не запускать worker для маскировки.

- [ ] **Step 2: Проверить Binance WebSocket без торговли**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node --input-type=module -e '"'"'import WebSocket from "ws"; const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade"); const timeout = setTimeout(() => { console.error("WS timeout"); ws.terminate(); process.exit(1); }, 15000); ws.once("open", () => { console.log("Binance WS open"); }); ws.once("message", () => { clearTimeout(timeout); console.log("Binance WS message received"); ws.close(); }); ws.once("close", () => process.exit(0)); ws.once("error", (e) => { clearTimeout(timeout); console.error("WS error", e.message); process.exit(1); });'"'"''
```

Expected: `Binance WS open` и одно message получены, затем clean close. Не отправлять ордера и не запускать worker.

- [ ] **Step 3: Записать dependency evidence и go/no-go checklist**

В `/Users/dmitry/.trientes-migration/cutover-dependency-checks.md` через Write зафиксировать release/artifact SHA, все HTTP checks, Binance open/message и требование финального single-writer запуска. Добавить: production `main` всё ещё равен `RELEASE_SHA`, A/MX не менялись, old web/worker online, old bot stopped, активных Claude processes нет, target web-only.

### Task 4: Остановить writers и сделать финальные snapshots

**Files:**
- Create final dumps/RDB/manifests в protected staging на source/target

- [ ] **Step 1: Восстановить backup script и crontab до финального snapshot**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/pg-backup.sh 'dv@$NEW_IP:/home/dv/pg-backup.sh'"
ssh -o BatchMode=yes "dv@$NEW_IP" 'chmod 700 /home/dv/pg-backup.sh && test -x /home/dv/pg-backup.sh && ! crontab -l | grep -q .'
ssh -o BatchMode=yes "dv@$OLD_IP" 'crontab -l' | ssh -o BatchMode=yes "dv@$NEW_IP" 'crontab -'
ssh -o BatchMode=yes "dv@$NEW_IP" 'crontab -l'
```

Expected: `/home/dv/pg-backup.sh` присутствует и executable, crontab содержит `0 3 * * * /home/dv/pg-backup.sh >> /home/dv/logs/pg-backup.log 2>&1`. Остальные source jobs не добавляются автоматически.

- [ ] **Step 2: Заморозить deploys и остановить writers на Aeza**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; test -z "$(pgrep -x claude || true)"; pm2 stop trientes-web trientes-worker; pm2 stop trientes-bot 2>/dev/null || true; sudo systemctl disable pm2-dv; pm2 status; test -z "$(pgrep -x claude || true)"'
```

Expected: все три приложения stopped, активных Claude processes нет, `pm2-dv` disabled и не вернёт writers после reboot. Не останавливать Aeza целиком и не менять DNS. Если worker не завершает in-flight jobs, остановить окно и разобрать их; не делать dump во время активной записи.

- [ ] **Step 3: Создать финальный PostgreSQL dump и проверить SHA**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; test ! -e /home/dv/migration-stage0/trientes-cutover-final.dump; pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file=/home/dv/migration-stage0/trientes-cutover-final.dump; chmod 600 /home/dv/migration-stage0/trientes-cutover-final.dump; sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump'
ssh -o BatchMode=yes "dv@$OLD_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/migration-stage0/trientes-cutover-final.dump 'dv@$NEW_IP:/home/dv/migration-stage0/trientes-cutover-final.dump'"
SOURCE_SHA=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump | cut -d' ' -f1")
TARGET_SHA=$(ssh -o BatchMode=yes "dv@$NEW_IP" "sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump | cut -d' ' -f1")
test "$SOURCE_SHA" = "$TARGET_SHA"
```

Expected: финальный dump после write freeze, SHA совпадает. Не использовать rehearsal dump как финальный.

- [ ] **Step 4: Создать согласованный Redis RDB**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; redis-cli SAVE; redis-cli CONFIG GET dir dbfilename; redis-cli DBSIZE; redis-cli INFO Stats | grep -E "expired_keys|evicted_keys"; sudo systemctl stop redis-server'
ssh -o BatchMode=yes "dv@$OLD_IP" "sudo rsync -a -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/lib/redis/dump.rdb 'root@$NEW_IP:/root/migration-stage0/cutover-final-dump.rdb'"
```

Expected: SAVE после остановки приложений, RDB path подтверждён, старый Redis остановлен и больше не меняет файл.

- [ ] **Step 5: Выполнить itemized dry-run live-state delta**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
install -d -m 700 /home/dv/migration-stage0/delta-review
SSH='ssh -o BatchMode=yes'
rsync -aHnc --delete -i -e "$SSH" /home/dv/.claude/ "dv@$NEW_IP:/home/dv/.claude/" > /home/dv/migration-stage0/delta-review/claude.itemize
rsync -aHnc -i -e "$SSH" /home/dv/.claude.json "dv@$NEW_IP:/home/dv/.claude.json" > /home/dv/migration-stage0/delta-review/claude-json.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes-artifacts/ "dv@$NEW_IP:/home/dv/trientes-artifacts/" > /home/dv/migration-stage0/delta-review/artifacts.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes/incoming/ "dv@$NEW_IP:/home/dv/trientes/incoming/" > /home/dv/migration-stage0/delta-review/incoming.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes/public/uploads/ "dv@$NEW_IP:/home/dv/trientes/public/uploads/" > /home/dv/migration-stage0/delta-review/public-uploads.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes-android/ "dv@$NEW_IP:/home/dv/trientes-android/" > /home/dv/migration-stage0/delta-review/android.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-uploads/ "root@$NEW_IP:/var/www/trientes-uploads/" > /home/dv/migration-stage0/delta-review/var-uploads.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-downloads/ "root@$NEW_IP:/var/www/trientes-downloads/" > /home/dv/migration-stage0/delta-review/var-downloads.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-exchange/ "root@$NEW_IP:/var/www/trientes-exchange/" > /home/dv/migration-stage0/delta-review/var-exchange.itemize
chmod 600 /home/dv/migration-stage0/delta-review/*.itemize
REMOTE
```

Expected: список изменений сохранён и проверен без секретов/PII. Не применять `--delete` до защищённой копии target и ручного review.

- [ ] **Step 6: Сохранить target backup и применить проверенную delta**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'test ! -e /home/dv/migration-stage0/target-before-delta; install -d -m 700 /home/dv/migration-stage0/target-before-delta; rsync -a /home/dv/.claude/ /home/dv/migration-stage0/target-before-delta/.claude/'
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
SSH='ssh -o BatchMode=yes'
rsync -aH --delete -e "$SSH" /home/dv/.claude/ "dv@$NEW_IP:/home/dv/.claude/"
rsync -aH -e "$SSH" /home/dv/.claude.json "dv@$NEW_IP:/home/dv/.claude.json"
rsync -aH -e "$SSH" /home/dv/trientes-artifacts/ "dv@$NEW_IP:/home/dv/trientes-artifacts/"
rsync -aH -e "$SSH" /home/dv/trientes/incoming/ "dv@$NEW_IP:/home/dv/trientes/incoming/"
rsync -aH -e "$SSH" /home/dv/trientes/public/uploads/ "dv@$NEW_IP:/home/dv/trientes/public/uploads/"
rsync -aH -e "$SSH" /home/dv/trientes-android/ "dv@$NEW_IP:/home/dv/trientes-android/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-uploads/ "root@$NEW_IP:/var/www/trientes-uploads/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-downloads/ "root@$NEW_IP:/var/www/trientes-downloads/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-exchange/ "root@$NEW_IP:/var/www/trientes-exchange/"
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'for path in /home/dv/trientes-artifacts /home/dv/trientes-android /home/dv/.claude; do find "$path" -type d -exec chmod 700 {} +; find "$path" -type f -exec sh -c '"'"'for file; do if test -x "$file"; then chmod 700 "$file"; else chmod 600 "$file"; fi; done'"'"' sh {} +; done'
```

Expected: применяются только проверенные изменения; `--delete` используется только для `.claude` после backup. Повторно применить protected dirs 0700, non-exec 0600, executables 0700 и проверить symlinks/owners.

### Task 5: Восстановить и проверить target data

**Files:**
- Recreate target DB только после сохранения rehearsal dump
- Restore final RDB

- [ ] **Step 1: Пересоздать пустую target DB и восстановить финальный dump**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'set -e; test -s /var/lib/postgresql/migration/trientes-rehearsal.dump; pm2 stop trientes-web; sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=\"trientes\" AND pid <> pg_backend_pid();"; sudo -u postgres dropdb trientes; sudo -u postgres createdb --owner=trientes --encoding=UTF8 --locale=en_US.UTF-8 --template=template0 trientes; install -m 600 -o postgres -g postgres /home/dv/migration-stage0/trientes-cutover-final.dump /var/lib/postgresql/migration/trientes-cutover-final.dump; sudo -u postgres pg_restore --exit-on-error --dbname=trientes /var/lib/postgresql/migration/trientes-cutover-final.dump'
```

Expected: target web остановлен, rehearsal dump сохранён, DB пересоздана пустой и restore rc0. Не выполнять dropdb на Aeza.

- [ ] **Step 2: Сравнить counts, timestamps, sequences, migrations и hashes статических таблиц**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
COUNTS_SQL='SELECT (SELECT COUNT(*) FROM "CoinSnapshot") AS snapshots, (SELECT MAX("fetchedAt") FROM "CoinSnapshot") AS latest, (SELECT COUNT(*) FROM "User") AS users, (SELECT COUNT(*) FROM "Session") AS sessions, (SELECT COUNT(*) FROM "Account") AS accounts, (SELECT COUNT(*) FROM "Coin") AS coins, (SELECT COUNT(*) FROM "Exchange") AS exchanges, (SELECT COUNT(*) FROM "_prisma_migrations") AS migrations;'
ssh -o BatchMode=yes "dv@$OLD_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$COUNTS_SQL'"
ssh -o BatchMode=yes "dv@$NEW_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$COUNTS_SQL'"
SEQ_SQL='SELECT sequence_name, last_value FROM information_schema.sequences ORDER BY sequence_name;'
ssh -o BatchMode=yes "dv@$OLD_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$SEQ_SQL'"
ssh -o BatchMode=yes "dv@$NEW_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$SEQ_SQL'"
HASH_SQL='SELECT md5(string_agg(t::text, '"'"'|'"'"' ORDER BY t.id)) FROM "User" t; SELECT md5(string_agg(t::text, '"'"'|'"'"' ORDER BY t.id)) FROM "Account" t; SELECT md5(string_agg(t::text, '"'"'|'"'"' ORDER BY t.id)) FROM "Coin" t; SELECT md5(string_agg(t::text, '"'"'|'"'"' ORDER BY t.id)) FROM "Exchange" t;'
ssh -o BatchMode=yes "dv@$OLD_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$HASH_SQL'"
ssh -o BatchMode=yes "dv@$NEW_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$HASH_SQL'"
```

Expected: counts/latest/migrations и hashes совпадают с финальным snapshot. Дополнительно проверить `information_schema.sequences` и `prisma migrate status`. Расхождение — abort до A change.

- [ ] **Step 3: Восстановить Redis RDB и проверить keys/TTL/expiry/eviction**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'set -e; systemctl stop redis-server; install -m 600 -o redis -g redis /root/migration-stage0/cutover-final-dump.rdb /var/lib/redis/dump.rdb; systemctl start redis-server; redis-cli PING; redis-cli DBSIZE; redis-cli INFO Stats | grep -E "expired_keys|evicted_keys"; redis-cli --scan --pattern "claude:session:*" | wc -l'
```

Expected: PONG, DBSIZE соответствует финальному RDB на момент SAVE с учётом задокументированных TTL expirations; `evicted_keys=0`; Telegram session keys/TTL присутствуют, нет load errors.

### Task 6: Запустить single-writer стек и проверить worker/bot

**Files:**
- Create protected startup evidence: `/Users/dmitry/.trientes-migration/cutover-startup-evidence.md`

- [ ] **Step 1: Запустить только web и проверить pre-DNS HTTPS**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx prisma migrate status && pm2 start ecosystem.config.js --only trientes-web && curl -fsS http://127.0.0.1:3000/api/health && curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/en'
curl -fsS --resolve "trientes.org:443:$NEW_IP" https://trientes.org/api/health
curl -fsS --resolve "trientes.org:443:$NEW_IP" https://trientes.org/en
```

Expected: health и `/en` 200, DB/Redis ok, cold-cache не вызывает рост память/реstarts. Это abort checkpoint: при ошибке A не менять и вернуть старый стек.

- [ ] **Step 2: Запустить worker один раз и проверить startup jobs**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && pm2 start ecosystem.config.js --only trientes-worker && sleep 30 && pm2 logs trientes-worker --lines 100 --nostream > /home/dv/migration-stage0/worker-startup.log && pm2 describe trientes-worker && redis-cli DBSIZE'
```

Expected: worker online, startup jobs начали заполнять caches, Binance WS/reconnect не зацикливается, нет повторяющихся 429/5xx/parser errors. Старый worker остаётся stopped. Не отправлять тестовые уведомления реальным пользователям.

- [ ] **Step 3: Перезапустить bot и проверить webhook/voice/native fetch без искусственных updates**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && pm2 restart ecosystem.config.js --only trientes-bot --update-env && pm2 save && curl -fsS http://127.0.0.1:4100/health'
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node -e '"'"'require("dotenv").config(); (async()=>{const base="https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN; const [me,hook]=await Promise.all([fetch(base+"/getMe").then(r=>r.json()),fetch(base+"/getWebhookInfo").then(r=>r.json())]); const url=hook.result?.url; const origin=url?new URL(url).origin:null; console.log(JSON.stringify({getMe:me.ok,webhook:hook.ok,origin,pending:hook.result?.pending_update_count,last_error_date:hook.result?.last_error_date})); if(!me.ok||!hook.ok||origin!=="https://trientes.org")process.exit(1)})().catch(()=>process.exit(1))'"'"''
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx vitest run bot/__tests__/voice.test.ts'
```

Expected: bot health ok; native `fetch` возвращает `getMe.ok=true`; webhook origin остаётся `https://trientes.org`, pending 0 и нет новой ошибки. `setWebhook` не выполняется. Voice regression использует реальный OpenAI 6 client через local mock `/v1/audio/transcriptions`, без внешней сети, real API key, аудио или PII; результат записать в startup evidence. Затем пользователь отправляет `/whoami` один раз: ровно один ответ без дублей.

### Task 7: Переключить только A-записи в DigitalOcean

**Files:**
- No MX/SPF/DMARC/DKIM/NS changes

- [ ] **Step 1: Зафиксировать rollback DNS и переключить `@`/`www`**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
doctl compute domain records list trientes.org > /Users/dmitry/.trientes-migration/dns-before-cutover.txt
doctl compute domain records update trientes.org --record-id 1837678911 --record-data "$NEW_IP" --record-ttl 300
doctl compute domain records update trientes.org --record-id 1837678935 --record-data "$NEW_IP" --record-ttl 300
```

Expected: изменены только A `@` и `www` на `159.65.118.122`. MX/SPF/DMARC/DKIM/NS не изменены. Если production AAAA появится, отдельно проверить его перед переключением; сейчас AAAA нет.

- [ ] **Step 2: Проверить authoritative и публичные DNS**

```bash
for resolver in ns1.digitalocean.com ns2.digitalocean.com ns3.digitalocean.com 1.1.1.1 8.8.8.8; do
  printf '\nResolver %s\n' "$resolver"
  dig +noall +answer "@$resolver" trientes.org A
  dig +noall +answer "@$resolver" www.trientes.org A
  dig +noall +answer "@$resolver" trientes.org MX
done
```

Expected: authoritative DO отдают новый IP, MX остаются IONOS. Публичные caches могут временно отдавать Aeza до TTL 300; не ускорять их изменением NS.

- [ ] **Step 3: Проверить внешний health и сохранить old runtime stopped**

```bash
curl -fsS https://trientes.org/api/health
curl -fsS -o /dev/null -w 'apex /en: %{http_code}\n' https://trientes.org/en
curl -fsS -o /dev/null -w 'www /en: %{http_code}\n' https://www.trientes.org/en
ssh -o BatchMode=yes "dv@$OLD_IP" 'pm2 status; systemctl is-active pm2-dv || true'
```

Expected: после распространения внешние health 200 и `/en` 200; old web/worker/bot остаются stopped и не принимают cached writes.

### Task 8: Полная acceptance, backups и security

**Files:**
- Create protected acceptance: `/Users/dmitry/.trientes-migration/cutover-acceptance.md`
- Create temporary restore-test DB only for backups

- [ ] **Step 1: Проверить auth, Telegram, worker и файлы**

Выполнить через браузер и read-only diagnostics:

- Существующая Auth.js database session продолжает работать и не удаляется; in-progress OAuth flow со старыми pre-upgrade check-cookies может быть отклонён — это ожидаемый повторный login, не обход и не patch библиотеки. Fresh Google/GitHub login/logout и domain OAuth callbacks успешны.
- Telegram `/whoami` и `/status` получают ровно один ответ; `getWebhookInfo` не имеет нового `last_error_date`/backlog.
- Worker caches свежие, schedules однократны, Binance WS подключён, alerts не дублируются.
- Обязательный browser gate `/en/crypto-map?coin=bitcoin`: canvas виден и инициализирован, tile responses HTTP 200, versioned worker/shared/оба map files HTTP 200, нет `pageerror`/MapLibre error; статические `© OpenStreetMap contributors` и `© OpenFreeMap` видимы. В cabinet point form клик по карте ставит marker и заполняет координаты; после SHOP→ONLINE→SHOP карта и click продолжают работать.
- `/exchange/`, APK latest symlink и read-only `GET /exchange-api/health` возвращает HTTP 200 и подтверждает работу proxy к внешнему order service; uploads доступны, KYB/protected files 403/404.
- Android/iOS продолжают использовать `https://trientes.org`; Mac tunnel перенастроен на `NEW_IP`, затем `/home/dv/bin/mac-ios --lane build_sim` проходит.

Сначала обновить destination через существующий tunnel на Aeza:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
ssh -p 2222 aleksandrswiss@localhost "NEW_IP='$NEW_IP' python3 -c 'from pathlib import Path; import os; p=Path.home()/\"Library/LaunchDaemons/com.poolwatt.tunnel.coinmarketcap.plist\"; text=p.read_text(); assert \"85.192.25.242\" in text; p.write_text(text.replace(\"85.192.25.242\", os.environ[\"NEW_IP\"]))'"
ssh -p 2222 aleksandrswiss@localhost 'launchctl kickstart -k system/com.poolwatt.tunnel.coinmarketcap'
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'ssh -p 2222 aleksandrswiss@localhost "hostname && /home/dv/bin/mac-ios --lane build_sim"'
```

```bash
source /Users/dmitry/.trientes-migration/stage0.env
curl -fsS --resolve "trientes.org:443:$NEW_IP" https://trientes.org/exchange-api/health
```

Expected: все проверки записаны в `cutover-acceptance.md`. Не объявлять acceptance завершённым по одному health.

- [ ] **Step 2: Создать первый backup и проверить restore во временную БД**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" '/home/dv/pg-backup.sh && LATEST=$(ls -1t /home/dv/backups/pg/trientes-*.sql.gz | head -n 1) && gzip -t "$LATEST" && sha256sum "$LATEST" && sudo -u postgres createdb --owner=trientes --encoding=UTF8 --locale=en_US.UTF-8 --template=template0 trientes_restore_test && zcat "$LATEST" | sudo -u postgres psql trientes_restore_test && sudo -u postgres psql trientes_restore_test -c '"'"'SELECT COUNT(*) FROM "CoinSnapshot"'"'"' && sudo -u postgres dropdb trientes_restore_test'
```

Expected: cron-compatible backup создан, gzip/restore успешны, counts совпадают, временная БД удалена. DO backup schedule проверен отдельно через `doctl compute droplet get "$DROPLET_ID" --format ID,Features`.

- [ ] **Step 3: Вернуть постоянный sudo и убрать recovery root access**

Владелец интерактивно задаёт `dv` сильный пароль через `sudo passwd dv`. Затем:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'sudo -k && sudo -v && printf "dv ALL=(ALL) ALL\n" | sudo tee /etc/sudoers.d/dv >/dev/null && sudo chmod 440 /etc/sudoers.d/dv && sudo visudo -cf /etc/sudoers.d/dv && sudo rm -f /etc/sudoers.d/90-dv-migration && sudo visudo -c && printf "PermitRootLogin no\n" | sudo tee /etc/ssh/sshd_config.d/99-trientes-root.conf >/dev/null && sudo sshd -t && sudo systemctl reload ssh'
```

Expected: обычный sudo работает, NOPASSWD file удалён, root SSH disabled, admin `dv` recovery сохранён. Затем:

```bash
scp -q -o BatchMode=yes /Users/dmitry/.trientes-migration/aeza-temporary.pub "dv@$NEW_IP:/home/dv/aeza-temporary.pub"
ssh -o BatchMode=yes "dv@$NEW_IP" 'set -e; for file in /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys; do sudo grep -vxFf /home/dv/aeza-temporary.pub "$file" > /tmp/trientes-authorized_keys.tmp; sudo cp /tmp/trientes-authorized_keys.tmp "$file"; sudo rm -f /tmp/trientes-authorized_keys.tmp; done; sudo chmod 600 /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys; rm -f /home/dv/aeza-temporary.pub'
```

Временный Aeza public key удалён из root/dv `authorized_keys`, admin key сохранён. Старый IP из firewall пока сохранить для rollback.

- [ ] **Step 4: Записать monitoring plan на 1/24/48 часов и retention 7 дней**

В `cutover-acceptance.md` зафиксировать:

- PM2 restart counter/RSS/CPU/disk, worker queues и Binance WS через 1, 24 и 48 часов;
- отсутствие дублей alerts/Telegram responses;
- первый cron backup и DO backup;
- старый Aeza выключен из runtime, но сохранён минимум 7 дней с остановленными PM2 apps и запретом автозапуска;
- удаление Aeza только отдельным подтверждением после restore test и стабильного soak.

- [ ] **Step 5: Обновить deploy-конфиги и документацию на новый IP**

После успешной acceptance выполнить только в target checkout:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" "NEW_IP='$NEW_IP' python3 -" <<'PY'
from pathlib import Path
import os
paths = [
    Path('/home/dv/trientes/README.md'),
    Path('/home/dv/trientes/deploy/nginx/trientes.conf'),
    Path('/home/dv/trientes/deploy/nginx/trientes-tls.conf'),
    Path('/home/dv/trientes/deploy/docs/dns-tls.md'),
]
for path in paths:
    text = path.read_text()
    if '85.192.25.242' not in text:
        raise SystemExit(f'Expected old IP missing in {path}')
    path.write_text(text.replace('85.192.25.242', os.environ['NEW_IP']))
PY
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && git diff --check && git add README.md deploy/nginx/trientes.conf deploy/nginx/trientes-tls.conf deploy/docs/dns-tls.md && git commit -m "chore(deploy): перейти на DigitalOcean IP" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && git push origin HEAD:main'
```

Expected: старый IP удалён только из перечисленных deploy/docs файлов, commit/push успешен. Исторические plans/specs не переписываются.

### Task 9: Rollback только при подтверждённом сбое

**Files:**
- Rollback evidence only; no automatic DNS revert

- [ ] **Step 1: Rollback до новых writes**

Если A ещё не изменён или новых production writes не было:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
doctl compute domain records update trientes.org --record-id 1837678911 --record-data "$OLD_IP" --record-ttl 300
doctl compute domain records update trientes.org --record-id 1837678935 --record-data "$OLD_IP" --record-ttl 300
ssh -o BatchMode=yes "dv@$NEW_IP" 'pm2 stop trientes-web trientes-worker trientes-bot 2>/dev/null || true'
ssh -o BatchMode=yes "dv@$OLD_IP" 'sudo systemctl enable pm2-dv && pm2 start ecosystem.config.js && pm2 save && pm2 status'
```

Expected: A возвращены на Aeza, новые worker/bot не запускались, старый стек восстановлен. Если новые writes были, эта команда не применяется.

- [ ] **Step 2: Rollback после новых writes — отдельное reverse migration window**

Остановить new web/worker/bot, затем создать reverse snapshots:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'set -e; pm2 stop trientes-web trientes-worker trientes-bot; pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file=/home/dv/migration-stage0/trientes-rollback.dump; chmod 600 /home/dv/migration-stage0/trientes-rollback.dump; redis-cli SAVE; sudo systemctl stop redis-server'
ssh -o BatchMode=yes "dv@$NEW_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/migration-stage0/trientes-rollback.dump 'dv@$OLD_IP:/home/dv/migration-stage0/trientes-rollback.dump'"
ssh -o BatchMode=yes "root@$NEW_IP" "rsync -a -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/lib/redis/dump.rdb 'dv@$OLD_IP:/home/dv/migration-stage0/rollback-dump.rdb'"
```

Восстановить Aeza только после проверки SHA-256 и сохранения pre-rollback backup:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; test -s /home/dv/migration-stage0/trientes-cutover-final.dump; sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=\"trientes\" AND pid <> pg_backend_pid();"; sudo -u postgres dropdb trientes; sudo -u postgres createdb --owner=trientes --encoding=UTF8 --locale=en_US.UTF-8 --template=template0 trientes; sudo -u postgres pg_restore --exit-on-error --dbname=trientes /home/dv/migration-stage0/trientes-rollback.dump; systemctl stop redis-server; install -m 600 -o redis -g redis /home/dv/migration-stage0/rollback-dump.rdb /var/lib/redis/dump.rdb; systemctl start redis-server'
```

Выполнить reverse file delta с itemized dry-run и protected backup перед фактической синхронизацией:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" "OLD_IP='$OLD_IP' bash -s" <<'REMOTE'
set -euo pipefail
SSH='ssh -o BatchMode=yes'
rsync -aHnc --delete -i -e "$SSH" /home/dv/.claude/ "dv@$OLD_IP:/home/dv/.claude/" > /home/dv/migration-stage0/reverse-claude.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes-artifacts/ "dv@$OLD_IP:/home/dv/trientes-artifacts/" > /home/dv/migration-stage0/reverse-artifacts.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes/incoming/ "dv@$OLD_IP:/home/dv/trientes/incoming/" > /home/dv/migration-stage0/reverse-incoming.itemize
rsync -aHnc -i -e "$SSH" /home/dv/trientes/public/uploads/ "dv@$OLD_IP:/home/dv/trientes/public/uploads/" > /home/dv/migration-stage0/reverse-public-uploads.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-uploads/ "root@$OLD_IP:/var/www/trientes-uploads/" > /home/dv/migration-stage0/reverse-var-uploads.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-downloads/ "root@$OLD_IP:/var/www/trientes-downloads/" > /home/dv/migration-stage0/reverse-var-downloads.itemize
sudo rsync -aHnc -i -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-exchange/ "root@$OLD_IP:/var/www/trientes-exchange/" > /home/dv/migration-stage0/reverse-var-exchange.itemize
REMOTE
```

После review и protected backup применить фактическую синхронизацию:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" "OLD_IP='$OLD_IP' bash -s" <<'REMOTE'
set -euo pipefail
SSH='ssh -o BatchMode=yes'
rsync -aH --delete -e "$SSH" /home/dv/.claude/ "dv@$OLD_IP:/home/dv/.claude/"
rsync -aH -e "$SSH" /home/dv/trientes-artifacts/ "dv@$OLD_IP:/home/dv/trientes-artifacts/"
rsync -aH -e "$SSH" /home/dv/trientes/incoming/ "dv@$OLD_IP:/home/dv/trientes/incoming/"
rsync -aH -e "$SSH" /home/dv/trientes/public/uploads/ "dv@$OLD_IP:/home/dv/trientes/public/uploads/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-uploads/ "root@$OLD_IP:/var/www/trientes-uploads/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-downloads/ "root@$OLD_IP:/var/www/trientes-downloads/"
sudo rsync -aH -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/www/trientes-exchange/ "root@$OLD_IP:/var/www/trientes-exchange/"
REMOTE
```

Проверить counts/latest/migrations/hashes/Redis keys/TTL/symlinks, запустить старый web-only через `curl --resolve` на OLD_IP, затем вернуть A и запустить старые worker/bot.

Expected: RPO 0 только после reverse synchronization. RTO отдельный, не 10–30 минут. Не возвращать A до восстановления данных и не откатывать NS одновременно с A.
