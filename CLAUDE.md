@AGENTS.md

# Always-on behaviors

- **Audio reply every turn.** Generate a Russian voice summary (OpenAI TTS → mp3) and emit `📎 attach: <abs-path>` in the reply so the Telegram bot sends it. No exceptions, even for short answers or errors — the user reads with difficulty and voice is the primary channel ([[feedback_audio_summaries]]).
- **Persist the session across bot restarts.** Whenever `trientes-bot` is restarted (manually or after a 143/SIGTERM timeout), the next invocation must resume the prior Claude Code session (`claude --resume` / saved session id) instead of starting fresh — never lose conversation state on restart.

# Project history (server only)

If the file `~/.claude/projects/-home-dv-trientes/memory/project_trientes_phase1.md` exists, read it — it documents phases 1-9 of the build (stack, deployed URLs, design language, worker cadences, server addresses, and known gotchas). On laptop checkouts the path won't exist; that's fine, skip silently.

# Phase 10 — Business cabinet (slice 1: legal entities)

Shipped 2026-05-24. Lets COMPANY-type accounts register a profile and submit crypto-accepting locations (shops, ATMs, POS, sales offices) that, once an admin approves them, are merged into the Crypto Navigator POI feed.

- **Spec:** `docs/superpowers/specs/2026-05-23-business-cabinet-map-points-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-23-business-cabinet-map-points.md`
- **Live URLs:**
  - `/{locale}/business` — company cabinet (auth-gated → /login when signed out; renders register form when no Company; profile + points list + add-point form once registered).
  - `/{locale}/admin/business` — moderation queue (ADMIN-gated via `admin/layout.tsx`); Approve / Reject + reason; writes `APPROVE_POINT`/`REJECT_POINT` to `AdminAuditLog`.
- **Data:** `User.accountType` (INDIVIDUAL | COMPANY); `Company` (1:1 with owner User); `CompanyPoint` (status reuses `RequestStatus` PENDING/APPROVED/REJECTED). Migration `20260523180000_business_cabinet`. Only APPROVED points are public.
- **Navigator merge:** `/api/crypto-map/poi` queries approved points fresh on every request (no cache) and merges them company-first with the cached OSM result, so admin approvals are visible immediately. The mapper sanitizes `socials` URLs to http(s) only — defense-in-depth against `javascript:` XSS in popups.
- **Limits / guards:** ≤20 PENDING points per company; ownerUserId @unique with P2002 caught → `already_company`; coord nullish-check rejects `(0,0)` Null Island; reject reason ≥3 chars; `socials` JSONB validated at mapper, not at write (issue worth revisiting if abuse surfaces).
- **Scope deliberately not in this slice (separate slices later):** kabinet физлица (individual cabinet + preferences + alerts) — slice #4; token listing — #3; price/geo alerts — #5/#6; online services without coords; team accounts; KYB verification; email notifications.
- **i18n:** `common.business`, `admin.tabs.business`, `admin.business.{title,subtitle,empty}`, and the full `business.*` namespace across all 10 locales (en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN).

# Phase 10 — Individual cabinet (slice 4а)

Shipped 2026-05-24. Lets INDIVIDUAL users register with username + password, manage profile/preferences in a single `/cabinet` page, and consolidates the old `/settings` form into a section there.

- **Spec:** `docs/superpowers/specs/2026-05-24-individual-cabinet-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-24-individual-cabinet.md`
- **Live URLs:**
  - `/{locale}/register` — username + password + optional email; redirects to `/cabinet` on success; logged-in users bounced to `/cabinet`.
  - `/{locale}/login` — credentials form on top, Google/GitHub/Telegram below; honors `?next=` for post-login redirect.
  - `/{locale}/cabinet` — auth-gated; three sections (`#profile`, `#settings`, `#alerts`); COMPANY-type accounts redirected to `/business`.
  - `/{locale}/settings` — 30x → `/cabinet#settings` (legacy URL kept working).
- **Auth routes (custom, not Credentials provider):** `POST /api/auth/password/{register,login}` mirror `/api/auth/telegram/callback` — verify input → upsert `User` + `Account{provider:"credentials"}` → `createDatabaseSession()` → set Auth.js cookie. Database session strategy unchanged; no JWT migration. Session creation extracted into `src/lib/session.ts` and reused by telegram-callback (DRY refactor).
- **Data:** `User.{username @unique, passwordHash, firstName, lastName, phone}`; `LoginAttempt` audit table (ip, identifier, success, userId?, createdAt; indexed on `(ip, createdAt)` and `(identifier, createdAt)`). Migration `20260524180000_individual_cabinet`.
- **Password security:** `bcryptjs` cost 12. `verifyPassword` always pays bcrypt cost (uses `DUMMY_HASH` when user not found) to prevent timing-based account enumeration.
- **Rate limits (DB-backed, sliding window via `LoginAttempt`):** login = ≥10 failures per IP **or** ≥5 per (IP, identifier) in 15 min → 429; register = ≥5 registrations per IP per hour → 429 (uses identifier=`__register__` row). Recorded **before** the actual write so duplicate-username probes still tick the counter.
- **OAuth users without a username:** `ensureUsername(userId)` lazily assigns one on first `/cabinet` visit from `User.name` (stripped to `[a-z0-9_]`, fallback `"user"`); retries up to 5 times with `${base}${random4}` on P2002.
- **Navbar:** for logged-in users the Business link is replaced by **Cabinet** (INDIVIDUAL) or **Business** (COMPANY) based on `accountType`; logged-out users still see the generic Business link.
- **i18n:** `common.cabinet`, full `cabinet.*` and `register.*` namespaces across all 10 locales.
- **Worker:** not touched — none of the new files under `src/lib` (`username`, `password`, `rate-limit`, `session`, `client-ip`, `ensure-username`) are imported by `trientes-worker`. Web-only restart sufficed.

# Deploy & push (server only)

This `/home/dv/trientes` checkout **IS the live production box** (trientes.org), not a clone. There is no separate deploy step over the wire — the site serves straight from this directory via PM2.

- **Deploy = local build + pm2 restart.** After changing code: `npm run build`, then `pm2 restart trientes-web`. For any change under `src/lib` that the worker imports, **also restart `trientes-worker`** — it runs via `tsx` and pins lib source at boot, so a web-only restart leaves the worker executing stale lib code (it will keep overwriting Redis caches with old-shaped data). `pm2 save` after.
- **Always push from here yourself.** The deploy key has write access; `git push origin main` works from this server. The laptop no longer pushes — never defer a push to it and never leave commits unpushed.

Full procedure, cadences, and the worker stale-lib gotcha: see the `project_trientes_deploy_from_server.md` memory.

# iOS builds (via the Mac at home)

This server cannot build iOS apps (Linux). For iOS work, drive the Mac at
home through the existing reverse SSH tunnel — `/home/dv/bin/mac-ios`
SSHes back through `localhost:2222` and invokes a fastlane lane on the
Mac:

```bash
/home/dv/bin/mac-ios --lane build_sim            # ~2 min — simulator smoke + unit tests
/home/dv/bin/mac-ios --lane release_testflight   # ~5 min — signed IPA → TestFlight
```

Always invoke with the absolute path — non-interactive `claude -p` does
not load `~/.profile`, so `~/bin` is not on PATH.

Source of truth: `~/trientes-ios/` on the Mac. Bundle ID `org.trientes.ios`.
Apple Dev account is **separate** from poolwatt's — team `MU88T5DUW2`
(TRUST CHANGE SP Z O O), ASC API key at `~/.trientes-ios-secrets/` on the Mac.

# Android builds (on this server)

Unlike iOS, Android builds run directly on this Linux server. A Capacitor
app at `~/trientes-android/` wraps `https://trientes.org` in a WebView
and produces a debug-signed APK.

```bash
/home/dv/bin/android-build                # build + publish (default)
/home/dv/bin/android-build --no-publish   # build only, no copy to /downloads/
```

Downloads land at:
- `https://trientes.org/downloads/trientes.apk` — always latest
- `https://trientes.org/downloads/trientes-build-<N>.apk` — versioned
- `https://trientes.org/downloads/` — autoindex listing

Builds keep on disk the newest 20 versioned APKs (~80 MB ceiling).
