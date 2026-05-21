# Deploy-time Autotests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every `trientes.org` deploy on `npm test` (vitest unit) and verify the live site afterward with 6 Playwright smoke specs, all driven by a single server-side `scripts/deploy.sh`.

**Architecture:** Add `@playwright/test` as a dev dependency (separate from the already-installed Playwright MCP). Six independent specs in `tests/e2e/` exercise the public, unauthenticated surface of the site. `scripts/deploy.sh` runs `git pull → build → vitest → pm2 reload → playwright smoke` with `set -euo pipefail` — any red step aborts the chain. Vitest and Playwright are kept apart via a fresh `vitest.config.ts` that excludes `tests/e2e/**`.

**Tech Stack:** Next.js 16, vitest 4, `@playwright/test` (latest 1.x), bash, PM2 (already installed), Node 22 via nvm.

**Spec reference:** `docs/superpowers/specs/2026-05-21-deploy-autotests-design.md`

**Environment note:** This working copy at `/home/dv/trientes` IS the production server checkout (host `85.192.25.242`). Do NOT run `scripts/deploy.sh` itself during verification — it performs a real production deploy. Only syntax-check it (`bash -n`). All test runs target the existing live `https://trientes.org`, not a fresh build.

---

## File Structure

**Created:**
- `playwright.config.ts` — Playwright runner config
- `vitest.config.ts` — vitest config that excludes `tests/e2e/**`
- `tests/e2e/home.spec.ts`
- `tests/e2e/coin-detail.spec.ts`
- `tests/e2e/exchanges.spec.ts`
- `tests/e2e/i18n.spec.ts`
- `tests/e2e/admin-gate.spec.ts`
- `tests/e2e/api-sse.spec.ts`
- `scripts/deploy.sh`

**Modified:**
- `package.json` — add `@playwright/test` devDep, `test:e2e` script
- `.gitignore` — ignore Playwright report/trace folders
- `AGENTS.md` — short "deploy via `./scripts/deploy.sh`" paragraph

---

### Task 1: Add @playwright/test devDep and test:e2e script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Inspect current `package.json` scripts and devDependencies blocks**

Open `package.json` and confirm the existing `"test": "vitest run"` script line and devDependencies block. Note exact ordering for alphabetical insertion.

- [ ] **Step 2: Add `test:e2e` script**

In `package.json`, inside `"scripts"`, after the existing `"test:watch": "vitest"` line, add:

```json
    "test:e2e": "playwright test",
```

The scripts block should now contain (in order):
```json
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
```

- [ ] **Step 3: Add `@playwright/test` to devDependencies**

In `package.json`, inside `"devDependencies"`, alphabetically between `@types/ws` and `@vitest/ui`, add:

```json
    "@playwright/test": "^1.49.0",
```

- [ ] **Step 4: Install**

Run: `npm install`

Expected: completes with no errors, updates `package-lock.json`, adds `node_modules/@playwright/test`. Look for "added N packages" output. No vulnerability errors expected.

- [ ] **Step 5: Verify Playwright CLI resolvable**

Run: `npx playwright --version`

Expected: prints `Version 1.49.x` (or whatever resolved). Confirms CLI is on PATH.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test: add @playwright/test dev dep + test:e2e script"
```

(Git identity env vars are required on this host — it has no global git config.)

---

### Task 2: Create `playwright.config.ts`

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Write the config file**

Create `playwright.config.ts` at repo root with:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 1,
  fullyParallel: true,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

- [ ] **Step 2: Verify Playwright discovers zero tests cleanly**

Run: `npx playwright test --list`

Expected: output reports `Total: 0 tests in 0 files` (or equivalent — no errors, just an empty test set since `tests/e2e/` doesn't exist yet). If it complains about a missing directory, create an empty `tests/e2e/` first: `mkdir -p tests/e2e`.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test: add playwright config (chromium, baseURL from env)"
```

---

### Task 3: Add `vitest.config.ts` to exclude `tests/e2e/**`

**Files:**
- Create: `vitest.config.ts`

**Why:** vitest's default test pattern is `**/*.{test,spec}.?(c|m)[jt]s?(x)`. Without exclusion it would try to run `tests/e2e/*.spec.ts` (Playwright files) and explode. We exclude `tests/e2e/**` upfront so the two runners don't collide.

- [ ] **Step 1: Confirm there's no existing vitest config**

Run: `ls vitest.config.* 2>/dev/null; ls vite.config.* 2>/dev/null`

Expected: no output (no file exists). If a config DOES exist, stop and adapt the step below to merge with it instead of creating new.

- [ ] **Step 2: Write the config**

Create `vitest.config.ts` at repo root:

```ts
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
```

- [ ] **Step 3: Run vitest, verify existing unit tests still pass**

Run: `npm test`

Expected: same outcome as before this task — 97 tests pass across 14 files. (Counts from project history; if today's `main` differs, expectation is "same as `git stash && npm test` on `HEAD~1`".) If anything regresses, stop and diagnose.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test: add vitest config that excludes tests/e2e (Playwright owns it)"
```

---

### Task 4: Update `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read existing `.gitignore`**

Open `.gitignore`. Locate the end of the file (or a suitable section) for appending Playwright entries.

- [ ] **Step 2: Append Playwright entries**

Add these lines at the end of `.gitignore` (preceded by a blank line for readability):

```
# Playwright
/playwright-report/
/test-results/
/blob-report/
/playwright/.cache/
```

- [ ] **Step 3: Sanity check the file isn't already tracking these**

Run: `git ls-files | grep -E "playwright-report|test-results|blob-report" || echo "clean"`

Expected: prints `clean`. If anything is listed, manually `git rm -r --cached <path>` it before continuing.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "chore: gitignore Playwright report/trace folders"
```

---

### Task 5: Install Playwright Chromium on this host (one-time)

**Files:** none

**Why:** Playwright MCP installed Chrome system-wide earlier, but `@playwright/test` uses its own browser binaries managed by `playwright install`. They're separate.

- [ ] **Step 1: Install Chromium for `@playwright/test`**

Run: `npx playwright install chromium`

Expected: downloads ~150MB browser to `~/.cache/ms-playwright/chromium-*/`. Output ends with no errors. ffmpeg may fail to download on ubuntu26.04 — that's fine, we don't record video. If chromium itself fails, stop and resolve.

- [ ] **Step 2: Verify by running an empty Playwright command**

Run: `npx playwright test --list`

Expected: `Total: 0 tests in 0 files`. No errors about missing browsers.

- [ ] **Step 3: No commit (system state only)**

This step changes `~/.cache/`, not the repo. Nothing to commit.

---

### Task 6: Write `tests/e2e/home.spec.ts`

**Files:**
- Create: `tests/e2e/home.spec.ts`

**Note on TDD discipline for E2E against existing prod:** These specs characterize already-shipped behavior, so the literal "write failing test first" doesn't fit. Instead, after writing each spec, we run it against live prod (expect PASS), then temporarily flip one assertion to confirm the test has teeth (expect FAIL), revert, re-run (expect PASS), commit. This proves the test isn't a no-op.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/home.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("home page renders top-coin table with at least 10 rows", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const response = await page.goto("/en", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // Table proper — top-coins list. Match by role, not by class.
  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  const rowCount = await table.locator("tbody tr").count();
  expect(rowCount).toBeGreaterThanOrEqual(10);

  // SSE/live-tick errors are noisy in the browser but should not throw.
  // Filter benign third-party errors and assert no real ones remain.
  const realErrors = consoleErrors.filter(
    (e) => !/favicon|EventSource|ChunkLoadError/i.test(e)
  );
  expect(realErrors, realErrors.join("\n")).toEqual([]);
});
```

- [ ] **Step 2: Run against live prod, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/home.spec.ts`

Expected: `1 passed`. If it fails because the `<table>` doesn't have `role="table"` (which it should by default for native `<table>` elements), check the actual markup with `curl -s https://trientes.org/en | grep '<table' | head -3` and adjust the selector — but native `<table>` already implies role. If row count is < 10 due to live page state, raise the question (Layer-1 list should reliably have ~99 rows).

- [ ] **Step 3: Verify the test has teeth**

Temporarily edit the spec: change `toBeGreaterThanOrEqual(10)` to `toBeGreaterThanOrEqual(99999)`. Re-run the test. Expected: `1 failed`. Then revert the edit and re-run; expected `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/home.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke home page — table renders ≥10 rows, no console errors"
```

---

### Task 7: Write `tests/e2e/coin-detail.spec.ts`

**Files:**
- Create: `tests/e2e/coin-detail.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/coin-detail.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("bitcoin detail page renders chart and a price", async ({ page }) => {
  const response = await page.goto("/en/coin/bitcoin", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  // lightweight-charts mounts a <canvas> inside the chart container.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Page should show a USD price like "$1,234" or "$12.34" somewhere prominent.
  const priceText = page.locator("body").getByText(/\$\s?\d[\d,]*\.?\d*/);
  await expect(priceText.first()).toBeVisible();
});
```

- [ ] **Step 2: Run against live prod, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/coin-detail.spec.ts`

Expected: `1 passed`.

- [ ] **Step 3: Verify teeth**

Temporarily change `/en/coin/bitcoin` to `/en/coin/nope-does-not-exist`. Re-run. Expected: `1 failed` (either 404 or no canvas). Revert. Re-run; `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/coin-detail.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke coin-detail — chart canvas + USD price visible"
```

---

### Task 8: Write `tests/e2e/exchanges.spec.ts`

**Files:**
- Create: `tests/e2e/exchanges.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/exchanges.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("exchanges page renders ≥10 exchange rows", async ({ page }) => {
  const response = await page.goto("/en/exchanges", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const table = page.getByRole("table").first();
  await expect(table).toBeVisible();

  const rowCount = await table.locator("tbody tr").count();
  expect(rowCount).toBeGreaterThanOrEqual(10);
});
```

- [ ] **Step 2: Run, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/exchanges.spec.ts`

Expected: `1 passed`.

- [ ] **Step 3: Verify teeth**

Change `toBeGreaterThanOrEqual(10)` to `toBeGreaterThanOrEqual(99999)`. Re-run. Expected `1 failed`. Revert. Expected `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/exchanges.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke exchanges page — table renders ≥10 rows"
```

---

### Task 9: Write `tests/e2e/i18n.spec.ts`

**Files:**
- Create: `tests/e2e/i18n.spec.ts`

**Selector approach:** The currency/locale switcher selectors aren't yet stabilized via testids. This spec navigates directly by URL instead of clicking the switcher — that's a more durable smoke check (the switcher itself just changes the URL).

- [ ] **Step 1: Write the spec**

Create `tests/e2e/i18n.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("locale routes serve content under /en and /de", async ({ page }) => {
  const en = await page.goto("/en", { waitUntil: "domcontentloaded" });
  expect(en?.status()).toBe(200);
  const enHtml = await page.locator("html").getAttribute("lang");
  expect(enHtml).toMatch(/^en/);

  const de = await page.goto("/de", { waitUntil: "domcontentloaded" });
  expect(de?.status()).toBe(200);
  const deHtml = await page.locator("html").getAttribute("lang");
  expect(deHtml).toMatch(/^de/);
});
```

- [ ] **Step 2: Run, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/i18n.spec.ts`

Expected: `1 passed`. If `/de` returns 404, the project's middleware locale list may not include `de` — open `src/middleware.ts` / `next-intl` config, confirm which locales ARE configured, and swap `de` for a known one (e.g. `fr`).

- [ ] **Step 3: Verify teeth**

Change `/de` to `/zz` (definitely-invalid locale). Re-run. Expected `1 failed` (likely 404 or wrong `lang` attr). Revert. Expected `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/i18n.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke i18n — /en and /de both serve with correct <html lang>"
```

---

### Task 10: Write `tests/e2e/admin-gate.spec.ts`

**Files:**
- Create: `tests/e2e/admin-gate.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/admin-gate.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("anonymous user cannot reach /admin/* (middleware bounces)", async ({ page }) => {
  // Don't set a cookie — browser context is fresh per test.
  await page.goto("/en/admin/coins", { waitUntil: "domcontentloaded" });

  // After all redirects, URL must no longer be in /admin/.
  const finalUrl = page.url();
  expect(finalUrl).not.toContain("/admin/");
});
```

- [ ] **Step 2: Run, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/admin-gate.spec.ts`

Expected: `1 passed`. If it fails because the page renders without redirect (i.e. admin is publicly visible — a security regression!), STOP, escalate to the user before continuing.

- [ ] **Step 3: Verify teeth**

Temporarily invert the assertion: change `not.toContain("/admin/")` to `toContain("/admin/")`. Re-run. Expected `1 failed` (since the URL really doesn't contain `/admin/` after the bounce). Revert. Re-run. Expected `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-gate.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke admin-gate — anonymous bounced out of /admin/*"
```

---

### Task 11: Write `tests/e2e/api-sse.spec.ts`

**Files:**
- Create: `tests/e2e/api-sse.spec.ts`

**Why a `request` test, not a page test:** SSE endpoints emit forever; we don't want a browser-attached EventSource. Playwright's `request` fixture issues a raw HTTP call. We check headers, then drop the connection.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/api-sse.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("/api/stream/prices serves text/event-stream", async ({ request }) => {
  // SSE streams forever — cap request at 5s; we only need headers, not the body.
  const response = await request.get("/api/stream/prices", { timeout: 5_000, maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/event-stream");
});
```

If Playwright's `request.get` blocks waiting for the full body (some versions do), wrap it in a `Promise.race` against a 5-second timeout, or use Node's `http.request` for a header-only check. Diagnose only if the test actually hangs > 10s.

- [ ] **Step 2: Run, verify PASS**

Run: `BASE_URL=https://trientes.org npx playwright test tests/e2e/api-sse.spec.ts`

Expected: `1 passed`. Note: `request.get` reads the response in chunks; for SSE the server holds the connection open. Playwright resolves the request once headers are received, BUT some Playwright versions also wait for body. If the test hangs > 5s, swap to a fetch-with-abort or use `node:http` directly inside the test. Diagnose only if it actually hangs.

- [ ] **Step 3: Verify teeth**

Change the endpoint to `/api/stream/does-not-exist`. Re-run. Expected `1 failed` (status 404). Revert. Expected `1 passed`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/api-sse.spec.ts
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "test(e2e): smoke /api/stream/prices — 200 + text/event-stream content-type"
```

---

### Task 12: Run the full E2E suite

**Files:** none (verification only)

- [ ] **Step 1: Run all 6 specs against prod**

Run: `BASE_URL=https://trientes.org npx playwright test`

Expected: `6 passed` across 6 files. Total runtime ~30–60 seconds. If any fails, STOP — diagnose before continuing. The deploy script depends on these being green.

- [ ] **Step 2: Confirm vitest is unaffected**

Run: `npm test`

Expected: same 97/97 (or whatever count exists on this branch) — vitest does NOT pick up the Playwright `.spec.ts` files thanks to Task 3's exclude.

- [ ] **Step 3: No commit (verification only)**

---

### Task 13: Write `scripts/deploy.sh`

**Files:**
- Create: `scripts/deploy.sh`

**Critical:** do NOT execute this script during verification. It performs a real production deploy: `pm2 reload` actually restarts the live `trientes.org` workers. Verification is limited to `bash -n` syntax check + manual review of the diff. The user runs it for real on their own initiative.

- [ ] **Step 1: Confirm `scripts/` directory exists**

Run: `ls scripts/`

Expected: lists existing files (`backup-db.sh`, `grant-admin.ts`). If missing, `mkdir -p scripts`.

- [ ] **Step 2: Write the script**

Create `scripts/deploy.sh`:

```bash
#!/usr/bin/env bash
# Production deploy for trientes.org. Run from the server (~/trientes).
# Aborts on any failed step. After PM2 reload, a red Playwright run means
# real users see the regression — operator decides whether to fix-forward
# or roll back with: git reset --hard HEAD@{1} && pm2 reload trientes-web trientes-worker

set -euo pipefail

# nvm-installed node — explicit PATH so this works under cron, ssh -t, etc.
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"

cd "$HOME/trientes"

echo "==> stash local drift (lockfile churn etc.)"
git stash --include-untracked --quiet || true

echo "==> pull latest main"
git pull --ff-only

echo "==> install deps from lockfile"
npm ci

echo "==> generate prisma client"
npx prisma generate

echo "==> apply pending migrations"
npx prisma migrate deploy

echo "==> build Next.js"
npm run build

echo "==> run vitest unit suite (gates reload)"
npm test

echo "==> reload PM2 processes"
pm2 reload trientes-web trientes-worker

echo "==> let workers warm up"
sleep 5

echo "==> playwright smoke against live prod"
BASE_URL=https://trientes.org npx playwright test

echo "==> deploy ok"
```

- [ ] **Step 3: Make executable**

Run: `chmod +x scripts/deploy.sh`

- [ ] **Step 4: Syntax check (do NOT run)**

Run: `bash -n scripts/deploy.sh`

Expected: no output, exit code 0. (A non-zero exit means a syntax error — fix and re-run.)

- [ ] **Step 5: Inspect the diff one more time**

Run: `git diff --staged scripts/deploy.sh` after `git add`, then visually confirm: nvm path, `set -euo pipefail`, `pm2 reload` target names match the project history (`trientes-web` + `trientes-worker`).

- [ ] **Step 6: Commit**

```bash
git add scripts/deploy.sh
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "ops: scripts/deploy.sh — vitest gate + pm2 reload + playwright smoke"
```

---

### Task 14: Document the deploy flow in `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Read `AGENTS.md`**

Open `AGENTS.md`. Confirm current content (one paragraph about Next.js differences).

- [ ] **Step 2: Append deploy section**

Append to the end of `AGENTS.md`:

```markdown

## Deploying

Production deploys run from the server (`dv@85.192.25.242`, repo at `~/trientes`):

```
./scripts/deploy.sh
```

The script aborts on any failed step. After PM2 reload it runs Playwright smoke
specs against `https://trientes.org`; if those go red, real users are seeing the
regression — fix-forward, or roll back:

```
git reset --hard HEAD@{1}
pm2 reload trientes-web trientes-worker
```

Adding new E2E specs: drop them in `tests/e2e/*.spec.ts`. They auto-run on next deploy.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
GIT_AUTHOR_NAME="Dmitry Volkov" GIT_AUTHOR_EMAIL="dvvolkovv@gmail.com" \
GIT_COMMITTER_NAME="Dmitry Volkov" GIT_COMMITTER_EMAIL="dvvolkovv@gmail.com" \
git commit -m "docs: document scripts/deploy.sh in AGENTS.md"
```

---

## Done criteria

- `npm test` passes (vitest, no e2e picked up).
- `npx playwright test --list` shows 6 specs across 6 files.
- `BASE_URL=https://trientes.org npx playwright test` passes 6/6.
- `bash -n scripts/deploy.sh` exits 0.
- `scripts/deploy.sh` is executable (`-rwxr-xr-x`).
- `AGENTS.md` mentions `./scripts/deploy.sh`.
- All 14 task commits land on `main`.

## Not done in this plan (deferred)

- Authenticated E2E flows (admin actions, Telegram login, watchlist).
- GitHub Actions / pre-merge CI.
- Automatic rollback.
- Visual regression / screenshot diffing.
- Multi-browser / mobile viewport coverage.
- Email/Slack alerting on red deploys.
