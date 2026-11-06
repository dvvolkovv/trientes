# Listing Mailcow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести почту `trientes.org` на существующий Mailcow и отправлять уведомление о каждой новой `CoinRequest` на `listing@trientes.org`, не рискуя сохранностью самой заявки.

**Architecture:** Существующие Next.js Server Actions и Prisma остаются источником истины. Общий `sendEmail` получает новый Nodemailer-транспорт через Mailcow; после `CoinRequest.create` выполняется синхронная best-effort отправка, а SMTP-сбой только логируется. DNS переключается после подготовки ящиков и прямой проверки Mailcow.

**Tech Stack:** Next.js 16 Server Actions, TypeScript, Prisma/PostgreSQL, Nodemailer 7, Vitest, Mailcow 2026-05c, IONOS DNS, PM2.

**Specification:** `docs/superpowers/specs/2026-11-06-listing-mailcow-design.md`

**Production:** `/home/dv/trientes` на `dv@85.192.25.242`; Mailcow: `/opt/mailcow-dockerized` на `root@mail.selyanska.eu`.

---

### Task 1: Зафиксировать исходное состояние и доступы

**Files:**
- Create locally, not Git: `/tmp/trientes-dns-before-2026-11-06.txt`

- [ ] **Step 1: Убедиться, что production checkout не содержит чужих изменений**

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 dv@85.192.25.242 'cd ~/trientes && git status --short --branch && git log -1 --oneline'
```

Expected: вывод `## main...origin/main` без изменённых tracked-файлов. При чужом WIP остановиться и согласовать интеграцию; не использовать `reset`, `clean` или stash.

- [ ] **Step 2: Сохранить текущие DNS для rollback**

```bash
{
  printf 'MX\n'; dig +noall +answer trientes.org MX;
  printf '\nSPF\n'; dig +noall +answer trientes.org TXT;
  printf '\nDMARC\n'; dig +noall +answer _dmarc.trientes.org CNAME; dig +noall +answer _dmarc.trientes.org TXT;
  printf '\nDKIM\n'; dig +noall +answer dkim._domainkey.trientes.org TXT;
} > /tmp/trientes-dns-before-2026-11-06.txt
```

Expected: файл содержит два IONOS MX, SPF IONOS и `_dmarc CNAME dmarc.ionos.de`; Mailcow DKIM отсутствует.

- [ ] **Step 3: Проверить Mailcow и отсутствие ранее созданного домена**

```bash
ssh -o BatchMode=yes root@165.245.254.8 'cd /opt/mailcow-dockerized && docker compose ps --status running && docker compose exec -T mysql-mailcow sh -c '"'"'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT domain FROM domain WHERE domain=\"trientes.org\"; SELECT username FROM mailbox WHERE username LIKE \"%@trientes.org\";"'"'"''
```

Expected: основные контейнеры running; оба SELECT пустые. Если домен уже появился из-за параллельной работы, не создавать дубликат — проверить конфигурацию и продолжить только после согласования.

- [ ] **Step 4: Подготовить защищённый локальный каталог для учётных данных**

```bash
install -m 700 -d /Users/dmitry/.trientes-mail
```

Expected: каталог доступен только владельцу. Секреты не сохраняются в репозиторий, claude-mem или вывод команд.

### Task 2: Создать домен, ящики, алиасы и DKIM в Mailcow

**Files:**
- Create temporarily on Mailcow: `/root/.trientes-mail-passwords.json`
- Create temporarily on Mailcow: `/root/trientes-mailcow-setup/`
- Create on Mailcow: `/root/trientes-dkim.txt`
- Create locally, protected: `/Users/dmitry/.trientes-mail/passwords.json`
- Create locally, public: `/Users/dmitry/.trientes-mail/dkim.txt`

- [ ] **Step 1: Создать случайные пароли и объекты через официальный API**

Команда использует существующий активный read-write API key, читая его из MySQL без вывода. Пароли генерируются как 64 hex-символа и не печатаются. Ответы API проверяются без вывода request log.

```bash
ssh -o BatchMode=yes root@165.245.254.8 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/mailcow-dockerized
test ! -e /root/.trientes-mail-passwords.json
test ! -d /root/trientes-mailcow-setup
install -m 700 -d /root/trientes-mailcow-setup
install -m 600 /dev/null /root/.trientes-mail-passwords.json
python3 - <<'PY'
import json, secrets
from pathlib import Path
Path('/root/.trientes-mail-passwords.json').write_text(json.dumps({
    'listing': secrets.token_hex(32),
    'noreply': secrets.token_hex(32),
}) + '\n')
PY
API_KEY=$(docker compose exec -T mysql-mailcow sh -c 'mysql -N -B -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT api_key FROM api WHERE access=\"rw\" AND active=1 ORDER BY created DESC LIMIT 1"')
test -n "$API_KEY"
mailcow_post() {
  local endpoint="$1" payload="$2" response
  response=$(mktemp /root/mailcow-response.XXXXXX)
  if ! curl -fsS -H "X-API-Key: $API_KEY" -H 'Content-Type: application/json' \
    --data "@$payload" "https://mail.selyanska.eu/api/v1/$endpoint" > "$response" || \
    ! jq -e 'if type == "array" then length > 0 and all(.[]; .type == "success") else .type == "success" end' "$response" > /dev/null; then
    printf 'Mailcow API failed: %s\n' "$endpoint" >&2
    rm -f "$response"
    return 1
  fi
  rm -f "$response"
  printf 'Mailcow API succeeded: %s\n' "$endpoint"
}
jq -n '{
  active: true, aliases: 10, backupmx: false, defquota: 2048,
  description: "Trientes listing and website notifications",
  domain: "trientes.org", gal: true, mailboxes: 10, maxquota: 2048,
  quota: 4096, restart_sogo: 1, relay_all_recipients: false,
  rl_frame: "s", rl_value: 10
}' > /root/trientes-mailcow-setup/domain.json
mailcow_post add/domain /root/trientes-mailcow-setup/domain.json
for local_part in listing noreply; do
  jq -n --arg local_part "$local_part" --slurpfile passwords /root/.trientes-mail-passwords.json '{
    active: true, domain: "trientes.org", local_part: $local_part,
    name: (if $local_part == "listing" then "Trientes Listing Requests" else "Trientes Notifications" end),
    authsource: "mailcow", password: $passwords[0][$local_part],
    password2: $passwords[0][$local_part], quota: 2048,
    force_pw_update: false, tls_enforce_in: false, tls_enforce_out: false
  }' > "/root/trientes-mailcow-setup/$local_part.json"
  mailcow_post add/mailbox "/root/trientes-mailcow-setup/$local_part.json"
done
for local_part in postmaster abuse dmarc; do
  jq -n --arg local_part "$local_part" '{
    active: true, address: ($local_part + "@trientes.org"),
    goto: "listing@trientes.org", sogo_visible: false
  }' > "/root/trientes-mailcow-setup/alias-$local_part.json"
  mailcow_post add/alias "/root/trientes-mailcow-setup/alias-$local_part.json"
done
if ! curl -fsS -H "X-API-Key: $API_KEY" https://mail.selyanska.eu/api/v1/get/dkim/trientes.org > /root/trientes-dkim.json || \
   ! jq -e '.dkim_txt | length > 0' /root/trientes-dkim.json > /dev/null; then
  jq -n '{dkim_selector: "dkim", domains: "trientes.org", key_size: 2048}' > /root/trientes-mailcow-setup/dkim.json
  mailcow_post add/dkim /root/trientes-mailcow-setup/dkim.json
  curl -fsS -H "X-API-Key: $API_KEY" https://mail.selyanska.eu/api/v1/get/dkim/trientes.org > /root/trientes-dkim.json
fi
jq -e -r '.dkim_txt' /root/trientes-dkim.json > /root/trientes-dkim.txt
printf 'Domain, mailboxes, aliases and DKIM are configured.\n'
REMOTE
```

Expected: `add/domain`, два `add/mailbox` и три `add/alias` succeeded. DKIM только прочитан: домен создаёт его автоматически из шаблона `Default`; `add/dkim` выполняется лишь если ключ отсутствует.

- [ ] **Step 2: Проверить результат read-only SQL**

```bash
ssh -o BatchMode=yes root@165.245.254.8 'cd /opt/mailcow-dockerized && docker compose exec -T mysql-mailcow sh -c '"'"'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT domain,active,mailboxes,quota FROM domain WHERE domain=\"trientes.org\"; SELECT username,quota,active FROM mailbox WHERE username LIKE \"%@trientes.org\" ORDER BY username; SELECT address FROM alias WHERE domain=\"trientes.org\" ORDER BY address;"'"'"''
```

Expected: домен active; mailbox `listing@` и `noreply@`, quota 2048; aliases `abuse@`, `dmarc@`, `postmaster@`. Пароли и API key в выводе отсутствуют.

- [ ] **Step 3: Скопировать учётные данные и публичный DKIM на ноутбук**

```bash
test ! -e /Users/dmitry/.trientes-mail/passwords.json
test ! -e /Users/dmitry/.trientes-mail/dkim.txt
scp -q -o BatchMode=yes root@165.245.254.8:/root/.trientes-mail-passwords.json /Users/dmitry/.trientes-mail/passwords.json
scp -q -o BatchMode=yes root@165.245.254.8:/root/trientes-dkim.txt /Users/dmitry/.trientes-mail/dkim.txt
chmod 600 /Users/dmitry/.trientes-mail/passwords.json /Users/dmitry/.trientes-mail/dkim.txt
```

Expected: файлы созданы с mode 600; их содержимое не выводится в терминал. `passwords.json` нужен владельцу для SOGo/IMAP, `dkim.txt` публичен и используется для DNS.

- [ ] **Step 4: Проверить прямую входящую доставку до смены MX**

```bash
ssh -o BatchMode=yes root@165.245.254.8 'swaks --server 165.245.254.8 --port 25 --from noreply@selyanska.eu --to listing@trientes.org --subject "Direct pre-MX Trientes test" --body "Direct Mailcow delivery test before MX cutover." --timeout 15'
ssh -o BatchMode=yes root@165.245.254.8 'cd /opt/mailcow-dockerized && docker compose exec -T dovecot-mailcow doveadm search -u listing@trientes.org ALL'
```

Expected: swaks завершается `250 OK`; `doveadm search` возвращает mailbox GUID и UID тестового письма. При ошибке получателя или доставки MX не переключать.

### Task 3: Переключить DNS, проверить почту и настроить production env

**Files:**
- Production only, not Git: `/home/dv/trientes/.env.local`
- Protected backup if env exists: `/home/dv/.trientes-env.local.before-mailcow`
- Temporary protected file: `/home/dv/.trientes-smtp-pass`

- [ ] **Step 1: Войти в IONOS и опубликовать DNS**

В уже открытом браузере перейти на `https://my.ionos.com/`; попросить владельца выполнить вход самостоятельно, если сессия не активна. Пароль в чат не запрашивать. Открыть Domains & SSL → `trientes.org` → DNS и выполнить четыре изменения:

1. Удалить MX `mx00.ionos.de` и `mx01.ionos.de`; добавить `trientes.org MX 10 mail.selyanska.eu.`.
2. В `dkim._domainkey.trientes.org TXT` поместить точное содержимое `/Users/dmitry/.trientes-mail/dkim.txt`, без добавления переносов или кавычек внутри значения.
3. Заменить SPF TXT домена на `v=spf1 mx ~all`; других SPF TXT не оставлять.
4. Удалить `_dmarc.trientes.org CNAME dmarc.ionos.de`; создать `_dmarc.trientes.org TXT` со значением `v=DMARC1; p=none; rua=mailto:dmarc@trientes.org`.

Expected: панель сохраняет все записи без ошибок. A-запись сайта не изменяется.

- [ ] **Step 2: Проверить публичные DNS через два resolver'а**

```bash
for resolver in 1.1.1.1 8.8.8.8; do
  printf '\nResolver %s\n' "$resolver"
  dig +noall +answer "@$resolver" trientes.org MX
  dig +noall +answer "@$resolver" trientes.org TXT
  dig +noall +answer "@$resolver" dkim._domainkey.trientes.org TXT
  dig +noall +answer "@$resolver" _dmarc.trientes.org TXT
done
```

Expected: только `MX 10 mail.selyanska.eu.`; одна SPF `v=spf1 mx ~all`; DKIM совпадает с `/Users/dmitry/.trientes-mail/dkim.txt`; DMARC `p=none` с `dmarc@trientes.org`. При stale negative cache дождаться TTL и повторить, не создавая дублирующие записи.

- [ ] **Step 3: Проверить внешний приём письма**

Попросить владельца отправить с внешнего почтового адреса письмо с темой `External Trientes MX test` и пустым тестовым текстом на `listing@trientes.org`, затем выполнить:

```bash
ssh -o BatchMode=yes root@165.245.254.8 'cd /opt/mailcow-dockerized && docker compose exec -T dovecot-mailcow doveadm search -u listing@trientes.org SUBJECT "External Trientes MX test"'
```

Expected: `doveadm search` возвращает UID внешнего письма. Дополнительно владелец может открыть его в SOGo, используя `listing@trientes.org` и пароль из защищённого `/Users/dmitry/.trientes-mail/passwords.json`.

- [ ] **Step 4: Проверить исходящую SMTP-аутентификацию и подписи**

Открыть `https://www.mail-tester.com/` и сохранить показанный одноразовый адрес одной строкой через Write в `/Users/dmitry/.trientes-mail/mail-tester-address`. Это публичный временный адрес, не секрет. Передать его на Mailcow и отправить письмо; тело содержит только тестовую фразу, никаких пользовательских данных.

```bash
scp -q -o BatchMode=yes /Users/dmitry/.trientes-mail/mail-tester-address root@165.245.254.8:/root/trientes-test-recipient
ssh -o BatchMode=yes root@165.245.254.8 'python3 -' <<'PY'
import json, smtplib, ssl
from email.message import EmailMessage
from pathlib import Path
password = json.load(open('/root/.trientes-mail-passwords.json'))['noreply']
recipient = Path('/root/trientes-test-recipient').read_text().strip()
msg = EmailMessage()
msg['From'] = 'noreply@trientes.org'
msg['To'] = recipient
msg['Subject'] = 'Trientes Mailcow authentication test'
msg.set_content('Trientes Mailcow SPF, DKIM and DMARC verification message.')
with smtplib.SMTP('mail.selyanska.eu', 587, timeout=20) as smtp:
    smtp.starttls(context=ssl.create_default_context())
    smtp.login('noreply@trientes.org', password)
    smtp.send_message(msg)
print('SMTP accepted the authentication test message')
PY
ssh -o BatchMode=yes root@165.245.254.8 'rm -f /root/trientes-test-recipient'
```

Expected: `SMTP accepted...`; mail-tester подтверждает SPF, DKIM и DMARC pass. DMARC policy `p=none` допустима. Пароль не печатается и не входит в аргументы команды.

- [ ] **Step 5: Передать SMTP-пароль на Trientes без вывода**

```bash
jq -r '.noreply' /Users/dmitry/.trientes-mail/passwords.json > /Users/dmitry/.trientes-mail/noreply.pass
chmod 600 /Users/dmitry/.trientes-mail/noreply.pass
scp -q -o BatchMode=yes /Users/dmitry/.trientes-mail/noreply.pass dv@85.192.25.242:/home/dv/.trientes-smtp-pass
ssh -o BatchMode=yes dv@85.192.25.242 'chmod 600 /home/dv/.trientes-smtp-pass'
```

Expected: файл на сервере имеет mode 600; пароль не появляется в выводе или командной строке.

- [ ] **Step 6: Обновить `.env.local`, сохранив остальные переменные и backup**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'python3 -' <<'PY'
from pathlib import Path
import os, shutil
env_path = Path('/home/dv/trientes/.env.local')
password = Path('/home/dv/.trientes-smtp-pass').read_text().strip()
updates = {
    'SMTP_HOST': 'mail.selyanska.eu',
    'SMTP_PORT': '587',
    'SMTP_USER': 'noreply@trientes.org',
    'SMTP_PASS': password,
    'SMTP_FROM_EMAIL': 'noreply@trientes.org',
    'LISTING_REQUESTS_TO': 'listing@trientes.org',
}
if env_path.exists():
    backup = Path('/home/dv/.trientes-env.local.before-mailcow')
    if backup.exists():
        raise SystemExit('Backup already exists; inspect it before retrying')
    shutil.copy2(env_path, backup)
    os.chmod(backup, 0o600)
    lines = env_path.read_text().splitlines()
else:
    lines = []
result = []
seen = set()
for line in lines:
    key = line.split('=', 1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else None
    if key in updates:
        if key not in seen:
            result.append(f'{key}={updates[key]}')
            seen.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f'{key}={value}')
tmp = env_path.with_suffix('.mailcow.tmp')
tmp.write_text('\n'.join(result) + '\n')
os.chmod(tmp, 0o600)
tmp.replace(env_path)
print('Updated only: ' + ', '.join(updates))
PY
ssh -o BatchMode=yes dv@85.192.25.242 'rm -f /home/dv/.trientes-smtp-pass && cd ~/trientes && git check-ignore .env.local && test "$(stat -c %a .env.local)" = 600'
```

Expected: напечатаны только имена обновлённых ключей; `.env.local` игнорируется Git и имеет mode 600; временный пароль удалён.

- [ ] **Step 7: Удалить временные секреты с Mailcow**

```bash
ssh -o BatchMode=yes root@165.245.254.8 'find /root/trientes-mailcow-setup -type f -exec shred -u {} +; rmdir /root/trientes-mailcow-setup; shred -u /root/.trientes-mail-passwords.json'
rm -f /Users/dmitry/.trientes-mail/noreply.pass /Users/dmitry/.trientes-mail/mail-tester-address
```

Expected: payload-файлы и корневая копия паролей удалены. Защищённая локальная копия `/Users/dmitry/.trientes-mail/passwords.json` остаётся владельцу для доступа к `listing@`.


### Task 4: Установить Nodemailer

**Files:**
- Modify: `/home/dv/trientes/package.json`
- Modify: `/home/dv/trientes/package-lock.json`

- [ ] **Step 1: Установить runtime- и dev-зависимости отдельными командами**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npm install nodemailer@7 && npm install --save-dev @types/nodemailer@7'
```

Expected: команды завершаются с exit code 0; Resend пока остаётся установленным, поэтому текущий код продолжает работать.

- [ ] **Step 2: Проверить версии**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npm ls nodemailer @types/nodemailer --depth=0'
```

Expected: `nodemailer@7.x.x` и `@types/nodemailer@7.x.x`, без `npm ERR!`.

- [ ] **Step 3: Закоммитить и отправить только зависимости**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && git add package.json package-lock.json && git diff --cached --check && git commit -m "chore: добавить nodemailer для SMTP" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && git push origin main'
```

Expected: создан один коммит только с `package.json` и `package-lock.json`; push завершился успешно.

### Task 5: Перевести общий email-helper на SMTP через TDD

**Files:**
- Create: `/home/dv/trientes/tests/email.test.ts`
- Modify: `/home/dv/trientes/src/lib/email.ts`
- Modify: `/home/dv/trientes/package.json`
- Modify: `/home/dv/trientes/package-lock.json`

- [ ] **Step 1: Написать failing-тесты транспорта**

Создать `tests/email.test.ts` полностью:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
  createTransport: mocks.createTransport,
}));

async function loadEmail() {
  return import("@/lib/email");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  mocks.createTransport.mockReset();
  mocks.sendMail.mockReset();
  mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
  vi.stubEnv("SMTP_HOST", "mail.selyanska.eu");
  vi.stubEnv("SMTP_PORT", "587");
  vi.stubEnv("SMTP_USER", "noreply@trientes.org");
  vi.stubEnv("SMTP_PASS", "unit-test-password");
  vi.stubEnv("SMTP_FROM_EMAIL", "noreply@trientes.org");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendEmail SMTP", () => {
  it("configures STARTTLS and sends escaped text/html", async () => {
    mocks.sendMail.mockResolvedValue({
      accepted: ["listing@trientes.org"],
      rejected: [],
    });
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({
      to: "listing@trientes.org",
      subject: "New request req_1",
      text: "<b>Coin</b>\nA & B",
    })).resolves.toEqual({ ok: true });

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: "mail.selyanska.eu",
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: {
        user: "noreply@trientes.org",
        pass: "unit-test-password",
      },
    });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: "noreply@trientes.org",
      to: "listing@trientes.org",
      subject: "New request req_1",
      text: "<b>Coin</b>\nA & B",
      html: "&lt;b&gt;Coin&lt;/b&gt;&lt;br/&gt;A &amp; B",
    });
  });

  it("does not call SMTP without credentials", async () => {
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({
      to: "listing@trientes.org",
      subject: "Subject",
      text: "Body",
    })).resolves.toEqual({ ok: false, reason: "email_not_configured" });
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("rejects CR/LF in recipient and subject before SMTP", async () => {
    const { sendEmail } = await loadEmail();

    for (const input of [
      { to: "to@example.com\r\nBCC: victim@example.com", subject: "Subject", text: "Body" },
      { to: "to@example.com", subject: "Subject\nBCC: victim@example.com", text: "Body" },
    ]) {
      await expect(sendEmail(input)).resolves.toEqual({
        ok: false,
        reason: "invalid_email_header",
      });
    }
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("rejects CR/LF in the configured sender before SMTP", async () => {
    vi.stubEnv("SMTP_FROM_EMAIL", "from@example.com\r\nBCC: victim@example.com");
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({
      to: "to@example.com",
      subject: "Subject",
      text: "Body",
    })).resolves.toEqual({ ok: false, reason: "invalid_email_header" });
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("normalises errors and never leaks the SMTP secret", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendMail.mockRejectedValue(new Error("535 super-secret-password"));
    const { sendEmail } = await loadEmail();

    const result = await sendEmail({
      to: "to@example.com",
      subject: "Subject",
      text: "Body",
    });

    expect(result).toEqual({ ok: false, reason: "smtp_send_failed" });
    expect(JSON.stringify(result)).not.toContain("super-secret-password");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("super-secret-password");
  });

  it("does not count a fully rejected recipient as delivered", async () => {
    mocks.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ["to@example.com"],
    });
    const { sendEmail } = await loadEmail();

    await expect(sendEmail({
      to: "to@example.com",
      subject: "Subject",
      text: "Body",
    })).resolves.toEqual({ ok: false, reason: "smtp_recipient_rejected" });
  });
});
```

- [ ] **Step 2: Запустить тест и подтвердить RED**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npx vitest run tests/email.test.ts'
```

Expected: FAIL: старый Resend-helper не вызывает `createTransport` и возвращает `email_not_configured` в успешном сценарии.

- [ ] **Step 3: Заменить `src/lib/email.ts` минимальной SMTP-реализацией**

```ts
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;
let warned = false;

function getTransporter(): Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    if (!warned) {
      console.warn("[email] SMTP credentials missing — email sending disabled");
      warned = true;
    }
    return null;
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure = port === 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "mail.selyanska.eu",
      port,
      secure,
      requireTLS: !secure,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      auth: { user, pass },
    });
  }
  return transporter;
}

function hasHeaderInjection(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char]!;
  });
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const from = process.env.SMTP_FROM_EMAIL ?? process.env.SMTP_USER ?? "";
  if ([input.to, input.subject, from].some(hasHeaderInjection)) {
    return { ok: false, reason: "invalid_email_header" };
  }

  try {
    const smtp = getTransporter();
    if (!smtp) return { ok: false, reason: "email_not_configured" };
    const info = await smtp.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? escapeHtml(input.text).replace(/\n/g, "<br/>"),
    });
    if (!Array.isArray(info.accepted) || info.accepted.length === 0) {
      return { ok: false, reason: "smtp_recipient_rejected" };
    }
    return { ok: true };
  } catch {
    console.error("[email] SMTP send failed");
    return { ok: false, reason: "smtp_send_failed" };
  }
}
```

- [ ] **Step 4: Запустить тест и подтвердить GREEN**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npx vitest run tests/email.test.ts'
```

Expected: 6 tests passed, 0 failed.

- [ ] **Step 5: Удалить Resend только после проверки отсутствия его импортов**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && ! grep -R -E "from \"resend\"|require\(\"resend\"\)" src && npm uninstall resend && npx vitest run tests/email.test.ts'
```

Expected: grep не находит импортов; uninstall завершается успешно; те же 6 tests passed.

- [ ] **Step 6: Закоммитить и отправить транспорт**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && git add src/lib/email.ts tests/email.test.ts package.json package-lock.json && git diff --cached --check && git commit -m "feat(email): перейти на Mailcow SMTP" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && git push origin main'
```

Expected: коммит содержит helper, тест и удаление Resend из зависимостей; push успешен.

### Task 6: Отправлять уведомление после создания CoinRequest через TDD

**Files:**
- Create: `/home/dv/trientes/tests/coin-request-action.test.ts`
- Modify: `/home/dv/trientes/src/app/actions/coin-request.ts`

- [ ] **Step 1: Написать failing-тесты Server Action**

Создать `tests/coin-request-action.test.ts` полностью:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitCoinRequest } from "@/app/actions/coin-request";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  sendEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    coinRequest: {
      count: mocks.count,
      create: mocks.create,
    },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

const validInput = {
  name: "Foo Chain",
  symbol: "FOO",
  coingeckoId: "foo-chain",
  reason: "Excellent project to track.",
};

function createdRequest() {
  return {
    id: "req_123",
    userId: "user_1",
    createdAt: new Date("2026-11-06T12:00:00.000Z"),
    name: "Foo Chain",
    symbol: "FOO",
    coingeckoId: "foo-chain",
    reason: "Excellent project to track.",
    user: { email: "owner@example.com", username: "owner" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("NEXTAUTH_URL", "https://trientes.org/");
  mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue(createdRequest());
  mocks.sendEmail.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("submitCoinRequest listing notification", () => {
  it("stores first, then sends one complete listing email", async () => {
    await expect(submitCoinRequest(validInput)).resolves.toEqual({ ok: true });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        name: "Foo Chain",
        symbol: "FOO",
        coingeckoId: "foo-chain",
        reason: "Excellent project to track.",
      },
      include: { user: { select: { email: true, username: true } } },
    });
    expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendEmail.mock.invocationCallOrder[0],
    );
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("listing@trientes.org");
    expect(mail.subject).toBe("New Trientes listing request req_123");
    for (const part of [
      "Request ID: req_123",
      "Created: 2026-11-06T12:00:00.000Z",
      "User ID: user_1",
      "Username: owner",
      "Email: owner@example.com",
      "Coin: Foo Chain (FOO)",
      "CoinGecko ID: foo-chain",
      "Excellent project to track.",
      "https://trientes.org/en/admin/requests",
    ]) {
      expect(mail.text).toContain(part);
    }
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("keeps the saved request and revalidates when SMTP returns failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockResolvedValue({ ok: false, reason: "smtp_send_failed" });

    await expect(submitCoinRequest(validInput)).resolves.toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(errorSpy).toHaveBeenCalledWith(
      "[coin-request] listing notification failed",
      { requestId: "req_123", reason: "smtp_send_failed" },
    );
  });

  it("keeps the saved request when the email helper throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendEmail.mockRejectedValue(new Error("unexpected secret"));

    await expect(submitCoinRequest(validInput)).resolves.toEqual({ ok: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(errorSpy).toHaveBeenCalledWith(
      "[coin-request] listing notification failed",
      { requestId: "req_123", reason: "email_helper_exception" },
    );
  });

  it("does not create a request or email above the pending limit", async () => {
    mocks.count.mockResolvedValue(10);

    await expect(submitCoinRequest(validInput)).resolves.toEqual({
      ok: false,
      reason: "too_many_pending",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("never puts user-controlled CR/LF in the subject", async () => {
    mocks.create.mockResolvedValue({
      ...createdRequest(),
      name: "Foo\r\nBCC: victim@example.com",
    });

    await submitCoinRequest({
      ...validInput,
      name: "Foo\r\nBCC: victim@example.com",
    });

    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.subject).toBe("New Trientes listing request req_123");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Запустить тест и подтвердить RED**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npx vitest run tests/coin-request-action.test.ts'
```

Expected: FAIL: текущий action не вызывает `sendEmail` и не включает пользователя в `create`.

- [ ] **Step 3: Обновить `src/app/actions/coin-request.ts` полностью**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCoinRequest } from "@/lib/coin-request";
import { sendEmail } from "@/lib/email";

const MAX_PENDING_PER_USER = 10;

export async function submitCoinRequest(input: {
  name: string;
  symbol: string;
  coingeckoId?: string;
  reason: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const validated = validateCoinRequest(input);
  if (!validated.ok) return { ok: false, reason: validated.reason };

  // Anti-spam: limit pending requests per user.
  const pendingCount = await prisma.coinRequest.count({
    where: { userId, status: "PENDING" },
  });
  if (pendingCount >= MAX_PENDING_PER_USER) {
    return { ok: false, reason: "too_many_pending" };
  }

  const request = await prisma.coinRequest.create({
    data: {
      userId,
      name: validated.data.name,
      symbol: validated.data.symbol,
      coingeckoId: validated.data.coingeckoId,
      reason: validated.data.reason,
    },
    include: { user: { select: { email: true, username: true } } },
  });

  try {
    const origin = (process.env.NEXTAUTH_URL ?? "https://trientes.org").replace(/\/+$/, "");
    const result = await sendEmail({
      to: process.env.LISTING_REQUESTS_TO ?? "listing@trientes.org",
      subject: `New Trientes listing request ${request.id}`,
      text: [
        "New coin listing request",
        `Request ID: ${request.id}`,
        `Created: ${request.createdAt.toISOString()}`,
        `User ID: ${request.userId}`,
        `Username: ${request.user.username ?? "not provided"}`,
        `Email: ${request.user.email ?? "not provided"}`,
        `Coin: ${request.name} (${request.symbol})`,
        `CoinGecko ID: ${request.coingeckoId ?? "not provided"}`,
        "",
        "Reason:",
        request.reason,
        "",
        `Moderate: ${origin}/en/admin/requests`,
      ].join("\n"),
    });
    if (!result.ok) {
      console.error("[coin-request] listing notification failed", {
        requestId: request.id,
        reason: result.reason ?? "unknown",
      });
    }
  } catch {
    console.error("[coin-request] listing notification failed", {
      requestId: request.id,
      reason: "email_helper_exception",
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 4: Запустить новый и существующий тесты заявки**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npx vitest run tests/coin-request-action.test.ts tests/coin-request.test.ts'
```

Expected: 5 новых tests и 9 существующих tests passed, 0 failed.

- [ ] **Step 5: Закоммитить и отправить уведомление**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && git add src/app/actions/coin-request.ts tests/coin-request-action.test.ts && git diff --cached --check && git commit -m "feat(requests): отправлять новую заявку на listing-почту" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && git push origin main'
```

Expected: коммит содержит только action и его тест; push успешен.

### Task 7: Обновить конфигурацию, проверить и развернуть

**Files:**
- Modify: `/home/dv/trientes/.env.example`
- Modify: `/home/dv/trientes/src/lib/notify.ts`
- Modify: `/home/dv/trientes/src/app/actions/email-verify.ts`
- Modify: `/home/dv/trientes/package.json`
- Modify: `/home/dv/trientes/package-lock.json`
- Production only, not Git: `/home/dv/trientes/.env.local`

- [ ] **Step 1: Заменить email-блок в `.env.example`**

Удалить блок:

```dotenv
# Email (Resend) — optional. Without these, approve/reject emails are silently skipped.
RESEND_API_KEY=
RESEND_FROM_EMAIL=notifications@trientes.org
```

Добавить на его место:

```dotenv
# Email via Mailcow SMTP. Without credentials, email sending is skipped.
SMTP_HOST=mail.selyanska.eu
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=noreply@trientes.org
LISTING_REQUESTS_TO=listing@trientes.org
```

- [ ] **Step 2: Обновить только имена и комментарии в notification callers**

В `src/lib/notify.ts` заменить импорт:

```ts
import { sendEmail } from "@/lib/email";
```

Удалить старый комментарий про Resend и оставить:

```ts
// Email goes through the shared src/lib/email.ts wrapper (Mailcow SMTP).
// That helper reports missing SMTP credentials as email_not_configured.
```

Внутри `notifyUser` заменить вызов:

```ts
const r = await sendEmail({ to: user.email, subject, text: input.text, html: input.html });
```

В `src/app/actions/email-verify.ts` заменить комментарий при ошибке отправки:

```ts
// Surface a non-blocking warning so the user can ask the operator to set up SMTP.
```

- [ ] **Step 3: Проверить отсутствие Resend и секретов в diff**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && ! grep -R -i "resend" src .env.example package.json && git diff --check && ! git diff --name-only | grep -E "(^|/)\.env(\.local)?$" && ! git diff --cached --name-only | grep -E "(^|/)\.env(\.local)?$" && git status --short'
```

Expected: Resend не найден; `.env.local` отсутствует в Git diff; в status только перечисленные в задаче tracked-файлы.

- [ ] **Step 4: Запустить полный набор проверок**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && npm test && npx eslint src/lib/email.ts src/lib/notify.ts src/app/actions/coin-request.ts src/app/actions/email-verify.ts tests/email.test.ts tests/coin-request-action.test.ts && npx tsc --noEmit && npm run build'
```

Expected: все Vitest suites passed; ESLint и TypeScript без ошибок; Next.js production build завершён успешно. Любая ошибка останавливает rollout до исправления.

- [ ] **Step 5: Закоммитить и отправить конфигурационную очистку**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && git add .env.example src/lib/notify.ts src/app/actions/email-verify.ts package.json package-lock.json && git diff --cached --check && git commit -m "chore(email): обновить конфигурацию под Mailcow" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && git push origin main'
```

Expected: секретов в staged diff нет; push успешен. Если `package.json` и lock не изменились после Task 5, Git просто не включит их в этот коммит.

- [ ] **Step 6: Перезапустить только затронутые процессы**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && pm2 restart trientes-web trientes-worker && pm2 save && pm2 status'
```

Expected: `trientes-web`, `trientes-worker` и `trientes-bot` имеют status `online`. `trientes-bot` не перезапускается этой командой.

- [ ] **Step 7: Проверить health endpoint и логи без секретов**

```bash
curl -fsS https://trientes.org/api/health
ssh -o BatchMode=yes dv@85.192.25.242 'pm2 logs trientes-web --lines 40 --nostream; pm2 logs trientes-worker --lines 40 --nostream'
```

Expected: health endpoint возвращает HTTP 200; в новых логах нет SMTP-паролей, строк авторизации и тел писем. Существующие исторические записи логов не считываются сверх необходимых 40 строк.

- [ ] **Step 8: Подать и проверить тестовую заявку**

В браузере открыть `https://trientes.org/en/request`, войти через контрольный аккаунт и отправить:

```text
Name: SMTP Mail Test
Symbol: SMTPTEST
CoinGecko ID: оставить пустым
Reason: Test listing request for Mailcow verification on 2026-11-06; reject after verification.
```

Expected:

- форма сообщает об успехе;
- запись `SMTPTEST` со статусом `PENDING` видна в `https://trientes.org/en/admin/requests`;
- в SOGo `listing@trientes.org` появилось одно письмо с темой `New Trientes listing request <id>`;
- письмо содержит ID, пользователя, монету, reason и корректную ссылку на админку;
- заявитель не получил автоответ.

Проверить запись на сервере без вывода чужих заявок:

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && node -e '"'"'require("dotenv").config(); const {PrismaClient}=require("@prisma/client"); const p=new PrismaClient(); p.coinRequest.findFirst({where:{symbol:"SMTPTEST",reason:{contains:"Mailcow verification"}},select:{id:true,status:true,symbol:true,createdAt:true},orderBy:{createdAt:"desc"}}).then(console.log).finally(()=>p.$disconnect())'"'"''
```

Expected: одна запись `SMTPTEST`, `PENDING`; поля `userId`, email и reason в командном выводе не запрашиваются.

- [ ] **Step 9: Проверить общий транспорт и завершить тестовую заявку**

Через контрольный аккаунт с неподтверждённым email запросить verification email и убедиться в его фактическом получении. Затем отклонить `SMTPTEST` через существующий admin UI с причиной `Mailcow verification complete`; для пользователя с включёнными verified email notifications проверить одно письмо о reject.

Expected: verification и reject письма отправлены от `noreply@trientes.org`; внешний проверяющий видит `spf=pass`, `dkim=pass`, `dmarc=pass`; тестовая заявка имеет `REJECTED`, монета не создана.

- [ ] **Step 10: Финально проверить Git и работающие процессы**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && git status --short --branch && git log -5 --oneline && pm2 status'
```

Expected: нет незакоммиченных tracked-изменений; все коммиты задачи присутствуют и отправлены в `origin/main`; три PM2-процесса `online`.

### Task 8: Rollback только при подтверждённом сбое

**Files:**
- Restore if present: `/home/dv/.trientes-env.local.before-mailcow`
- Revert only the four implementation commits from Tasks 4–7

- [ ] **Step 1: Вернуть DNS IONOS при почтовом сбое**

В IONOS DNS для `trientes.org` удалить Mailcow MX, DKIM TXT и собственный DMARC TXT, затем восстановить значения из `/tmp/trientes-dns-before-2026-11-06.txt`:

```text
MX 10 mx00.ionos.de.
MX 10 mx01.ionos.de.
TXT v=spf1 include:_spf-eu.ionos.com ~all
_dmarc.trientes.org CNAME dmarc.ionos.de.
```

Expected: `dig trientes.org MX`, SPF и DMARC показывают исходные IONOS-значения. A-запись сайта остаётся неизменной. Mailcow-домен не удалять: это позволит исследовать сбой без дополнительной потери данных.

- [ ] **Step 2: Вернуть прежний env, если существовал backup**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'if test -f /home/dv/.trientes-env.local.before-mailcow; then cp /home/dv/.trientes-env.local.before-mailcow /home/dv/trientes/.env.local && chmod 600 /home/dv/trientes/.env.local; fi'
```

Expected: прежний `.env.local` восстановлен только при наличии заранее созданного backup; новый backup не перезаписывается.

- [ ] **Step 3: Отменить только четыре коммита этой задачи по их точным сообщениям**

```bash
ssh -o BatchMode=yes dv@85.192.25.242 'cd ~/trientes && COMMITS=$(git log --format=%H --grep="добавить nodemailer для SMTP" --grep="перейти на Mailcow SMTP" --grep="отправлять новую заявку на listing-почту" --grep="обновить конфигурацию под Mailcow") && test "$(printf "%s\n" "$COMMITS" | wc -l)" -eq 4 && git revert --no-commit $COMMITS && git diff --cached --check && git commit -m "revert: откатить почтовую интеграцию Mailcow" -m "Co-Authored-By: Kimi Code <noreply@anthropic.com>" && npm install && npm test && npm run build && pm2 restart trientes-web trientes-worker && pm2 save && git push origin main'
```

Expected: найдены ровно четыре коммита; tests и build успешны; прежний Resend-транспорт восстановлен, `trientes-bot` не перезапущен. Если найдено не четыре коммита или есть чужие изменения, команда останавливается до ручного разбора — `git reset --hard` не использовать.
