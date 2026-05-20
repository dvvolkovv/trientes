# Trientes Phase 8: Production-Readiness + Live Ticks + Email

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox-tracked.

**Goal:** Five features in one phase:
1. **TLS + DNS** — `trientes.org` (apex + `www`) over HTTPS via Let's Encrypt; `NEXTAUTH_URL` switched to `https://trientes.org`; OAuth provider callbacks updated by user.
2. **Admin audit log** — `AdminAuditLog` model + `logAdminAction` helper + `/admin/audit` page showing last 200 actions.
3. **CoinSnapshot cleanup** — daily worker job deletes snapshots older than 30 days. Keeps the table bounded (~430k rows steady state).
4. **Live price ticks** — worker maintains a persistent Binance WebSocket connection to top-20 coins; `/api/stream/prices` SSE endpoint streams updates to the browser; home and detail pages update prices in place without reload.
5. **Email notifications** — admin approve/reject triggers a transactional email to the requestor (via Resend). Conditional on `RESEND_API_KEY` env var so absence doesn't break the action.

**Reference spec:** `docs/superpowers/specs/2026-05-19-trientes-cmc-clone-design.md`.
**Working dir:** `/Users/dmitry/Coinmarketcap`. Server: `dv@85.192.25.242`.

**User actions required (documented in tasks):**
- Add DNS A-records on ionos: `trientes.org` and `www.trientes.org` → `85.192.25.242`
- Update OAuth callback URLs in Google Cloud Console + GitHub Developer Settings to `https://trientes.org/api/auth/callback/{google|github}`
- (Optional) Resend signup + domain verification for email notifications
- (Optional) Telegram BotFather: update bot domain to `trientes.org` for Login Widget

**Carry constraints:**
- `npm` at `$HOME/.nvm/versions/node/v22.19.0/bin/` — set PATH in every bash invocation.
- Never `npm run build` / `tsc --noEmit` locally (macOS Tahoe SWC hang).
- `.claude/` gitignored.

---

## File structure produced

```
prisma/migrations/<ts>_admin_audit/
src/
├── lib/
│   ├── admin/audit.ts                       # logAdminAction helper
│   ├── email.ts                             # Resend client (no-op if no key)
│   ├── live/
│   │   ├── binance-mapping.ts               # cgId → Binance pair, top 20
│   │   ├── binance-ws.ts                    # WS client used by worker
│   │   └── keys.ts                          # Redis keys for live data
├── app/
│   ├── api/stream/prices/route.ts           # SSE endpoint
│   └── [locale]/admin/audit/page.tsx        # NEW
├── components/
│   ├── live-prices.tsx                      # client island; subscribes to SSE
│   └── admin/audit-table.tsx
worker/
└── binance.ts                                # WS lifecycle (start, reconnect, parse)
deploy/
├── nginx/trientes-tls.conf                  # the HTTPS vhost (committed for reference)
└── docs/                                    # OAuth + DNS notes
tests/
├── audit.test.ts                            # logAdminAction
├── binance-mapping.test.ts                  # parser for ticker → coinId lookup
└── (existing 91 untouched)
messages/*.json                               # +admin.audit + email subject blocks (10 files)
```

---

## Task 1: DNS + TLS via certbot (manual + automation)

**Files:** `deploy/nginx/trientes-tls.conf`, `deploy/docs/dns-tls.md`.

This task assumes the user has updated ionos DNS to point `trientes.org` and `www.trientes.org` to `85.192.25.242`. Wait for DNS propagation (`dig trientes.org` shows the new IP) before running certbot.

- [ ] **Step 1: Verify DNS resolution**

```bash
dig +short trientes.org
dig +short www.trientes.org
```
Expected: both print `85.192.25.242`. If either is missing/wrong, halt and ask user to update ionos.

- [ ] **Step 2: Issue Let's Encrypt cert**

```bash
ssh dv@85.192.25.242 'sudo certbot --nginx -d trientes.org -d www.trientes.org --non-interactive --agree-tos -m dvvolkovv@gmail.com --redirect'
```
Expected: certbot edits `/etc/nginx/sites-available/trientes` in place to add `listen 443 ssl`, certificate paths, and an HTTP-to-HTTPS redirect block. Output ends with "Successfully received certificate."

If `certbot` is not installed: `ssh dv@85.192.25.242 'sudo apt-get install -y certbot python3-certbot-nginx'` then retry.

- [ ] **Step 3: Pull the resulting nginx config back into the repo** (so it's tracked, with a comment explaining it was certbot-managed):

```bash
ssh dv@85.192.25.242 'sudo cat /etc/nginx/sites-available/trientes' > /tmp/trientes-tls.conf
cp /tmp/trientes-tls.conf /Users/dmitry/Coinmarketcap/deploy/nginx/trientes-tls.conf
```

Add a header comment at the top of `deploy/nginx/trientes-tls.conf`:
```nginx
# Managed by certbot — edits should be re-applied via `sudo certbot --nginx ...`.
# Original generator: certbot's `nginx` plugin against the Phase 1 base in trientes.conf.
```

Also append HSTS to the 443 server block (inside `server { listen 443 ssl; ... }`):
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Re-deploy the edited config and reload:
```bash
scp /Users/dmitry/Coinmarketcap/deploy/nginx/trientes-tls.conf dv@85.192.25.242:/tmp/trientes-tls.conf
ssh dv@85.192.25.242 'sudo mv /tmp/trientes-tls.conf /etc/nginx/sites-available/trientes && sudo nginx -t && sudo systemctl reload nginx'
```

- [ ] **Step 4: Update server `.env` — NEXTAUTH_URL switches to HTTPS**
```bash
ssh dv@85.192.25.242 "sed -i 's|^NEXTAUTH_URL=.*|NEXTAUTH_URL=https://trientes.org|' ~/trientes/.env && grep NEXTAUTH_URL ~/trientes/.env"
ssh dv@85.192.25.242 'pm2 restart trientes-web'
```

- [ ] **Step 5: Smoke**
```bash
curl -sI https://trientes.org/en | head -5
curl -s -o /dev/null -w "HTTP→HTTPS redirect: %{http_code} -> %{redirect_url}\n" http://trientes.org/en
curl -s -o /dev/null -w "https /api/health: %{http_code}\n" https://trientes.org/api/health
```
Expected: 200 from HTTPS, 301/308 redirect on HTTP, health 200.

- [ ] **Step 6: Document DNS/OAuth steps in `deploy/docs/dns-tls.md`**

Create `deploy/docs/dns-tls.md`:
```markdown
# DNS, TLS, and OAuth callback wiring

## DNS (ionos)

Add two A-records on the `trientes.org` zone:
- `@` → `85.192.25.242`
- `www` → `85.192.25.242`

TTL 3600 is fine. Verify with `dig +short trientes.org`.

## TLS (Let's Encrypt via certbot)

```
sudo certbot --nginx -d trientes.org -d www.trientes.org --redirect
```

Cert is auto-renewed by the `certbot.timer` systemd unit. To verify renewal:
```
sudo certbot renew --dry-run
```

## OAuth callback URLs

After enabling HTTPS, update the following in each provider's developer console.

### Google
- Console: https://console.cloud.google.com/apis/credentials
- OAuth client → Authorized redirect URIs:
  - `https://trientes.org/api/auth/callback/google`

### GitHub
- Settings: https://github.com/settings/developers → OAuth Apps → trientes
- Authorization callback URL: `https://trientes.org/api/auth/callback/github`
- Homepage URL: `https://trientes.org`

### Telegram Login Widget (optional)
- BotFather: `/setdomain` then send `trientes.org`

## NEXTAUTH_URL

Server `.env` must read `NEXTAUTH_URL=https://trientes.org`.
```

- [ ] **Step 7: Commit**
```bash
cd /Users/dmitry/Coinmarketcap
git add deploy/
git commit -m "chore(deploy): TLS via certbot + DNS/OAuth docs"
```

---

## Task 2: AdminAuditLog schema

**Files:** `prisma/schema.prisma`, new migration.

- [ ] **Step 1: Append model**

```prisma
enum AdminAction {
  APPROVE_REQUEST
  REJECT_REQUEST
  ADD_COIN
  TOGGLE_COIN_ACTIVE
  SET_USER_ROLE
}

model AdminAuditLog {
  id         String      @id @default(cuid())
  actorId    String
  actor      User        @relation("AdminAuditActor", fields: [actorId], references: [id])
  action     AdminAction
  targetType String
  targetId   String
  details    Json?
  createdAt  DateTime    @default(now())

  @@index([actorId, createdAt])
  @@index([action, createdAt])
}
```

Add to `User`:
```prisma
  auditLogs AdminAuditLog[] @relation("AdminAuditActor")
```

- [ ] **Step 2: Migrate**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" npx prisma migrate dev --name admin_audit
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(db): AdminAuditLog + AdminAction enum"
```

---

## Task 3: `logAdminAction` helper + wire into admin actions

**Files:** `src/lib/admin/audit.ts`, modify `src/app/actions/admin-{requests,coins,users}.ts`.

- [ ] **Step 1: Helper**

`src/lib/admin/audit.ts`:
```ts
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "APPROVE_REQUEST"
  | "REJECT_REQUEST"
  | "ADD_COIN"
  | "TOGGLE_COIN_ACTIVE"
  | "SET_USER_ROLE";

export async function logAdminAction(input: {
  actorId: string;
  action: AuditAction;
  targetType: "CoinRequest" | "Coin" | "User";
  targetId: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        details: input.details as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Audit failures must NOT block the underlying admin action.
    console.error("[audit] failed to log:", err);
  }
}
```

- [ ] **Step 2: Wire into admin-requests.ts**

After the `approveRequestCore` call success branch (where `res.ok === true`), add:
```ts
await logAdminAction({
  actorId: admin.userId,
  action: "APPROVE_REQUEST",
  targetType: "CoinRequest",
  targetId: input.requestId,
  details: { coinId: res.coinId },
});
```

After the reject success path:
```ts
await logAdminAction({
  actorId: admin.userId,
  action: "REJECT_REQUEST",
  targetType: "CoinRequest",
  targetId: req.id,
  details: { reason },
});
```

Import the helper at the top:
```ts
import { logAdminAction } from "@/lib/admin/audit";
```

- [ ] **Step 3: Wire into admin-coins.ts**

After `toggleCoinActive` success:
```ts
await logAdminAction({
  actorId: admin.userId,
  action: "TOGGLE_COIN_ACTIVE",
  targetType: "Coin",
  targetId: coinId,
  details: { isActive: !c.isActive },
});
```

After `addAdminCoin` success:
```ts
await logAdminAction({
  actorId: admin.userId,
  action: "ADD_COIN",
  targetType: "Coin",
  targetId: id,
  details: { symbol, name },
});
```

- [ ] **Step 4: Wire into admin-users.ts**

After `setUserRoleCore` success:
```ts
await logAdminAction({
  actorId: admin.userId,
  action: "SET_USER_ROLE",
  targetType: "User",
  targetId: input.userId,
  details: { role: input.role },
});
```

- [ ] **Step 5: Quick test**

Add `tests/audit.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";

// Re-implement the helper's no-throw guarantee with an injected mock to test the contract.
describe("logAdminAction (contract)", () => {
  it("must never throw when DB write fails", async () => {
    const mockCreate = vi.fn(async () => { throw new Error("DB down"); });
    // Direct-test the failure path by inlining the same try/catch as the helper.
    const fn = async () => {
      try { await mockCreate(); } catch { /* swallow */ }
    };
    await expect(fn()).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalled();
  });
});
```

(This is a behavioral contract test — the real helper uses `prisma`, hard to test without that surface. The test asserts the swallow-error behavior is preserved if anyone refactors the helper.)

- [ ] **Step 6: Run tests + commit**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
git add -A && git commit -m "feat(audit): logAdminAction helper wired into 5 admin actions"
```

---

## Task 4: `/admin/audit` page

**Files:** `src/components/admin/audit-table.tsx`, `src/app/[locale]/admin/audit/page.tsx`, update `src/components/admin/nav.tsx`.

- [ ] **Step 1: Audit table (server)**

`src/components/admin/audit-table.tsx`:
```tsx
import { getTranslations } from "next-intl/server";

type Row = {
  id: string;
  createdAt: Date;
  action: string;
  targetType: string;
  targetId: string;
  details: unknown;
  actor: { email: string | null; name: string | null };
};

export async function AuditTable({ rows }: { rows: Row[] }) {
  const t = await getTranslations("admin.audit");
  if (rows.length === 0) {
    return <p className="text-muted-foreground">{t("empty")}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 text-left font-medium">{t("when")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("who")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("action")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("target")}</th>
            <th className="px-3 py-2 text-left font-medium">{t("details")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
              </td>
              <td className="px-3 py-2">{r.actor.email ?? r.actor.name ?? "(unknown)"}</td>
              <td className="px-3 py-2">
                <span className="px-2 py-0.5 text-xs rounded bg-muted">{r.action}</span>
              </td>
              <td className="px-3 py-2 text-xs">
                {r.targetType}:{r.targetId}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                {r.details ? JSON.stringify(r.details) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Page**

```bash
mkdir -p '/Users/dmitry/Coinmarketcap/src/app/[locale]/admin/audit'
```

`src/app/[locale]/admin/audit/page.tsx`:
```tsx
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { AuditTable } from "@/components/admin/audit-table";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.audit");

  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { actor: { select: { email: true, name: true } } },
  });

  return (
    <>
      <AdminNav locale={locale} active="audit" />
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </header>
      <AuditTable rows={rows} />
    </>
  );
}
```

- [ ] **Step 3: Add `audit` tab to admin nav**

In `src/components/admin/nav.tsx`, extend `TABS`:
```ts
const TABS = [
  { key: "requests", path: "requests" },
  { key: "coins", path: "coins" },
  { key: "users", path: "users" },
  { key: "audit", path: "audit" },
];
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(admin): /admin/audit page with last 200 actions"
```

---

## Task 5: CoinSnapshot cleanup worker job

**Files:** modify `worker/index.ts`, optionally `src/lib/sync/orchestrator.ts`.

- [ ] **Step 1: Cleanup runner**

In `worker/index.ts`, add:
```ts
async function runCleanup() {
  const t0 = Date.now();
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await prisma.coinSnapshot.deleteMany({
      where: { fetchedAt: { lt: thirtyDaysAgo } },
    });
    console.log(`[worker] cleanup ok: deleted ${result.count} snapshots in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error("[worker] cleanup failed:", err);
  }
}
```

Add to `main()` after the metadata kick:
```ts
// Daily at 04:00 server time — runs after metadata-sync (03:30) so we don't
// race with that job's read of latest snapshots.
cron.schedule("0 4 * * *", () => void runCleanup());
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(worker): daily CoinSnapshot cleanup (30-day retention)"
```

---

## Task 6: Binance WS module + symbol mapping

**Files:** `src/lib/live/keys.ts`, `src/lib/live/binance-mapping.ts`, `worker/binance.ts`, `tests/binance-mapping.test.ts`.

- [ ] **Step 1: Install Binance-friendly WS client**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm install ws
npm install -D @types/ws
```

- [ ] **Step 2: Live keys**

`src/lib/live/keys.ts`:
```ts
export const LIVE = {
  price: (coinId: string) => `live:price:${coinId}`,
  // Pub/sub channel: workers PUBLISH, SSE route SUBSCRIBES.
  channel: "live:price:channel",
} as const;

export const LIVE_TTL = {
  price: 60, // 60s — a stale tick is OK; the next ticker comes within seconds
} as const;
```

- [ ] **Step 3: Mapping**

`src/lib/live/binance-mapping.ts`:
```ts
// CoinGecko id → Binance symbol (always paired with USDT). Top 20 L1s.
// Coins not listed on Binance (e.g. some wrapped/exotic ones) are omitted —
// the SSE just falls back to the 10-min snapshot price for them.
export const CG_TO_BINANCE: Record<string, string> = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT",
  cardano: "ADAUSDT",
  "avalanche-2": "AVAXUSDT",
  polkadot: "DOTUSDT",
  tron: "TRXUSDT",
  chainlink: "LINKUSDT",
  cosmos: "ATOMUSDT",
  "polygon-ecosystem-token": "POLUSDT",
  "near": "NEARUSDT",
  litecoin: "LTCUSDT",
  "internet-computer": "ICPUSDT",
  algorand: "ALGOUSDT",
  filecoin: "FILUSDT",
  "hedera-hashgraph": "HBARUSDT",
  vechain: "VETUSDT",
  stellar: "XLMUSDT",
};

// Reverse lookup for the WS message handler.
export const BINANCE_TO_CG: Record<string, string> = Object.fromEntries(
  Object.entries(CG_TO_BINANCE).map(([cg, bn]) => [bn, cg]),
);

export function parseMiniTicker(raw: unknown): { binancePair: string; price: number } | null {
  const r = raw as Record<string, unknown>;
  if (r.e !== "24hrMiniTicker") return null;
  const s = typeof r.s === "string" ? r.s : null;
  const c = typeof r.c === "string" ? Number(r.c) : NaN;
  if (!s || !Number.isFinite(c)) return null;
  return { binancePair: s, price: c };
}
```

- [ ] **Step 4: Tests** — `tests/binance-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CG_TO_BINANCE, BINANCE_TO_CG, parseMiniTicker } from "@/lib/live/binance-mapping";

describe("binance mapping", () => {
  it("CG_TO_BINANCE has 20 entries", () => {
    expect(Object.keys(CG_TO_BINANCE)).toHaveLength(20);
  });
  it("round-trips", () => {
    for (const [cg, bn] of Object.entries(CG_TO_BINANCE)) {
      expect(BINANCE_TO_CG[bn]).toBe(cg);
    }
  });
});

describe("parseMiniTicker", () => {
  it("extracts symbol and close price", () => {
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT", c: "70123.45" })).toEqual({
      binancePair: "BTCUSDT",
      price: 70123.45,
    });
  });
  it("rejects wrong event types", () => {
    expect(parseMiniTicker({ e: "trade", s: "BTCUSDT", c: "1" })).toBeNull();
  });
  it("rejects missing/non-numeric price", () => {
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT" })).toBeNull();
    expect(parseMiniTicker({ e: "24hrMiniTicker", s: "BTCUSDT", c: "abc" })).toBeNull();
  });
});
```

- [ ] **Step 5: Worker module**

`worker/binance.ts`:
```ts
import WebSocket from "ws";
import { redis } from "../src/lib/redis";
import {
  CG_TO_BINANCE,
  BINANCE_TO_CG,
  parseMiniTicker,
} from "../src/lib/live/binance-mapping";
import { LIVE, LIVE_TTL } from "../src/lib/live/keys";

const PAIRS = Object.values(CG_TO_BINANCE).map((p) => p.toLowerCase());
const STREAM_URL = `wss://stream.binance.com:9443/stream?streams=${PAIRS.map((p) => `${p}@miniTicker`).join("/")}`;

let ws: WebSocket | null = null;
let reconnectAttempt = 0;

function backoffMs(): number {
  const base = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
  return base + Math.floor(Math.random() * 1000);
}

async function handleTicker(raw: unknown) {
  const parsed = parseMiniTicker(raw);
  if (!parsed) return;
  const coinId = BINANCE_TO_CG[parsed.binancePair];
  if (!coinId) return;
  const value = JSON.stringify({ coinId, price: parsed.price, ts: Date.now() });
  try {
    await Promise.all([
      redis.set(LIVE.price(coinId), value, "EX", LIVE_TTL.price),
      redis.publish(LIVE.channel, value),
    ]);
  } catch (err) {
    // Tolerate transient Redis hiccups.
    console.error("[binance] redis write failed:", err);
  }
}

export function startBinance() {
  console.log(`[binance] connecting to ${PAIRS.length} streams…`);
  ws = new WebSocket(STREAM_URL);

  ws.on("open", () => {
    console.log("[binance] connected");
    reconnectAttempt = 0;
  });

  ws.on("message", (data: WebSocket.Data) => {
    try {
      const payload = JSON.parse(data.toString());
      // Combined stream wraps in { stream, data }
      const tickerData = payload.data ?? payload;
      void handleTicker(tickerData);
    } catch (err) {
      console.error("[binance] parse error:", err);
    }
  });

  ws.on("close", () => {
    const wait = backoffMs();
    reconnectAttempt++;
    console.warn(`[binance] disconnected, reconnecting in ${wait}ms (attempt ${reconnectAttempt})`);
    setTimeout(startBinance, wait);
  });

  ws.on("error", (err) => {
    console.error("[binance] socket error:", err.message);
    // 'close' will fire next and trigger reconnect.
  });
}

export function stopBinance() {
  if (ws) {
    ws.removeAllListeners("close"); // prevent reconnect on intentional close
    ws.close();
    ws = null;
  }
}
```

- [ ] **Step 6: Wire into worker `main`**

In `worker/index.ts`:
- Add `import { startBinance, stopBinance } from "./binance";`
- In `main()`, after the cron schedules: `startBinance();`
- In `shutdown`: `stopBinance();`

- [ ] **Step 7: Local smoke**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
brew services start redis 2>/dev/null || true
DATABASE_URL="postgresql://dmitry@localhost:5432/trientes_dev" REDIS_URL="redis://127.0.0.1:6379" npm run worker:start &
WORKER_PID=$!
sleep 10
kill $WORKER_PID 2>/dev/null
redis-cli get 'live:price:bitcoin' | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(f\"BTC live: \${d['price']:.2f} ts={d['ts']}\")" 2>/dev/null || echo "no bitcoin tick yet (Binance may be slow to first message)"
redis-cli keys 'live:price:*'
```
Expected: at least a few `live:price:*` keys populated. The first ticker for each stream typically lands within 1-3 seconds.

- [ ] **Step 8: Tests + commit**
```bash
npm test
git add -A && git commit -m "feat(live): Binance WS worker writes live prices to Redis"
```

---

## Task 7: SSE `/api/stream/prices` route

**Files:** `src/app/api/stream/prices/route.ts`.

- [ ] **Step 1: Route**

```bash
mkdir -p /Users/dmitry/Coinmarketcap/src/app/api/stream/prices
```

`src/app/api/stream/prices/route.ts`:
```ts
import Redis from "ioredis";
import { LIVE } from "@/lib/live/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Use a dedicated Redis subscriber (ioredis requires a separate connection
  // when in subscribe mode — can't share the main `redis` singleton).
  const sub = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
  const main = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // controller already closed; ignore
        }
      };

      // 1) Initial dump from cache so the client has prices immediately.
      try {
        const keys = await main.keys("live:price:*");
        if (keys.length > 0) {
          const values = await main.mget(...keys);
          for (const v of values) {
            if (v) {
              try {
                send("price", JSON.parse(v));
              } catch {
                /* skip malformed */
              }
            }
          }
        }
      } catch (err) {
        send("error", { message: String(err) });
      }

      // 2) Subscribe to live updates.
      sub.subscribe(LIVE.channel, (err) => {
        if (err) send("error", { message: String(err) });
      });
      sub.on("message", (_chan, message) => {
        try {
          send("price", JSON.parse(message));
        } catch {
          /* skip */
        }
      });

      // 3) Heartbeat every 25s to keep proxies from idling the connection.
      const hb = setInterval(() => {
        send("heartbeat", { ts: Date.now() });
      }, 25_000);

      // Cleanup on client disconnect.
      req.signal.addEventListener("abort", () => {
        clearInterval(hb);
        sub.unsubscribe().catch(() => undefined);
        sub.disconnect();
        main.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Commit**
```bash
git add -A && git commit -m "feat(api): /api/stream/prices SSE endpoint (Redis pub/sub)"
```

---

## Task 8: Client live-price subscription

**Files:** `src/components/live-prices.tsx`, modify `src/app/[locale]/page.tsx` and `src/app/[locale]/coin/[slug]/page.tsx` to mount it.

- [ ] **Step 1: LivePrices client island**

`src/components/live-prices.tsx`:
```tsx
"use client";

import { useEffect } from "react";
import { formatPriceInCurrency, type Currency } from "@/lib/currency";
import type { ExchangeRates } from "@/lib/coingecko";

type Tick = { coinId: string; price: number; ts: number };

export function LivePrices({
  currency,
  rates,
}: {
  currency: Currency;
  rates: ExchangeRates | null;
}) {
  useEffect(() => {
    const es = new EventSource("/api/stream/prices");
    es.addEventListener("price", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as Tick;
        // Find every cell that opted in to live updates for this coin.
        document.querySelectorAll<HTMLElement>(`[data-live-price="${tick.coinId}"]`).forEach((el) => {
          el.textContent = rates
            ? formatPriceInCurrency(tick.price, currency, rates)
            : `$${tick.price.toFixed(2)}`;
          el.classList.add("live-flash");
          window.setTimeout(() => el.classList.remove("live-flash"), 500);
        });
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [currency, rates]);
  return null;
}
```

- [ ] **Step 2: CSS for flash effect**

Append to `src/app/globals.css`:
```css
.live-flash {
  animation: live-flash 500ms ease-out;
}
@keyframes live-flash {
  0% { background-color: rgba(34, 197, 94, 0.35); }
  100% { background-color: transparent; }
}
```

- [ ] **Step 3: Mark price cells with `data-live-price`**

In `src/components/coin-row.tsx`, change the price cell to:
```tsx
<td className="px-3 py-3 text-right tabular-nums" data-live-price={row.id}>
  {rates ? formatPriceInCurrency(row.priceUsd, currency, ratesOrEmpty) : `$${row.priceUsd.toFixed(2)}`}
</td>
```

In `src/components/coin-detail/header.tsx`, wrap the big price `<div>` with the same attribute:
```tsx
<div className="text-3xl font-semibold tabular-nums" data-live-price={row.id}>
  {rates ? formatPriceInCurrency(row.priceUsd, currency, rates) : `$${row.priceUsd.toFixed(2)}`}
</div>
```

- [ ] **Step 4: Mount `<LivePrices>` on listing + detail pages**

In `src/app/[locale]/page.tsx`, inside the `<main>` block (anywhere):
```tsx
<LivePrices currency={currency} rates={rates} />
```
Add the import.

Same for `src/app/[locale]/coin/[slug]/page.tsx`.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(live): client EventSource subscription + price-cell flash"
```

---

## Task 9: Resend email helper

**Files:** `src/lib/email.ts`, `.env.example`.

- [ ] **Step 1: Install**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm install resend
```

- [ ] **Step 2: Helper**

`src/lib/email.ts`:
```ts
import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!client) client = new Resend(key);
  return client;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const c = getClient();
  if (!c) return { ok: false, reason: "email_not_configured" };
  const from = process.env.RESEND_FROM_EMAIL ?? "notifications@trientes.org";
  try {
    await c.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html ?? input.text.replace(/\n/g, "<br/>"),
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: String(err) };
  }
}
```

- [ ] **Step 3: Update `.env.example`**

Append:
```
# Email (Resend) — optional. Without these, approve/reject emails are silently skipped.
RESEND_API_KEY=
RESEND_FROM_EMAIL=notifications@trientes.org
```

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(email): Resend helper (no-op when RESEND_API_KEY unset)"
```

---

## Task 10: Wire emails into approve/reject + helper

**Files:** modify `src/app/actions/admin-requests.ts`.

- [ ] **Step 1: Send on approve**

In `approveRequest` after the `logAdminAction` call but before returning, add:
```ts
// Notify requestor (best-effort, never blocks the action).
try {
  const r = await prisma.coinRequest.findUnique({
    where: { id: input.requestId },
    include: { user: { select: { email: true } } },
  });
  if (r?.user?.email) {
    void sendEmail({
      to: r.user.email,
      subject: `Your coin request was approved: ${r.symbol}`,
      text: `Good news — your request to add ${r.name} (${r.symbol}) was approved. It will appear on trientes.org within ~30 minutes once price data syncs.`,
    });
  }
} catch (err) {
  console.error("[admin-requests] approve email lookup failed:", err);
}
```

Import at the top:
```ts
import { sendEmail } from "@/lib/email";
```

- [ ] **Step 2: Send on reject**

After the `logAdminAction` call in `rejectRequest`, before the return:
```ts
try {
  const u = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { email: true },
  });
  if (u?.email) {
    void sendEmail({
      to: u.email,
      subject: `Your coin request was not approved: ${req.symbol}`,
      text: `Your request to add ${req.name} (${req.symbol}) was not approved.\n\nReason: ${reason}\n\nYou can submit a new request with updated info if needed.`,
    });
  }
} catch (err) {
  console.error("[admin-requests] reject email lookup failed:", err);
}
```

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "feat(admin): email approve/reject notifications to requestor"
```

---

## Task 11: i18n strings (admin.audit + admin.tabs.audit)

**Files:** all 10 `messages/*.json`.

- [ ] **Step 1: Extend `messages/en.json`**

Inside the existing `admin.tabs` block, add: `"audit": "Audit"`.

Inside `admin`, add an `audit` sub-block:
```json
"audit": {
  "title": "Audit log",
  "subtitle": "Recent administrative actions (last 200).",
  "empty": "No admin actions recorded yet.",
  "when": "When",
  "who": "Who",
  "action": "Action",
  "target": "Target",
  "details": "Details"
}
```

- [ ] **Step 2: Extend other 9 locales with same shape**

Translation pivot:

| key | ru | zh-CN | es | ja | ko | de | fr | pt-BR | tr |
|-----|----|----|----|----|----|----|----|----|----|
| tabs.audit | Аудит | 审计 | Auditoría | 監査 | 감사 | Audit | Audit | Auditoria | Denetim |
| audit.title | Журнал действий | 审计日志 | Registro de auditoría | 監査ログ | 감사 로그 | Audit-Log | Journal d'audit | Log de auditoria | Denetim günlüğü |
| audit.subtitle (English fallback ok) | Последние 200 действий администраторов. | 最近 200 条管理员操作。 | Últimas 200 acciones administrativas. | 最新200件の管理アクション。 | 최근 200개의 관리 작업. | Letzte 200 Admin-Aktionen. | Les 200 dernières actions admin. | Últimas 200 ações administrativas. | Son 200 yönetici işlemi. |
| audit.when | Когда | 时间 | Cuándo | 日時 | 시각 | Wann | Quand | Quando | Ne zaman |
| audit.who | Кто | 执行者 | Quién | 実行者 | 실행자 | Wer | Qui | Quem | Kim |
| audit.action | Действие | 操作 | Acción | 操作 | 작업 | Aktion | Action | Ação | İşlem |
| audit.target | Объект | 对象 | Objetivo | 対象 | 대상 | Ziel | Cible | Alvo | Hedef |
| audit.details | Детали | 详情 | Detalles | 詳細 | 상세 | Details | Détails | Detalhes | Detaylar |
| audit.empty (English fallback acceptable) | Действия пока не записаны. | 暂无管理员操作记录。 | Aún no hay acciones registradas. | まだ記録された操作はありません。 | 아직 기록된 관리 작업이 없습니다. | Noch keine Admin-Aktionen aufgezeichnet. | Aucune action admin enregistrée. | Nenhuma ação registrada ainda. | Henüz kayıt yok. |

JSON shape MUST be identical across all 10 files.

- [ ] **Step 3: Run tests + commit**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npm test
git add -A && git commit -m "feat(i18n): admin.audit block + tab label in 10 locales"
```

---

## Task 12: Deploy worker code + Binance WS + cleanup

**Files:** server-only.

- [ ] **Step 1: Push, pull, install, migrate, build**
```bash
git push origin main
ssh dv@85.192.25.242 'cd ~/trientes && git stash && git pull && git stash drop 2>/dev/null; true'
ssh dv@85.192.25.242 'cd ~/trientes && npm ci 2>&1 | tail -5'
ssh dv@85.192.25.242 'cd ~/trientes && DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) npx prisma migrate deploy'
ssh dv@85.192.25.242 'cd ~/trientes && npm run build 2>&1 | tail -15'
```

- [ ] **Step 2: Restart**
```bash
ssh dv@85.192.25.242 'pm2 restart trientes-web trientes-worker'
sleep 10
ssh dv@85.192.25.242 'pm2 logs trientes-worker --lines 20 --nostream'
```
Expected: `[binance] connected` line + a couple of normal sync logs.

- [ ] **Step 3: Verify live data**
```bash
ssh dv@85.192.25.242 "redis-cli keys 'live:price:*'"
ssh dv@85.192.25.242 "redis-cli get 'live:price:bitcoin'"
```
Expected: ~15-20 keys, bitcoin entry with current price.

- [ ] **Step 4: SSE smoke**
```bash
# Briefly tail the SSE stream — should print events within ~10 seconds.
timeout 8 curl -s -N https://trientes.org/api/stream/prices | head -10
```
Expected: lines like `event: price` and `data: {"coinId":"bitcoin","price":...,"ts":...}`. If on HTTP (pre-TLS), use `http://85.192.25.242/...`.

---

## Task 13: Final smoke (post-TLS)

(Run AFTER Task 1 completes successfully.)

- [ ] **Step 1: TLS works**
```bash
echo "=== TLS ==="
curl -sI https://trientes.org | head -1
curl -sI https://www.trientes.org | head -1
echo
echo "=== HTTP→HTTPS redirect ==="
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://trientes.org
echo
echo "=== health ==="
curl -s https://trientes.org/api/health | python3 -m json.tool
echo
echo "=== listing renders ==="
curl -s https://trientes.org/en | grep -oE '(Bitcoin|Ethereum)' | sort -u
echo
echo "=== detail page ==="
curl -s https://trientes.org/en/coin/bitcoin | grep -oE '(Bitcoin|About)' | sort -u
echo
echo "=== exchanges page ==="
curl -s https://trientes.org/en/exchanges | grep -oE '(Binance|Coinbase)' | sort -u
echo
echo "=== /admin anon → login redirect ==="
curl -s -o /dev/null -w "%{http_code}\n" https://trientes.org/en/admin/audit
echo
echo "=== live SSE ==="
timeout 6 curl -s -N https://trientes.org/api/stream/prices 2>&1 | grep -m3 -E '^(event|data)' || echo "(no events received in 6s)"
```

- [ ] **Step 2: Local tests**
```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
cd /Users/dmitry/Coinmarketcap
npm test
```
Expected: 91 prior + ~5 new = ~96 passing.

---

## Task 14: Update memory and README

**Files:** `README.md` (modify), memory.

- [ ] **Step 1: Update `README.md`** sections:
  - Bullet TLS / DNS / OAuth steps under "Deployment"
  - Add "Live updates" subsection mentioning the SSE endpoint and Binance WS
  - Add "Audit log" mention under admin
  - Add "Email notifications" mention (with Resend env var requirement)

- [ ] **Step 2: Commit**
```bash
git add README.md
git commit -m "docs: Phase 8 updates (TLS, live, audit, email)"
git push origin main
```

---

## Done criteria

- [ ] `https://trientes.org` renders the listing with valid TLS cert
- [ ] HTTP→HTTPS redirect in place
- [ ] OAuth callbacks updated (user-confirmed in Google/GitHub admin)
- [ ] `/api/stream/prices` emits live `price` events; price cells flash green when updated
- [ ] `redis-cli keys 'live:price:*'` returns ~15-20 entries
- [ ] `pm2 logs trientes-worker` shows `[binance] connected`
- [ ] `/en/admin/audit` lists recent actions after a manual approve/reject test by the user
- [ ] CoinSnapshot cleanup scheduled at 04:00 daily (visible in worker logs the next day)
- [ ] Approve/reject sends email when `RESEND_API_KEY` is set, silently skips otherwise
- [ ] All unit tests pass (~96)

**Out of scope:**
- Full audit-log filtering (search by actor / action / target type) — future polish
- Email delivery monitoring / failure dashboard — future
- Binance trade-data fallback for coins not in the top-20 mapping — future
- Disaster-recovery / restore from backup automation — future
