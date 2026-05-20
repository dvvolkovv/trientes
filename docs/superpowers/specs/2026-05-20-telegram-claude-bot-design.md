# Telegram → Claude Code bot

**Status:** design approved 2026-05-20, implementation pending
**Author:** Dmitry Volkov (@dvvolkov)
**Lives in:** new directory `~/trientes/bot/` on server 85.192.25.242

## Goal

Give the trientes maintainer (and one collaborator) the ability to drive ongoing development and operations of trientes.org from Telegram — text or voice — without opening a terminal. Claude Code does the actual editing, commits, pushes, and `pm2 reload` on the same server that hosts production.

## Scope

**In scope:**
- One Telegram bot, hosted on the prod server as a new PM2 process `trientes-bot`.
- Accepts text and voice (OGG) messages from a whitelist of Telegram user IDs.
- Voice → text via OpenAI Whisper API.
- Per-user continuous Claude Code session, scoped to `~/trientes`, with explicit `/new` to reset.
- Full autonomy: Claude reads, edits, commits, pushes, and reloads PM2 by itself. Git is the safety net.
- Hybrid streaming UX: high-level status by default, opt-in verbose tool-call view via `/verbose`.

**Out of scope (for first iteration):**
- Multiple projects / `/cd` between repos.
- Confirmation prompts before deploy.
- Browser-rendered diffs or attachments.
- Local STT (whisper.cpp) — Whisper API is cheap enough at this volume.
- Email/SMS alerts on bot failures.
- Per-message billing dashboards.

## Architecture

```
┌──────────────────┐    HTTPS    ┌────────────────────────────────────────────┐
│ Telegram Client  │ ◄──webhook──┤  Server 85.192.25.242                      │
│ @dvvolkov,       │             │                                            │
│ @ALGENOMIC       │             │  nginx: location /bot/<secret>             │
└──────────────────┘             │    → proxy_pass http://127.0.0.1:4100      │
                                 │                                            │
                                 │  PM2 process: trientes-bot (new)           │
                                 │  ├─ webhook (Express on 127.0.0.1:4100)    │
                                 │  ├─ auth (whitelist)                       │
                                 │  ├─ voice (OpenAI Whisper)                 │
                                 │  ├─ session store (Redis)                  │
                                 │  ├─ claude runner (spawn claude CLI)       │
                                 │  └─ telegram view (status updates)         │
                                 │                                            │
                                 │  Existing PM2 (untouched):                 │
                                 │  ├─ trientes-web    (Next.js prod)         │
                                 │  └─ trientes-worker (cron + Binance WS)    │
                                 │                                            │
                                 │  Shared filesystem: ~/trientes (git repo)  │
                                 │  Claude edits files → git push → pm2 reload│
                                 └────────────────────────────────────────────┘
```

**Principles:**
- The bot is a thin bridge between Telegram and the Claude Code CLI. It does not parse code, diff, or apply policy beyond auth.
- Webhook over polling — reuses the existing TLS termination at trientes.org via a new nginx location.
- All state lives in Redis (already deployed for the SSE tick pipeline). No new database schema.
- All operational state is JSONL logs on disk. No new Prisma migrations.

## Components

All components live in `~/trientes/bot/` as a single Node.js application bundled into the trientes monorepo (sibling of `worker/`). Reuses `package.json`, eslint, vitest, tsconfig from the parent project.

### `webhook.ts` — HTTP entry point
- Express, binds to `127.0.0.1:4100`.
- `POST /bot/<TELEGRAM_WEBHOOK_SECRET>` is the only mounted route.
- Validates `X-Telegram-Bot-Api-Secret-Token` header against the same secret (two-factor check on top of URL secrecy).
- Routes to `messageHandler` (text), `voiceHandler` (voice), or `commandHandler` (text starting with `/`).
- Global error handler writes to `audit.jsonl` and replies to user with a generic "bot crashed, check logs" if reply was possible.

### `auth.ts` — whitelist guard
- Reads `BOT_ALLOWED_USER_IDS` from env (comma-separated numeric Telegram user IDs).
- Non-whitelisted updates are silently dropped — never reply, to avoid leaking that the bot exists.
- Logs every drop to `unauthorized.jsonl` (`{ts, user_id, username, text_snippet}`).
- Exception: `/whoami` is allowed for everyone — replies with the caller's user_id only. Bootstraps whitelist population (you message the bot once, get your ID, paste into .env).

### `voice.ts` — Whisper transcription
- Downloads voice file via Telegram `getFile` + binary fetch to a temp file under `/tmp/`.
- POSTs to OpenAI `/v1/audio/transcriptions` (`model=whisper-1`, `language=ru`).
- Returns transcribed text, which then enters the same path as a text message.
- Cleans up temp file in `finally`.
- On Whisper failure (network, 4xx, 429, 5xx) → reply "не разобрал, повтори текстом", do not touch session.

### `session.ts` — Redis-backed session store
- Key: `claude:session:<telegram_user_id>` → JSON `{ claudeSessionId, startedAt, lastActivity }`.
- TTL 30 minutes, refreshed on every touch.
- `get(userId)` — returns existing record or null.
- `set(userId, claudeSessionId)` — persists session id; called by `claudeRunner` after a successful first run when Claude reports its session_id in the stream.
- `reset(userId)` — DEL key (for `/new`).
- `touch(userId)` — refresh TTL.
- `status(userId)` — return full record + whether an active claude process is currently running for this user.
- If Redis is unavailable, the store falls through to per-message mode (each request runs Claude without resume, no continuity) and logs a warning. The bot does not crash.

### `claudeRunner.ts` — Claude Code CLI orchestrator
- Spawns `claude` CLI per user request. Two forms:
  - **First request in a session** (no stored claudeSessionId):
    ```
    claude -p \
      --output-format stream-json \
      --verbose \
      --dangerously-skip-permissions \
      "<prompt>"
    ```
  - **Subsequent requests** (claudeSessionId in Redis):
    ```
    claude -p \
      --resume <claudeSessionId> \
      --output-format stream-json \
      --verbose \
      --dangerously-skip-permissions \
      "<prompt>"
    ```
  Both run with `cwd: /home/dv/trientes` and inherited PATH containing nvm-managed node. (`--verbose` is required by the CLI when combining `-p` with `--output-format stream-json`.)
- Parser watches for the first `{type:"system", subtype:"init", session_id:"..."}` event and calls `session.set(userId, session_id)` so subsequent messages can resume.
- One active child process per user is tracked in an in-memory map `{userId → ChildProcess}`. A second request from the same user while one is running gets a reply: "текущая задача ещё идёт, /cancel или подожди".
- Parses stream-json line-by-line. Each event with `type:"tool_use"` becomes a status update; `type:"text"` accumulates into the final assistant reply.
- 10-minute hard timeout per request — SIGTERM, then SIGKILL after 5 seconds, replies "задача застряла, /new чтобы продолжить".
- On clean exit (code 0): runs `git rev-parse HEAD` and `git diff-tree --no-commit-id --name-only -r HEAD` in cwd to enrich the final reply with commit SHA, file list, and a GitHub commit URL.
- On non-zero exit: appends the last 2000 chars of stderr in a `<pre>` block to the reply.
- Writes one audit row per request to `audit.jsonl` (see Logging).
- **CLI assumption to verify during implementation:** exact flag names (`--resume`, `--output-format stream-json --verbose`) match the installed Claude Code CLI version. Read `node_modules/@anthropic-ai/claude-code/` docs or `claude --help` on the server before wiring spawn arguments.

### `telegramView.ts` — chat renderer
- Two modes per user, persisted at Redis key `bot:verbose:<user_id>` (boolean, no TTL).
- **Default (verbose=false):**
  - One placeholder message right after request received: "🤔 думаю...".
  - `editMessageText` debounced to max once per second to respect Telegram limits.
  - Status string format: `<emoji> <short-action>` (e.g. `📖 читаю Header.tsx`, `✏️ правлю 3 файла`, `💾 коммичу`, `🚀 пушу`, `♻️ рестарт prod`).
  - Final assistant reply posted as a new message (not an edit) so it survives in the chat scroll.
- **Verbose (verbose=true):**
  - Each tool_use becomes a separate message.
  - Bash outputs included in `<pre>` blocks, truncated to 3500 chars (Telegram limit is 4096).
- `/verbose` toggles the flag, replies with current state.

### `commands.ts` — slash commands
- `/new` — `session.reset(uid)`, "новая сессия".
- `/status` — show session metadata + active process state.
- `/cancel` — SIGTERM the active claude process for this user, if any.
- `/verbose` — toggle and reply with new state.
- `/whoami` — reply with caller's user_id (works without whitelist).
- Unknown command → "неизвестная команда, доступны: /new /status /cancel /verbose /whoami".

## Data flow (voice request, end-to-end)

1. Telegram → `POST /bot/<secret>` with update `{ message: { voice: { file_id } } }`.
2. `webhook.ts` validates secret header.
3. `auth.ts` checks `from.id ∈ BOT_ALLOWED_USER_IDS`. Drop if not.
4. `voice.ts` downloads OGG → `/tmp/voice-<id>.ogg`, POSTs to OpenAI Whisper, gets text, deletes temp file.
5. Bot sends two messages: `🎤 услышал: <text>` and `🤔 думаю...` (the second one is the one that will be edited).
6. `session.get(userId)` returns existing record or null.
7. `claudeRunner` spawns `claude -p [--resume <sid>] --output-format stream-json --verbose --dangerously-skip-permissions "<text>"` in `~/trientes`. On the first run for this user, `--resume` is omitted; the runner captures the `session_id` from the first stream event and stores it via `session.set`.
8. Stream-json events update the placeholder via `telegramView` (debounced 1 Hz).
9. Process exits 0. Runner queries `git rev-parse HEAD` and changed files, sends final message:
   ```
   ✅ готово
   коммит: abc1234 — fix: уменьшить кнопку в хедере
   файлы: src/components/Header.tsx
   https://github.com/dvvolkovv/trientes/commit/abc1234def...
   ```
10. `session.touch(userId)` extends TTL. Audit row written.

## Security

| Layer | Mechanism |
|---|---|
| Network | nginx `location /bot/<secret>` proxies POST-only to `127.0.0.1:4100`. Bot binds to loopback. |
| Telegram | `X-Telegram-Bot-Api-Secret-Token` header matched against secret. |
| App | `BOT_ALLOWED_USER_IDS` whitelist of numeric user IDs. Silent drop for outsiders. |
| Claude | `--dangerously-skip-permissions` — fully autonomous by explicit user decision; git revert is the safety net. |

## Logging

Two JSONL files under `~/trientes/bot/logs/`:

- `unauthorized.jsonl` — `{ts, user_id, username, text_snippet}` per blocked request.
- `audit.jsonl` — `{ts, user_id, prompt, session_id, claude_exit_code, commit_sha?, files_changed?, duration_ms}` per processed request.

Logrotate config: daily rotation, keep 30 days, compress after 1 day. Lives in `/etc/logrotate.d/trientes-bot` (provisioned by deploy script).

## Error handling

| Failure | Caught in | User-visible result |
|---|---|---|
| Whisper API down / 5xx | `voice.ts` | "не разобрал голос, повтори текстом" |
| Whisper 429 | `voice.ts` | "лимит транскрипции, попробуй текстом или через минуту" |
| Telegram `editMessageText` timeout | `telegramView.ts` retry 3×, then give up | Status may freeze; Claude keeps running; final reply still arrives |
| Claude crashed (exit ≠ 0) | `claudeRunner.ts` | Reply with last 2000 chars of stderr in `<pre>` |
| Claude hung > 10 min | timeout in `claudeRunner.ts` | SIGTERM + "задача застряла, /new чтобы продолжить" |
| Redis down | `session.ts` | Degraded: per-message session, warning logged, bot stays up |
| `git push` rejected | inside Claude (sees Bash output) | Claude reports or retries on its own — bot does not intervene |
| Unhandled exception | global handler in `webhook.ts` | "бот упал, проверь логи" if reply still possible |

## Testing

Unit tests under `bot/__tests__/` using the project's existing vitest.

- `auth.test.ts` — allow/deny/missing user_id.
- `session.test.ts` — getOrCreate / reset / TTL behaviour, fall-through when Redis missing (use ioredis-mock).
- `voice.test.ts` — mock OpenAI client; verify temp file lifecycle and POST shape.
- `claudeRunner.parse.test.ts` — feed stream-json fixtures, assert events mapped to correct status strings.
- `telegramView.test.ts` — debounce throttles edits to 1 Hz; long messages truncated to 3500 chars.
- `commands.test.ts` — `/new`, `/status`, `/cancel`, `/verbose`, `/whoami` behaviour and side-effects.

Not covered (deliberate): live Whisper calls, real Claude execution, webhook routing (trivial, exercised via manual acceptance).

**Manual acceptance after first deploy:**
1. Send text `/whoami` → reply with your numeric ID. Add to `.env`, restart bot.
2. Send text "что в README?" → see status stream + reply.
3. `/new`. Send voice "покажи последний коммит" → Whisper → Bash → reply.
4. Send text "поправь typo в README: Triente→Trientes если есть" → wait for `✅ коммит abc1234`.
5. `/verbose`, then send any small request → see every tool_use as separate message.

## Configuration

New entries in `~/trientes/.env` (sibling of existing trientes env):

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...           # 32+ random chars, used in URL and header
BOT_ALLOWED_USER_IDS=                 # comma-separated, fill after /whoami
OPENAI_API_KEY=...                    # only used by voice.ts
BOT_PORT=4100                         # loopback port
CLAUDE_CWD=/home/dv/trientes
CLAUDE_TIMEOUT_MS=600000              # 10 min
```

## Dependencies

New in `package.json`:
- `grammy` (Telegram bot framework, typed, modern)
- `openai` (Whisper only)
- `ioredis-mock` (devDependency, for session tests)

Already present and reused:
- `ioredis` (worker uses it)
- `express` (Next.js bundles a compatible version, but we'll declare explicitly)
- `vitest`, `typescript`, `eslint`

External, must be installed on server:
- Claude Code CLI: `npm i -g @anthropic-ai/claude-code`, then `claude` once interactively to log in with the Anthropic subscription. Token lands in `~/.claude/`.

## Deployment

1. New PM2 entry in `ecosystem.config.js`:
   ```js
   {
     name: 'trientes-bot',
     cwd: '/home/dv/trientes',
     script: 'bot/dist/index.js',   // or tsx if we keep TS at runtime
     env_file: '/home/dv/trientes/.env',
     max_memory_restart: '300M',
   }
   ```
2. New nginx location in the trientes.org server block:
   ```
   location /bot/<TELEGRAM_WEBHOOK_SECRET> {
       proxy_pass http://127.0.0.1:4100;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Telegram-Bot-Api-Secret-Token $http_x_telegram_bot_api_secret_token;
       proxy_read_timeout 30s;
   }
   ```
3. Register webhook with Telegram once:
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://trientes.org/bot/<SECRET>" \
     -d "secret_token=<SECRET>"
   ```
4. Install Claude Code CLI on server, log in once.
5. Set up logrotate config.
6. `pm2 start ecosystem.config.js --only trientes-bot && pm2 save`.

## Open questions / explicit non-decisions

- **Cost of Whisper:** at ~$0.006/min, even 5 hours of voice per month is $1.80. Not budgeted explicitly, lives under user's OpenAI account.
- **Claude rate limits on the subscription:** if hit, fallback to `ANTHROPIC_API_KEY` is a one-line change. Not implemented up front.
- **Concurrent users:** with two whitelisted IDs and one Claude process per user, max 2 parallel runs. No queueing needed.
- **No backup / disaster recovery story** for the bot itself: it's stateless beyond Redis. Recreating from this spec + `.env` brings it back.
