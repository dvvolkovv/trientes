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

**Как выполнять блоки.** Каждый ```bash блок — отдельный скрипт: сохранить его в `/Users/dmitry/.trientes-migration/run/task<N>-step<M>.sh` (каталог `0700`) и запустить `bash <файл>`. Не вставлять блоки в интерактивный shell: на ноуте это zsh, где `$var` без кавычек не делится на слова, а `exit 1` закрывает терминал, и без `set -e` упавший `test` не останавливает следующие команды. Каждый блок начинается с `set -euo pipefail` (heredoc-скрипты на серверах — со своим) и последней строкой печатает `OK: Task N Step M`. Нет этой строки — шаг не пройден, к следующему не переходить. Каталог создаётся один раз: `install -d -m 700 /Users/dmitry/.trientes-migration/run`. На ноуте `bash` — это `/bin/bash` 3.2: в блоках нет ассоциативных массивов и `mapfile`.

**Доступ на время rollback.** До закрытия окна rollback (Task 10, не раньше 7 дней после cutover) на target остаются recovery-доступы, на которых держится Task 9: root SSH только по ключу, `sudo` без пароля для `dv` и временный Aeza key в `authorized_keys` root и `dv`. SSH на target открыт только с `ADMIN_IP` и `OLD_IP`, а после Task 8 Step 2 ещё с IP Mac для iOS-туннеля (Cloud Firewall `trientes-org-web-fw` и UFW). Вход по паролю выключен. Обратная синхронизация идёт с Aeza (pull): у root на Aeza нет `authorized_keys`, и target не может писать на Aeza.

---

### Task 1: Зафиксировать release и провести dependency triage

**Files:**
- Modify protected state: `/Users/dmitry/.trientes-migration/stage0.env`
- Create protected audit: `/Users/dmitry/.trientes-migration/security/npm-audit-full.json`, `npm-audit-production.json`, `audit-triage-${RELEASE_SHA}.md`

- [ ] **Step 1: Проверить идентичность production release и зафиксировать её**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить только после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из повторно проверенного target build}"
: "${ROLLBACK_SHA:?SHA, на котором работает Aeza}"
: "${ROLLBACK_BUILD_ID:?.next/BUILD_ID на Aeza}"
printf '%s' "$RELEASE_SHA" | grep -Eq '^[0-9a-f]{40}$'
ssh -o BatchMode=yes "dv@$OLD_IP" 'cd ~/trientes && git status --short --branch && git rev-parse HEAD && git fetch origin main && git rev-parse origin/main'
ACTUAL=$(ssh -o BatchMode=yes "dv@$OLD_IP" 'cd ~/trientes && test -z "$(git status --short)" && git rev-parse HEAD && cat .next/BUILD_ID' | paste -sd' ' -)
test "$ACTUAL" = "$ROLLBACK_SHA $ROLLBACK_BUILD_ID"
ssh -o BatchMode=yes "dv@$OLD_IP" "cd ~/trientes && git merge-base --is-ancestor '$RELEASE_SHA' origin/main && git diff --quiet '$RELEASE_SHA'..origin/main -- . ':(exclude)docs'"
TARGET_ACTUAL=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && test -z "$(git status --short)" && git rev-parse HEAD && cat .next/BUILD_ID' | paste -sd' ' -)
test "$TARGET_ACTUAL" = "$RELEASE_SHA $TARGET_BUILD_ID"
# npm не проверяет engines.node без engine-strict: сравнить версию Node на target явно.
NODE_CHECK=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node -p "require(\"./package.json\").engines.node" && node -p process.versions.node' | paste -sd' ' -)
NODE_MIN=${NODE_CHECK%% *}; NODE_MIN=${NODE_MIN#>=}; NODE_NOW=${NODE_CHECK##* }
printf '%s' "$NODE_MIN" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
test "$(printf '%s\n%s\n' "$NODE_MIN" "$NODE_NOW" | sort -V | sed -n 1p)" = "$NODE_MIN"
echo "OK: Task 1 Step 1"
```

Expected: `RELEASE_SHA` и `TARGET_BUILD_ID` записаны в `stage0.env` после merge security branch, а не взяты из прежнего rehearsal. Aeza остаётся точкой rollback: HEAD равен `ROLLBACK_SHA` (`835aca4`), `.next/BUILD_ID` равен `ROLLBACK_BUILD_ID`, working tree чист. Release на Aeza не разворачивается: worker и bot запускаются через `tsx` прямо из исходников, поэтому checkout, `node_modules` и `.next` на Aeza должны оставаться согласованными для rollback (Task 9). origin/main содержит `RELEASE_SHA`, а после него может меняться только `docs/`. Target HEAD и `.next/BUILD_ID` совпадают с проверенными значениями, working tree чист. Node на target не ниже `engines.node` из `package.json` (`>=22.12.0`: на более старом Node sanitize-html роняет SSR страниц монет с `ERR_REQUIRE_ESM`). Если main изменился где-либо вне `docs/` (код, конфиги, lock-файл, `prisma`, `deploy`, `scripts`) либо target artifact изменился, остановиться и повторить release pipeline, а не подменять код молча.

- [ ] **Step 2: Сохранить полный и production-only audit без автоматического исправления**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
install -m 700 -d /Users/dmitry/.trientes-migration/security
# npm audit выходит с ненулевым кодом, если находит уязвимости: код игнорируется, а валидность JSON проверяет jq ниже.
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npm audit --json' > /Users/dmitry/.trientes-migration/security/npm-audit-full.json || true
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npm audit --omit=dev --json' > /Users/dmitry/.trientes-migration/security/npm-audit-production.json || true
chmod 600 /Users/dmitry/.trientes-migration/security/npm-audit-*.json
jq -e '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-full.json
jq -e '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-production.json
echo "OK: Task 1 Step 2"
```

Expected: оба JSON валидны и содержат metadata. `npm audit fix`/`--force` не выполняются.

- [ ] **Step 3: Классифицировать critical/high по prod/dev, прямым/transitive, reachability и доступному исправлению**

```bash
set -euo pipefail
jq -r '.metadata.vulnerabilities' /Users/dmitry/.trientes-migration/security/npm-audit-full.json
jq -r '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | {name: .key, severity: .value.severity, isDirect: .value.isDirect, via: .value.via, fixAvailable: .value.fixAvailable}' /Users/dmitry/.trientes-migration/security/npm-audit-full.json > /Users/dmitry/.trientes-migration/security/critical-high-full.jsonl
jq -r '.vulnerabilities | to_entries[] | select(.value.severity == "critical" or .value.severity == "high") | {name: .key, severity: .value.severity, isDirect: .value.isDirect, via: .value.via, fixAvailable: .value.fixAvailable}' /Users/dmitry/.trientes-migration/security/npm-audit-production.json > /Users/dmitry/.trientes-migration/security/critical-high-production.jsonl
chmod 600 /Users/dmitry/.trientes-migration/security/critical-high-*.jsonl
echo "OK: Task 1 Step 3"
```

После merge security branch и повторного audit создать `/Users/dmitry/.trientes-migration/security/audit-triage-${RELEASE_SHA}.md` с явными `RELEASE_SHA`, `TARGET_BUILD_ID`, датой audit и результатом `go/no-go`. Для каждой записи из обоих JSONL указать: prod/dev, direct/transitive, runtime reachability, advisory/link, available fix и решение `fix separately / written risk acceptance`. Отдельно перечислить остаточные dev-only high findings и обосновать их отсутствие в production dependency graph; старый triage не переиспользовать. Не выдавать количество findings за эксплуатируемость. Эксплуатируемая production-critical уязвимость — блокер cutover; остальные требуют письменного risk acceptance. Без нового release-specific triage и явного `go` cutover не начинать. Файл защитить `chmod 600`.

### Task 2: Запечатать проверенный build artifact и проверить восстановление

**Files:**
- Create protected archive: `/home/dv/migration-stage0/release-${RELEASE_SHA}.next.tar` (`.next` + `.generated/maplibre`) и SHA-256
- Create protected per-file manifest: `/home/dv/migration-stage0/release-${RELEASE_SHA}.artifact-manifest.txt`
- Create protected restore backup: `/home/dv/migration-stage0/artifact-before-restore-test/`

- [ ] **Step 1: Создать архив именно проверенных `.next` и `.generated/maplibre`**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из проверенного target build}"
ssh -o BatchMode=yes "dv@$NEW_IP" "RELEASE_SHA='$RELEASE_SHA' TARGET_BUILD_ID='$TARGET_BUILD_ID' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
# Работающий web переписывает ISR-страницы и .next/cache: печатать только остановленный.
pm2 stop trientes-web > /dev/null
test "$(cat .next/BUILD_ID)" = "$TARGET_BUILD_ID"
maplibre_version=$(node -p "require('./node_modules/maplibre-gl/package.json').version")
map_dir=".generated/maplibre/$maplibre_version"
for asset in maplibre-gl-worker.mjs maplibre-gl-shared.mjs; do
  cmp "node_modules/maplibre-gl/dist/$asset" "$map_dir/$asset"
done
test -z "$(find .generated/maplibre -name '*.map' -print -quit)"
test -z "$(find .generated/maplibre -name '.*.tmp' -print -quit)"
test ! -e public/maplibre
dirs=$(find .generated/maplibre -mindepth 1 -maxdepth 1 -type d | wc -l)
test "$dirs" -ge 1 && test "$dirs" -le 2
node -e '
const fs = require("fs"), p = require("path");
const nft = ".next/server/app/maplibre/[...path]/route.js.nft.json";
const files = JSON.parse(fs.readFileSync(nft, "utf8")).files
  .map((f) => p.relative(process.cwd(), p.resolve(p.dirname(nft), f)));
const leaked = files.filter((f) => f.startsWith("src/") || f === "package.json");
if (leaked.length) { console.error("route trace widened:", leaked.slice(0, 5)); process.exit(1); }
'
install -d -m 700 /home/dv/migration-stage0
archive="/home/dv/migration-stage0/release-$RELEASE_SHA.next.tar"
manifest="/home/dv/migration-stage0/release-$RELEASE_SHA.artifact-manifest.txt"
test ! -e "$archive"
test ! -e "$manifest"
tar -C /home/dv/trientes -cf "$archive" .next .generated/maplibre
find .next .generated/maplibre -type f -print0 | sort -z | xargs -0 sha256sum > "$manifest"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive" "$archive.sha256" "$manifest"
printf 'Sealed BUILD_ID %s with MapLibre %s (%s version dirs)\n' "$TARGET_BUILD_ID" "$maplibre_version" "$dirs"
REMOTE
echo "OK: Task 2 Step 1"
```

Expected: web на target остановлен до печати и остаётся остановленным до Step 2 (DNS указывает на Aeza, production-трафика на target нет), поэтому `.next` (включая ISR и `.next/cache`) не меняется между tar, manifest и restore test; BUILD_ID совпадает; versioned runtime assets (`worker`/`shared`) побайтово совпадают с установленным MapLibre distribution; source maps и осиротевшие temp-файлы в production artifact отсутствуют (`prebuild` запускает copy с `MAPLIBRE_INCLUDE_SOURCE_MAPS=0` и prune, который удаляет stale `.map` во всех сохранённых версиях; между `npm run build` и этим шагом в `~/trientes` не запускать `npm test`/`npm run dev` — они кладут `.map`); legacy `public/maplibre` отсутствует; trace route `/maplibre/[...path]` не расширился на `src/` и корневой `package.json` (сужение из `432e2fe`); в `.generated/maplibre` текущая и максимум одна предыдущая версия (на чистом target — ровно одна). Архив содержит `.next` и весь `.generated/maplibre`, manifest — SHA-256 каждого файла обоих trees. Archive SHA-256 и MapLibre version сохранены в `merged-release-evidence.md`.

- [ ] **Step 2: Проверить восстановление BUILD_ID, manifest, MapLibre HTTP и Cache-Control**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?назначить после merge security branch}"
: "${TARGET_BUILD_ID:?назначить из проверенного target build}"
ssh -o BatchMode=yes "dv@$NEW_IP" "RELEASE_SHA='$RELEASE_SHA' TARGET_BUILD_ID='$TARGET_BUILD_ID' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
maplibre_version=$(node -p "require('./node_modules/maplibre-gl/package.json').version")
archive="/home/dv/migration-stage0/release-$RELEASE_SHA.next.tar"
manifest="/home/dv/migration-stage0/release-$RELEASE_SHA.artifact-manifest.txt"
backup=/home/dv/migration-stage0/artifact-before-restore-test
test ! -e "$backup"
# Остановлен в Step 1; если web успел стартовать, .next мог измениться — повторить Step 1.
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const web=JSON.parse(s).find(x=>x.name==="trientes-web");if(!web||web.pm2_env.status!=="stopped"){console.error("trientes-web is not stopped since Step 1");process.exit(1)}})'
mkdir -m 700 -p "$backup"
mv .next "$backup/.next"
mv .generated/maplibre "$backup/maplibre"
tar -C /home/dv/trientes -xf "$archive"
test "$(cat .next/BUILD_ID)" = "$TARGET_BUILD_ID"
sha256sum --quiet -c "$manifest"
diff -qr "$backup/.next" .next
diff -qr "$backup/maplibre" .generated/maplibre
read -r out_log err_log < <(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).find(x=>x.name==="trientes-web").pm2_env;console.log(e.pm_out_log_path,e.pm_err_log_path)})')
out_off=$(stat -c %s "$out_log" 2>/dev/null || echo 0) err_off=$(stat -c %s "$err_log" 2>/dev/null || echo 0)
pm2 start ecosystem.config.js --only trientes-web
pm2 save
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/health
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/en)" = 200
IMMUTABLE='public, max-age=31536000, immutable'
check() {
  expected_status=$1 expected_cache=$2 url_path=$3
  headers=$(curl -sS --max-time 10 -A 'trientes-cutover-check' -o /dev/null -D - "http://127.0.0.1:3000/$url_path" | tr -d '\r') || true
  hdr() { printf '%s\n' "$headers" | awk -v h="$1:" 'tolower($1)==h {sub(/^[^:]*: */, ""); print}' | paste -sd, -; }
  http_status=$(printf '%s\n' "$headers" | awk 'NR==1 {print $2}')
  cache=$(hdr cache-control) ctype=$(hdr content-type) nosniff=$(hdr x-content-type-options)
  printf '%s [%s] [%s] /%s\n' "$http_status" "$cache" "$ctype" "$url_path"
  problem=
  test "$http_status" = "$expected_status" || problem=status
  test "$cache" = "$expected_cache" || problem="${problem:+$problem,}cache-control"
  test "$nosniff" = nosniff || problem="${problem:+$problem,}nosniff"
  if [ "$expected_status" = 200 ]; then case "$ctype" in text/javascript*) ;; *) problem="${problem:+$problem,}content-type" ;; esac; fi
  if [ -n "$problem" ]; then printf 'FAIL /%s: %s\n%s\n' "$url_path" "$problem" "$headers" >&2; return 1; fi
}
check 200 "$IMMUTABLE" "maplibre/$maplibre_version/maplibre-gl-worker.mjs"
check 200 "$IMMUTABLE" "maplibre/$maplibre_version/maplibre-gl-shared.mjs"
check 404 no-store "maplibre/$maplibre_version/maplibre-gl-worker.mjs.map"
check 404 no-store maplibre/maplibre-gl-worker.mjs
check 404 no-store maplibre/maplibre-gl-shared.mjs
check 404 no-store maplibre/0.0.0/maplibre-gl-worker.mjs
# Стартовая проверка ассетов пишет в лог через ~6 с после старта.
sleep 7
if { tail -c +"$((out_off + 1))" "$out_log"; tail -c +"$((err_off + 1))" "$err_log"; } 2>/dev/null | grep -F '[maplibre-assets]'; then echo 'FAIL maplibre asset errors in web log since restart' >&2; exit 1; fi
REMOTE
echo "OK: Task 2 Step 2"
```

Expected: web был остановлен со Step 1 (иначе блок падает до восстановления — повторить Step 1); восстановленные `.next` и `.generated/maplibre` побайтово совпадают с backup и manifest, BUILD_ID совпадает, health и `/en` 200; versioned `worker`/`shared` — HTTP 200 с Cache-Control ровно `public, max-age=31536000, immutable` (сравнение точное: лишняя или повторённая директива, например от nginx, — FAIL), `content-type: text/javascript` (module worker без JS MIME не загрузится) и `nosniff`; source map, root URL без версии (worker и shared) и несуществующая версия — 404 с Cache-Control ровно `no-store` и `nosniff` (404 никогда не кешируется как immutable); в логе web нет стартовой/runtime ошибки MapLibre-ассетов (только строки, дописанные после этого `pm2 start` — старые ошибки rehearsal не дают ложный FAIL; префикс `[maplibre-assets]`: стартовая проверка `src/instrumentation.ts` пишет `DEPLOYMENT ERROR: missing …` через ~6 с после старта без запросов, route — `deployment error: … is missing` один раз на путь и любые не-ENOENT ошибки чтения); worker/bot не запущены. Любая разница — блокер; не запускать cutover с другим artifact. При падении `check` печатает URL, список несовпадений и все заголовки.

### Task 3: Проверить readiness внешних зависимостей и final acceptance plan

**Files:**
- Create protected evidence: `/Users/dmitry/.trientes-migration/cutover-dependency-checks.md`

- [ ] **Step 1: Проверить фактические startup HTTP dependencies без запуска worker**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx tsx -e '"'"'import { fetchMarkets } from "./src/lib/markets"; const rows = await fetchMarkets(); if (rows.length === 0) throw new Error("CNBC markets empty"); console.log(`CNBC quotes: ${rows.length}`)'"'"''
ssh -o BatchMode=yes "dv@$NEW_IP" 'curl -fsS https://api.coingecko.com/api/v3/ping >/dev/null && curl -fsS https://api.coinpaprika.com/v1/global >/dev/null && curl -fsS https://api.alternative.me/fng/?limit=1 >/dev/null && curl -fsS https://cointelegraph.com/rss >/dev/null && curl -fsS https://www.coindesk.com/arc/outboundfeeds/rss/ >/dev/null && printf "Startup HTTP dependencies passed\n"'
echo "OK: Task 3 Step 1"
```

Expected: CNBC quotes непустой, остальные endpoints HTTP 200. Любая ошибка — блокер до отдельной диагностики; не запускать worker для маскировки.

- [ ] **Step 2: Проверить Binance WebSocket без торговли**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node --input-type=module -e '"'"'import WebSocket from "ws"; const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade"); const timeout = setTimeout(() => { console.error("WS timeout"); ws.terminate(); process.exit(1); }, 15000); ws.once("open", () => { console.log("Binance WS open"); }); ws.once("message", () => { clearTimeout(timeout); console.log("Binance WS message received"); ws.close(); }); ws.once("close", () => process.exit(0)); ws.once("error", (e) => { clearTimeout(timeout); console.error("WS error", e.message); process.exit(1); });'"'"''
echo "OK: Task 3 Step 2"
```

Expected: `Binance WS open` и одно message получены, затем clean close. Не отправлять ордера и не запускать worker.

- [ ] **Step 3: Записать dependency evidence и go/no-go checklist**

В `/Users/dmitry/.trientes-migration/cutover-dependency-checks.md` через Write зафиксировать release/artifact SHA, все HTTP checks, Binance open/message и требование финального single-writer запуска. Добавить: origin/main содержит `RELEASE_SHA` без новых изменений в коде, Aeza всё ещё на `ROLLBACK_SHA`/`ROLLBACK_BUILD_ID`, A/MX не менялись, old web/worker online, old bot stopped, активных Claude processes нет, target web-only.

### Task 4: Остановить writers и сделать финальные snapshots

**Files:**
- Create final dumps/RDB/manifests в protected staging на source/target

- [ ] **Step 1: Восстановить backup script и crontab до финального snapshot**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/pg-backup.sh 'dv@$NEW_IP:/home/dv/pg-backup.sh'"
ssh -o BatchMode=yes "dv@$NEW_IP" 'chmod 700 /home/dv/pg-backup.sh && test -x /home/dv/pg-backup.sh && ! crontab -l | grep -q .'
ssh -o BatchMode=yes "dv@$OLD_IP" 'crontab -l' | ssh -o BatchMode=yes "dv@$NEW_IP" 'crontab -'
ssh -o BatchMode=yes "dv@$NEW_IP" 'crontab -l' | grep -Fx '0 3 * * * /home/dv/pg-backup.sh >> /home/dv/logs/pg-backup.log 2>&1'
echo "OK: Task 4 Step 1"
```

Expected: `/home/dv/pg-backup.sh` присутствует и executable, crontab содержит `0 3 * * * /home/dv/pg-backup.sh >> /home/dv/logs/pg-backup.log 2>&1`. Остальные source jobs не добавляются автоматически.

- [ ] **Step 2: Заморозить deploys и остановить writers на Aeza**

До остановки writers снять существующую database session отдельного тестового аккаунта (не реального пользователя) на Aeza. Она попадёт в финальный dump и в Task 6 доказывает, что перенесённые сессии работают на target.

Пароль не проходит через агента, argv (`jq --arg`, `curl -d '...'` видны в `ps`) и `read` (агент его не наберёт). До окна владелец сам создаёт в своём терминале файл с телом запроса `{"identifier":"…","password":"…","locale":"en"}` с правами `0600`, например `(umask 077 && vi /Users/dmitry/.trientes-migration/cutover-login.json)`. Файл не выводится и не читается в чат; агент проверяет только права и наличие полей.

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
LOGIN_BODY=/Users/dmitry/.trientes-migration/cutover-login.json
COOKIE_JAR=/Users/dmitry/.trientes-migration/cutover-auth-cookie.txt
test "$(stat -f %Lp "$LOGIN_BODY")" = 600
jq -e 'has("identifier") and has("password")' "$LOGIN_BODY" > /dev/null
(umask 077 && : > "$COOKIE_JAR")
curl -fsS --resolve "trientes.org:443:$OLD_IP" -c "$COOKIE_JAR" -H 'content-type: application/json' --data-binary @"$LOGIN_BODY" https://trientes.org/api/auth/password/login > /dev/null
chmod 600 "$COOKIE_JAR"
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$OLD_IP" -b "$COOKIE_JAR" https://trientes.org/en/cabinet)" = 200
echo "OK: Task 4 Step 2 (session)"
```

Expected: login body и cookie jar `0600`, cabinet на Aeza 200 с этой session. Ни пароль, ни cookie не выводятся и не попадают в чат и логи. После acceptance сессия отзывается, а оба файла удаляются (Task 8 Step 4).

Затем остановить writers:

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
test -z "$(pgrep -x claude || true)"
pm2 stop trientes-web trientes-worker trientes-bot > /dev/null
sudo systemctl disable pm2-dv
pm2 status
online=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$online" || { echo "FAIL: not stopped: $online" >&2; exit 1; }
test -z "$(pgrep -x claude || true)"
REMOTE
echo "OK: Task 4 Step 2 (writers)"
```

Expected: все три приложения зарегистрированы и stopped (bot был остановлен заранее; `pm2 stop` уже остановленного процесса не ошибка, а незарегистрированного — ошибка, и это сигнал разобраться), ни одного процесса PM2 в статусе, отличном от stopped, активных Claude processes нет, `pm2-dv` disabled и не вернёт writers после reboot. Не останавливать Aeza целиком и не менять DNS. Если worker не завершает in-flight jobs, остановить окно и разобрать их; не делать dump во время активной записи.

- [ ] **Step 3: Создать финальный PostgreSQL dump и проверить SHA**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; test ! -e /home/dv/migration-stage0/trientes-cutover-final.dump; pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file=/home/dv/migration-stage0/trientes-cutover-final.dump; chmod 600 /home/dv/migration-stage0/trientes-cutover-final.dump; sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump'
ssh -o BatchMode=yes "dv@$OLD_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/migration-stage0/trientes-cutover-final.dump 'dv@$NEW_IP:/home/dv/migration-stage0/trientes-cutover-final.dump'"
SOURCE_SHA=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump | cut -d' ' -f1")
TARGET_SHA=$(ssh -o BatchMode=yes "dv@$NEW_IP" "sha256sum /home/dv/migration-stage0/trientes-cutover-final.dump | cut -d' ' -f1")
printf '%s' "$SOURCE_SHA" | grep -Eq '^[0-9a-f]{64}$'
test "$SOURCE_SHA" = "$TARGET_SHA"
echo "OK: Task 4 Step 3"
```

Expected: финальный dump после write freeze, SHA совпадает. Не использовать rehearsal dump как финальный.

- [ ] **Step 4: Создать согласованный Redis RDB**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'set -e; redis-cli SAVE; redis-cli CONFIG GET dir dbfilename; redis-cli DBSIZE; redis-cli INFO Stats | grep -E "expired_keys|evicted_keys"; sudo systemctl stop redis-server'
ssh -o BatchMode=yes "dv@$OLD_IP" "sudo rsync -a -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes' /var/lib/redis/dump.rdb 'root@$NEW_IP:/root/migration-stage0/cutover-final-dump.rdb'"
SOURCE_RDB=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sudo sha256sum /var/lib/redis/dump.rdb | cut -d' ' -f1")
TARGET_RDB=$(ssh -o BatchMode=yes "root@$NEW_IP" "sha256sum /root/migration-stage0/cutover-final-dump.rdb | cut -d' ' -f1")
printf '%s' "$SOURCE_RDB" | grep -Eq '^[0-9a-f]{64}$'
test "$SOURCE_RDB" = "$TARGET_RDB"
echo "OK: Task 4 Step 4"
```

Expected: SAVE после остановки приложений, RDB path подтверждён (`/var/lib/redis`, `dump.rdb`), старый Redis остановлен и больше не меняет файл, SHA-256 RDB на Aeza и target совпадают.

- [ ] **Step 5: Выполнить itemized dry-run live-state delta**

```bash
set -euo pipefail
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
wc -l /home/dv/migration-stage0/delta-review/*.itemize
REMOTE
echo "OK: Task 4 Step 5"
```

Expected: список изменений сохранён и проверен без секретов/PII. Не применять `--delete` до защищённой копии target и ручного review.

- [ ] **Step 6: Сохранить target backup и применить проверенную delta**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'set -e; test ! -e /home/dv/migration-stage0/target-before-delta; install -d -m 700 /home/dv/migration-stage0/target-before-delta; rsync -a /home/dv/.claude/ /home/dv/migration-stage0/target-before-delta/.claude/'
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
echo "OK: Task 4 Step 6"
```

Expected: применяются только проверенные изменения; `--delete` используется только для `.claude` после backup. Повторно применить protected dirs 0700, non-exec 0600, executables 0700 и проверить symlinks/owners.

### Task 5: Восстановить и проверить target data

**Files:**
- Recreate target DB только после сохранения rehearsal dump
- Restore final RDB

- [ ] **Step 1: Пересоздать пустую target DB и восстановить финальный dump**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /tmp
test -s /home/dv/migration-stage0/trientes-cutover-final.dump
# Каталог postgres 0700: проверять от root, иначе test -s всегда ложен.
sudo test -s /var/lib/postgresql/migration/trientes-rehearsal.dump
pm2 stop trientes-web > /dev/null
read -r collate ctype < <(sudo -u postgres psql -Atc "SELECT datcollate || ' ' || datctype FROM pg_database WHERE datname = 'trientes'")
test -n "$collate" && test -n "$ctype"
# --force (PostgreSQL 13+) сам завершает оставшиеся подключения.
sudo -u postgres dropdb --force trientes
sudo -u postgres createdb --owner=trientes --encoding=UTF8 --lc-collate="$collate" --lc-ctype="$ctype" --template=template0 trientes
sudo install -m 600 -o postgres -g postgres /home/dv/migration-stage0/trientes-cutover-final.dump /var/lib/postgresql/migration/trientes-cutover-final.dump
sudo -u postgres pg_restore --exit-on-error --dbname=trientes /var/lib/postgresql/migration/trientes-cutover-final.dump
printf 'restored trientes (%s/%s)\n' "$collate" "$ctype"
REMOTE
echo "OK: Task 5 Step 1"
```

Expected: target web остановлен, rehearsal dump сохранён, DB пересоздана пустой с прежними collation/ctype (совпадение с Aeza проверяет Step 2) и restore rc0. Имя БД в SQL — строковый литерал `'trientes'` внутри heredoc, без экранирования через ssh (`"trientes"` в SQL — идентификатор, запрос упал бы). Не выполнять dropdb на Aeza.

- [ ] **Step 2: Сравнить counts, timestamps, sequences, migrations и hashes статических таблиц**

SQL идёт файлом через stdin, а не через `-c '…'` внутри ssh-строки: литерал `'|'` в `string_agg` разорвал бы кавычки удалённого shell. Сессионные настройки фиксируют формат вывода, чтобы `t::text` и timestamps не зависели от `TimeZone`/`DateStyle` серверов; `COLLATE "C"` делает порядок строк независимым от locale.

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
SQL=/Users/dmitry/.trientes-migration/run/task5-compare.sql
cat > "$SQL" <<'EOF'
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, MDY';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';
SELECT 'db', pg_encoding_to_char(encoding), datcollate, datctype FROM pg_database WHERE datname = current_database();
SELECT 'snapshots', COUNT(*), MAX("fetchedAt") FROM "CoinSnapshot";
SELECT 'users', COUNT(*) FROM "User";
SELECT 'sessions', COUNT(*) FROM "Session";
SELECT 'accounts', COUNT(*) FROM "Account";
SELECT 'coins', COUNT(*) FROM "Coin";
SELECT 'exchanges', COUNT(*) FROM "Exchange";
SELECT 'migrations', COUNT(*), MAX(finished_at) FROM "_prisma_migrations";
SELECT 'seq', schemaname, sequencename, last_value FROM pg_sequences ORDER BY schemaname, sequencename;
SELECT 'md5 User', md5(string_agg(t::text, '|' ORDER BY t.id COLLATE "C")) FROM "User" t;
SELECT 'md5 Account', md5(string_agg(t::text, '|' ORDER BY t.id COLLATE "C")) FROM "Account" t;
SELECT 'md5 Coin', md5(string_agg(t::text, '|' ORDER BY t.id COLLATE "C")) FROM "Coin" t;
SELECT 'md5 Exchange', md5(string_agg(t::text, '|' ORDER BY t.id COLLATE "C")) FROM "Exchange" t;
EOF
PSQL='psql -X -q -At -v ON_ERROR_STOP=1 --host=127.0.0.1 --username=trientes --dbname=trientes -f -'
OLD_OUT=$(ssh -o BatchMode=yes "dv@$OLD_IP" "$PSQL" < "$SQL")
NEW_OUT=$(ssh -o BatchMode=yes "dv@$NEW_IP" "$PSQL" < "$SQL")
test -n "$OLD_OUT"
diff <(printf '%s\n' "$OLD_OUT") <(printf '%s\n' "$NEW_OUT")
printf '%s\n' "$NEW_OUT" | grep -v '^md5'
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx prisma migrate status'
echo "OK: Task 5 Step 2"
```

Expected: вывод Aeza и target совпадает построчно (`diff` пуст): encoding/collation/ctype, counts, `MAX("fetchedAt")`, число и последняя применённая migration, `last_value` каждой sequence (`pg_sequences`; в `information_schema.sequences` этого столбца нет) и md5 статических таблиц. Печатаются только агрегаты, без строк таблиц. `prisma migrate status` — `Database schema is up to date`. Любое расхождение — abort до A change.

- [ ] **Step 3: Восстановить Redis RDB и проверить keys/TTL/expiry/eviction**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
test "$(redis-cli CONFIG GET dir | sed -n 2p)" = /var/lib/redis
test "$(redis-cli CONFIG GET dbfilename | sed -n 2p)" = dump.rdb
systemctl stop redis-server
install -m 600 -o redis -g redis /root/migration-stage0/cutover-final-dump.rdb /var/lib/redis/dump.rdb
systemctl start redis-server
for _ in $(seq 1 30); do test "$(redis-cli PING 2>/dev/null)" = PONG && break; sleep 1; done
test "$(redis-cli PING)" = PONG
# INFO отдаёт строки с \r\n.
redis-cli INFO Persistence | tr -d '\r' | grep -qx 'loading:0'
redis-cli DBSIZE
redis-cli INFO Stats | grep -E "expired_keys|evicted_keys"
redis-cli --scan --pattern "claude:session:*" | wc -l
REMOTE
echo "OK: Task 5 Step 3"
```

Expected: PONG, DBSIZE соответствует финальному RDB на момент SAVE с учётом задокументированных TTL expirations; `evicted_keys=0`; Telegram session keys/TTL присутствуют, нет load errors.

### Task 6: Запустить single-writer стек и проверить worker/bot

**Files:**
- Create protected startup evidence: `/Users/dmitry/.trientes-migration/cutover-startup-evidence.md`

- [ ] **Step 1: Запустить только web и проверить pre-DNS HTTPS**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/trientes
npx prisma migrate status
pm2 start ecosystem.config.js --only trientes-web
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/health
test "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/en)" = 200
REMOTE
curl -fsS --resolve "trientes.org:443:$NEW_IP" https://trientes.org/api/health
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" https://trientes.org/en)" = 200
echo "OK: Task 6 Step 1"
```

Expected: health и `/en` 200, DB/Redis ok, cold-cache не вызывает рост память/реstarts. Это abort checkpoint: при ошибке A не менять и вернуть старый стек.

- [ ] **Step 2: Проверить реальные uploads и защиту KYB до изменения A**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
urlpath() { python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$1"; }
PUBLIC_UPLOAD=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'find /var/www/trientes-uploads/coin-cards -type f -name "*.png" | head -n 1')
test -n "$PUBLIC_UPLOAD"
REL_PATH=${PUBLIC_UPLOAD#/var/www/trientes-uploads/}
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' --resolve "trientes.org:443:$NEW_IP" "https://trientes.org/uploads/$(urlpath "$REL_PATH")" | grep -qx '200 image/png'
KYB_FILE=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'find /home/dv/trientes/public/uploads/kyb -type f ! -name .gitkeep | head -n 1')
if [ -n "$KYB_FILE" ]; then
  KYB_REL=${KYB_FILE#/home/dv/trientes/public/}
  KYB_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" "https://trientes.org/$(urlpath "$KYB_REL")")
  case "$KYB_STATUS" in 403|404) ;; *) echo "KYB exposed: $KYB_STATUS"; exit 1 ;; esac
fi
unset PUBLIC_UPLOAD REL_PATH KYB_FILE KYB_REL
echo "OK: Task 6 Step 2"
```

Expected: существующий coin-card PNG отдаётся как `200 image/png` по `/uploads/coin-cards/...` (путь `REL_PATH` уже содержит `coin-cards/`); реальный KYB-документ (не `.gitkeep`), если есть, — 403/404. На 2026-11-08 реальных KYB-документов нет; KYB upload пишет в `public/uploads/kyb`, который Next.js раздаёт без авторизации, — это отдельный pre-existing finding `security/kyb-public-storage-finding.md`, а появление документа с HTTP 200 — блокер или письменный risk acceptance. Имена файлов не выводятся. Если upload отсутствует на target или KYB доступен, A-записи не менять. Это обязательный pre-DNS upload gate.

- [ ] **Step 3: Проверить перенесённую session, fresh login/logout и OAuth redirects до изменения A**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
LOGIN_BODY=/Users/dmitry/.trientes-migration/cutover-login.json
COOKIE_JAR=/Users/dmitry/.trientes-migration/cutover-auth-cookie.txt
test "$(stat -f %Lp "$LOGIN_BODY")" = 600
test "$(stat -f %Lp "$COOKIE_JAR")" = 600
csrf_token() { curl -fsS --resolve "trientes.org:443:$NEW_IP" -b "$1" -c "$1" https://trientes.org/api/auth/csrf | jq -er '.csrfToken | select(type == "string" and length > 0)'; }
cabinet_status() { curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" "$@" https://trientes.org/en/cabinet; }
test "$(cabinet_status -b "$COOKIE_JAR")" = 200
test "$(cabinet_status)" != 200

FRESH_JAR=$(mktemp); chmod 600 "$FRESH_JAR"
curl -fsS --resolve "trientes.org:443:$NEW_IP" -c "$FRESH_JAR" -H 'content-type: application/json' --data-binary @"$LOGIN_BODY" https://trientes.org/api/auth/password/login > /dev/null
test "$(cabinet_status -b "$FRESH_JAR")" = 200
CSRF=$(csrf_token "$FRESH_JAR")
curl -sS -o /dev/null --resolve "trientes.org:443:$NEW_IP" -b "$FRESH_JAR" -c "$FRESH_JAR" --data-urlencode "csrfToken=$CSRF" https://trientes.org/api/auth/signout
test "$(cabinet_status -b "$FRESH_JAR")" != 200
rm -f "$FRESH_JAR"

for provider in google github; do
  OAUTH_JAR=$(mktemp); chmod 600 "$OAUTH_JAR"
  CSRF=$(csrf_token "$OAUTH_JAR")
  LOCATION=$(curl -sS -o /dev/null -w '%{redirect_url}' --resolve "trientes.org:443:$NEW_IP" -b "$OAUTH_JAR" -c "$OAUTH_JAR" \
    --data-urlencode "csrfToken=$CSRF" --data-urlencode "callbackUrl=https://trientes.org/en/cabinet" "https://trientes.org/api/auth/signin/$provider")
  python3 - "$provider" "$LOCATION" <<'PY'
import sys, urllib.parse
provider, location = sys.argv[1], sys.argv[2]
url = urllib.parse.urlparse(location)
query = urllib.parse.parse_qs(url.query)
assert url.hostname == {"google": "accounts.google.com", "github": "github.com"}[provider], provider
assert query.get("redirect_uri") == [f"https://trientes.org/api/auth/callback/{provider}"], provider
assert query.get("code_challenge") or query.get("state"), provider
print(provider, "redirect ok")
PY
  rm -f "$OAUTH_JAR"
done
unset CSRF LOCATION
echo "OK: Task 6 Step 3"
```

Expected: перенесённая из dump session открывает cabinet (200), без cookie — redirect на login; fresh password login из того же `cutover-login.json` (`curl --data-binary @file`, пароль не попадает в argv, переменные и чат) создаёт database session, signout её удаляет; CSRF token непустой (иначе `jq -e` роняет блок); Google/GitHub signin ведут на провайдера с `redirect_uri=https://trientes.org/api/auth/callback/<provider>` и PKCE/state. Полный OAuth callback требует интерактивного входа пользователя и проверяется в Task 8; in-progress OAuth flow со старыми pre-upgrade check-cookies может закончиться ожидаемым `InvalidCheck` — повторный вход должен пройти. При любой ошибке auth A-записи не менять и вернуть старый стек; это обязательный pre-DNS gate.

- [ ] **Step 4: Запустить worker один раз и проверить startup jobs**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/trientes
pm2 start ecosystem.config.js --only trientes-worker
sleep 30
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);if(!p||p.pm2_env.status!=="online"||p.pm2_env.restart_time!==0){console.error(process.argv[1]+" not stably online");process.exit(1)}})' trientes-worker
(umask 077 && pm2 logs trientes-worker --lines 100 --nostream > /home/dv/migration-stage0/worker-startup.log)
pm2 describe trientes-worker
redis-cli DBSIZE
REMOTE
echo "OK: Task 6 Step 4"
```

Expected: worker online без рестартов за 30 с (`restart_time=0`), startup jobs начали заполнять caches, Binance WS/reconnect не зацикливается, нет повторяющихся 429/5xx/parser errors. Старый worker остаётся stopped. Не отправлять тестовые уведомления реальным пользователям.

- [ ] **Step 5: Перезапустить bot и проверить webhook/voice/native fetch без искусственных updates**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
# Старый bot на Aeza остановлен с Task 4 Step 2: двух bot одновременно нет.
test -z "$(ssh -o BatchMode=yes "dv@$OLD_IP" 'pm2 jlist' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status==="online").map(p=>p.name).join(" ")))')"
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/trientes
pm2 start ecosystem.config.js --only trientes-bot --update-env
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:4100/health 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4100/health
pm2 save
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node -e '"'"'require("dotenv").config({ quiet: true }); (async()=>{const base="https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN; const [me,hook]=await Promise.all([fetch(base+"/getMe").then(r=>r.json()),fetch(base+"/getWebhookInfo").then(r=>r.json())]); const url=hook.result?.url; const origin=url?new URL(url).origin:null; console.log(JSON.stringify({getMe:me.ok,webhook:hook.ok,origin,pending:hook.result?.pending_update_count,last_error_date:hook.result?.last_error_date})); if(!me.ok||!hook.ok||origin!=="https://trientes.org")process.exit(1)})().catch(()=>process.exit(1))'"'"''
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
check=$(mktemp -d /tmp/voice-check.XXXXXX)
rmdir "$check"
trap 'cd /; rm -f "$check/node_modules"; git -C /home/dv/trientes worktree remove --force "$check" 2>/dev/null || rm -rf "$check"' EXIT
git -C /home/dv/trientes worktree add --detach "$check" HEAD >/dev/null
ln -s /home/dv/trientes/node_modules "$check/node_modules"
cd "$check"
npx vitest run bot/__tests__/voice.openai-http.test.ts bot/__tests__/voice.test.ts
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /home/dv/trientes
test -z "$(find .generated/maplibre -name '*.map' -print -quit)"
grep '  \.generated/maplibre/' "/home/dv/migration-stage0/release-$(git rev-parse HEAD).artifact-manifest.txt" | sha256sum --quiet -c -
test "$(git worktree list | wc -l)" -eq 1
echo "artifact maplibre intact, temp worktree removed"
REMOTE
echo "OK: Task 6 Step 5"
```

Expected: на Aeza ничего не online; bot health ok; native `fetch` возвращает `getMe.ok=true`; webhook origin остаётся `https://trientes.org`. `setWebhook` не выполняется. До переключения A ненулевые `pending` и свежий `last_error_date` ожидаемы: DNS ещё ведёт на Aeza, где bot остановлен и webhook отвечает 502; Telegram держит updates и доставит их после Task 7. `pending` → 0 и ответ на `/whoami` проверяются в Task 8 Step 1. Voice regression использует реальный OpenAI 6 client через local HTTP `/v1/audio/transcriptions`, без внешней сети, real API key, аудио или PII; результат записать в startup evidence. Тесты идут во временном detached worktree с symlink на production `node_modules` и без `.env`: vitest globalSetup копирует MapLibre с source maps, поэтому его нельзя запускать в живом `~/trientes`. Это бы добавило `.map` в `.generated/maplibre` и сломало sealed artifact. Вторая команда подтверждает три вещи: в production `.generated/maplibre` нет `.map`, его файлы сходятся с artifact manifest, временный worktree удалён (`git worktree list` = 1). `.next` здесь с manifest не сверяется: работающий web может переписать ISR-страницы.

- [ ] **Step 6: Проверить MapLibre и cabinet point form до изменения A**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
IMMUTABLE='public, max-age=31536000, immutable'
MAPLIBRE_VERSION=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node -p "require(\"./node_modules/maplibre-gl/package.json\").version"')
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" 'https://trientes.org/en/crypto-map?coin=bitcoin')" = 200
edge_check() {
  expected_status=$1 expected_cache=$2 url_path=$3
  headers=$(curl -sS --max-time 10 -A 'trientes-cutover-check' -o /dev/null -D - --resolve "trientes.org:443:$NEW_IP" "https://trientes.org/$url_path" | tr -d '\r') || true
  hdr() { printf '%s\n' "$headers" | awk -v h="$1:" 'tolower($1)==h {sub(/^[^:]*: */, ""); print}' | paste -sd, -; }
  http_status=$(printf '%s\n' "$headers" | awk 'NR==1 {print $2}')
  cache=$(hdr cache-control) ctype=$(hdr content-type) nosniff=$(hdr x-content-type-options)
  printf '%s [%s] [%s] /%s\n' "$http_status" "$cache" "$ctype" "$url_path"
  problem=
  test "$http_status" = "$expected_status" || problem=status
  test "$cache" = "$expected_cache" || problem="${problem:+$problem,}cache-control"
  test "$nosniff" = nosniff || problem="${problem:+$problem,}nosniff"
  if [ "$expected_status" = 200 ]; then case "$ctype" in text/javascript*) ;; *) problem="${problem:+$problem,}content-type" ;; esac; fi
  if [ -n "$problem" ]; then printf 'FAIL /%s: %s\n%s\n' "$url_path" "$problem" "$headers" >&2; return 1; fi
}
edge_check 200 "$IMMUTABLE" "maplibre/$MAPLIBRE_VERSION/maplibre-gl-worker.mjs"
edge_check 200 "$IMMUTABLE" "maplibre/$MAPLIBRE_VERSION/maplibre-gl-shared.mjs"
edge_check 404 no-store "maplibre/$MAPLIBRE_VERSION/maplibre-gl-worker.mjs.map"
edge_check 404 no-store maplibre/maplibre-gl-worker.mjs
edge_check 404 no-store maplibre/maplibre-gl-shared.mjs
edge_check 404 no-store maplibre/0.0.0/maplibre-gl-worker.mjs
echo "OK: Task 6 Step 6"
```

Через Playwright (Chromium с `--host-resolver-rules="MAP trientes.org $NEW_IP, MAP www.trientes.org $NEW_IP"`) дополнительно проверить на target: создание MapLibre canvas, загрузку vector tiles (HTTP 200), empty-map click с origin marker, выбор реального POI, видимые статические `© OpenStreetMap contributors` и `© OpenFreeMap`, отсутствие `pageerror` и ошибок worker. С отключённым WebGL2 (init script: `getContext("webgl2")` возвращает `null`) страница показывает локализованное fallback-сообщение вместо карты без `pageerror`. В cabinet под тестовым аккаунтом: клик по карте ставит marker и заполняет координаты, после SHOP→ONLINE→SHOP карта и click работают, сохранение координат тестовой точки проходит.

Expected: публичная карта и cabinet map form работают; через nginx/TLS versioned worker/shared отдают HTTP 200 с Cache-Control ровно `public, max-age=31536000, immutable` (одним заголовком: nginx в `location /` Cache-Control не добавляет, и повтор или лишняя директива — FAIL), `text/javascript` и `nosniff`, source map, root URL без версии (worker и shared) и несуществующая версия — 404 с Cache-Control ровно `no-store` и `nosniff`; WebGL2 fallback корректен, нет 404 ресурсов и `pageerror`. Любая ошибка — блокер до A-записей.

### Task 7: Переключить только A-записи в DigitalOcean

**Files:**
- No MX/SPF/DMARC/DKIM/NS changes
- Create protected DNS evidence: `/Users/dmitry/.trientes-migration/dns-before-cutover.json`, `dns-after-cutover.json`, `dns-switched-at`

- [ ] **Step 1: Зафиксировать rollback DNS и переключить `@`/`www`**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
umask 077
DIR=/Users/dmitry/.trientes-migration
BEFORE=$DIR/dns-before-cutover.json; AFTER=$DIR/dns-after-cutover.json
[ -e "$BEFORE" ] || doctl compute domain records list trientes.org --output json > "$BEFORE"
jq -e --arg old "$OLD_IP" '(map(select(.id == 1837678911 and .type == "A" and .name == "@" and .data == $old)) | length) == 1 and (map(select(.id == 1837678935 and .type == "A" and .name == "www" and .data == $old)) | length) == 1 and (map(select(.type == "AAAA")) | length) == 0' "$BEFORE" > /dev/null
[ -e "$DIR/dns-switched-at" ] || date -u +%s > "$DIR/dns-switched-at"
for id in 1837678911 1837678935; do doctl compute domain records update trientes.org --record-id "$id" --record-data "$NEW_IP" --record-ttl 300 > /dev/null; done
doctl compute domain records list trientes.org --output json > "$AFTER"
python3 - "$BEFORE" "$AFTER" "$NEW_IP" <<'PY'
import json, sys
before = {r["id"]: r for r in json.load(open(sys.argv[1]))}
after = {r["id"]: r for r in json.load(open(sys.argv[2]))}
assert before.keys() == after.keys(), "record set changed"
changed = sorted(i for i in before if before[i] != after[i])
assert changed == [1837678911, 1837678935], changed
for i in changed:
    diff = {k for k in before[i].keys() | after[i].keys() if before[i].get(k) != after[i].get(k)}
    assert diff == {"data"}, (i, diff)
    assert after[i]["data"] == sys.argv[3], i
print("changed only A @/www data")
PY
echo "OK: Task 7 Step 1"
```

Expected: изменены только A `@` и `www` на `159.65.118.122`. MX/SPF/DMARC/DKIM/NS не изменены. Если production AAAA появится, отдельно проверить его перед переключением; сейчас AAAA нет. `dns-before-cutover.json` — снимок зоны до переключения: при повторном запуске он не перезаписывается, и по нему Task 9 возвращает A. `dns-switched-at` (Unix time переключения) читают Task 8 Step 1, Task 9 и Task 10. Блок сравнивает зону до и после: если изменилось что-то, кроме поля `data` двух A-записей, он падает. Такой результат — сигнал разобраться вручную, а не повторять блок.

- [ ] **Step 2: Проверить authoritative и публичные DNS**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
for ns in ns1.digitalocean.com ns2.digitalocean.com ns3.digitalocean.com; do
  for name in trientes.org www.trientes.org; do
    ok= a= aaaa=
    for _ in $(seq 1 30); do
      a=$(dig +short "@$ns" "$name" A 2>/dev/null | paste -sd' ' - || true)
      aaaa=$(dig +short "@$ns" "$name" AAAA 2>/dev/null | paste -sd' ' - || true)
      if [ "$a" = "$NEW_IP" ] && [ -z "$aaaa" ]; then ok=1; break; fi
      sleep 10
    done
    test -n "$ok" || { echo "FAIL: $ns $name A=[$a] AAAA=[$aaaa]" >&2; exit 1; }
    echo "$ns $name A=$a"
  done
done
for resolver in ns1.digitalocean.com 1.1.1.1 8.8.8.8; do
  printf '\nResolver %s\n' "$resolver"
  dig +noall +answer "@$resolver" trientes.org A
  dig +noall +answer "@$resolver" www.trientes.org A
  dig +noall +answer "@$resolver" trientes.org MX
done
echo "OK: Task 7 Step 2"
```

Expected: authoritative DO отдают новый IP, MX остаются IONOS. Публичные caches могут временно отдавать Aeza до TTL 300; не ускорять их изменением NS. Все три DO nameserver отдают для apex и `www` ровно `NEW_IP` и пустой AAAA. На каждый сервер блок ждёт до 5 минут. Ответы 1.1.1.1 и 8.8.8.8 только печатаются: шаг от них не зависит.

- [ ] **Step 3: Проверить внешний health и сохранить old runtime stopped**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
for host in trientes.org www.trientes.org; do
  ip=
  for _ in $(seq 1 40); do
    ip=$(curl -sS -o /dev/null -w '%{remote_ip}' "https://$host/api/health" 2>/dev/null || true)
    [ "$ip" = "$NEW_IP" ] && break
    sleep 15
  done
  test "$ip" = "$NEW_IP" || { echo "FAIL: $host на этом ноуте всё ещё ведёт на ${ip:-ничего}" >&2; exit 1; }
done
curl -fsS https://trientes.org/api/health
echo
for host in trientes.org www.trientes.org; do
  got=$(curl -sS -o /dev/null -w '%{http_code} %{remote_ip}' "https://$host/en")
  test "$got" = "200 $NEW_IP" || { echo "FAIL $host/en: $got" >&2; exit 1; }
done
ssh -o BatchMode=yes "dv@$OLD_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
online=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$online" || { echo "FAIL: на Aeza не остановлены: $online" >&2; exit 1; }
if systemctl is-enabled --quiet pm2-dv; then echo 'FAIL: pm2-dv enabled на Aeza' >&2; exit 1; fi
if systemctl is-active --quiet redis-server; then echo 'FAIL: redis-server active на Aeza' >&2; exit 1; fi
echo "Aeza: PM2 apps stopped, pm2-dv disabled, redis-server stopped"
REMOTE
echo "OK: Task 7 Step 3"
```

Expected: после распространения внешние health 200 и `/en` 200; old web/worker/bot остаются stopped и не принимают cached writes. Блок ждёт до 10 минут, пока DNS на этом ноуте не поведёт apex и `www` на `NEW_IP` (`%{remote_ip}`), и только потом проверяет health и `/en`. `www` отвечает 200 сам, без redirect, поэтому `-L` не нужен. На Aeza не должно быть запущенных PM2 apps; `pm2-dv` disabled, `redis-server` stopped. PostgreSQL и nginx на Aeza продолжают работать: PostgreSQL нужен для rollback gate (Task 9), nginx отвечает клиентам со старым DNS cache 502, потому что web остановлен.

### Task 8: Полная acceptance, backups и security

**Files:**
- Create protected acceptance: `/Users/dmitry/.trientes-migration/cutover-acceptance.md`
- Create temporary restore-test DB only for backups
- Create protected Mac tunnel state: `/Users/dmitry/.trientes-migration/mac-tunnel.env`; на Mac `~/trientes-tunnel/` (`aeza.plist`, `do.plist`, `reload.sh`, `reload.log`)
- Modify (через временный worktree на Aeza, push в main): `README.md`, `deploy/nginx/trientes.conf`, `deploy/nginx/trientes-tls.conf`, `deploy/docs/dns-tls.md`

Результаты каждого шага записывать в `cutover-acceptance.md` через Write (файл `chmod 600`). Без секретов, cookie, Telegram ID и имён KYB-файлов.

- [ ] **Step 1: Проверить Telegram webhook и процессы на target**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
SWITCHED_AT=$(cat /Users/dmitry/.trientes-migration/dns-switched-at)
printf '%s' "$SWITCHED_AT" | grep -Eqx '[0-9]{10}'
ssh -o BatchMode=yes "dv@$NEW_IP" "SWITCHED_AT='$SWITCHED_AT' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ps=JSON.parse(s);let bad=0;for(const n of ["trientes-web","trientes-worker","trientes-bot"]){const p=ps.find(x=>x.name===n);const st=p?p.pm2_env.status:"missing";console.log(n+" "+st+(p?" restarts="+p.pm2_env.restart_time:""));if(st!=="online")bad=1;if(n==="trientes-bot"&&p&&p.pm2_env.restart_time!==0)bad=1}process.exit(bad)})'
node - <<'JS'
require("dotenv").config({ quiet: true });
const switchedAt = Number(process.env.SWITCHED_AT);
const base = "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const hook = await fetch(base + "/getWebhookInfo").then((r) => r.json());
    if (!hook.ok) throw new Error("getWebhookInfo failed");
    const info = hook.result;
    const origin = info.url ? new URL(info.url).origin : null;
    const now = Math.floor(Date.now() / 1000);
    const errorAt = info.last_error_date ?? 0;
    // DNS caches keep sending Telegram to Aeza for up to TTL 300 after the switch.
    const fresh = errorAt > switchedAt + 360 && now - errorAt < 300;
    console.log(JSON.stringify({ origin, pending: info.pending_update_count, error_age_s: errorAt ? now - errorAt : null, ...(fresh ? { last_error_message: info.last_error_message } : {}) }));
    if (origin !== "https://trientes.org") throw new Error("webhook origin changed");
    if (info.pending_update_count === 0 && !fresh) return;
    if (Date.now() > deadline) throw new Error("webhook backlog or fresh error after 15 min");
    await sleep(20000);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
JS
REMOTE
echo "OK: Task 8 Step 1"
```

После `OK` владелец отправляет боту `/whoami` и `/status` и подтверждает, что на каждую команду пришёл ровно один ответ.

Expected: все три приложения online. У bot `restart_time=0` с запуска в Task 6 Step 5. Webhook origin остаётся `https://trientes.org` (путь и secret не печатаются). Backlog доставлен (`pending=0`), свежих ошибок нет. Ошибки, которые Telegram получал от Aeza в первые 6 минут после переключения (`dns-switched-at` + 360 с), свежими не считаются: в это время Telegram ещё мог брать из DNS cache старый IP. Блок ждёт до 15 минут. Если backlog не уходит или появляются новые ошибки, разобрать `last_error_message` до продолжения; `setWebhook` не выполнять.

- [ ] **Step 2: Перенастроить Mac tunnel на `NEW_IP` и проверить iOS build**

Mac (`aleksandrswiss`) держит LaunchDaemon `com.poolwatt.tunnel.coinmarketcap`: autossh к `dv@85.192.25.242` с `-R 2222:localhost:22 -R 5900:localhost:5900`. Через этот tunnel `/home/dv/bin/mac-ios` собирает iOS. Переключение идёт в четыре блока: собрать данные о Mac на Aeza, открыть ему target, подменить plist на Mac, проверить сборку. Plist меняет `reload.sh`, который запускается от root отдельно от SSH-сессии. `launchctl bootout` рвёт тот самый tunnel, через который пришла команда, поэтому `kickstart -k` из сессии не годится. Если Mac не подключится к target за ~2 минуты, `reload.sh` сам вернёт прежний plist на Aeza.

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
MAC_FP='SHA256:ANYYye98deDG0HW1sD55PaEx00R7y/wlC49l29lG/Og'
umask 077
RAW=$DIR/mac-tunnel.raw
ssh -o BatchMode=yes "dv@$OLD_IP" "MAC_FP='$MAC_FP' bash -s" > "$RAW" <<'REMOTE'
set -euo pipefail
listener=$(sudo ss -Htlnp '( sport = :2222 )')
pid=$(printf '%s\n' "$listener" | sed -n 's/.*pid=\([0-9]*\),.*/\1/p' | sed -n 1p)
test -n "$pid"
est=$(sudo ss -Htnp state established '( sport = :22 )')
mac_ip=$(printf '%s\n' "$est" | awk -v p="pid=$pid," 'index($0, p) { a = $4; sub(/:[0-9]+$/, "", a); gsub(/^\[::ffff:|\]$/, "", a); print a }' | sort -u)
re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
[[ $mac_ip =~ $re ]] || { echo "FAIL: IP Mac не найден по процессу tunnel" >&2; exit 1; }
tmpk=$(mktemp); trap 'rm -f "$tmpk"' EXIT
key_line= n=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  printf '%s\n' "$line" > "$tmpk"
  if [ "$(ssh-keygen -lf "$tmpk" < /dev/null | awk '{print $2}')" = "$MAC_FP" ]; then key_line=$line; n=$((n + 1)); fi
done < ~/.ssh/authorized_keys
test "$n" -eq 1 || { echo "FAIL: ключ Mac найден $n раз" >&2; exit 1; }
kh=$(ssh-keygen -F '[localhost]:2222' -f ~/.ssh/known_hosts | grep -v '^#')
test -n "$kh"
printf 'MAC_IP=%s\nMAC_KEY_B64=%s\nKH_B64=%s\n' "$mac_ip" "$(printf '%s\n' "$key_line" | base64 -w0)" "$(printf '%s\n' "$kh" | base64 -w0)"
REMOTE
test "$(wc -l < "$RAW" | tr -d ' ')" = 3
MAC_IP=$(sed -n 's/^MAC_IP=//p' "$RAW")
MAC_KEY_B64=$(sed -n 's/^MAC_KEY_B64=//p' "$RAW")
KH_B64=$(sed -n 's/^KH_B64=//p' "$RAW")
printf '%s' "$MAC_IP" | grep -Eqx '([0-9]{1,3}\.){3}[0-9]{1,3}'
printf '%s' "$MAC_KEY_B64" | grep -Eqx '[A-Za-z0-9+/=]+'
printf '%s' "$KH_B64" | grep -Eqx '[A-Za-z0-9+/=]+'
printf "MAC_IP='%s'\nMAC_KEY_B64='%s'\nKH_B64='%s'\n" "$MAC_IP" "$MAC_KEY_B64" "$KH_B64" > "$DIR/mac-tunnel.env"
rm -f "$RAW"
echo "Mac IP: $MAC_IP"
echo "OK: Task 8 Step 2 (collect)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
source "$DIR/mac-tunnel.env"
MAC_FP='SHA256:ANYYye98deDG0HW1sD55PaEx00R7y/wlC49l29lG/Og'
ssh -o BatchMode=yes "dv@$NEW_IP" "MAC_IP='$MAC_IP' MAC_FP='$MAC_FP' MAC_KEY_B64='$MAC_KEY_B64' KH_B64='$KH_B64' bash -s" <<'REMOTE'
set -euo pipefail
umask 077
tmpk=$(mktemp); trap 'rm -f "$tmpk"' EXIT
key=$(printf '%s' "$MAC_KEY_B64" | base64 -d)
printf '%s\n' "$key" > "$tmpk"
test "$(ssh-keygen -lf "$tmpk" | awk '{print $2}')" = "$MAC_FP"
if ! grep -qxF -- "$key" ~/.ssh/authorized_keys; then printf '%s\n' "$key" >> ~/.ssh/authorized_keys; fi
sudo ufw allow from "$MAC_IP" to any port 22 proto tcp comment 'mac ios tunnel' > /dev/null
ufw_status=$(sudo ufw status)
grep -qF "$MAC_IP" <<< "$ufw_status"
busy=$(sudo ss -Htlnp '( sport = :2222 or sport = :5900 )')
other=$(printf '%s\n' "$busy" | awk 'NF && !/"sshd/')
test -z "$other" || { echo "FAIL: порты 2222/5900 на target заняты не sshd" >&2; exit 1; }
touch ~/.ssh/known_hosts
kh=$(printf '%s' "$KH_B64" | base64 -d)
existing=$(ssh-keygen -F '[localhost]:2222' -f ~/.ssh/known_hosts | grep -v '^#' || true)
extra=$(comm -23 <(printf '%s\n' "$existing" | sed '/^$/d' | sort -u) <(printf '%s\n' "$kh" | sort -u))
test -z "$extra" || { echo "FAIL: в known_hosts target другой ключ для [localhost]:2222" >&2; exit 1; }
while IFS= read -r l; do
  if ! grep -qxF -- "$l" ~/.ssh/known_hosts; then printf '%s\n' "$l" >> ~/.ssh/known_hosts; fi
done <<< "$kh"
ssh-keygen -F '[localhost]:2222' -f ~/.ssh/known_hosts > /dev/null
echo "target: ключ Mac, UFW и known_hosts готовы"
REMOTE
FW=9743afdd-d18c-4230-a69b-07e23fa499f5
has_mac_rule() { doctl compute firewall get "$FW" --output json | jq -e --arg a "$MAC_IP" --arg b "$MAC_IP/32" 'any(.[0].inbound_rules[]; .protocol == "tcp" and .ports == "22" and any((.sources.addresses // [])[]; . == $a or . == $b))' > /dev/null; }
if ! has_mac_rule; then doctl compute firewall add-rules "$FW" --inbound-rules "protocol:tcp,ports:22,address:$MAC_IP/32"; fi
has_mac_rule
echo "OK: Task 8 Step 2 (target)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
MAC_FP='SHA256:ANYYye98deDG0HW1sD55PaEx00R7y/wlC49l29lG/Og'
HOSTKEYS_B64=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'cat /etc/ssh/ssh_host_ed25519_key.pub /etc/ssh/ssh_host_ecdsa_key.pub /etc/ssh/ssh_host_rsa_key.pub' | awk -v h="$NEW_IP" '{print h, $1, $2}' | base64 | tr -d '\n')
test -n "$HOSTKEYS_B64"
{
  printf "OLD_IP='%s'\nNEW_IP='%s'\nMAC_FP='%s'\nHOSTKEYS_B64='%s'\n" "$OLD_IP" "$NEW_IP" "$MAC_FP" "$HOSTKEYS_B64"
  cat <<'MAC'
set -euo pipefail
LABEL=com.poolwatt.tunnel.coinmarketcap
LIVE=/Library/LaunchDaemons/$LABEL.plist
DIR=$HOME/trientes-tunnel
install -d -m 700 "$DIR"
if [ -e "$DIR/do.plist" ] && cmp -s "$LIVE" "$DIR/do.plist"; then echo "Mac tunnel уже смотрит на $NEW_IP"; exit 0; fi
[ -e "$DIR/aeza.plist" ] || cp -p "$LIVE" "$DIR/aeza.plist"
cmp -s "$LIVE" "$DIR/aeza.plist" || { echo "FAIL: live plist отличается от сохранённого aeza.plist" >&2; exit 1; }
old_re=$(printf '%s' "$OLD_IP" | sed 's/\./\\./g')
sed "s/$old_re/$NEW_IP/g" "$DIR/aeza.plist" > "$DIR/do.plist.tmp"
mv "$DIR/do.plist.tmp" "$DIR/do.plist"
plutil -lint "$DIR/do.plist" > /dev/null
count() { grep -cF "$1" "$2" || true; }
test "$(count "$OLD_IP" "$DIR/aeza.plist")" = 1
test "$(count "$NEW_IP" "$DIR/aeza.plist")" = 0
test "$(count "$OLD_IP" "$DIR/do.plist")" = 0
test "$(count "$NEW_IP" "$DIR/do.plist")" = 1
test "$(diff "$DIR/aeza.plist" "$DIR/do.plist" | grep -c '^[<>]' || true)" = 2
test "$(ssh-keygen -lf "$HOME/.ssh/id_ed25519" < /dev/null | awk '{print $2}')" = "$MAC_FP"
KH=$HOME/.ssh/known_hosts
touch "$KH"
hostkeys=$(printf '%s' "$HOSTKEYS_B64" | base64 -D)
test -n "$hostkeys"
existing=$(ssh-keygen -F "$NEW_IP" -f "$KH" | grep -v '^#' || true)
while read -r h t k _; do
  [ -n "$h" ] || continue
  if ! grep -qF " $t $k" <<< "$hostkeys"; then echo "FAIL: в known_hosts Mac другой $t ключ для $NEW_IP" >&2; exit 1; fi
done <<< "$existing"
while read -r h t k; do
  if ! awk -v t="$t" -v k="$k" '$2 == t && $3 == k { f = 1 } END { exit !f }' <<< "$existing"; then printf '%s %s %s\n' "$h" "$t" "$k" >> "$KH"; fi
done <<< "$hostkeys"
ssh-keygen -F "$NEW_IP" -f "$KH" > /dev/null
cat > "$DIR/reload.sh" <<'RELOAD'
#!/bin/bash
set -u
target_ip=$1 candidate=$2 fallback=$3
LABEL=com.poolwatt.tunnel.coinmarketcap
LIVE=/Library/LaunchDaemons/$LABEL.plist
sleep 5
load() {
  install -m 644 -o root -g wheel "$1" "$LIVE" || return 1
  launchctl bootout "system/$LABEL" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap system "$LIVE" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}
connected() { /usr/sbin/lsof -nP -a -c ssh -iTCP@"$1":22 -sTCP:ESTABLISHED > /dev/null 2>&1; }
wait_connected() {
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if connected "$1"; then
      ok=0
      for _ in 1 2 3; do sleep 10; connected "$1" || ok=1; done
      [ "$ok" = 0 ] && return 0
    fi
    sleep 5
  done
  return 1
}
echo "loading candidate $candidate"
if load "$candidate" && wait_connected "$target_ip"; then echo "RESULT ok candidate"; exit 0; fi
echo "candidate failed, restoring fallback"
if load "$fallback"; then echo "RESULT fallback loaded"; else echo "RESULT fallback FAILED"; fi
exit 1
RELOAD
chmod 700 "$DIR/reload.sh"
: > "$DIR/reload.log"
sudo -n /bin/sh -c "nohup /bin/bash '$DIR/reload.sh' '$NEW_IP' '$DIR/do.plist' '$DIR/aeza.plist' > '$DIR/reload.log' 2>&1 < /dev/null &"
echo "reload на $NEW_IP запланирован; этот tunnel оборвётся через ~5 с"
MAC
} | ssh -o BatchMode=yes "dv@$OLD_IP" 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -p 2222 aleksandrswiss@localhost /bin/bash -s'
echo "OK: Task 8 Step 2 (mac)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
for _ in $(seq 1 48); do [ -n "$(ss -Htln '( sport = :2222 )')" ] && break; sleep 5; done
test -n "$(ss -Htln '( sport = :2222 )')" || { echo "FAIL: Mac tunnel не дошёл до target; reload.log читать через Aeza" >&2; exit 1; }
mac() { ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -p 2222 aleksandrswiss@localhost "$@"; }
result=
for _ in $(seq 1 120); do
  result=$(mac 'grep "^RESULT" ~/trientes-tunnel/reload.log || true' 2>/dev/null || true)
  [ -n "$result" ] && break
  sleep 5
done
test "$result" = 'RESULT ok candidate' || { echo "FAIL: ${result:-нет RESULT}; reload.log читать через Aeza" >&2; exit 1; }
test -x /home/dv/bin/mac-ios
/home/dv/bin/mac-ios --lane build_sim < /dev/null
REMOTE
echo "OK: Task 8 Step 2 (verify)"
```

Expected:
- **collect.** Блок находит IP Mac по SSH-сессии, которая держит `:2222` на Aeza (`sudo ss -p`), ключ Mac в `authorized_keys` по отпечатку `ANYY…` (ровно одна строка) и host key Mac в `known_hosts` dv (`[localhost]:2222`). Всё сохраняется в `mac-tunnel.env` (`0600`); печатается только IP.
- **target.**
  - Ключ Mac добавлен в `authorized_keys` dv.
  - Порт 22 открыт для IP Mac в UFW (`mac ios tunnel`) и в Cloud Firewall; повторный запуск правила не дублирует.
  - Порты 2222/5900 свободны или заняты самим tunnel (sshd).
  - Host key Mac перенесён в `known_hosts` dv на target; другой ключ для `[localhost]:2222` — FAIL.
- **mac.**
  - Live plist сохранён как `aeza.plist`.
  - `do.plist` отличается от него ровно одной строкой с IP (`plutil -lint` ok).
  - Ключ `~/.ssh/id_ed25519` на Mac (его использует plist) совпадает с `ANYY…`.
  - Host keys target заранее добавлены в `known_hosts` Mac. С `StrictHostKeyChecking=accept-new` конфликтующая запись заблокировала бы подключение, поэтому конфликт — FAIL.
  - `reload.sh` запущен от root через `sudo -n` и `nohup`, отдельно от SSH-сессии.
  - Если plist уже равен `do.plist`, блок ничего не меняет.
- **verify.**
  - Listener `:2222` появился на target.
  - В `reload.log` строка `RESULT ok candidate`: Mac держит соединение с `NEW_IP` 30 с.
  - `mac-ios --lane build_sim` проходит.
  - При `RESULT fallback loaded` Mac вернулся на Aeza; лог читать через Aeza (`ssh -p 2222 aleksandrswiss@localhost` с `dv@OLD_IP`) и разобрать до повтора.
  - `RESULT fallback FAILED` — Mac без tunnel, нужен ручной вход владельца на Mac.
- **IP Mac.** IP Mac может быть динамическим. Если он сменится, Mac перестанет подключаться к target: IP Mac в UFW и Cloud Firewall нужно обновить вручную (новый IP сообщает владелец).

- [ ] **Step 3: Проверить exchange, APK и записать ручную acceptance**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
for path in exchange/ exchange-api/health; do
  got=$(curl -sS -o /dev/null -w '%{http_code} %{remote_ip}' "https://trientes.org/$path")
  test "$got" = "200 $NEW_IP" || { echo "FAIL /$path: $got" >&2; exit 1; }
done
APK=/var/www/trientes-downloads/trientes.apk
NEW_LINK=$(ssh -o BatchMode=yes "dv@$NEW_IP" "readlink '$APK'")
OLD_LINK=$(ssh -o BatchMode=yes "dv@$OLD_IP" "readlink '$APK'")
test -n "$NEW_LINK"
test "$NEW_LINK" = "$OLD_LINK"
SIZE=$(ssh -o BatchMode=yes "dv@$NEW_IP" "stat -L -c %s '$APK'")
HEAD=$(curl -sSI https://trientes.org/downloads/trientes.apk | tr -d '\r')
test "$(printf '%s\n' "$HEAD" | awk 'NR == 1 {print $2}')" = 200
test "$(printf '%s\n' "$HEAD" | awk 'tolower($1) == "content-length:" {print $2}')" = "$SIZE"
printf 'APK -> %s (%s bytes)\n' "$NEW_LINK" "$SIZE"
echo "OK: Task 8 Step 3"
```

Затем через браузер и read-only diagnostics проверить и записать в `cutover-acceptance.md`:

- Существующая Auth.js database session продолжает работать и не удаляется; in-progress OAuth flow со старыми pre-upgrade check-cookies может быть отклонён — это ожидаемый повторный login, не обход и не patch библиотеки. Fresh Google/GitHub login/logout и domain OAuth callbacks успешны.
- Telegram `/whoami` и `/status` получают ровно один ответ; `getWebhookInfo` не имеет нового `last_error_date`/backlog.
- Worker caches свежие, schedules однократны, Binance WS подключён, alerts не дублируются.
- Обязательный browser gate `/en/crypto-map?coin=bitcoin`: canvas виден и инициализирован, tile responses HTTP 200, versioned worker/shared HTTP 200 с `immutable`, source maps и root URL без версии 404 с `no-store` (в production не публикуются), нет `pageerror`/MapLibre error; при отключённом WebGL2 виден локализованный fallback без `pageerror`; статические `© OpenStreetMap contributors` и `© OpenFreeMap` видимы. В cabinet point form клик по карте ставит marker и заполняет координаты; после SHOP→ONLINE→SHOP карта и click продолжают работать.
- `/exchange/`, APK latest symlink и read-only `GET /exchange-api/health` возвращает HTTP 200 и подтверждает работу proxy к внешнему order service; uploads доступны, KYB/protected files 403/404.
- Android/iOS продолжают использовать `https://trientes.org`; Mac tunnel перенастроен на `NEW_IP`, затем `/home/dv/bin/mac-ios --lane build_sim` проходит.

Expected: все проверки записаны в `cutover-acceptance.md`. Не объявлять acceptance завершённым по одному health. Блок проверяет без `--resolve`, через реальный DNS:
- `/exchange/` и `/exchange-api/health` отвечают 200 с `NEW_IP`;
- symlink `trientes.apk` на target ведёт на тот же build, что на Aeza;
- `content-length` APK совпадает с размером файла.

Session тестового аккаунта нужна для ручных проверок cabinet, поэтому её отзывают только в Step 4.

- [ ] **Step 4: Отозвать тестовую session и удалить login-файлы**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
LOGIN_BODY=/Users/dmitry/.trientes-migration/cutover-login.json
COOKIE_JAR=/Users/dmitry/.trientes-migration/cutover-auth-cookie.txt
csrf_token() { curl -fsS --resolve "trientes.org:443:$NEW_IP" -b "$1" -c "$1" https://trientes.org/api/auth/csrf | jq -er '.csrfToken | select(type == "string" and length > 0)'; }
cabinet_status() { curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" "$@" https://trientes.org/en/cabinet; }
if [ -e "$COOKIE_JAR" ] && [ "$(cabinet_status -b "$COOKIE_JAR")" = 200 ]; then
  ORIG=$(mktemp); chmod 600 "$ORIG"
  cp "$COOKIE_JAR" "$ORIG"
  CSRF=$(csrf_token "$COOKIE_JAR")
  curl -sS -o /dev/null --resolve "trientes.org:443:$NEW_IP" -b "$COOKIE_JAR" -c "$COOKIE_JAR" --data-urlencode "csrfToken=$CSRF" https://trientes.org/api/auth/signout
  STATUS=$(cabinet_status -b "$ORIG")
  rm -f "$ORIG"
  unset CSRF
  test "$STATUS" != 200 || { echo "FAIL: session из Task 4 всё ещё открывает cabinet" >&2; exit 1; }
  echo "session из Task 4 отозвана"
else
  echo "активной session из Task 4 нет"
fi
rm -f "$COOKIE_JAR" "$LOGIN_BODY"
test ! -e "$COOKIE_JAR"
test ! -e "$LOGIN_BODY"
echo "OK: Task 8 Step 4"
```

Expected:
- Session тестового аккаунта, перенесённая в dump из Task 4 Step 2, удалена на сервере. Проверка идёт исходной cookie (копия до signout), а не перезаписанным jar: она больше не открывает cabinet.
- Если session уже неактивна, блок только удаляет файлы.
- `cutover-login.json` (пароль тестового аккаунта) и cookie jar удалены. Ни пароль, ни cookie не выводились.

- [ ] **Step 5: Создать первый backup и проверить restore во временную БД**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /tmp
test -x /home/dv/pg-backup.sh
test -d /home/dv/logs
start=$(date +%s)
/home/dv/pg-backup.sh >> /home/dv/logs/pg-backup.log 2>&1
LATEST=$(ls -1t /home/dv/backups/pg/trientes-*.sql.gz | sed -n 1p)
test -n "$LATEST"
test "$(stat -c %Y "$LATEST")" -ge "$start"
gzip -t "$LATEST"
printf 'backup sha256 %s\n' "$(sha256sum "$LATEST" | cut -d' ' -f1)"
read -r collate ctype < <(sudo -u postgres psql -Atc "SELECT datcollate || ' ' || datctype FROM pg_database WHERE datname = 'trientes'")
test -n "$collate"
test -n "$ctype"
test -z "$(sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = 'trientes_restore_test'")"
trap 'sudo -u postgres dropdb --force --if-exists trientes_restore_test' EXIT
sudo -u postgres createdb --owner=trientes --encoding=UTF8 --lc-collate="$collate" --lc-ctype="$ctype" --template=template0 trientes_restore_test
zcat "$LATEST" | sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 --dbname=trientes_restore_test > /dev/null
counts() {
  sudo -u postgres psql -X -q -At -v ON_ERROR_STOP=1 --dbname="$1" <<'SQL'
SELECT 'migrations', COUNT(*), md5(COALESCE(string_agg(migration_name || ':' || COALESCE(finished_at::text, '-'), ',' ORDER BY migration_name), '')) FROM _prisma_migrations;
SELECT 'users', COUNT(*) FROM "User";
SELECT 'accounts', COUNT(*) FROM "Account";
SELECT 'coins', COUNT(*) FROM "Coin";
SELECT 'exchanges', COUNT(*) FROM "Exchange";
SELECT 'snapshots', COUNT(*) FROM "CoinSnapshot";
SQL
}
val() { printf '%s\n' "$1" | awk -F'|' -v k="$2" '$1 == k { print $2 }'; }
live=$(counts trientes)
restored=$(counts trientes_restore_test)
test "$(printf '%s\n' "$live" | grep '^migrations|')" = "$(printf '%s\n' "$restored" | grep '^migrations|')"
for k in users accounts coins exchanges snapshots; do test "$(val "$restored" "$k")" -gt 0; done
for k in users accounts; do test "$(val "$restored" "$k")" -le "$(val "$live" "$k")"; done
printf '%s\n' "$restored" | cut -d'|' -f1,2
sudo -u postgres dropdb --force trientes_restore_test
test -z "$(sudo -u postgres psql -Atc "SELECT 1 FROM pg_database WHERE datname = 'trientes_restore_test'")"
trap - EXIT
REMOTE
doctl compute droplet get "$DROPLET_ID" --output json | jq -e 'any(.[0].features[]; . == "backups")' > /dev/null
echo "OK: Task 8 Step 5"
```

Expected: cron-compatible backup создан, gzip/restore успешны, counts совпадают, временная БД удалена. Подробно:
- Backup создаёт тот же `/home/dv/pg-backup.sh`, что запускает cron. Вывод дописывается в `pg-backup.log`, строки с паролем не печатаются. Файл новее старта блока.
- Временная БД получает collation/ctype из live `trientes`, а не hardcoded locale. Restore идёт с `ON_ERROR_STOP`.
- В restore-копии совпадает набор применённых migrations. User/Account/Coin/Exchange/CoinSnapshot непустые, User/Account не больше live: после backup могли появиться новые строки. Печатаются только counts.
- `trientes_restore_test` удаляется и при ошибке (trap).
- У Droplet включены DO backups.

- [ ] **Step 6: Обновить deploy-конфиги и документацию на новый IP**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "OLD_IP='$OLD_IP' NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
git fetch -q origin main
wt=$(mktemp -d /tmp/trientes-deploy-ip.XXXXXX)
rmdir "$wt"
trap 'cd /; git -C /home/dv/trientes worktree remove --force "$wt" 2>/dev/null || rm -rf "$wt"; git -C /home/dv/trientes worktree prune' EXIT
git worktree add -q --detach "$wt" origin/main
cd "$wt"
if ! git grep -q -F "$OLD_IP" -- . ':(exclude)docs'; then echo "origin/main уже без $OLD_IP вне docs/"; exit 0; fi
python3 - <<'PY'
import os
from pathlib import Path
old, new = os.environ["OLD_IP"], os.environ["NEW_IP"]
for name in ("README.md", "deploy/nginx/trientes.conf", "deploy/nginx/trientes-tls.conf", "deploy/docs/dns-tls.md"):
    path = Path(name)
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"old IP missing in {name}")
    path.write_text(text.replace(old, new))
PY
if git grep -n -F "$OLD_IP" -- . ':(exclude)docs'; then echo "FAIL: старый IP остался вне docs/" >&2; exit 1; fi
git diff --check
git add README.md deploy/nginx/trientes.conf deploy/nginx/trientes-tls.conf deploy/docs/dns-tls.md
git commit -q -m "chore(deploy): перейти на DigitalOcean IP" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
if ! git push -q origin HEAD:main; then
  git fetch -q origin main
  git rebase -q origin/main
  if git grep -n -F "$OLD_IP" -- . ':(exclude)docs'; then echo "FAIL: старый IP вернулся после rebase" >&2; exit 1; fi
  git push -q origin HEAD:main
fi
git log -1 --format='%h %s'
REMOTE
echo "OK: Task 8 Step 6"
```

Expected: старый IP удалён только из перечисленных deploy/docs файлов, commit/push успешен. Исторические plans/specs не переписываются.
- Правка идёт во временном detached worktree от свежего `origin/main` на Aeza (там есть доступ к GitHub). Ни `~/trientes` на Aeza (точка rollback на `835aca4`), ни checkout на target не меняются; worktree удаляется и при ошибке.
- Если push отклонён, коммит перебазируется на новый `origin/main`, и проверка старого IP повторяется. Force push не используется.
- После этого коммита в main меняется не только `docs/`, поэтому проверка Task 1 Step 1 к нему уже неприменима. Это ожидаемо после cutover.

- [ ] **Step 7: Monitoring через 1, 24 и 48 часов и retention 7 дней**

Блок запускать через 1, 24 и 48 часов после переключения A и каждый раз дописывать результат в `cutover-acceptance.md`.

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
SWITCHED_AT=$(cat /Users/dmitry/.trientes-migration/dns-switched-at)
printf '%s' "$SWITCHED_AT" | grep -Eqx '[0-9]{10}'
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ps=JSON.parse(s);let bad=0;for(const n of ["trientes-web","trientes-worker","trientes-bot"]){const p=ps.find(x=>x.name===n);if(!p){console.log(n+" missing");bad=1;continue}const e=p.pm2_env;console.log([n,e.status,"restarts="+e.restart_time,"mem="+Math.round(p.monit.memory/1048576)+"MB","cpu="+p.monit.cpu+"%"].join(" "));if(e.status!=="online")bad=1}process.exit(bad)})'
df -h / | sed -n 2p
free -m | sed -n 2p
crontab -l | grep -F pg-backup.sh
ls -lt /home/dv/backups/pg | sed -n 2,4p
log=/home/dv/logs/trientes-worker.out.log
test -f "$log"
recent=$(tail -n 5000 "$log")
printf 'worker log (last 5000 lines): error=%s 429=%s binance=%s\n' "$(grep -ci 'error' <<< "$recent" || true)" "$(grep -c '429' <<< "$recent" || true)" "$(grep -ci 'binance' <<< "$recent" || true)"
REMOTE
doctl compute droplet backups "$DROPLET_ID" --output json | jq -r '.[] | "DO backup \(.name) \(.created_at)"'
AEZA_ONLINE=$(ssh -o BatchMode=yes "dv@$OLD_IP" 'pm2 jlist' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$AEZA_ONLINE" || { echo "FAIL: на Aeza запущены: $AEZA_ONLINE" >&2; exit 1; }
if ssh -o BatchMode=yes "dv@$OLD_IP" 'systemctl is-enabled --quiet pm2-dv'; then echo 'FAIL: pm2-dv enabled на Aeza' >&2; exit 1; fi
date -u -r "$((SWITCHED_AT + 604800))" '+Task 10 не раньше %Y-%m-%d %H:%M UTC'
echo "OK: Task 8 Step 7"
```

В `cutover-acceptance.md` зафиксировать:

- PM2 restart counter/RSS/CPU/disk, worker queues и Binance WS через 1, 24 и 48 часов;
- отсутствие дублей alerts/Telegram responses;
- первый cron backup и DO backup;
- старый Aeza выключен из runtime, но сохранён минимум 7 дней с остановленными PM2 apps и запретом автозапуска;
- удаление Aeza только отдельным подтверждением после restore test и стабильного soak.

Expected:
- Все три приложения online. Счётчики ошибок worker сравниваются между прогонами: важен рост, а не абсолютное число.
- Первый cron backup (03:00 UTC) появился в `/home/dv/backups/pg`, DO backup в списке.
- На Aeza ничего не запущено, `pm2-dv` disabled.
- Дата Task 10 (переключение A + 7 дней) записана.

### Task 9: Rollback только при подтверждённом сбое

**Files:**
- Rollback evidence only; no automatic DNS revert
- Create protected rollback state: `/Users/dmitry/.trientes-migration/rollback-ts`, `rollback-gate.result`, `rollback-reverse-synced`, `run/task9-user-writes.sql`, `dns-after-rollback.json`
- Create на Aeza: `/home/dv/migration-stage0/rollback-gate/`, `reverse-review/`, `trientes-rollback-<TS>.dump`, `aeza-before-rollback-<TS>.dump`, `aeza-before-rollback-<TS>/files/`, `aeza-before-rollback-claude-<TS>/`

Rollback — решение владельца при подтверждённом сбое target, а не реакция на одну ошибку. Порядок: Step 1 останавливает target и определяет, были ли на нём пользовательские записи. Step 2 переносит их на Aeza (только если gate `dirty`). Step 3 запускает Aeza, возвращает A и writers. Обратная синхронизация идёт с Aeza (pull): target на Aeza писать не может. Redis не переносится целиком: dump Redis 8.10 (RDB v15) Redis 8.0.5 на Aeza не прочитает. Поэтому с target переносятся только флаги `bot:verbose:*`, а Telegram-сессии Claude (`claude:session:*`, TTL 30 минут) теряются. Если target недоступен и gate выполнить нельзя, данные target после переключения A не восстановить (RPO > 0): решение о rollback принимает владелец.

- [ ] **Step 1: Остановить target и проверить пользовательские записи (gate)**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
: "${RELEASE_SHA:?SHA release на target}"
DIR=/Users/dmitry/.trientes-migration
umask 077
[ -e "$DIR/rollback-ts" ] || date -u +%Y%m%dT%H%M%SZ > "$DIR/rollback-ts"
ssh -o BatchMode=yes "dv@$NEW_IP" "RELEASE_SHA='$RELEASE_SHA' bash -s" <<'REMOTE'
set -euo pipefail
cd ~/trientes
running() { pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))'; }
now=$(running)
if [ -n "$now" ]; then pm2 stop $now > /dev/null; fi
sudo systemctl disable pm2-dv
now=$(running)
test -z "$now" || { echo "FAIL: на target не остановлены: $now" >&2; exit 1; }
test -z "$(pgrep -x claude || true)" || { echo "FAIL: на target работает claude" >&2; exit 1; }
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
echo "target остановлен, pm2-dv disabled"
REMOTE
if [ ! -e "$DIR/dns-switched-at" ]; then
  echo clean > "$DIR/rollback-gate.result"
  echo "A-записи не переключались: production-трафика на target не было, gate clean"
  echo "OK: Task 9 Step 1"
  exit 0
fi
SQL=$DIR/run/task9-user-writes.sql
cat > "$SQL" <<'EOF'
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, MDY';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 1;
SET bytea_output = 'hex';
WITH skip(name) AS (VALUES
  ('CoinSnapshot'), ('GlobalStats'), ('ExchangeMarket'), ('OsmCryptoPoi'),
  ('CoinCardPriceIndex'), ('CoinCardPricePoint'), ('CoinCardSupply'), ('CoinCardChainFacts'),
  ('PageView'), ('LoginAttempt'), ('Session'), ('VerificationToken'), ('Coin'), ('Exchange')
),
excl(name, cols) AS (VALUES
  ('PriceAlert', ARRAY['triggered', 'lastFiredAt', 'updatedAt']),
  ('CoinCard', ARRAY['updatedAt', 'provenance']),
  ('CoinCardMarket', ARRAY['nativeSymbol', 'quote', 'priceUsd', 'volumeUsd24h', 'change24h', 'isOutlier', 'confirmedAt', 'checkedAt', 'checkError']),
  ('CoinCardContract', ARRAY['onchainName', 'onchainSymbol', 'onchainDecimals', 'onchainTotalSupply', 'onchainFlags', 'mismatches', 'checkedAt', 'checkError', 'verifiedAt'])
),
tables AS (
  SELECT table_name::text AS name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
),
missing AS (
  SELECT s.name AS item FROM (SELECT name FROM skip UNION SELECT name FROM excl) s
  WHERE s.name NOT IN (SELECT name FROM tables)
  UNION ALL
  SELECT x.name || '.' || c FROM excl x, unnest(x.cols) c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns k
    WHERE k.table_schema = 'public' AND k.table_name = x.name AND k.column_name = c
  )
)
SELECT stmt FROM (
  SELECT 0 AS ord, item AS name, format('DO $q$ BEGIN RAISE EXCEPTION %L; END $q$', 'schema drift: ' || item) AS stmt FROM missing
  UNION ALL
  SELECT 1, t.name, format(
    'SELECT %L, COUNT(*), md5(COALESCE(string_agg(r, %L ORDER BY r COLLATE "C"), %L)) FROM (SELECT %s AS r FROM public.%I t) s',
    t.name, '|', '',
    CASE WHEN t.name = 'CoinCard'
      -- worker merges AGGREGATED/VERIFIED_ONCHAIN entries; only user/admin entries are user writes
      THEN $e$((to_jsonb(t) - ARRAY['updatedAt', 'provenance']) || jsonb_build_object('provenance', CASE WHEN jsonb_typeof(t.provenance) = 'object' THEN (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(t.provenance) e(k, v) WHERE v->>'kind' IN ('SELF_REPORTED', 'ADMIN_SET')) ELSE t.provenance END))::text$e$
      ELSE format('(to_jsonb(t) - %L::text[])::text', COALESCE(x.cols, ARRAY[]::text[]))
    END,
    t.name)
  FROM tables t LEFT JOIN excl x ON x.name = t.name
  WHERE t.name NOT IN (SELECT name FROM skip)
) q
ORDER BY ord, name COLLATE "C"
\gexec
EOF
PSQL='psql -X -q -At -v ON_ERROR_STOP=1 --host=127.0.0.1 --username=trientes --dbname=trientes -f -'
O_OUT=$(ssh -o BatchMode=yes "dv@$OLD_IP" "$PSQL" < "$SQL")
N_OUT=$(ssh -o BatchMode=yes "dv@$NEW_IP" "$PSQL" < "$SQL")
test -n "$O_OUT"
test -n "$N_OUT"
if [ "$O_OUT" = "$N_OUT" ]; then
  db=clean
else
  db=dirty
  echo "DB: отличаются таблицы с пользовательскими записями (count на Aeza / target):"
  awk -F'|' 'NR == FNR { o[$1] = $0; oc[$1] = $2; next } { seen[$1] = 1; if (o[$1] != $0) printf "  %s: aeza=%s target=%s\n", $1, (($1 in oc) ? oc[$1] : "-"), $2 } END { for (k in o) if (!(k in seen)) printf "  %s: aeza=%s target=-\n", k, oc[k] }' <(printf '%s\n' "$O_OUT") <(printf '%s\n' "$N_OUT")
fi
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
G=/home/dv/migration-stage0/rollback-gate
install -d -m 700 "$G"
umask 077
SSH='ssh -o BatchMode=yes'
ROOT_SSH='ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes'
rsync -rlHcn --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes-artifacts/" /home/dv/trientes-artifacts/ > "$G/artifacts.itemize"
rsync -rlHcn --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes/incoming/" /home/dv/trientes/incoming/ > "$G/incoming.itemize"
rsync -rlHcn --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes/public/uploads/" /home/dv/trientes/public/uploads/ > "$G/public-uploads.itemize"
rsync -rlHcn --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes-android/" /home/dv/trientes-android/ > "$G/android.itemize"
for d in trientes-uploads trientes-downloads trientes-exchange; do
  sudo rsync -rlHcn --delete -i -e "$ROOT_SSH" "root@$NEW_IP:/var/www/$d/" "/var/www/$d/" > "$G/var-${d#trientes-}.itemize"
done
chmod 600 "$G"/*.itemize
REMOTE
FILE_CHANGES=$(ssh -o BatchMode=yes "dv@$OLD_IP" 'cat /home/dv/migration-stage0/rollback-gate/*.itemize | wc -l' | tr -d ' ')
printf '%s' "$FILE_CHANGES" | grep -Eqx '[0-9]+'
if [ "$db" = clean ] && [ "$FILE_CHANGES" = 0 ]; then result=clean; else result=dirty; fi
echo "$result" > "$DIR/rollback-gate.result"
printf 'DB: %s, file changes: %s -> gate %s\n' "$db" "$FILE_CHANGES" "$result"
echo "OK: Task 9 Step 1"
```

Expected: с этого момента сайт недоступен до Step 3. Target остановлен (web/worker/bot, `pm2-dv` disabled) и больше не пишет; DNS ещё ведёт на него.
- **Без переключения A.** Если A не переключались (`dns-switched-at` нет), production-трафика на target не было, и gate сразу `clean`.
- **DB gate.** Сравниваются только пользовательские записи. Не сравниваются таблицы, которые пополняет worker (snapshots, markets, POI, price/supply/chain facts), а также `PageView`, `LoginAttempt`, `Session`, `VerificationToken`, `Coin` и `Exchange`. В `PriceAlert`, `CoinCard`, `CoinCardMarket`, `CoinCardContract` исключены столбцы, которые обновляет worker. Из `CoinCard.provenance` учитываются только записи `SELF_REPORTED`/`ADMIN_SET`. Если исключаемой таблицы или столбца нет, блок падает с `schema drift: …` (rc 3): схема изменилась, и gate надо пересобрать.
- **Ложный `dirty` безопасен.** Его может дать истечение alert, upgrade provenance или onchain tokenomics; он лишь ведёт в reverse sync (Step 2). Печатаются только имена таблиц и counts, без строк и md5.
- **File gate.** Dry-run pull с target на Aeza сравнивает содержимое (`-c`) без времени и прав. Itemize-файлы лежат на Aeza в `rollback-gate/` (`0600`); в чат выводится только число строк. Имена файлов (KYB, PII) не печатаются.
- **Результат.** Итог (`clean`/`dirty`) записан в `rollback-gate.result`. При `clean` Step 2 пропустить.

- [ ] **Step 2: Перенести пользовательские данные с target на Aeza (только при gate `dirty`)**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
test "$(cat "$DIR/rollback-gate.result")" = dirty
TS=$(cat "$DIR/rollback-ts")
printf '%s' "$TS" | grep -Eqx '[0-9]{8}T[0-9]{6}Z'
ssh -o BatchMode=yes "dv@$NEW_IP" "TS='$TS' bash -s" <<'REMOTE'
set -euo pipefail
umask 077
online=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$online" || { echo "FAIL: на target запущены: $online" >&2; exit 1; }
out=/home/dv/migration-stage0/trientes-rollback-$TS.dump
if [ ! -e "$out" ]; then
  pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file="$out.tmp"
  mv "$out.tmp" "$out"
fi
REMOTE
NEW_SHA=$(ssh -o BatchMode=yes "dv@$NEW_IP" "sha256sum /home/dv/migration-stage0/trientes-rollback-$TS.dump | cut -d' ' -f1")
ssh -o BatchMode=yes "dv@$OLD_IP" "TS='$TS' NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
umask 077
cd /home/dv/migration-stage0
safety=aeza-before-rollback-$TS.dump
if [ ! -e "$safety" ]; then
  pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file="$safety.tmp"
  mv "$safety.tmp" "$safety"
fi
rsync -a -e 'ssh -o BatchMode=yes' "dv@$NEW_IP:/home/dv/migration-stage0/trientes-rollback-$TS.dump" "trientes-rollback-$TS.dump"
REMOTE
OLD_SHA=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sha256sum /home/dv/migration-stage0/trientes-rollback-$TS.dump | cut -d' ' -f1")
printf '%s' "$NEW_SHA" | grep -Eqx '[0-9a-f]{64}'
test "$NEW_SHA" = "$OLD_SHA"
echo "OK: Task 9 Step 2 (dump)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
test "$(cat "$DIR/rollback-gate.result")" = dirty
TS=$(cat "$DIR/rollback-ts")
printf '%s' "$TS" | grep -Eqx '[0-9]{8}T[0-9]{6}Z'
ssh -o BatchMode=yes "dv@$OLD_IP" "TS='$TS' bash -s" <<'REMOTE'
set -euo pipefail
cd /tmp
online=$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$online" || { echo "FAIL: на Aeza запущены: $online" >&2; exit 1; }
dump=/home/dv/migration-stage0/trientes-rollback-$TS.dump
test -s "$dump"
test -s "/home/dv/migration-stage0/aeza-before-rollback-$TS.dump"
sudo install -d -m 700 -o postgres -g postgres /var/lib/postgresql/migration
read -r collate ctype < <(sudo -u postgres psql -Atc "SELECT datcollate || ' ' || datctype FROM pg_database WHERE datname = 'trientes'")
test -n "$collate"
test -n "$ctype"
sudo -u postgres dropdb --force trientes
sudo -u postgres createdb --owner=trientes --encoding=UTF8 --lc-collate="$collate" --lc-ctype="$ctype" --template=template0 trientes
sudo install -m 600 -o postgres -g postgres "$dump" "/var/lib/postgresql/migration/trientes-rollback-$TS.dump"
sudo -u postgres pg_restore --exit-on-error --dbname=trientes "/var/lib/postgresql/migration/trientes-rollback-$TS.dump"
printf 'restored trientes on Aeza (%s/%s)\n' "$collate" "$ctype"
REMOTE
PSQL='psql -X -q -At -v ON_ERROR_STOP=1 --host=127.0.0.1 --username=trientes --dbname=trientes -f -'
for f in task5-compare.sql task9-user-writes.sql; do
  test -s "$DIR/run/$f"
  O_OUT=$(ssh -o BatchMode=yes "dv@$OLD_IP" "$PSQL" < "$DIR/run/$f")
  N_OUT=$(ssh -o BatchMode=yes "dv@$NEW_IP" "$PSQL" < "$DIR/run/$f")
  test -n "$O_OUT"
  if [ "$O_OUT" != "$N_OUT" ]; then echo "FAIL: $f после restore отличается" >&2; exit 1; fi
done
echo "OK: Task 9 Step 2 (restore)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
test "$(cat "$DIR/rollback-gate.result")" = dirty
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
R=/home/dv/migration-stage0/reverse-review
install -d -m 700 "$R"
umask 077
SSH='ssh -o BatchMode=yes'
ROOT_SSH='ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes'
rsync -aHnc --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes-artifacts/" /home/dv/trientes-artifacts/ > "$R/artifacts.itemize"
rsync -aHnc --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes/incoming/" /home/dv/trientes/incoming/ > "$R/incoming.itemize"
rsync -aHnc --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes/public/uploads/" /home/dv/trientes/public/uploads/ > "$R/public-uploads.itemize"
rsync -aHnc --delete -i -e "$SSH" "dv@$NEW_IP:/home/dv/trientes-android/" /home/dv/trientes-android/ > "$R/android.itemize"
for d in trientes-uploads trientes-downloads trientes-exchange; do
  sudo rsync -aHnc --delete -i -e "$ROOT_SSH" "root@$NEW_IP:/var/www/$d/" "/var/www/$d/" > "$R/var-${d#trientes-}.itemize"
done
chmod 600 "$R"/*.itemize
for f in "$R"/*.itemize; do
  printf '%s: %s lines\n' "$(basename "$f")" "$(wc -l < "$f")"
  awk '{ print ($1 == "*deleting") ? "delete" : substr($1, 1, 2) }' "$f" | sort | uniq -c
done
REMOTE
echo "OK: Task 9 Step 2 (files review)"
```

После review itemize-файлов на Aeza (не копировать их в чат):

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
test "$(cat "$DIR/rollback-gate.result")" = dirty
TS=$(cat "$DIR/rollback-ts")
printf '%s' "$TS" | grep -Eqx '[0-9]{8}T[0-9]{6}Z'
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' TS='$TS' bash -s" <<'REMOTE'
set -euo pipefail
B=/home/dv/migration-stage0/aeza-before-rollback-$TS/files
install -d -m 700 "/home/dv/migration-stage0/aeza-before-rollback-$TS" "$B"
SSH='ssh -o BatchMode=yes'
ROOT_SSH='ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes'
sync_dv() { rsync -aH --delete --backup --backup-dir="$B/$1" -e "$SSH" "dv@$NEW_IP:$2/" "$2/"; }
sync_dv artifacts /home/dv/trientes-artifacts
sync_dv incoming /home/dv/trientes/incoming
sync_dv public-uploads /home/dv/trientes/public/uploads
sync_dv android /home/dv/trientes-android
for d in trientes-uploads trientes-downloads trientes-exchange; do
  sudo rsync -aH --delete --backup --backup-dir="$B/var-${d#trientes-}" -e "$ROOT_SSH" "root@$NEW_IP:/var/www/$d/" "/var/www/$d/"
done
for path in /home/dv/trientes-artifacts /home/dv/trientes-android; do
  find "$path" -type d -exec chmod 700 {} +
  find "$path" -type f -exec sh -c 'for file; do if test -x "$file"; then chmod 700 "$file"; else chmod 600 "$file"; fi; done' sh {} +
done
REMOTE
touch "$DIR/rollback-reverse-synced"
echo "OK: Task 9 Step 2 (files apply)"
```

Expected:
- **dump.**
  - Dump target снят при остановленных приложениях; повторный запуск его не перезаписывает.
  - Aeza перед restore сохраняет собственный dump (`aeza-before-rollback-<TS>.dump`): из него можно вернуть состояние Aeza.
  - Aeza забирает dump с target (pull), SHA-256 совпадает.
- **restore.** БД Aeza пересоздаётся с прежними collation/ctype и восстанавливается из dump target. Затем `task5-compare.sql` (counts, sequences, migrations, md5 статических таблиц) и gate SQL на Aeza и target совпадают построчно. Target при этом остановлен, поэтому его данные не меняются.
- **files review.** Dry-run с правами и временем; на файл печатаются только счётчики по типам изменений. Если что-то неожиданное (массовые `delete`, изменения в `trientes-exchange`), остановиться и разобрать.
- **files apply.**
  - Pull с `--delete`: всё, что перезаписано или удалено на Aeza, сохраняется в `aeza-before-rollback-<TS>/files/`.
  - Права protected dirs восстановлены (dirs `0700`, executables `0700`, остальное `0600`).
  - Маркер `rollback-reverse-synced` разрешает Step 3.

- [ ] **Step 3: Вернуть трафик на Aeza**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
: "${ROLLBACK_SHA:?SHA, на котором работает Aeza}"
: "${ROLLBACK_BUILD_ID:?.next/BUILD_ID на Aeza}"
DIR=/Users/dmitry/.trientes-migration
TS=$(cat "$DIR/rollback-ts")
printf '%s' "$TS" | grep -Eqx '[0-9]{8}T[0-9]{6}Z'
GATE=$(cat "$DIR/rollback-gate.result")
if [ "$GATE" != clean ] && [ ! -e "$DIR/rollback-reverse-synced" ]; then echo "FAIL: gate $GATE, а reverse sync (Step 2) не завершён" >&2; exit 1; fi
TARGET_ONLINE=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'pm2 jlist' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$TARGET_ONLINE" || { echo "FAIL: на target запущены: $TARGET_ONLINE" >&2; exit 1; }
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' TS='$TS' ROLLBACK_SHA='$ROLLBACK_SHA' ROLLBACK_BUILD_ID='$ROLLBACK_BUILD_ID' bash -s" <<'REMOTE'
set -euo pipefail
SSH='ssh -o BatchMode=yes'
C=/home/dv/migration-stage0/aeza-before-rollback-claude-$TS
if [ ! -e "$C" ]; then
  install -d -m 700 "$C.tmp"
  rsync -aH /home/dv/.claude/ "$C.tmp/.claude/"
  rsync -aH /home/dv/.claude.json "$C.tmp/.claude.json"
  mv "$C.tmp" "$C"
fi
rsync -aH --delete -e "$SSH" "dv@$NEW_IP:/home/dv/.claude/" /home/dv/.claude/
rsync -aH -e "$SSH" "dv@$NEW_IP:/home/dv/.claude.json" /home/dv/.claude.json
find /home/dv/.claude -type d -exec chmod 700 {} +
find /home/dv/.claude -type f -exec sh -c 'for file; do if test -x "$file"; then chmod 700 "$file"; else chmod 600 "$file"; fi; done' sh {} +
chmod 600 /home/dv/.claude.json
sudo systemctl start redis-server
for _ in $(seq 1 30); do test "$(redis-cli PING 2>/dev/null)" = PONG && break; sleep 1; done
test "$(redis-cli PING)" = PONG
info=
for _ in $(seq 1 30); do
  info=$(redis-cli INFO Persistence 2>/dev/null | tr -d '\r' || true)
  if grep -qx 'loading:0' <<< "$info"; then break; fi
  sleep 1
done
grep -qx 'loading:0' <<< "$info"
vtmp=$(mktemp); trap 'rm -f "$vtmp"' EXIT
ssh -n -o BatchMode=yes "dv@$NEW_IP" 'redis-cli --scan --pattern "bot:verbose:*" | while IFS= read -r k; do printf "%s\t%s\n" "$k" "$(redis-cli GET "$k" < /dev/null)"; done' > "$vtmp"
bad=$(awk -F'\t' 'NF != 2 || $1 !~ /^bot:verbose:[0-9]+$/ || $2 != "1" { n++ } END { print n + 0 }' "$vtmp")
test "$bad" = 0 || { echo "FAIL: неожиданных записей bot:verbose: $bad" >&2; exit 1; }
redis-cli --scan --pattern 'bot:verbose:*' | while IFS= read -r k; do redis-cli DEL "$k" < /dev/null > /dev/null; done
while IFS=$'\t' read -r k v; do redis-cli SET "$k" "$v" < /dev/null > /dev/null; done < "$vtmp"
test "$(redis-cli --scan --pattern 'bot:verbose:*' | wc -l)" -eq "$(wc -l < "$vtmp")"
printf 'bot:verbose synced: %s keys\n' "$(wc -l < "$vtmp")"
pg_isready -q -h 127.0.0.1
cd ~/trientes
test -z "$(git status --short)"
test "$(git rev-parse HEAD)" = "$ROLLBACK_SHA"
test "$(cat .next/BUILD_ID)" = "$ROLLBACK_BUILD_ID"
pm2 start ecosystem.config.js --only trientes-web
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/health
echo
REMOTE
curl -fsS --resolve "trientes.org:443:$OLD_IP" https://trientes.org/api/health
echo
test "$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$OLD_IP" https://trientes.org/en)" = 200
echo "OK: Task 9 Step 3 (start)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
if [ ! -e "$DIR/dns-switched-at" ]; then
  echo "A-записи не переключались, DNS не трогаем"
  echo "OK: Task 9 Step 3 (dns)"
  exit 0
fi
BEFORE=$DIR/dns-before-cutover.json
test -s "$BEFORE"
umask 077
for id in 1837678911 1837678935; do doctl compute domain records update trientes.org --record-id "$id" --record-data "$OLD_IP" --record-ttl 300 > /dev/null; done
REVERTED=$DIR/dns-after-rollback.json
doctl compute domain records list trientes.org --output json > "$REVERTED"
python3 - "$BEFORE" "$REVERTED" "$OLD_IP" <<'PY'
import json, sys
before = {r["id"]: r for r in json.load(open(sys.argv[1]))}
after = {r["id"]: r for r in json.load(open(sys.argv[2]))}
for i in (1837678911, 1837678935):
    assert after.get(i) == before[i], i
    assert after[i]["data"] == sys.argv[3], i
others = sorted(i for i in before.keys() | after.keys() if i not in (1837678911, 1837678935) and before.get(i) != after.get(i))
print("A @/www равны снимку до cutover" + (f"; другие записи менялись после cutover: {len(others)}" if others else ""))
PY
for ns in ns1 ns2 ns3; do
  for name in trientes.org www.trientes.org; do
    ok= a=
    for _ in $(seq 1 30); do
      a=$(dig +short "@$ns.digitalocean.com" "$name" A 2>/dev/null | paste -sd' ' - || true)
      if [ "$a" = "$OLD_IP" ]; then ok=1; break; fi
      sleep 10
    done
    test -n "$ok" || { echo "FAIL: $ns $name A=[$a]" >&2; exit 1; }
  done
done
echo "OK: Task 9 Step 3 (dns)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
TARGET_ONLINE=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'pm2 jlist' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).filter(p=>p.pm2_env.status!=="stopped").map(p=>p.name).join(" ")))')
test -z "$TARGET_ONLINE" || { echo "FAIL: на target запущены: $TARGET_ONLINE" >&2; exit 1; }
ssh -o BatchMode=yes "dv@$OLD_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
cd ~/trientes
pm2 start ecosystem.config.js --only trientes-worker
pm2 start ecosystem.config.js --only trientes-bot --update-env
for _ in $(seq 1 60); do curl -fsS -o /dev/null http://127.0.0.1:4100/health 2>/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4100/health
echo
pm2 save
sudo systemctl enable pm2-dv
node - <<'JS'
require("dotenv").config({ quiet: true });
(async () => {
  const base = "https://api.telegram.org/bot" + process.env.TELEGRAM_BOT_TOKEN;
  const [me, hook] = await Promise.all([fetch(base + "/getMe").then((r) => r.json()), fetch(base + "/getWebhookInfo").then((r) => r.json())]);
  const url = hook.result?.url;
  const origin = url ? new URL(url).origin : null;
  console.log(JSON.stringify({ getMe: me.ok, webhook: hook.ok, origin, pending: hook.result?.pending_update_count }));
  if (!me.ok || !hook.ok || origin !== "https://trientes.org") process.exit(1);
})().catch(() => process.exit(1));
JS
REMOTE
echo "OK: Task 9 Step 3 (writers)"
```

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
LISTEN=$(ssh -o BatchMode=yes "dv@$NEW_IP" "ss -Htln '( sport = :2222 )'" || true)
RELOADED=0
if [ -n "$LISTEN" ]; then
  RELOADED=1
  ssh -o BatchMode=yes "dv@$NEW_IP" "OLD_IP='$OLD_IP' bash -s" <<'REMOTE'
set -euo pipefail
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -p 2222 aleksandrswiss@localhost "OLD_IP='$OLD_IP' /bin/bash -s" <<'MAC'
set -euo pipefail
DIR=$HOME/trientes-tunnel
test -s "$DIR/aeza.plist"
test -s "$DIR/do.plist"
test -x "$DIR/reload.sh"
: > "$DIR/reload.log"
sudo -n /bin/sh -c "nohup /bin/bash '$DIR/reload.sh' '$OLD_IP' '$DIR/aeza.plist' '$DIR/do.plist' > '$DIR/reload.log' 2>&1 < /dev/null &"
echo "reload на $OLD_IP запланирован"
MAC
REMOTE
fi
ssh -o BatchMode=yes "dv@$OLD_IP" "RELOADED='$RELOADED' bash -s" <<'REMOTE'
set -euo pipefail
for _ in $(seq 1 48); do [ -n "$(ss -Htln '( sport = :2222 )')" ] && break; sleep 5; done
test -n "$(ss -Htln '( sport = :2222 )')" || { echo "FAIL: Mac tunnel не подключён к Aeza" >&2; exit 1; }
if [ "$RELOADED" = 1 ]; then
  mac() { ssh -n -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -p 2222 aleksandrswiss@localhost "$@"; }
  result=
  for _ in $(seq 1 120); do
    result=$(mac 'grep "^RESULT" ~/trientes-tunnel/reload.log || true' 2>/dev/null || true)
    [ -n "$result" ] && break
    sleep 5
  done
  test "$result" = 'RESULT ok candidate' || { echo "FAIL: ${result:-нет RESULT}" >&2; exit 1; }
fi
echo "Mac tunnel на Aeza"
REMOTE
echo "OK: Task 9 Step 3 (mac)"
```

Rollback опирается на нетронутые `~/trientes/node_modules` и `~/trientes/.next` на Aeza (`835aca4`). Не пересобирать и не чистить их, пока Aeza хранится (≥7 дней). Чистый `npm ci` на `835aca4` падает с ERESOLVE: `openai@4.104.0` требует `zod@^3`, а в lock-файле `zod@4.4.3`; в security-ветке это исправлено коммитом `782e5a2`. Если всё же придётся переустанавливать старую версию, использовать `npm ci --legacy-peer-deps` и сверить `.next/BUILD_ID` со значением из Stage 0.

Expected: RPO 0 только после reverse synchronization. RTO отдельный, не 10–30 минут. Не возвращать A до восстановления данных и не откатывать NS одновременно с A.
- **start.**
  - Запуск разрешён только при gate `clean` или после Step 2.
  - Сначала копия `.claude`/`.claude.json` Aeza сохраняется в `aeza-before-rollback-claude-<TS>`, затем они забираются с target.
  - Redis на Aeza поднимается из своего pre-cutover RDB. С target переносятся только `bot:verbose:*`; печатается их число, ID не печатаются.
  - HEAD и `.next/BUILD_ID` Aeza равны `ROLLBACK_SHA`/`ROLLBACK_BUILD_ID`. Запускается только web; health и `/en` через `--resolve` на `OLD_IP` отвечают 200.
  - Если TLS на Aeza не проходит, проверить срок сертификата: после переключения A certbot на Aeza продлить его не может.
- **dns.** A `@`/`www` возвращены и совпадают со снимком `dns-before-cutover.json`. Другие записи зоны (например, почтовые, если менялись после cutover) не трогаются, печатается только их число. Все DO nameserver отдают `OLD_IP`.
- **writers.**
  - Worker и bot стартуют только после DNS и при остановленном target, поэтому двух writers нет.
  - Bot health 200, `pm2 save`, `pm2-dv` снова enabled.
  - `getMe` ok, webhook origin `https://trientes.org` (путь и secret не печатаются).
- **mac.**
  - Если Mac tunnel был на target, `reload.sh` загружает `aeza.plist`; при неудаче он вернёт `do.plist`.
  - Listener `:2222` на Aeza и `RESULT ok candidate`.
  - Если target недоступен, переключить Mac может только владелец: запустить `reload.sh` с аргументами `OLD_IP aeza.plist do.plist` на самом Mac.
- **После rollback.** Target остаётся остановленным, `pm2-dv` на нём disabled. Повторный cutover — новый проход runbook с новым финальным dump; `rollback-*` маркеры перед ним перенести в архив.

### Task 10: Закрыть окно rollback (не раньше 7 дней после cutover)

**Files:**
- Modify target: `/root/.ssh/authorized_keys`, `/home/dv/.ssh/authorized_keys`, `/etc/ssh/sshd_config.d/99-trientes.conf`; remove `/etc/sudoers.d/90-dv-migration`
- Modify Cloud Firewall `trientes-org-web-fw` и UFW: убрать 22/tcp с `OLD_IP`
- Create temporary root-only helper: `/usr/local/sbin/trientes-disable-root-ssh` (удаляет себя после запуска)

Порядок важен: сначала у `dv` появляется пароль и проверяется обычный `sudo`, потом удаляется `NOPASSWD`, и только последним шагом закрывается root SSH. Пока root SSH открыт, ошибка с паролем `dv` исправляется через root по ключу. Во время Steps 2–4 держать открытой отдельную SSH-сессию `dv@NEW_IP`.

- [ ] **Step 1: Убрать временный Aeza key и SSH-доступ с Aeza**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
DIR=/Users/dmitry/.trientes-migration
if [ -e "$DIR/rollback-ts" ]; then echo "FAIL: был rollback (Task 9); Task 10 только по отдельному решению" >&2; exit 1; fi
SWITCHED_AT=$(cat "$DIR/dns-switched-at")
printf '%s' "$SWITCHED_AT" | grep -Eqx '[0-9]{10}'
AGE=$(( $(date -u +%s) - SWITCHED_AT ))
test "$AGE" -ge 604800 || { echo "FAIL: окно rollback открыто ещё $(( (604800 - AGE) / 3600 )) ч" >&2; exit 1; }
for name in trientes.org www.trientes.org; do test "$(dig +short @ns1.digitalocean.com "$name" A)" = "$NEW_IP"; done
TARGET_STATE=$(ssh -o BatchMode=yes "dv@$NEW_IP" 'pm2 jlist' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ps=JSON.parse(s);console.log(["trientes-web","trientes-worker","trientes-bot"].map(n=>{const p=ps.find(x=>x.name===n);return n+"="+(p?p.pm2_env.status:"missing")}).join(" "))})')
test "$TARGET_STATE" = 'trientes-web=online trientes-worker=online trientes-bot=online' || { echo "FAIL: $TARGET_STATE" >&2; exit 1; }
AEZA_FP=$(ssh-keygen -lf "$DIR/aeza-temporary.pub" | awk '{print $2}')
test "$AEZA_FP" = 'SHA256:R2/p0CBHwK2rjKXy2IRjbzFIaSnqv8/zweD1vfGojKY'
LAPTOP_FP='SHA256:crrC7BhR7iddgO+bzCtb+WbJxVK21RQVDsdMwKtq7Ks'
{
  printf "AEZA_FP='%s'\nLAPTOP_FP='%s'\n" "$AEZA_FP" "$LAPTOP_FP"
  cat <<'ROOT'
set -euo pipefail
tmpk=$(mktemp); tmpn=$(mktemp); trap 'rm -f "$tmpk" "$tmpn"' EXIT
for file in /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys; do
  : > "$tmpn"
  removed=0 laptop=0
  while IFS= read -r line; do
    case "$line" in ''|'#'*) printf '%s\n' "$line" >> "$tmpn"; continue ;; esac
    printf '%s\n' "$line" > "$tmpk"
    fp=$(ssh-keygen -lf "$tmpk" < /dev/null | awk '{print $2}')
    if [ "$fp" = "$AEZA_FP" ]; then removed=$((removed + 1)); continue; fi
    if [ "$fp" = "$LAPTOP_FP" ]; then laptop=1; fi
    printf '%s\n' "$line" >> "$tmpn"
  done < "$file"
  test "$laptop" = 1 || { echo "FAIL: в $file нет ключа ноута" >&2; exit 1; }
  install -m "$(stat -c %a "$file")" -o "$(stat -c %U "$file")" -g "$(stat -c %G "$file")" "$tmpn" "$file"
  fps=$(ssh-keygen -lf "$file" | awk '{print $2}')
  if grep -qxF "$AEZA_FP" <<< "$fps"; then echo "FAIL: Aeza key остался в $file" >&2; exit 1; fi
  printf '%s: удалено строк с Aeza key: %s, осталось ключей: %s\n' "$file" "$removed" "$(printf '%s\n' "$fps" | wc -l)"
done
ROOT
} | ssh -o BatchMode=yes "dv@$NEW_IP" 'sudo bash -s'
FW=9743afdd-d18c-4230-a69b-07e23fa499f5
has_old_rule() { doctl compute firewall get "$FW" --output json | jq -e --arg a "$OLD_IP" --arg b "$OLD_IP/32" 'any(.[0].inbound_rules[]; any((.sources.addresses // [])[]; . == $a or . == $b))' > /dev/null; }
if has_old_rule; then doctl compute firewall remove-rules "$FW" --inbound-rules "protocol:tcp,ports:22,address:$OLD_IP/32"; fi
if has_old_rule; then echo "FAIL: OLD_IP остался в Cloud Firewall" >&2; exit 1; fi
ssh -o BatchMode=yes "dv@$NEW_IP" "OLD_IP='$OLD_IP' bash -s" <<'REMOTE'
set -euo pipefail
sudo ufw --force delete allow from "$OLD_IP" to any port 22 proto tcp > /dev/null || true
ufw_status=$(sudo ufw status)
if grep -qF "$OLD_IP" <<< "$ufw_status"; then echo "FAIL: OLD_IP остался в UFW" >&2; exit 1; fi
REMOTE
if ssh -o BatchMode=yes "dv@$OLD_IP" "ssh -o BatchMode=yes -o ConnectTimeout=10 dv@$NEW_IP true" 2>/dev/null; then echo "FAIL: Aeza всё ещё входит на target" >&2; exit 1; fi
for port in 3000 4100 5432 6379; do
  if nc -z -G 3 -w 3 "$NEW_IP" "$port" 2>/dev/null; then echo "FAIL: порт $port открыт снаружи" >&2; exit 1; fi
done
echo "OK: Task 10 Step 1"
```

Expected:
- **Предусловия.** Прошло ≥ 7 дней с переключения A, rollback не выполнялся, A ведут на `NEW_IP`, все три приложения на target online.
- **Ключи.** Временный Aeza key (`R2/p0…`) удалён из `authorized_keys` root и `dv`. Владелец, группа и права файлов сохранены. Ключ ноута (`crrC7Bh…`) остаётся в обоих; у `dv` также остаётся ключ Mac (`ANYY…`). Приватный ключ `~/.ssh/id_ed25519` dv на target не трогается: через него `mac-ios` входит на Mac.
- **Доступ с Aeza.** 22/tcp с `OLD_IP` убран из Cloud Firewall и UFW, вход с Aeza на target больше не проходит.
- **Внешние порты.** 3000, 4100, 5432 и 6379 снаружи закрыты.

- [ ] **Step 2: Владелец задаёт пароль `dv`**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -t "dv@$NEW_IP" 'sudo passwd dv'
test "$(ssh -o BatchMode=yes "dv@$NEW_IP" 'sudo passwd -S dv' | awk '{print $2}')" = P
ssh -t "dv@$NEW_IP" 'su dv -c true && echo PASSWORD_OK'
echo "OK: Task 10 Step 2"
```

Expected: владелец сам вводит новый сильный пароль `dv` в своём терминале. Пароль не проходит через агента, чат и argv. `passwd -S` показывает `P` (пароль задан, раньше было `L`), `su dv` с этим паролем проходит (`PASSWORD_OK`). Вход по SSH паролем остаётся выключенным: пароль нужен только для `sudo`.

- [ ] **Step 3: Подготовить отключение root SSH и убрать `NOPASSWD`**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
groups=$(id -nG dv)
case " $groups " in *' sudo '*) ;; *) echo "FAIL: dv не в группе sudo" >&2; exit 1 ;; esac
test "$(sudo passwd -S dv | awk '{print $2}')" = P
tmp=$(mktemp)
cat > "$tmp" <<'SH'
#!/bin/bash
set -euo pipefail
conf=/etc/ssh/sshd_config.d/99-trientes.conf
test "$(sed -n 1p "$conf")" = 'PermitRootLogin prohibit-password'
sed -i '1s/^PermitRootLogin prohibit-password$/PermitRootLogin no/' "$conf"
test "$(sed -n 1p "$conf")" = 'PermitRootLogin no'
sshd -t
effective=$(sshd -T)
grep -qx 'permitrootlogin no' <<< "$effective"
systemctl reload-or-restart ssh
rm -f "$0"
echo "root SSH отключён"
SH
sudo install -m 700 -o root -g root "$tmp" /usr/local/sbin/trientes-disable-root-ssh
rm -f "$tmp"
sudo bash -s <<'ROOT'
set -euo pipefail
test -e /etc/sudoers.d/90-dv-migration
test -e /etc/sudoers.d/90-cloud-init-users
rm /etc/sudoers.d/90-dv-migration
visudo -c > /dev/null
rights=$(sudo -l -U dv)
if grep -q NOPASSWD <<< "$rights"; then echo 'FAIL: у dv остался NOPASSWD' >&2; exit 1; fi
grep -qE '\(ALL( : ALL)?\) ALL' <<< "$rights"
echo "sudo для dv теперь требует пароль"
ROOT
REMOTE
echo "OK: Task 10 Step 3"
```

Expected:
- **Предусловия.** `dv` в группе `sudo`, пароль задан.
- **Helper.** `/usr/local/sbin/trientes-disable-root-ssh` (root, `0700`) пока не запускается. Он:
  - меняет первую строку `99-trientes.conf` на `PermitRootLogin no`. Отдельный файл не годится: sshd берёт первое значение, а `99-trientes.conf` — единственный, где задан `PermitRootLogin`;
  - проверяет `sshd -t` и эффективное `permitrootlogin no`;
  - перезагружает ssh;
  - удаляет себя.
- **sudo.** `/etc/sudoers.d/90-dv-migration` удалён, `visudo -c` ok. У `dv` больше нет `NOPASSWD`, остаётся `(ALL : ALL) ALL` через группу `sudo`. `90-cloud-init-users` (только root) не трогается.

- [ ] **Step 4: Владелец проверяет `sudo` по паролю и закрывает root SSH**

```bash
set -euo pipefail
source /Users/dmitry/.trientes-migration/stage0.env
ssh -t "dv@$NEW_IP" 'sudo -k; sudo -v && echo SUDO_OK'
ssh -t "dv@$NEW_IP" 'sudo /usr/local/sbin/trientes-disable-root-ssh'
if ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$NEW_IP" true 2>/dev/null; then echo 'FAIL: root SSH всё ещё открыт' >&2; exit 1; fi
ssh -o BatchMode=yes "dv@$NEW_IP" 'test ! -e /usr/local/sbin/trientes-disable-root-ssh'
if ssh -o BatchMode=yes "dv@$NEW_IP" 'sudo -n true' 2>/dev/null; then echo 'FAIL: sudo без пароля' >&2; exit 1; fi
echo "OK: Task 10 Step 4"
```

Expected:
- `sudo` по паролю `dv` работает (`SUDO_OK`) до закрытия root SSH.
- После helper вход `root@NEW_IP` по ключу отклоняется, `dv` входит по ключу как раньше. Helper удалён, `sudo -n` без пароля не проходит.
- Если `SUDO_OK` нет, helper не запускать: root SSH по ключу остаётся путём восстановления.

Follow-up после Task 10 (отдельные изменения, не часть окна):
- Ключ Mac в `authorized_keys` dv на target ограничить: `restrict,port-forwarding,permitlisten="localhost:2222",permitlisten="localhost:5900"`, затем проверить tunnel и `mac-ios --lane build_sim`.
- Если IP Mac динамический и меняется, правило 22/tcp для него в Cloud Firewall и UFW нужно обновлять.
- Пара ключей `R2/p0…` общая у Aeza и target (через неё `mac-ios` входит на Mac). Перед удалением Aeza выпустить на target новый ключ для Mac и убрать `R2/p0…` из `authorized_keys` на Mac.
- Удаление Aeza — отдельное решение владельца после restore test и стабильного soak.
