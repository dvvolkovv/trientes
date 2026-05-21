# Deploy-time Autotests — Design

**Date:** 2026-05-21
**Status:** Approved (brainstorming gate)
**Owner:** dv

## Goal

Catch regressions automatically on every deploy of `trientes.org` by gating PM2 reload on unit tests and running Playwright smoke tests against the live URL immediately after reload.

## Context

- Deploy today is manual on `dv@85.192.25.242`: `git pull` (after `git stash`), then `pm2 reload trientes-web trientes-worker`. No CI / GitHub Actions.
- 14 vitest unit test files exist (97 passing per Phase 1-9 notes). Run via `npm test`.
- Playwright MCP (`@playwright/mcp`) installed for ad-hoc browser driving; this spec adds `@playwright/test` as a proper test runner.
- Local build is broken on macOS (SWC dlopen hang). Everything in this spec runs on the server, not the laptop.

## Non-goals

- GitHub Actions / cloud CI. Not building one now.
- Automatic rollback. Rollback stays a manual `git reset --hard HEAD@{1} && pm2 reload …`.
- Authenticated E2E flows (admin actions, Telegram login, watchlist mutations). Future phase.
- Multi-browser matrix. Chromium only.
- Preview / staging environment. Smoke runs directly against prod.

## Architecture

```
scripts/deploy.sh   (runs on server, invoked manually)
        │
        ├─ git stash && git pull
        ├─ npm ci
        ├─ npx prisma generate
        ├─ npx prisma migrate deploy
        ├─ npm run build
        ├─ npm test                     ── vitest unit (gates reload)
        ├─ pm2 reload trientes-web trientes-worker
        ├─ sleep 5                      ── let workers warm up
        └─ BASE_URL=https://trientes.org npx playwright test
                                        ── Playwright smoke against live prod
```

Single linear shell pipeline with `set -euo pipefail`. Any step failing aborts the script. After PM2 reload, a red Playwright run signals real regression visible to users; rollback is operator's call.

## Components

### 1. `playwright.config.ts` (repo root)

- Single project: `chromium` only.
- `testDir: "./tests/e2e"`
- `baseURL: process.env.BASE_URL ?? "http://localhost:3000"`
- `timeout: 30_000`, `expect.timeout: 10_000`
- `retries: 1` (covers a flaky cold-cache hit on the first request)
- `reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]`
- `use.trace: "retain-on-failure"`, `use.screenshot: "only-on-failure"`
- No `webServer` block — we never want Playwright to spawn Next; the deploy script controls when the server is live.

### 2. `tests/e2e/` (six smoke specs)

Each spec is short (< 30 lines), independent, no shared fixtures.

| File | Asserts |
|---|---|
| `home.spec.ts` | `GET /en` → 200; ≥ 10 coin rows render; no `console.error` during load. |
| `coin-detail.spec.ts` | `GET /en/coin/bitcoin` → 200; price text present; `canvas` element from lightweight-charts visible. |
| `exchanges.spec.ts` | `GET /en/exchanges` → 200; ≥ 10 rows. |
| `i18n.spec.ts` | Visit `/en`, click language switcher → `de`, URL matches `/de`, page title or h1 changes. |
| `admin-gate.spec.ts` | Visit `/en/admin/coins` unauthenticated; assert final URL after redirects does NOT contain `/admin/` (i.e. middleware bounced us). Don't pin to a specific login path — both Auth.js `/api/auth/signin` and a localized `/en/login` are valid bounces. |
| `api-sse.spec.ts` | `request.get("/api/stream/prices")` returns 200 and `content-type` includes `text/event-stream`. |

Selectors prefer accessible roles (`getByRole("table")`, `getByRole("link", { name: "Exchanges" })`). Where the existing markup has no good role anchor, use a deliberate `data-testid` added to that component (separate small edit per file).

### 3. `scripts/deploy.sh`

Single bash script, server-side. POSIX `set -euo pipefail`. Sources nvm so that node/npm/npx resolve under cron-like environments:

```bash
#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd "$HOME/trientes"

git stash --include-untracked --quiet || true
git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm test
pm2 reload trientes-web trientes-worker
sleep 5
BASE_URL=https://trientes.org npx playwright test
echo "deploy ok"
```

- `git stash` covers known server lockfile drift (documented in project history).
- `npm ci` (not `npm install`) to honor lockfile exactly.
- `prisma migrate deploy` is idempotent; safe to run when no new migrations.
- Made executable: `chmod +x scripts/deploy.sh`.

### 4. One-time server setup (documented, not scripted)

On `dv@85.192.25.242`:
```
cd ~/trientes
npm install            # picks up new @playwright/test devDep after pull
npx playwright install chromium --with-deps
```

`--with-deps` installs system libs via apt; needs sudo, hence one-time and out of `deploy.sh`.

## Data Flow

No new persistent data. Playwright produces:
- `playwright-report/` (HTML) — gitignored, viewed via `npx playwright show-report` on server.
- `test-results/` (traces, screenshots on failure) — gitignored.

## Error Handling

- **Unit test fails** → script exits before PM2 reload. Prod stays on previous version. Operator inspects vitest output.
- **Build fails** → same as above.
- **Migration fails** → script exits before reload. DB may be partially migrated (prisma behavior); operator handles manually.
- **PM2 reload fails** → script exits; prod may be in mixed state. Operator checks `pm2 status`.
- **Playwright fails after reload** → script exits non-zero, but prod is already on the new version. Operator decides: investigate, fix-forward, or `git reset --hard HEAD@{1} && pm2 reload …`. Trace + screenshot in `test-results/` aid triage.

## Testing the Tests

After the script lands:
1. Run `npm test` locally on server — unit tests still green.
2. Run `BASE_URL=https://trientes.org npx playwright test` against current prod — all 6 specs green.
3. Deliberately break one spec (e.g. expect 999 rows on home) → confirm script exits non-zero.

## Boundaries / Files Touched

New files:
- `playwright.config.ts`
- `tests/e2e/home.spec.ts`
- `tests/e2e/coin-detail.spec.ts`
- `tests/e2e/exchanges.spec.ts`
- `tests/e2e/i18n.spec.ts`
- `tests/e2e/admin-gate.spec.ts`
- `tests/e2e/api-sse.spec.ts`
- `scripts/deploy.sh`

Edited files:
- `package.json` — add `@playwright/test` devDep, `test:e2e` script (`playwright test`).
- `.gitignore` — add `playwright-report/`, `test-results/`, `/blob-report/`, `/playwright/.cache/`.
- `vitest.config.ts` — new file (none exists today). Sets `test.exclude` to default vitest excludes plus `tests/e2e/**`, so vitest does not try to run Playwright specs. Vitest defaults match `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which would otherwise pull in `tests/e2e/*.spec.ts`.
- README/AGENTS.md — one paragraph: "Deploy via `./scripts/deploy.sh` on server."

## Risks

- **Playwright vs vitest test discovery collision.** Mitigation: scope vitest to `tests/*.test.ts` (exclude `tests/e2e/**`); Playwright reads only `tests/e2e/**`.
- **Smoke against live prod has a "red window".** If Playwright catches a real regression, users saw the regression for ~5–10 s before the alarm. Accepted; no preview env in scope.
- **Locale switcher selector fragility.** i18n.spec.ts uses the language dropdown; if its DOM changes, test breaks. Mitigated by `data-testid` on the switcher.
- **Server bandwidth.** Playwright against prod over public internet adds maybe 50 requests per deploy. Negligible.

## Why this design

- Matches existing operational reality (server-side manual deploys), not idealized CI.
- Minimum new tooling: one config, one script, six tiny specs.
- Gate before reload (unit) + verify after reload (smoke) covers both classes of regression cheaply.
- Easy to extend later: GitHub Actions can call the same `playwright test` invocation; authenticated specs can be added under `tests/e2e/auth/` without touching deploy.sh.
