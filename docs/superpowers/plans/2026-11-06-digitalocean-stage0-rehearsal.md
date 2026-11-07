# DigitalOcean Stage 0 Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать новый Droplet для `trientes.org`, перенести копии runtime-данных и доказать работоспособность PostgreSQL, Redis, приложения, nginx и TLS до любых изменений публичного DNS.

**Architecture:** Production на Aeza продолжает обслуживать пользователей. Новый сервер собирается с нуля и проходит rehearsal с копией БД, Redis RDB и файлов; активен только web, worker/bot не запускаются. Публичные A/MX/NS и почтовый runtime остаются неизменными.

**Tech Stack:** DigitalOcean Droplet/Cloud Firewall, Ubuntu 24.04, Node.js 22, PostgreSQL 16, Redis 8.x, Next.js/PM2, nginx/Certbot, rsync, pg_dump/pg_restore.

**Specification:** `docs/superpowers/specs/2026-11-06-digitalocean-migration-design.md`

**Source:** `dv@85.192.25.242`, production `/home/dv/trientes`.

**State:** `/Users/dmitry/.trientes-migration/stage0.env` и защищённые artifacts в `/Users/dmitry/.trientes-migration/` mode 0700.

---

### Task 1: Зафиксировать clean baseline, restart health и внешний backup

**Files:**
- Create protected: `/Users/dmitry/.trientes-migration/stage0.env`
- Create protected: `/Users/dmitry/.trientes-migration/baseline-*.log`
- Create protected: последний source dump в `/Users/dmitry/.trientes-migration/`

- [ ] **Step 1: Создать защищённый state-каталог**

```bash
install -m 700 -d /Users/dmitry/.trientes-migration
test ! -e /Users/dmitry/.trientes-migration/stage0.env
umask 077
printf 'OLD_IP=85.192.25.242\n' > /Users/dmitry/.trientes-migration/stage0.env
chmod 600 /Users/dmitry/.trientes-migration/stage0.env
```

Expected: каталог 0700, новый state file 0600. Если файл уже существует, не перезаписывать — сначала проверить, не является ли это незавершённым rehearsal.

- [ ] **Step 2: Остановиться при чужом WIP или неотправленных коммитах**

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 dv@85.192.25.242 'cd ~/trientes && git status --short --branch && git diff --stat && printf "Unpushed commits: " && git rev-list --count origin/main..HEAD && printf "HEAD: " && git rev-parse HEAD && git status --porcelain=v1'
```

Expected: `git status --porcelain` пуст, `Unpushed commits: 0`. Иначе **STOP**: не создавать Droplet, не копировать production и не сбрасывать WIP. Продолжить только после чистого зафиксированного состояния или отдельного письменного решения владельца.

После успешной проверки зафиксировать SHA и создать неизменный source-worktree:

```bash
BASE_SHA=$(ssh -o BatchMode=yes dv@85.192.25.242 'git -C ~/trientes rev-parse HEAD')
printf 'BASE_SHA=%s\n' "$BASE_SHA" >> /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "cd ~/trientes && test ! -e .worktrees/do-stage0-source && git worktree add --detach .worktrees/do-stage0-source '$BASE_SHA' && git worktree lock .worktrees/do-stage0-source"
```

Expected: отдельный detached worktree содержит ровно `BASE_SHA` и не меняется при последующих commits в production. Каталог `.worktrees` игнорируется Git. Production `.env` копируется отдельно в Task 4, поскольку его нет в новом worktree.

- [ ] **Step 3: Проверить текущий restart health без дампа секретов**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'pm2 status; pm2 describe trientes-web | grep -E "status|restarts|uptime|max memory restart|watch|cron_restart"; journalctl -k --since "24 hours ago" --no-pager | grep -Ei "out of memory|oom-kill|killed process" || true' > /Users/dmitry/.trientes-migration/baseline-pm2.log
chmod 600 /Users/dmitry/.trientes-migration/baseline-pm2.log
ssh -o BatchMode=yes dv@85.192.25.242 'pm2 logs trientes-web --lines 150 --nostream' > /Users/dmitry/.trientes-migration/baseline-web.log
chmod 600 /Users/dmitry/.trientes-migration/baseline-web.log
```

Expected: web `online`; нет активного crash loop, свежего OOM или повторяющегося фатального исключения. Большой исторический counter сам по себе не блокер. При активном сбое остановиться и создать отдельный debugging plan; не переносить нестабильность без разбора.

- [ ] **Step 4: Скопировать последний известно хороший dump за пределы Aeza**

```bash
LATEST_DUMP=$(ssh -o BatchMode=yes dv@85.192.25.242 'ls -1t /home/dv/backups/pg/trientes-*.sql.gz' | head -n 1)
test -n "$LATEST_DUMP"
scp -q -o BatchMode=yes "dv@85.192.25.242:$LATEST_DUMP" /Users/dmitry/.trientes-migration/
LOCAL_DUMP="/Users/dmitry/.trientes-migration/$(basename "$LATEST_DUMP")"
chmod 600 "$LOCAL_DUMP"
gzip -t "$LOCAL_DUMP"
REMOTE_SHA=$(ssh -o BatchMode=yes dv@85.192.25.242 "sha256sum '$LATEST_DUMP' | cut -d' ' -f1")
LOCAL_SHA=$(shasum -a 256 "$LOCAL_DUMP" | cut -d' ' -f1)
test "$REMOTE_SHA" = "$LOCAL_SHA"
printf 'BASELINE_DUMP=%s\nBASELINE_DUMP_SHA256=%s\n' "$LOCAL_DUMP" "$LOCAL_SHA" >> /Users/dmitry/.trientes-migration/stage0.env
```

Expected: `gzip -t` успешен, SHA-256 совпадает. Ни один restore test не выполняется против production БД.

### Task 2: Создать Droplet и Cloud Firewall

**Files:**
- Modify protected state: `/Users/dmitry/.trientes-migration/stage0.env`

- [ ] **Step 1: Убедиться в отсутствии ресурсов с тем же именем и определить admin IP**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
! doctl compute droplet list --format Name --no-header | grep -Fx 'trientes-org-prod'
! doctl compute firewall list --format Name --no-header | grep -Fx 'trientes-org-web-fw'
ADMIN_IP=$(curl -fsS https://api.ipify.org)
python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1])' "$ADMIN_IP"
printf 'ADMIN_IP=%s\n' "$ADMIN_IP" >> /Users/dmitry/.trientes-migration/stage0.env
```

Expected: ресурсов с такими именами нет; admin IP валиден. Если Droplet уже создан предыдущей попыткой, не создавать второй — сначала идентифицировать его и состояние.

- [ ] **Step 2: Создать утверждённый Droplet**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
read -r DROPLET_ID NEW_IP NEW_IPV6 <<< "$(doctl compute droplet create trientes-org-prod \
  --region fra1 --size s-4vcpu-8gb --image ubuntu-24-04-x64 \
  --ssh-keys 55819415 --enable-ipv6 --enable-private-networking \
  --enable-monitoring --droplet-agent=true --enable-backups \
  --backup-policy-plan daily --backup-policy-hour 4 \
  --tag-names trientes-org,web,production --wait \
  --format ID,PublicIPv4,PublicIPv6 --no-header)"
python3 -c 'import ipaddress,sys; ipaddress.IPv4Address(sys.argv[1]); ipaddress.IPv6Address(sys.argv[2])' "$NEW_IP" "$NEW_IPV6"
printf 'DROPLET_ID=%s\nNEW_IP=%s\nNEW_IPV6=%s\n' "$DROPLET_ID" "$NEW_IP" "$NEW_IPV6" >> /Users/dmitry/.trientes-migration/stage0.env
doctl compute droplet get "$DROPLET_ID" --format ID,Name,PublicIPv4,PublicIPv6,Memory,VCPUs,Disk,Region,Status,Features
```

Expected: `trientes-org-prod`, FRA1, 4 vCPU, 8192 MB, 160 GB, `active`, backups/IPv6/monitoring включены. При ошибке после создания сначала найти ресурс через `doctl compute droplet list`, не повторять создание вслепую.

- [ ] **Step 3: Создать Cloud Firewall с SSH только с admin/Aeza IP**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
doctl compute firewall create --name trientes-org-web-fw \
  --inbound-rules "protocol:tcp,ports:22,address:${ADMIN_IP}/32 protocol:tcp,ports:22,address:${OLD_IP}/32 protocol:tcp,ports:80,address:0.0.0.0/0 protocol:tcp,ports:80,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0 protocol:tcp,ports:443,address:::/0" \
  --outbound-rules "protocol:tcp,ports:1-65535,address:0.0.0.0/0 protocol:tcp,ports:1-65535,address:::/0 protocol:udp,ports:1-65535,address:0.0.0.0/0 protocol:udp,ports:1-65535,address:::/0 protocol:icmp,address:0.0.0.0/0 protocol:icmp,address:::/0" \
  --droplet-ids "$DROPLET_ID"
```

Expected: inbound 22 только admin/Aeza; 80/443 public IPv4+IPv6; никаких inbound 3000/4100/5432/6379 или mail ports. Outbound разрешает необходимые feeds, DNS/NTP, SSH и updates.

- [ ] **Step 4: Проверить SSH и сохранить host key как новый**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
until ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "root@$NEW_IP" 'hostname && cloud-init status --wait'; do sleep 5; done
```

Expected: SSH по ключу работает, cloud-init завершён без ошибки. Сохранённый host key нового Droplet не заменяет запись Aeza.

### Task 3: Установить базовый runtime и hardened SSH/UFW

**Files:**
- Create on target: `/etc/ssh/sshd_config.d/99-trientes.conf`
- Create target service: `pm2-dv.service`

- [ ] **Step 1: Установить пакеты и версии**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl gnupg lsb-release sudo ufw rsync jq git build-essential nginx postgresql postgresql-contrib certbot python3-certbot-nginx unzip zip openjdk-21-jdk-headless
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor -o /usr/share/keyrings/redis-archive-keyring.gpg
printf 'deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb noble main\n' > /etc/apt/sources.list.d/redis.list
apt-get update
apt-get install -y nodejs redis-server
locale-gen en_US.UTF-8
npm install -g pm2@7.0.1 @anthropic-ai/claude-code@2.1.233
node --version
pm2 --version
psql --version
redis-server --version
nginx -v
claude --version
REMOTE
```

Expected: Node 22.x, PM2 7.0.1, PostgreSQL 16.x, Redis 8.x, Claude CLI 2.1.233. Не продолжать с PostgreSQL 15/17 или Redis 7.

- [ ] **Step 2: Создать пользователя `dv` и передать admin SSH key**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'bash -s' <<'REMOTE'
set -euo pipefail
id dv >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --uid 1000 dv
usermod -aG sudo dv
install -d -m 700 -o dv -g dv /home/dv/.ssh
cp /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys
chown dv:dv /home/dv/.ssh/authorized_keys
chmod 600 /home/dv/.ssh/authorized_keys
printf 'dv ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-dv-migration
chmod 440 /etc/sudoers.d/90-dv-migration
visudo -cf /etc/sudoers.d/90-dv-migration
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'id && sudo -n true && sudo -n systemctl is-active postgresql'
```

Expected: новая сессия `dv` работает, passwordless sudo проверен, PostgreSQL active. Root SSH остаётся как recovery до конца rehearsal.

- [ ] **Step 3: Настроить UFW и SSH hardening**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" "ADMIN_IP='$ADMIN_IP' OLD_IP='$OLD_IP' bash -s" <<'REMOTE'
set -euo pipefail
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_IP" to any port 22 proto tcp
ufw allow from "$OLD_IP" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
cat > /etc/ssh/sshd_config.d/99-trientes.conf <<'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowTcpForwarding yes
GatewayPorts no
EOF
sshd -t
systemctl reload ssh
ufw status verbose
REMOTE
```

Expected: inbound только разрешённые SSH и 80/443; password auth off; root только key; новая `dv` SSH-сессия после reload по-прежнему работает.

- [ ] **Step 4: Настроить PM2 systemd, но не запускать приложения**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'pm2 startup systemd -u dv --hp /home/dv && systemctl disable pm2-dv && systemctl enable postgresql redis-server nginx && systemctl is-enabled postgresql redis-server nginx'
```

Expected: unit `pm2-dv` создан, но disabled до rehearsal web-only `pm2 save`. Worker/bot не запущены.

### Task 4: Перенести секреты, checkout и runtime-файлы

**Files:**
- Create protected staging: `/home/dv/migration-stage0/`
- Copy production `.env`, `.pgpass`, `.claude`, SSH keys, runtime files и live configs на target

- [ ] **Step 1: Разрешить Aeza временный direct SSH к target**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'cat ~/.ssh/id_ed25519.pub' > /Users/dmitry/.trientes-migration/aeza-temporary.pub
chmod 600 /Users/dmitry/.trientes-migration/aeza-temporary.pub
scp -q -o BatchMode=yes /Users/dmitry/.trientes-migration/aeza-temporary.pub "root@$NEW_IP:/root/aeza-temporary.pub"
ssh -o BatchMode=yes "root@$NEW_IP" 'set -e; for file in /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys; do grep -qxFf /root/aeza-temporary.pub "$file" || cat /root/aeza-temporary.pub >> "$file"; done; chown dv:dv /home/dv/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys /home/dv/.ssh/authorized_keys; rm -f /root/aeza-temporary.pub; install -d -m 700 -o dv -g dv /home/dv/migration-stage0; install -d -m 700 /root/migration-stage0'
ssh -o BatchMode=yes "dv@$OLD_IP" 'sudo -n true'
ssh -o BatchMode=yes "dv@$OLD_IP" "if test ! -d /home/dv/migration-stage0/source-clone/.git; then git clone --no-hardlinks /home/dv/trientes/.git /home/dv/migration-stage0/source-clone && git -C /home/dv/migration-stage0/source-clone checkout --detach '$BASE_SHA' && git -C /home/dv/migration-stage0/source-clone remote set-url origin git@github.com:dvvolkovv/trientes.git; fi && test \"\$(git -C /home/dv/migration-stage0/source-clone rev-parse HEAD)\" = '$BASE_SHA' && test -z \"\$(git -C /home/dv/migration-stage0/source-clone status --porcelain)\" && git -C /home/dv/migration-stage0/source-clone cat-file -e '$BASE_SHA^{commit}' && git -C /home/dv/migration-stage0/source-clone fsck --no-dangling"
```

Expected: Aeza может подключаться к target только по своему ключу и только через разрешённый firewall; временный root key доступ будет удалён в cutover plan.

- [ ] **Step 2: Синхронизировать checkout и protected user state напрямую Aeza → DO**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
install -d -m 700 /home/dv/.android
SSH='ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
rsync -a --stats -e "$SSH" \
  --exclude node_modules --exclude .next --exclude .next-preview \
  --exclude .worktrees --exclude test-results --exclude playwright-report \
  /home/dv/migration-stage0/source-clone/ "dv@$NEW_IP:/home/dv/trientes/"
rsync -a -e "$SSH" /home/dv/trientes/.env "dv@$NEW_IP:/home/dv/trientes/.env"
rsync -a -e "$SSH" --exclude authorized_keys --exclude known_hosts /home/dv/.ssh/ "dv@$NEW_IP:/home/dv/.ssh/"
rsync -a -e "$SSH" /home/dv/.pgpass /home/dv/.trientes-dbpass /home/dv/.trientes-bot-secret /home/dv/.claude.json "dv@$NEW_IP:/home/dv/"
rsync -a -e "$SSH" /home/dv/.claude/ "dv@$NEW_IP:/home/dv/.claude/"
rsync -a -e "$SSH" /home/dv/bin/ "dv@$NEW_IP:/home/dv/bin/"
rsync -a -e "$SSH" --exclude /.gradle --exclude /build --exclude /.cxx /home/dv/trientes-android/ "dv@$NEW_IP:/home/dv/trientes-android/"
rsync -a -e "$SSH" /home/dv/.android/debug.keystore "dv@$NEW_IP:/home/dv/.android/"
rsync -a -e "$SSH" /home/dv/trientes-artifacts/ "dv@$NEW_IP:/home/dv/trientes-artifacts/"
chmod 600 /home/dv/trientes/.env /home/dv/.pgpass /home/dv/.trientes-dbpass /home/dv/.trientes-bot-secret /home/dv/.claude.json
REMOTE
```

Expected: checkout, secrets, Claude resume state, scripts и Android local repo на target; права 0600 сохранены. Никакие значения не печатаются.

- [ ] **Step 3: Перенести исторические backups отдельно от критического пути**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
rsync -a --stats -e 'ssh -o BatchMode=yes' /home/dv/backups/ "dv@$NEW_IP:/home/dv/backups/"
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'find /home/dv/backups -type d -exec chmod 700 {} +; find /home/dv/backups -type f -exec chmod 600 {} +'
```

Expected: вся 14-дневная история скопирована; новые backup files недоступны другим пользователям. Этот шаг выполняется до production-окна.

- [ ] **Step 4: Сохранить холодный архив неruntime-каталогов и логов**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
SSH='ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
rsync -a --stats -e "$SSH" --exclude node_modules --exclude .next --exclude .git /home/dv/trientes-org-exchange/ "dv@$NEW_IP:/home/dv/migration-stage0/cold-archive/trientes-org-exchange/"
rsync -a --stats -e "$SSH" --exclude node_modules --exclude .next /home/dv/trientes-site-review.gAF0ws/ "dv@$NEW_IP:/home/dv/migration-stage0/cold-archive/trientes-site-review/"
rsync -a -e "$SSH" /home/dv/logs/ "dv@$NEW_IP:/home/dv/migration-stage0/cold-archive/logs/"
rsync -a -e "$SSH" /home/dv/trientes-org-exchange-plan.mp3 /home/dv/trientes-org-exchange-untracked-before.txt "dv@$NEW_IP:/home/dv/migration-stage0/cold-archive/"
REMOTE
ssh -o BatchMode=yes "dv@$NEW_IP" 'find /home/dv/migration-stage0/cold-archive -type d -exec chmod 700 {} +; find /home/dv/migration-stage0/cold-archive -type f -exec chmod 600 {} +'
```

Expected: review-каталоги и логи сохранены в защищённый cold archive, но не используются как рабочие checkout и не запускаются. Сломанные worktree-ссылки `.git` специально не переносятся.

- [ ] **Step 5: Перенести live nginx/TLS и `/var/www` без `--delete`**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" "NEW_IP='$NEW_IP' bash -s" <<'REMOTE'
set -euo pipefail
RSYNC_SSH='ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
sudo rsync -aH -e "$RSYNC_SSH" /etc/letsencrypt/ "root@$NEW_IP:/etc/letsencrypt/"
sudo rsync -aH -e "$RSYNC_SSH" /etc/nginx/sites-available/trientes "root@$NEW_IP:/etc/nginx/sites-available/trientes"
if sudo test -f /etc/nginx/sites-available/trientes.bak; then
  sudo rsync -aH -e "$RSYNC_SSH" /etc/nginx/sites-available/trientes.bak "root@$NEW_IP:/etc/nginx/sites-available/trientes.bak"
fi
sudo rsync -aH -e "$RSYNC_SSH" /etc/nginx/sites-enabled/trientes "root@$NEW_IP:/etc/nginx/sites-enabled/trientes"
sudo rsync -aH -e "$RSYNC_SSH" /etc/nginx/conf.d/trientes-exchange.conf "root@$NEW_IP:/etc/nginx/conf.d/trientes-exchange.conf"
sudo rsync -aH -e "$RSYNC_SSH" /etc/nginx/snippets/trientes-exchange.conf "root@$NEW_IP:/etc/nginx/snippets/trientes-exchange.conf"
sudo rsync -aH -e "$RSYNC_SSH" /var/www/trientes-uploads/ "root@$NEW_IP:/var/www/trientes-uploads/"
sudo rsync -aH -e "$RSYNC_SSH" /var/www/trientes-downloads/ "root@$NEW_IP:/var/www/trientes-downloads/"
sudo rsync -aH -e "$RSYNC_SSH" /var/www/trientes-exchange/ "root@$NEW_IP:/var/www/trientes-exchange/"
REMOTE
```

Expected: configs, symlinks, TLS material и static files на target; default nginx files не удаляются. `default` site позже отключается отдельно.

- [ ] **Step 6: Проверить права и отсутствие публичных секретов**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'for path in /home/dv/trientes-artifacts /home/dv/trientes-android /home/dv/.claude; do find "$path" -type d -exec chmod 700 {} +; find "$path" -type f -exec sh -c '"'"'for file; do if test -x "$file"; then chmod 700 "$file"; else chmod 600 "$file"; fi; done'"'"' sh {} +; done'
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && test -d .git && git status --short --branch && git rev-parse HEAD && git cat-file -e HEAD^{commit} && stat -c "%a %U:%G %n" .env ~/.pgpass ~/.trientes-dbpass ~/.trientes-bot-secret ~/.claude.json && test -x /home/dv/trientes-android/bin/build && test -d /var/www/trientes-exchange && test -L /var/www/trientes-downloads/trientes.apk'
```

Expected: standalone `.git` директория, рабочие `git status`/`cat-file`, SHA совпадает с `BASE_SHA`, `.env` и protected files mode 600 владельца `dv`; защищённые directories 0700, обычные files 0600, executable files включая `trientes-android/bin/build` 0700; APK symlink существует. Содержимое файлов не выводится.

### Task 5: Выполнить PostgreSQL и Redis rehearsal

**Files:**
- Create source/target staging dump и RDB
- Create target database `trientes` только как пустую rehearsal DB

- [ ] **Step 1: Снять и передать rehearsal PostgreSQL dump**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'install -d -m 700 /home/dv/migration-stage0 && pg_dump --host=127.0.0.1 --username=trientes --dbname=trientes --format=custom --file=/home/dv/migration-stage0/trientes-rehearsal.dump && chmod 600 /home/dv/migration-stage0/trientes-rehearsal.dump && sha256sum /home/dv/migration-stage0/trientes-rehearsal.dump'
ssh -o BatchMode=yes "dv@$OLD_IP" "rsync -a -e 'ssh -o BatchMode=yes' /home/dv/migration-stage0/trientes-rehearsal.dump 'dv@$NEW_IP:/home/dv/migration-stage0/trientes-rehearsal.dump'"
SOURCE_SHA=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sha256sum /home/dv/migration-stage0/trientes-rehearsal.dump | cut -d' ' -f1")
TARGET_SHA=$(ssh -o BatchMode=yes "dv@$NEW_IP" "sha256sum /home/dv/migration-stage0/trientes-rehearsal.dump | cut -d' ' -f1")
test "$SOURCE_SHA" = "$TARGET_SHA"
```

Expected: custom dump создан и побайтово совпадает на target.

- [ ] **Step 2: Создать роль и пустую БД без вывода пароля**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'python3 -' <<'PY'
from pathlib import Path
from urllib.parse import urlsplit, unquote
import subprocess
url = None
for line in Path('/home/dv/trientes/.env').read_text().splitlines():
    if line.startswith('DATABASE_URL='):
        url = line.split('=', 1)[1].strip().strip('"').strip("'")
        break
if not url:
    raise SystemExit('DATABASE_URL missing')
password = unquote(urlsplit(url).password or '')
if not password:
    raise SystemExit('Database password missing')
exists = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', "SELECT 1 FROM pg_roles WHERE rolname='trientes'"], check=True, capture_output=True, text=True).stdout.strip()
if not exists:
    literal = "'" + password.replace("'", "''") + "'"
    subprocess.run(['sudo', '-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1'], input=f'CREATE ROLE trientes LOGIN PASSWORD {literal};\n', text=True, check=True)
db_exists = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', "SELECT 1 FROM pg_database WHERE datname='trientes'"], check=True, capture_output=True, text=True).stdout.strip()
if db_exists:
    raise SystemExit('Refusing to restore over existing trientes DB')
subprocess.run(['sudo', '-u', 'postgres', 'createdb', '--owner=trientes', '--encoding=UTF8', '--locale=en_US.UTF-8', '--template=template0', 'trientes'], check=True)
print('Role verified and empty rehearsal database created')
PY
```

Expected: роль существует с исходным паролем, пустая `trientes` создана. Если БД уже существует, restore останавливается — сначала разобрать происхождение, не удалять её автоматически.

- [ ] **Step 3: Восстановить и сравнить counts без чтения пользовательских строк**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" 'set -e; install -d -m 700 -o postgres -g postgres /var/lib/postgresql/migration; install -m 600 -o postgres -g postgres /home/dv/migration-stage0/trientes-rehearsal.dump /var/lib/postgresql/migration/trientes-rehearsal.dump; sudo -u postgres test -r /var/lib/postgresql/migration/trientes-rehearsal.dump'
SOURCE_SHA=$(ssh -o BatchMode=yes "dv@$OLD_IP" "sha256sum /home/dv/migration-stage0/trientes-rehearsal.dump | cut -d' ' -f1")
POSTGRES_COPY_SHA=$(ssh -o BatchMode=yes "root@$NEW_IP" "sha256sum /var/lib/postgresql/migration/trientes-rehearsal.dump | cut -d' ' -f1")
test "$SOURCE_SHA" = "$POSTGRES_COPY_SHA"
ssh -o BatchMode=yes "root@$NEW_IP" 'sudo -u postgres pg_restore --exit-on-error --dbname=trientes /var/lib/postgresql/migration/trientes-rehearsal.dump'
COUNTS_SQL='SELECT (SELECT COUNT(*) FROM "CoinSnapshot") AS coin_snapshots, (SELECT MAX("fetchedAt") FROM "CoinSnapshot") AS latest_snapshot, (SELECT COUNT(*) FROM "User") AS users, (SELECT COUNT(*) FROM "Session") AS sessions, (SELECT COUNT(*) FROM "Account") AS accounts, (SELECT COUNT(*) FROM "Coin") AS coins, (SELECT COUNT(*) FROM "Exchange") AS exchanges, (SELECT COUNT(*) FROM "_prisma_migrations") AS migrations;'
ssh -o BatchMode=yes "dv@$OLD_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$COUNTS_SQL'"
ssh -o BatchMode=yes "dv@$NEW_IP" "psql --host=127.0.0.1 --username=trientes --dbname=trientes -c '$COUNTS_SQL'"
```

Expected: counts, `latest_snapshot` и migrations совпадают на момент дампа. Перед restore защищённая копия в `/var/lib/postgresql/migration` имеет владельца `postgres:postgres`, права `0700` на каталог и `0600` на dump и тот же SHA-256. Расхождение — блокер; не запускать migrations автоматически. Source продолжает принимать writes после дампа, поэтому сравнивай именно момент snapshot, а не последующий live дрейф.

- [ ] **Step 4: Проверить загрузку Redis RDB**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$OLD_IP" 'redis-cli SAVE && redis-cli CONFIG GET dir dbfilename && redis-cli DBSIZE'
ssh -o BatchMode=yes "dv@$OLD_IP" "sudo rsync -a -e 'ssh -i /home/dv/.ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=accept-new' /var/lib/redis/dump.rdb 'root@$NEW_IP:/root/migration-stage0/dump.rdb'"
ssh -o BatchMode=yes "root@$NEW_IP" 'set -e; systemctl stop redis-server; install -m 600 -o redis -g redis /root/migration-stage0/dump.rdb /var/lib/redis/dump.rdb; systemctl start redis-server; redis-cli PING; redis-cli DBSIZE; journalctl -u redis-server --since "5 minutes ago" --no-pager | grep -Ei "error|failed|corrupt" && exit 1 || true'
```

Expected: `PONG`, DBSIZE совпадает с источником на момент SAVE, нет RDB load errors. Старый Redis продолжает работать после rehearsal; финальный SAVE будет отдельно в cutover plan.

### Task 6: Собрать приложение и проверить миграции/тесты

**Files:**
- Rebuild only: `/home/dv/trientes/node_modules`, `.next`

- [ ] **Step 1: Проверить commit и установить dependencies из lockfile**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" "cd ~/trientes && test \"\$(git rev-parse HEAD)\" = '$BASE_SHA' && npm ci --legacy-peer-deps && npx prisma generate"
```

Expected: commit совпадает с `BASE_SHA`; dependencies установлены без изменения lockfile.

- [ ] **Step 2: Запустить полный test suite**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npm test'
```

Expected: все test files/tests passed. Исходный baseline был 449; для более нового clean SHA требуется прохождение всего актуального набора, а не именно старого числа.

- [ ] **Step 3: Проверить Prisma и production build**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && npx prisma migrate status && npm run build'
```

Expected: database schema up to date, никаких unexpected pending migrations; Next.js build успешен. Не выполнять `migrate dev` или новые migrations для устранения расхождений.

### Task 7: Настроить nginx/TLS и web-only rehearsal

**Files:**
- Modify target only: `/etc/nginx/sites-available/trientes`
- Create target backup: `/root/migration-stage0/trientes-nginx-before-ip.conf`
- Start only `trientes-web` через PM2

- [ ] **Step 1: Заменить старый IP только в новой live config**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "root@$NEW_IP" "NEW_IP='$NEW_IP' python3 -" <<'PY'
from pathlib import Path
import os, shutil
path = Path('/etc/nginx/sites-available/trientes')
backup = Path('/root/migration-stage0/trientes-nginx-before-ip.conf')
if backup.exists():
    raise SystemExit('Backup already exists; inspect before retry')
shutil.copy2(path, backup)
text = path.read_text()
if '85.192.25.242' not in text:
    raise SystemExit('Expected source IP not found in nginx config')
path.write_text(text.replace('85.192.25.242', os.environ['NEW_IP']))
PY
ssh -o BatchMode=yes "root@$NEW_IP" 'rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx'
```

Expected: domain server names сохранены, только literal IP заменён на target; `nginx -t` успешен. Git-шаблоны на старом сервере не изменяются.

- [ ] **Step 2: Запустить только web и сохранить web-only PM2 list**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && pm2 delete trientes-worker trientes-bot 2>/dev/null || true; pm2 start ecosystem.config.js --only trientes-web && pm2 save && sudo systemctl enable pm2-dv && pm2 status'
```

Expected: только `trientes-web` online; `trientes-worker` и `trientes-bot` отсутствуют в активном list и web-only dump. После reboot worker/bot не поднимутся.

- [ ] **Step 3: Проверить HTTPS, health и static routes через новый IP**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
curl -fsS --resolve "trientes.org:443:$NEW_IP" https://trientes.org/api/health
curl -fsSI --resolve "trientes.org:443:$NEW_IP" https://trientes.org/en
curl -fsSI --resolve "www.trientes.org:443:$NEW_IP" https://www.trientes.org/en
curl -fsSI --resolve "trientes.org:443:$NEW_IP" https://trientes.org/exchange/
curl -fsSI --resolve "trientes.org:443:$NEW_IP" https://trientes.org/downloads/trientes.apk
EXCHANGE_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" https://trientes.org/exchange-api/)
test "$EXCHANGE_CODE" -lt 500
```

Expected: health 200 с PostgreSQL/Redis ok; `@` и `www` имеют валидный TLS; `/exchange/` и APK доступны; `/exchange-api/` отвечает внешний upstream, а не 502/503/504. Bot route намеренно не проверяется до его запуска в cutover.

- [ ] **Step 4: Проверить privacy и отсутствие публичных internal ports**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
for path in '/.env' '/.git/config' '/uploads/kyb/' '/backups/'; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --resolve "trientes.org:443:$NEW_IP" "https://trientes.org$path")
  test "$code" = 403 -o "$code" = 404
done
for port in 3000 4100 5432 6379; do
  ! nc -vz -G 5 "$NEW_IP" "$port"
done
```

Expected: секреты/KYB/backups недоступны; внешние подключения к 3000/4100/5432/6379 не проходят. Не сканировать другие хосты или диапазоны.

- [ ] **Step 5: Проверить исходящие зависимости без worker**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'curl -fsS https://api.coingecko.com/api/v3/ping >/dev/null && curl -fsS https://api.binance.com/api/v3/ping >/dev/null && curl -fsS https://www.cnbc.com/id/100003114/device/rss/rss.html >/dev/null && curl -fsS https://cointelegraph.com/rss >/dev/null && printf "Outbound HTTP checks passed\n"'
ssh -o BatchMode=yes "dv@$NEW_IP" 'cd ~/trientes && node -e '"'"'require("dotenv").config(); fetch("https://api.telegram.org/bot"+process.env.TELEGRAM_BOT_TOKEN+"/getMe").then(r=>r.json()).then(j=>{console.log("Telegram getMe ok:",!!j.ok); if(!j.ok)process.exit(1)})'"'"''
```

Expected: outbound HTTP и Telegram `getMe ok: true`. Token не выводится; worker по-прежнему не запущен.

### Task 8: Зафиксировать rehearsal readiness

**Files:**
- Create protected report: `/Users/dmitry/.trientes-migration/stage0-readiness.md`
- Create protected security handoff: `/Users/dmitry/.trientes-migration/cutover-security-requirements.md`
- Create protected live-state handoff: `/Users/dmitry/.trientes-migration/cutover-data-delta-requirements.md`
- Create protected build handoff: `/Users/dmitry/.trientes-migration/cutover-build-requirements.md`
- Preserve sanitized Task 6 evidence: `/Users/dmitry/.trientes-migration/task6-*.log`
- Copy protected evidence: `/Users/dmitry/.trientes-migration/postfix-memory.csv`
- Preserve protected evidence: `/Users/dmitry/.trientes-migration/postfix-pm2.log`

- [ ] **Step 1: Проверить неизменность публичных DNS**

```bash
dig +noall +answer trientes.org A
dig +noall +answer www.trientes.org A
dig +noall +answer trientes.org MX
dig +noall +answer trientes.org NS
```

Expected: A `@`/`www` остаются `85.192.25.242`, MX и NS остаются IONOS. Любое неожиданное изменение — остановка и отдельный разбор.

- [ ] **Step 2: Записать readiness report**

Скопировать завершённые post-fix memory observations и проверить защищённые права:

```bash
source /Users/dmitry/.trientes-migration/stage0.env
scp -q -o BatchMode=yes "dv@$OLD_IP:/home/dv/migration-stage0/postfix-memory.csv" /Users/dmitry/.trientes-migration/postfix-memory.csv
chmod 600 /Users/dmitry/.trientes-migration/postfix-memory.csv /Users/dmitry/.trientes-migration/postfix-pm2.log
wc -l /Users/dmitry/.trientes-migration/postfix-memory.csv
```

Expected: не менее 120 строк при завершённом двухчасовом soak; при активном production-окне monitor не останавливается ради отчёта. Если процесс завершился раньше, сохранить имеющиеся данные и явно отметить причину, не выдумывать тренд. Отдельно зафиксировать изменения RSS/PID/restart count, не называя рост утечкой без heap/profile evidence.

В `/Users/dmitry/.trientes-migration/stage0-readiness.md` зафиксировать через Write:

- Droplet ID/IP, размер, backups и firewall;
- исходный `BASE_SHA`, locked baseline worktree и standalone `/home/dv/migration-stage0/source-clone` с рабочей `.git` директорией и совпадением checkout;
- post-fix PM2 events и фактическую динамику RSS/PID/restart count из `postfix-memory.csv`, без необоснованного вывода об утечке;
- результат restart diagnosis;
- SHA-256 rehearsal dump и RDB;
- DB counts/latest_snapshot/migrations и Redis DBSIZE;
- результаты build и полного test suite, включая явный статус `UNRESOLVED UPSTREAM/INTERMITTENT` для Next.js 16.2.6 Google Fonts и ссылку на `cutover-build-requirements.md`;
- HTTPS/health/static/privacy/outbound checks;
- подтверждение, что worker/bot не запускались, DNS не менялся;
- открытые замечания, если они есть, либо явное `Ready for separate DNS delegation plan: YES`.

Expected: report содержит только operational facts, без паролей, токенов, содержимого env, PII или секретного webhook path.

- [ ] **Step 3: Оставить безопасное состояние до следующего плана**

```bash
source /Users/dmitry/.trientes-migration/stage0.env
ssh -o BatchMode=yes "dv@$NEW_IP" 'pm2 status && systemctl is-enabled pm2-dv && pm2 describe trientes-web | grep -E "status|restarts|uptime"'
```

Expected: только web online; worker/bot не запущены; Droplet сохранён для отдельного DNS delegation plan. Временный Aeza SSH key остаётся ограниченным firewall и будет удалён в финальном cutover plan. Mailcow DNS/app не меняются.

- [ ] **Step 4: Зафиксировать обязательный отзыв временных привилегий**

Создать `/Users/dmitry/.trientes-migration/cutover-security-requirements.md` через Write с содержимым:

```markdown
# Обязательные действия cutover security

- [ ] Владелец задаёт `dv` сильный пароль интерактивно через `sudo passwd dv`; пароль не передаётся в команды, логи или чат.
- [ ] В `/etc/sudoers.d/dv` записать обычное правило `dv ALL=(ALL) ALL`, проверить `visudo -cf /etc/sudoers.d/dv` и свежую SSH-сессию с `sudo -k && sudo -v`.
- [ ] После подтверждения обычного sudo удалить `/etc/sudoers.d/90-dv-migration` с NOPASSWD и снова проверить `visudo` и `sudo -v`.
- [ ] После проверки независимого admin recovery установить `PermitRootLogin no`, выполнить `sshd -t` и reload SSH.
- [ ] Удалить временный Aeza public key из `/root/.ssh/authorized_keys` и `/home/dv/.ssh/authorized_keys`, сохранив admin key владельца.
- [ ] После окончательного вывода Aeza удалить `85.192.25.242/32` из SSH inbound в Cloud Firewall и UFW.
- [ ] Проверить, что 3000/4100/5432/6379 остаются закрыты, а worker/bot запущены только на новом сервере.
```

```bash
chmod 600 /Users/dmitry/.trientes-migration/cutover-security-requirements.md
```

Expected: файл mode 0600 и явно передан в будущий cutover plan. До успешного cutover временные NOPASSWD/root recovery остаются для rehearsal и не отзываются преждевременно.

- [ ] **Step 5: Зафиксировать финальную delta-синхронизацию живого state**

Создать `/Users/dmitry/.trientes-migration/cutover-data-delta-requirements.md` через Write:

```markdown
# Обязательный final data-delta перед cutover

- [ ] Подтвердить остановку bot, отсутствие Claude processes/deploys и остановку old web/worker.
- [ ] Сохранить UTC manifest изменений `.claude`, `.claude.json`, artifacts, incoming, `public/uploads` и `/var/www/trientes-*`.
- [ ] Сохранить защищённую копию target-only entries до любого `--delete`; cold archive не использовать как рабочий checkout.
- [ ] Выполнить itemized `rsync --dry-run` и отдельно проверить добавления/изменения/удаления без вывода секретов/PII.
- [ ] Для `.claude` применять `--delete` только после остановки writers и ручной проверки target-only entries; спорные entries архивировать, а не удалять.
- [ ] Повторно применить directories `0700`, non-executable files `0600`, executable files `0700`, сохранить symlinks/owners.
- [ ] Проверить SHA-256 изменённых файлов, counts/symlinks, Claude resume state и APK latest symlink.
- [ ] Cold archive и его broken `.env` symlink не использовать как рабочий checkout.
- [ ] Выполнить отдельные финальные PostgreSQL dump/restore и Redis SAVE/RDB copy; file delta не заменяет DB snapshots.
```

```bash
chmod 600 /Users/dmitry/.trientes-migration/cutover-data-delta-requirements.md
```

Expected: handoff mode 0600 и передан в будущий cutover plan. `--delete` на живом state до полной остановки writers и itemized dry-run запрещён.

- [ ] **Step 6: Зафиксировать unresolved Next.js build issue и путь финальной сборки**

Проверить наличие sanitized `/Users/dmitry/.trientes-migration/task6-npm-ci.log`, `task6-tests.log`, `task6-build-failed.log`, `task6-build-success.log`, `task6-migrate-status.log` и `task6-evidence.md` с mode 0600.

Создать `/Users/dmitry/.trientes-migration/cutover-build-requirements.md` через Write:

```markdown
# Обязательные требования к финальной сборке и cutover

## Статус
UNRESOLVED UPSTREAM/INTERMITTENT ISSUE — successful retry is a workaround, not a fix.

Сигнатуры: `Module not found @vercel/turbopack-next/internal/font/google/font`, `next/font/google queries have exactly one entry`, `NextFontGoogleFontFileReplacer`. BASE_SHA rehearsal: 8ce8539f2ffdabcab1edbad18731f829e72b3034. Подробности и BUILD_ID — в `task6-evidence.md`.

## Запрещено
- Не выполнять dependency upgrade или `npm audit fix` во время cutover.
- Не считать retry исправлением и не менять font import как случайный workaround.

## Выбрать один проверенный путь заранее
1. Отдельная задача: next + eslint-config-next 16.4.3, extensionless regression fixture, полный test suite и несколько чистых сборок до cutover.
2. Проверенный `.next`: зафиксировать BASE_SHA/BUILD_ID, защищённый архив с SHA-256 и проверить запуск именно этого BUILD_ID без чистой пересборки.

Контролируемый retry допустим только при совпадении известной error signature; новая ошибка — stop и отдельная диагностика. NFT warning документировать отдельно.
```

```bash
chmod 600 /Users/dmitry/.trientes-migration/cutover-build-requirements.md
```

Expected: handoff и sanitized logs mode 0600; readiness report прямо называет issue нерешённой и ссылается на выбранный путь сборки. Upgrade во время cutover запрещён.
