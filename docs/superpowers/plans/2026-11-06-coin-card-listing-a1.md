# Собственный листинг монет — Слайс A1: фундамент, подача, публичная карточка

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Любой пользователь оформляет полноценную карточку монеты через визард из 4 шагов, админ её одобряет, и карточка публично рендерится с бейджем провенанса у каждого значения — без всякой зависимости от CoinGecko.

**Architecture:** Вся логика выносится в чистые функции под `src/lib/coin-card-*.ts` (валидация, классификация риска полей, полнота заполнения, провенанс, slug) и покрывается модульными тестами без базы — ровно как `src/lib/coin-request.ts` и `src/lib/admin/approve-request.ts` (последний принимает `PrismaLike`, поэтому тестируется с подставной базой). Поверх них — тонкие серверные действия (`src/app/actions/coin-card.ts`), клиентский визард и серверный рендер карточки. Миграция одна и аддитивная, сразу со всеми таблицами слайса A, включая те, что начнёт использовать только A2 (команда, приглашения, политика мультисига, ревизии) — чтобы не плодить вторую миграцию.

**Tech Stack:** Next.js 16.2.6 (App Router, server actions), Prisma + PostgreSQL, next-intl (10 локалей), Vitest (`npm test`), Tailwind. Запуск в проде — PM2 (`trientes-web`, `trientes-worker`).

**Важно перед кодом:** AGENTS.md требует читать документацию из `node_modules/next/dist/docs/` — это НЕ тот Next.js, что в обучающих данных. Минимум: `node_modules/next/dist/docs/01-app/02-guides/forms.md` (серверные действия и формы) и `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/` (revalidatePath, redirect).

**Спека:** `docs/superpowers/specs/2026-11-06-coin-card-listing-design.md`

**Что НЕ входит в A1** (идёт в план A2, пишется после сдачи A1): команда и приглашения, права по разделам в интерфейсе, конвейер ревизий, мультисиг, публичная история изменений, очередь модерации ревизий. В A1 карточку редактирует только её создатель и только пока она `PENDING`; после одобрения правки закрыты до A2. Это осознанное ограничение, а не недоделка: оно даёт работающий листинг на каждом шаге.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `prisma/schema.prisma` | +9 моделей, +6 enum, +связи на `User` и `Coin` |
| `prisma/migrations/20261106190000_coin_card/migration.sql` | аддитивная миграция |
| `src/lib/coin-card-slug.ts` | `slugifyCoinName`, `buildSlugCandidates` — чистые |
| `src/lib/coin-card-risk.ts` | `isHighRiskPath`, `sectionRisk` — единственный источник истины по риску полей |
| `src/lib/coin-card-validate.ts` | `validateCardBasics`, `validateContract`, `validateTokenomics`, `validateLinks` |
| `src/lib/coin-card-completeness.ts` | `computeCompleteness` → 0..100 |
| `src/lib/coin-card-provenance.ts` | `setProvenance`, `getProvenance`, `mergeProvenance` |
| `src/lib/coin-card-access.ts` | `canEditCardNow` — в A1 только «создатель + PENDING»; в A2 расширяется ролями |
| `src/lib/admin/approve-coin-card.ts` | `approveCoinCardCore(prisma: PrismaLike, …)` — ядро модерации, тестируемое |
| `src/app/actions/coin-card.ts` | серверные действия: `createCoinCard`, `saveCoinCardSection` |
| `src/app/actions/admin-coin-cards.ts` | `approveCoinCard`, `rejectCoinCard` |
| `src/app/api/coin-card/logo/upload/route.ts` | загрузка логотипа (копия паттерна `business/point/upload`) |
| `src/components/coin-card-wizard/*.tsx` | визард: шаги, прогресс-бар |
| `src/components/coin-card/provenance-badge.tsx` | бейдж источника значения |
| `src/components/coin-card/trust-plaque.tsx` | плашка уровня доверия |
| `src/components/coin-card/sections/*.tsx` | публичный рендер разделов |
| `src/app/[locale]/admin/coin-cards/page.tsx` | очередь модерации новых карточек |
| `tests/coin-card-*.test.ts` | модульные тесты |
| `messages/*.json` | ключи `coinCard.*` в 10 локалях |

---

### Task 1: Схема и миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261106190000_coin_card/migration.sql`

- [ ] **Step 1: Добавить enum'ы в `prisma/schema.prisma`**

Вставить после существующего `enum RequestStatus` (около строки 279):

```prisma
enum CoinCardSection {
  IDENTITY
  CONTRACTS
  TOKENOMICS
  MARKETS
  SECURITY
  TEAM
  LINKS
  MARKETING
  ACCEPTANCE
}

enum CoinCardRole {
  OWNER
  ADMIN
  EDITOR
  VIEWER
}

enum CoinCardTrust {
  UNVERIFIED
  CONTRACT_VERIFIED
  PROJECT_CLAIMED
  FULLY_VERIFIED
}

enum ProvenanceKind {
  SELF_REPORTED
  VERIFIED_ONCHAIN
  AGGREGATED
  ADMIN_SET
}

enum CoinCardVote {
  APPROVE
  REJECT
}

enum CoinCardRevisionKind {
  CONTENT
  POLICY
}

enum CoinCardRevisionStatus {
  DRAFT
  PENDING_SIGNERS
  PENDING_ADMIN
  APPLIED
  REJECTED
  EXPIRED
  WITHDRAWN
}
```

- [ ] **Step 2: Добавить модели в `prisma/schema.prisma`**

Вставить в конец файла:

```prisma
model CoinCard {
  id            String        @id @default(cuid())
  slug          String        @unique
  coinId        String?       @unique
  coin          Coin?         @relation("CoinCardCoin", fields: [coinId], references: [id], onDelete: SetNull)
  companyId     String?
  company       Company?      @relation(fields: [companyId], references: [id], onDelete: SetNull)
  stewardUserId String?
  steward       User?         @relation("CoinCardSteward", fields: [stewardUserId], references: [id], onDelete: SetNull)
  trust         CoinCardTrust @default(UNVERIFIED)
  status        RequestStatus @default(PENDING)
  completeness  Int           @default(0)
  name          String
  symbol        String
  tagline       String?
  description   String?       @db.Text
  logoUrl       String?
  launchDate    DateTime?
  tags          String[]      @default([])
  consensus     String?
  hashAlgo      String?
  links         Json?
  tokenomics    Json?
  teamInfo      Json?
  marketing     Json?
  security      Json?
  provenance    Json?
  rejectReason  String?
  reviewedById  String?
  reviewedAt    DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  contracts CoinCardContract[]
  markets   CoinCardMarket[]
  members   CoinCardMember[]
  invites   CoinCardInvite[]
  revisions CoinCardRevision[]
  policy    CoinCardPolicy?

  @@index([status, createdAt])
  @@index([trust])
}

model CoinCardContract {
  id          String    @id @default(cuid())
  cardId      String
  card        CoinCard  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  chain       String
  address     String
  decimals    Int?
  standard    String?
  isCanonical Boolean   @default(false)
  explorerUrl String?
  verifiedAt  DateTime?

  @@unique([cardId, chain, address])
  @@index([chain, address])
}

model CoinCardMarket {
  id           String    @id @default(cuid())
  cardId       String
  card         CoinCard  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  kind         String
  exchangeId   String?
  exchangeName String
  pair         String
  tradeUrl     String?
  chain        String?
  poolAddress  String?
  priceUsd     Float?
  volumeUsd24h Float?
  claimedAt    DateTime  @default(now())
  confirmedAt  DateTime?

  @@unique([cardId, kind, exchangeName, pair])
  @@index([cardId])
}

model CoinCardMember {
  id          String            @id @default(cuid())
  cardId      String
  card        CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  userId      String
  user        User              @relation("CoinCardMemberUser", fields: [userId], references: [id], onDelete: Cascade)
  role        CoinCardRole      @default(VIEWER)
  sections    CoinCardSection[] @default([])
  isSigner    Boolean           @default(false)
  invitedById String?
  createdAt   DateTime          @default(now())

  approvals CoinCardApproval[]

  @@unique([cardId, userId])
  @@index([userId])
}

model CoinCardInvite {
  id           String            @id @default(cuid())
  cardId       String
  card         CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  role         CoinCardRole      @default(VIEWER)
  sections     CoinCardSection[] @default([])
  isSigner     Boolean           @default(false)
  token        String            @unique
  createdById  String
  createdBy    User              @relation("CoinCardInviteCreator", fields: [createdById], references: [id], onDelete: Cascade)
  expiresAt    DateTime
  acceptedById String?
  acceptedBy   User?             @relation("CoinCardInviteAcceptor", fields: [acceptedById], references: [id], onDelete: SetNull)
  acceptedAt   DateTime?
  revokedAt    DateTime?
  createdAt    DateTime          @default(now())

  @@index([cardId, createdAt])
}

model CoinCardPolicy {
  cardId    String            @id
  card      CoinCard          @relation(fields: [cardId], references: [id], onDelete: Cascade)
  multisig  Boolean           @default(false)
  threshold Int               @default(1)
  sections  CoinCardSection[] @default([])
  updatedAt DateTime          @updatedAt
}

model CoinCardRevision {
  id            String                 @id @default(cuid())
  cardId        String
  card          CoinCard               @relation(fields: [cardId], references: [id], onDelete: Cascade)
  kind          CoinCardRevisionKind   @default(CONTENT)
  section       CoinCardSection?
  authorId      String
  author        User                   @relation("CoinCardRevisionAuthor", fields: [authorId], references: [id], onDelete: Cascade)
  status        CoinCardRevisionStatus @default(DRAFT)
  highRisk      Boolean                @default(false)
  diff          Json
  thresholdAt   Int?
  signerCountAt Int?
  expiresAt     DateTime?
  adminId       String?
  adminNote     String?
  decidedAt     DateTime?
  appliedAt     DateTime?
  createdAt     DateTime               @default(now())

  approvals CoinCardApproval[]

  @@index([cardId, createdAt])
  @@index([status, createdAt])
}

model CoinCardApproval {
  id         String           @id @default(cuid())
  revisionId String
  revision   CoinCardRevision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  memberId   String
  member     CoinCardMember   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  decision   CoinCardVote
  comment    String?
  createdAt  DateTime         @default(now())

  @@unique([revisionId, memberId])
  @@index([revisionId])
}
```

- [ ] **Step 3: Добавить обратные связи**

В `model User` добавить строки:

```prisma
  coinCardsStewarded  CoinCard[]         @relation("CoinCardSteward")
  coinCardMemberships CoinCardMember[]   @relation("CoinCardMemberUser")
  coinCardInvitesMade CoinCardInvite[]   @relation("CoinCardInviteCreator")
  coinCardInvitesGot  CoinCardInvite[]   @relation("CoinCardInviteAcceptor")
  coinCardRevisions   CoinCardRevision[] @relation("CoinCardRevisionAuthor")
```

В `model Coin` добавить:

```prisma
  card CoinCard? @relation("CoinCardCoin")
```

В `model Company` добавить:

```prisma
  coinCards CoinCard[]
```

В `enum AdminAction` добавить значения:

```prisma
  APPROVE_COIN_CARD
  REJECT_COIN_CARD
  APPLY_COIN_REVISION
  REJECT_COIN_REVISION
  FORCE_COIN_REVISION
  DISABLE_COIN_MULTISIG
  TRANSFER_COIN_CARD
```

- [ ] **Step 4: Сгенерировать миграцию**

Run: `npx prisma migrate dev --name coin_card --create-only`

Переименовать созданную папку в `prisma/migrations/20261106190000_coin_card`, если префикс даты другой — порядок миграций должен идти после `20261106080000_osm_crypto_poi`.

Проверить глазами, что в SQL **нет** `DROP`, `ALTER COLUMN ... SET NOT NULL` и переименований существующих таблиц. Миграция должна быть только `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` / `ALTER TYPE ... ADD VALUE`.

Run: `grep -iE "^\s*(drop|alter column|rename)" prisma/migrations/20261106190000_coin_card/migration.sql`
Expected: пустой вывод.

- [ ] **Step 5: Применить и сгенерировать клиент**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration applied` и `Generated Prisma Client`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261106190000_coin_card
git commit -m "feat(coin-card): модель карточки монеты, команды и ревизий"
```

---

### Task 2: `coin-card-slug.ts` — генерация slug

**Files:**
- Create: `src/lib/coin-card-slug.ts`
- Test: `tests/coin-card-slug.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-slug.test.ts
import { describe, expect, it } from "vitest";
import { slugifyCoinName, buildSlugCandidates } from "@/lib/coin-card-slug";

describe("slugifyCoinName", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyCoinName("Foobar Chain")).toBe("foobar-chain");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyCoinName("  My!!  Great__Coin.. ")).toBe("my-great-coin");
  });

  it("transliterates cyrillic", () => {
    expect(slugifyCoinName("Монета Жук")).toBe("moneta-zhuk");
  });

  it("falls back to 'coin' when nothing survives", () => {
    expect(slugifyCoinName("!!!")).toBe("coin");
  });

  it("caps length at 60 chars without trailing hyphen", () => {
    const s = slugifyCoinName("a".repeat(100));
    expect(s.length).toBe(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("buildSlugCandidates", () => {
  it("puts the plain slug first, then symbol-suffixed, then numbered", () => {
    expect(buildSlugCandidates("Foobar Chain", "FOO")).toEqual([
      "foobar-chain",
      "foobar-chain-foo",
      "foobar-chain-2",
      "foobar-chain-3",
      "foobar-chain-4",
    ]);
  });

  it("does not duplicate the symbol suffix when name already ends with it", () => {
    const c = buildSlugCandidates("Foo", "FOO");
    expect(c[0]).toBe("foo");
    expect(c).not.toContain("foo-foo");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-slug.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/coin-card-slug"`.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-slug.ts

const MAX_SLUG = 60;

const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** URL-safe slug from a free-form coin name. Never empty. */
export function slugifyCoinName(input: string): string {
  const lowered = (input ?? "").toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (ch in CYR) out += CYR[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += "-";
  }
  out = out.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!out) return "coin";
  if (out.length > MAX_SLUG) out = out.slice(0, MAX_SLUG).replace(/-+$/g, "");
  return out || "coin";
}

/**
 * Slug candidates in preference order. The caller tries them against the
 * unique index and takes the first that is free.
 */
export function buildSlugCandidates(name: string, symbol: string): string[] {
  const base = slugifyCoinName(name);
  const sym = slugifyCoinName(symbol);
  const out = [base];
  const withSym = `${base}-${sym}`;
  if (sym && withSym !== base && !base.endsWith(`-${sym}`) && base !== sym) {
    out.push(withSym);
  }
  for (let n = 2; out.length < 5; n += 1) out.push(`${base}-${n}`);
  return out;
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-slug.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-slug.ts tests/coin-card-slug.test.ts
git commit -m "feat(coin-card): генерация slug карточки"
```

---

### Task 3: `coin-card-risk.ts` — классификация риска полей

Это единственный источник истины о том, какие поля требуют модератора. От него зависит и A1 (можно ли вообще опубликовать правку), и A2 (куда уходит ревизия).

**Files:**
- Create: `src/lib/coin-card-risk.ts`
- Test: `tests/coin-card-risk.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-risk.test.ts
import { describe, expect, it } from "vitest";
import { isHighRiskPath, isHighRiskSection, HIGH_RISK_SECTIONS } from "@/lib/coin-card-risk";

describe("isHighRiskSection", () => {
  it("marks contracts, tokenomics, markets and security as high risk", () => {
    expect(isHighRiskSection("CONTRACTS")).toBe(true);
    expect(isHighRiskSection("TOKENOMICS")).toBe(true);
    expect(isHighRiskSection("MARKETS")).toBe(true);
    expect(isHighRiskSection("SECURITY")).toBe(true);
  });

  it("marks presentational sections as low risk", () => {
    expect(isHighRiskSection("MARKETING")).toBe(false);
    expect(isHighRiskSection("LINKS")).toBe(false);
    expect(isHighRiskSection("TEAM")).toBe(false);
    expect(isHighRiskSection("ACCEPTANCE")).toBe(false);
  });

  it("treats IDENTITY as low risk at section level", () => {
    expect(isHighRiskSection("IDENTITY")).toBe(false);
  });

  it("exposes the high-risk set for UI badges", () => {
    expect(HIGH_RISK_SECTIONS).toContain("CONTRACTS");
    expect(HIGH_RISK_SECTIONS).not.toContain("MARKETING");
  });
});

describe("isHighRiskPath", () => {
  it("escalates symbol and slug inside IDENTITY", () => {
    expect(isHighRiskPath("symbol")).toBe(true);
    expect(isHighRiskPath("slug")).toBe(true);
  });

  it("keeps the rest of IDENTITY low risk", () => {
    expect(isHighRiskPath("name")).toBe(false);
    expect(isHighRiskPath("tagline")).toBe(false);
    expect(isHighRiskPath("description")).toBe(false);
    expect(isHighRiskPath("logoUrl")).toBe(false);
  });

  it("marks every path under a high-risk section", () => {
    expect(isHighRiskPath("tokenomics.circulating")).toBe(true);
    expect(isHighRiskPath("contracts.0.address")).toBe(true);
    expect(isHighRiskPath("security.audits.1.reportUrl")).toBe(true);
    expect(isHighRiskPath("markets.3.pair")).toBe(true);
  });

  it("marks paths under low-risk sections as low risk", () => {
    expect(isHighRiskPath("marketing.roadmap.0.title")).toBe(false);
    expect(isHighRiskPath("links.website")).toBe(false);
  });

  it("fails closed on unknown paths", () => {
    expect(isHighRiskPath("whoKnows.someField")).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-risk.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-risk.ts

export type CardSection =
  | "IDENTITY" | "CONTRACTS" | "TOKENOMICS" | "MARKETS"
  | "SECURITY" | "TEAM" | "LINKS" | "MARKETING" | "ACCEPTANCE";

/** Sections where a bad edit can defraud users (wrong contract, fake supply). */
export const HIGH_RISK_SECTIONS: readonly CardSection[] = [
  "CONTRACTS", "TOKENOMICS", "MARKETS", "SECURITY",
];

/** Low-risk sections still moderated while the card is UNVERIFIED. */
export const LOW_RISK_SECTIONS: readonly CardSection[] = [
  "IDENTITY", "TEAM", "LINKS", "MARKETING", "ACCEPTANCE",
];

/** Root field paths that belong to IDENTITY but carry identity-theft risk. */
const HIGH_RISK_IDENTITY_PATHS = new Set(["symbol", "slug", "coinId"]);

/** Root field paths of IDENTITY that are safe to publish without review. */
const LOW_RISK_IDENTITY_PATHS = new Set([
  "name", "tagline", "description", "logoUrl",
  "launchDate", "tags", "consensus", "hashAlgo",
]);

const SECTION_BY_ROOT: Record<string, CardSection> = {
  contracts: "CONTRACTS",
  tokenomics: "TOKENOMICS",
  markets: "MARKETS",
  security: "SECURITY",
  teamInfo: "TEAM",
  links: "LINKS",
  marketing: "MARKETING",
  acceptance: "ACCEPTANCE",
};

export function isHighRiskSection(section: CardSection): boolean {
  return HIGH_RISK_SECTIONS.includes(section);
}

/**
 * Risk of a single dotted field path ("tokenomics.circulating",
 * "contracts.0.address"). Unknown paths return true: a field nobody
 * classified must not slip past the moderator.
 */
export function isHighRiskPath(path: string): boolean {
  const root = (path ?? "").split(".")[0];
  if (HIGH_RISK_IDENTITY_PATHS.has(root)) return true;
  if (LOW_RISK_IDENTITY_PATHS.has(root)) return false;
  const section = SECTION_BY_ROOT[root];
  if (!section) return true;
  return isHighRiskSection(section);
}

/** True when any path in the diff needs a moderator. */
export function diffNeedsModerator(paths: readonly string[]): boolean {
  return paths.some(isHighRiskPath);
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-risk.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-risk.ts tests/coin-card-risk.test.ts
git commit -m "feat(coin-card): классификация риска полей карточки"
```

---

### Task 4: `coin-card-validate.ts` — валидация ввода

**Files:**
- Create: `src/lib/coin-card-validate.ts`
- Test: `tests/coin-card-validate.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-validate.test.ts
import { describe, expect, it } from "vitest";
import {
  validateCardBasics,
  validateContract,
  validateTokenomics,
  normalizeHttpUrl,
} from "@/lib/coin-card-validate";

describe("validateCardBasics", () => {
  it("accepts a minimal valid card and normalizes fields", () => {
    const r = validateCardBasics({
      name: "  Foobar Chain  ",
      symbol: " foo ",
      tagline: " Fast L1 ",
      description: "A chain for testing purposes.",
      website: "foobar.org",
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.data.name).toBe("Foobar Chain");
      expect(r.data.symbol).toBe("FOO");
      expect(r.data.tagline).toBe("Fast L1");
      expect(r.data.website).toBe("https://foobar.org");
    }
  });

  it("requires a name", () => {
    expect(validateCardBasics({ name: " ", symbol: "FOO", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "name_required" });
  });

  it("requires a symbol", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_required" });
  });

  it("rejects an over-long symbol", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "ABCDEFGHIJKLM", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_too_long" });
  });

  it("rejects a symbol with punctuation", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FO O", website: "https://a.io" }))
      .toEqual({ ok: false, reason: "symbol_invalid" });
  });

  it("rejects an over-long tagline", () => {
    expect(validateCardBasics({
      name: "Foo", symbol: "FOO", website: "https://a.io", tagline: "x".repeat(121),
    })).toEqual({ ok: false, reason: "tagline_too_long" });
  });

  it("requires a website", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FOO", website: " " }))
      .toEqual({ ok: false, reason: "website_required" });
  });

  it("rejects a javascript: website", () => {
    expect(validateCardBasics({ name: "Foo", symbol: "FOO", website: "javascript:alert(1)" }))
      .toEqual({ ok: false, reason: "url_invalid" });
  });
});

describe("normalizeHttpUrl", () => {
  it("adds https:// to a bare host", () => {
    expect(normalizeHttpUrl("example.com")).toBe("https://example.com");
  });

  it("keeps an explicit http url", () => {
    expect(normalizeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("returns null for empty input", () => {
    expect(normalizeHttpUrl("  ")).toBeNull();
  });

  it("returns 'invalid' for non-http schemes", () => {
    expect(normalizeHttpUrl("javascript:alert(1)")).toBe("invalid");
    expect(normalizeHttpUrl("data:text/html,x")).toBe("invalid");
  });
});

describe("validateContract", () => {
  it("accepts a checksummed EVM address", () => {
    const r = validateContract({
      chain: "ethereum",
      address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
    });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.data.address).toBe("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599");
  });

  it("rejects a malformed EVM address", () => {
    expect(validateContract({ chain: "ethereum", address: "0xdeadbeef" }))
      .toEqual({ ok: false, reason: "contract_invalid" });
  });

  it("accepts a base58 Solana mint", () => {
    expect(validateContract({
      chain: "solana",
      address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    })).toMatchObject({ ok: true });
  });

  it("rejects an unknown chain", () => {
    expect(validateContract({ chain: "atlantis", address: "0x0" }))
      .toEqual({ ok: false, reason: "chain_unknown" });
  });

  it("rejects negative or absurd decimals", () => {
    expect(validateContract({ chain: "ethereum", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: -1 }))
      .toEqual({ ok: false, reason: "decimals_invalid" });
    expect(validateContract({ chain: "ethereum", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 100 }))
      .toEqual({ ok: false, reason: "decimals_invalid" });
  });
});

describe("validateTokenomics", () => {
  it("accepts a consistent supply triple", () => {
    expect(validateTokenomics({ circulating: 1000, total: 2000, max: 3000 }))
      .toMatchObject({ ok: true });
  });

  it("accepts partially filled supply", () => {
    expect(validateTokenomics({ circulating: 1000 })).toMatchObject({ ok: true });
    expect(validateTokenomics({})).toMatchObject({ ok: true });
  });

  it("rejects circulating greater than total", () => {
    expect(validateTokenomics({ circulating: 3000, total: 2000 }))
      .toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("rejects total greater than max", () => {
    expect(validateTokenomics({ total: 4000, max: 3000 }))
      .toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("rejects negative supply", () => {
    expect(validateTokenomics({ circulating: -1 }))
      .toEqual({ ok: false, reason: "supply_negative" });
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-validate.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-validate.ts

export type Fail<R extends string> = { ok: false; reason: R };
export type Ok<T> = { ok: true; data: T };

export const SUPPORTED_CHAINS = [
  "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche",
  "solana", "tron", "ton", "bitcoin", "cardano", "cosmos", "near", "sui", "aptos",
] as const;
export type Chain = (typeof SUPPORTED_CHAINS)[number];

const EVM_CHAINS = new Set<string>([
  "ethereum", "bsc", "polygon", "arbitrum", "optimism", "base", "avalanche",
]);
const BASE58_CHAINS = new Set<string>(["solana", "tron"]);

/**
 * Accepts bare hosts ("example.com") and http(s) URLs; rejects every other
 * scheme. Returns null for blank input, "invalid" for unusable input.
 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null | "invalid" {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return "invalid";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "invalid";
  if (!u.hostname.includes(".")) return "invalid";
  return u.toString().replace(/\/$/, "");
}

export type BasicsInput = {
  name?: string | null;
  symbol?: string | null;
  tagline?: string | null;
  description?: string | null;
  website?: string | null;
};
export type BasicsData = {
  name: string;
  symbol: string;
  tagline: string | null;
  description: string | null;
  website: string;
};
export type BasicsReason =
  | "name_required" | "name_too_long"
  | "symbol_required" | "symbol_too_long" | "symbol_invalid"
  | "tagline_too_long" | "description_too_long"
  | "website_required" | "url_invalid";

export function validateCardBasics(
  input: BasicsInput,
): Ok<BasicsData> | Fail<BasicsReason> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, reason: "name_required" };
  if (name.length > 100) return { ok: false, reason: "name_too_long" };

  const symbolRaw = (input.symbol ?? "").trim();
  if (!symbolRaw) return { ok: false, reason: "symbol_required" };
  const symbol = symbolRaw.toUpperCase();
  if (symbol.length > 12) return { ok: false, reason: "symbol_too_long" };
  if (!/^[A-Z0-9]+$/.test(symbol)) return { ok: false, reason: "symbol_invalid" };

  const tagline = (input.tagline ?? "").trim() || null;
  if (tagline && tagline.length > 120) return { ok: false, reason: "tagline_too_long" };

  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 20000) {
    return { ok: false, reason: "description_too_long" };
  }

  const websiteRaw = (input.website ?? "").trim();
  if (!websiteRaw) return { ok: false, reason: "website_required" };
  const website = normalizeHttpUrl(websiteRaw);
  if (website === "invalid" || website === null) {
    return { ok: false, reason: "url_invalid" };
  }

  return { ok: true, data: { name, symbol, tagline, description, website } };
}

export type ContractInput = {
  chain?: string | null;
  address?: string | null;
  decimals?: number | null;
  standard?: string | null;
  explorerUrl?: string | null;
};
export type ContractData = {
  chain: Chain;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
};
export type ContractReason =
  | "chain_unknown" | "contract_required" | "contract_invalid"
  | "decimals_invalid" | "url_invalid";

export function validateContract(
  input: ContractInput,
): Ok<ContractData> | Fail<ContractReason> {
  const chain = (input.chain ?? "").trim().toLowerCase();
  if (!(SUPPORTED_CHAINS as readonly string[]).includes(chain)) {
    return { ok: false, reason: "chain_unknown" };
  }

  const raw = (input.address ?? "").trim();
  if (!raw) return { ok: false, reason: "contract_required" };

  let address = raw;
  if (EVM_CHAINS.has(chain)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return { ok: false, reason: "contract_invalid" };
    address = raw.toLowerCase();
  } else if (BASE58_CHAINS.has(chain)) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) {
      return { ok: false, reason: "contract_invalid" };
    }
  } else if (raw.length < 4 || raw.length > 128) {
    return { ok: false, reason: "contract_invalid" };
  }

  const decimals = input.decimals ?? null;
  if (decimals !== null) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      return { ok: false, reason: "decimals_invalid" };
    }
  }

  const explorerUrl = normalizeHttpUrl(input.explorerUrl);
  if (explorerUrl === "invalid") return { ok: false, reason: "url_invalid" };

  return {
    ok: true,
    data: {
      chain: chain as Chain,
      address,
      decimals,
      standard: (input.standard ?? "").trim() || null,
      explorerUrl,
    },
  };
}

export type TokenomicsInput = {
  circulating?: number | null;
  total?: number | null;
  max?: number | null;
};
export type TokenomicsReason = "supply_negative" | "supply_inconsistent";

export function validateTokenomics(
  input: TokenomicsInput,
): Ok<TokenomicsInput> | Fail<TokenomicsReason> {
  const vals = [input.circulating, input.total, input.max];
  if (vals.some((v) => v != null && (!Number.isFinite(v) || v < 0))) {
    return { ok: false, reason: "supply_negative" };
  }
  const { circulating: c, total: t, max: m } = input;
  if (c != null && t != null && c > t) return { ok: false, reason: "supply_inconsistent" };
  if (t != null && m != null && t > m) return { ok: false, reason: "supply_inconsistent" };
  if (c != null && m != null && c > m) return { ok: false, reason: "supply_inconsistent" };
  return { ok: true, data: input };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-validate.test.ts`
Expected: PASS, 22 теста.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-validate.ts tests/coin-card-validate.test.ts
git commit -m "feat(coin-card): валидация полей карточки"
```

---

### Task 5: `coin-card-completeness.ts` — прогресс заполнения

**Files:**
- Create: `src/lib/coin-card-completeness.ts`
- Test: `tests/coin-card-completeness.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-completeness.test.ts
import { describe, expect, it } from "vitest";
import { computeCompleteness, missingFields } from "@/lib/coin-card-completeness";

const EMPTY = { name: "", symbol: "" };

const FULL = {
  name: "Foobar Chain",
  symbol: "FOO",
  tagline: "Fast L1",
  description: "x".repeat(300),
  logoUrl: "/uploads/coin-cards/a/b.png",
  launchDate: new Date("2024-01-01"),
  tags: ["l1"],
  links: { website: "https://foobar.org", docs: "https://d.foobar.org", whitepaper: "https://foobar.org/wp.pdf", github: "https://github.com/foobar", x: "https://x.com/foobar", telegram: "https://t.me/foobar" },
  tokenomics: { circulating: 1, total: 2, max: 3, excludedAddresses: ["0x1"], emission: "fixed" },
  security: { audits: [{ firm: "Zellic", reportUrl: "https://z.io/r" }], riskFlags: { mintable: false }, teamDoxxed: true, legalEntity: "Foobar Labs OÜ" },
  teamInfo: { members: [{ name: "A", role: "CEO" }], investors: ["X Capital"] },
  marketing: { pitch: "y".repeat(200), roadmap: [{ title: "Mainnet", date: "2024-06" }], mediaKit: "https://foobar.org/kit" },
  contracts: [{ chain: "ethereum", address: "0x" + "1".repeat(40), decimals: 18 }],
  markets: [{ kind: "CEX", exchangeName: "Binance", pair: "FOO/USDT" }],
};

describe("computeCompleteness", () => {
  it("is 0 for an empty card", () => {
    expect(computeCompleteness(EMPTY)).toBe(0);
  });

  it("is 100 for a fully filled card", () => {
    expect(computeCompleteness(FULL)).toBe(100);
  });

  it("never leaves the 0..100 range", () => {
    const v = computeCompleteness({ ...FULL, tags: [], markets: [] });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(100);
  });

  it("is monotonic: adding a field never lowers the score", () => {
    const before = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const after = computeCompleteness({ name: "Foo", symbol: "FOO", tagline: "Fast" });
    expect(after).toBeGreaterThan(before);
  });

  it("ignores blank strings and empty arrays", () => {
    const a = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const b = computeCompleteness({ name: "Foo", symbol: "FOO", tagline: "   ", tags: [] });
    expect(b).toBe(a);
  });

  it("does not credit a too-short description", () => {
    const a = computeCompleteness({ name: "Foo", symbol: "FOO" });
    const b = computeCompleteness({ name: "Foo", symbol: "FOO", description: "short" });
    expect(b).toBe(a);
  });
});

describe("missingFields", () => {
  it("lists what is still missing, for the UI hint", () => {
    const miss = missingFields({ name: "Foo", symbol: "FOO" });
    expect(miss).toContain("logoUrl");
    expect(miss).toContain("contracts");
    expect(miss).not.toContain("name");
  });

  it("is empty for a full card", () => {
    expect(missingFields(FULL)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-completeness.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-completeness.ts

export type CompletenessInput = {
  name?: string | null;
  symbol?: string | null;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  launchDate?: Date | string | null;
  tags?: string[] | null;
  links?: Record<string, unknown> | null;
  tokenomics?: Record<string, unknown> | null;
  security?: Record<string, unknown> | null;
  teamInfo?: Record<string, unknown> | null;
  marketing?: Record<string, unknown> | null;
  contracts?: unknown[] | null;
  markets?: unknown[] | null;
};

const MIN_DESCRIPTION = 120;
const MIN_PITCH = 80;

function filled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function sub(obj: Record<string, unknown> | null | undefined, key: string): unknown {
  return obj ? obj[key] : undefined;
}

/**
 * Weighted checklist. Weights sum to 100 exactly — assert this in the test
 * rather than trusting arithmetic by eye.
 */
const CHECKS: ReadonlyArray<{ key: string; weight: number; test: (c: CompletenessInput) => boolean }> = [
  { key: "name", weight: 4, test: (c) => filled(c.name) },
  { key: "symbol", weight: 4, test: (c) => filled(c.symbol) },
  { key: "tagline", weight: 4, test: (c) => filled(c.tagline) },
  { key: "description", weight: 8, test: (c) => (c.description ?? "").trim().length >= MIN_DESCRIPTION },
  { key: "logoUrl", weight: 8, test: (c) => filled(c.logoUrl) },
  { key: "launchDate", weight: 3, test: (c) => filled(c.launchDate) },
  { key: "tags", weight: 3, test: (c) => filled(c.tags) },
  { key: "links.website", weight: 6, test: (c) => filled(sub(c.links, "website")) },
  { key: "links.docs", weight: 3, test: (c) => filled(sub(c.links, "docs")) },
  { key: "links.whitepaper", weight: 4, test: (c) => filled(sub(c.links, "whitepaper")) },
  { key: "links.github", weight: 4, test: (c) => filled(sub(c.links, "github")) },
  { key: "links.social", weight: 4, test: (c) => filled(sub(c.links, "x")) || filled(sub(c.links, "telegram")) },
  { key: "contracts", weight: 10, test: (c) => filled(c.contracts) },
  { key: "tokenomics.supply", weight: 6, test: (c) => filled(sub(c.tokenomics, "circulating")) || filled(sub(c.tokenomics, "total")) },
  { key: "tokenomics.method", weight: 4, test: (c) => filled(sub(c.tokenomics, "excludedAddresses")) || filled(sub(c.tokenomics, "emission")) },
  { key: "markets", weight: 6, test: (c) => filled(c.markets) },
  { key: "security.audits", weight: 6, test: (c) => filled(sub(c.security, "audits")) },
  { key: "security.entity", weight: 3, test: (c) => filled(sub(c.security, "legalEntity")) },
  { key: "teamInfo.members", weight: 5, test: (c) => filled(sub(c.teamInfo, "members")) },
  { key: "marketing.pitch", weight: 3, test: (c) => (String(sub(c.marketing, "pitch") ?? "")).trim().length >= MIN_PITCH },
  { key: "marketing.roadmap", weight: 2, test: (c) => filled(sub(c.marketing, "roadmap")) },
];

export const COMPLETENESS_TOTAL_WEIGHT = CHECKS.reduce((s, c) => s + c.weight, 0);

/** 0..100 — drives the wizard progress bar. */
export function computeCompleteness(card: CompletenessInput): number {
  const got = CHECKS.reduce((s, c) => (c.test(card) ? s + c.weight : s), 0);
  return Math.max(0, Math.min(100, Math.round((got / COMPLETENESS_TOTAL_WEIGHT) * 100)));
}

/** Keys of unmet checks, for the "what's still missing" hint. */
export function missingFields(card: CompletenessInput): string[] {
  return CHECKS.filter((c) => !c.test(card)).map((c) => c.key);
}
```

- [ ] **Step 4: Добавить тест на сумму весов**

Дописать в `tests/coin-card-completeness.test.ts`:

```ts
import { COMPLETENESS_TOTAL_WEIGHT } from "@/lib/coin-card-completeness";

describe("weights", () => {
  it("sum to exactly 100 so the score needs no fudging", () => {
    expect(COMPLETENESS_TOTAL_WEIGHT).toBe(100);
  });
});
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-completeness.test.ts`
Expected: PASS, 9 тестов. Если `COMPLETENESS_TOTAL_WEIGHT !== 100` — поправить веса в `CHECKS`, а не тест.

- [ ] **Step 6: Commit**

```bash
git add src/lib/coin-card-completeness.ts tests/coin-card-completeness.test.ts
git commit -m "feat(coin-card): расчёт полноты заполнения карточки"
```

---

### Task 6: `coin-card-provenance.ts` — метки источника значений

**Files:**
- Create: `src/lib/coin-card-provenance.ts`
- Test: `tests/coin-card-provenance.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-provenance.test.ts
import { describe, expect, it } from "vitest";
import {
  getProvenance,
  markSelfReported,
  mergeProvenance,
  type ProvenanceMap,
} from "@/lib/coin-card-provenance";

const AT = new Date("2026-11-06T10:00:00.000Z");

describe("markSelfReported", () => {
  it("stamps every changed path as self-reported", () => {
    const m = markSelfReported({}, ["tokenomics.circulating", "links.website"], AT);
    expect(m["tokenomics.circulating"]).toEqual({
      kind: "SELF_REPORTED",
      source: null,
      at: AT.toISOString(),
    });
    expect(Object.keys(m)).toHaveLength(2);
  });

  it("does not touch paths it was not given", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = markSelfReported(base, ["links.website"], AT);
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });
});

describe("mergeProvenance", () => {
  it("lets a stronger source overwrite a weaker one", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "SELF_REPORTED", source: null, at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    });
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("does not let a weaker source downgrade a verified value", () => {
    const base: ProvenanceMap = {
      "tokenomics.total": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      "tokenomics.total": { kind: "SELF_REPORTED", source: null, at: AT.toISOString() },
    });
    expect(m["tokenomics.total"].kind).toBe("VERIFIED_ONCHAIN");
  });

  it("lets ADMIN_SET override anything", () => {
    const base: ProvenanceMap = {
      "symbol": { kind: "VERIFIED_ONCHAIN", source: "ethereum", at: AT.toISOString() },
    };
    const m = mergeProvenance(base, {
      "symbol": { kind: "ADMIN_SET", source: "moderator", at: AT.toISOString() },
    });
    expect(m["symbol"].kind).toBe("ADMIN_SET");
  });
});

describe("getProvenance", () => {
  it("defaults unknown paths to self-reported", () => {
    expect(getProvenance(null, "links.website").kind).toBe("SELF_REPORTED");
  });

  it("survives a malformed JSONB blob", () => {
    expect(getProvenance("not an object" as unknown as ProvenanceMap, "x").kind)
      .toBe("SELF_REPORTED");
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-provenance.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-provenance.ts

export type ProvenanceKind =
  | "SELF_REPORTED" | "VERIFIED_ONCHAIN" | "AGGREGATED" | "ADMIN_SET";

export type ProvenanceEntry = {
  kind: ProvenanceKind;
  /** Chain id, exchange count, moderator — whatever qualifies the kind. */
  source: string | null;
  /** ISO timestamp. */
  at: string;
};

export type ProvenanceMap = Record<string, ProvenanceEntry>;

/**
 * Trust ranking. A weaker source must never silently downgrade a stronger
 * one — that is how a verified number turns back into a claim.
 */
const RANK: Record<ProvenanceKind, number> = {
  SELF_REPORTED: 0,
  AGGREGATED: 1,
  VERIFIED_ONCHAIN: 2,
  ADMIN_SET: 3,
};

const DEFAULT_ENTRY: ProvenanceEntry = {
  kind: "SELF_REPORTED",
  source: null,
  at: new Date(0).toISOString(),
};

function asMap(raw: unknown): ProvenanceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProvenanceMap;
}

export function getProvenance(raw: unknown, path: string): ProvenanceEntry {
  const m = asMap(raw);
  const e = m[path];
  if (!e || typeof e !== "object" || !(e.kind in RANK)) return DEFAULT_ENTRY;
  return e;
}

export function markSelfReported(
  raw: unknown,
  paths: readonly string[],
  at: Date,
): ProvenanceMap {
  const next = { ...asMap(raw) };
  for (const p of paths) {
    next[p] = { kind: "SELF_REPORTED", source: null, at: at.toISOString() };
  }
  return next;
}

export function mergeProvenance(raw: unknown, incoming: ProvenanceMap): ProvenanceMap {
  const next = { ...asMap(raw) };
  for (const [path, entry] of Object.entries(incoming)) {
    const cur = next[path];
    if (!cur || RANK[entry.kind] >= RANK[cur.kind]) next[path] = entry;
  }
  return next;
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-provenance.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-provenance.ts tests/coin-card-provenance.test.ts
git commit -m "feat(coin-card): метки провенанса значений карточки"
```

---

### Task 7: `coin-card-access.ts` — кто может править карточку сейчас

В A1 правило простое: создатель (`stewardUserId`), пока карточка `PENDING`, плюс админ сайта всегда. Функция сразу принимает `member`, чтобы A2 расширил её ролями, не меняя вызовы.

**Files:**
- Create: `src/lib/coin-card-access.ts`
- Test: `tests/coin-card-access.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/coin-card-access.test.ts
import { describe, expect, it } from "vitest";
import { canEditSection, canEditCardNow } from "@/lib/coin-card-access";

const card = (over: Partial<{ status: string; stewardUserId: string | null }> = {}) => ({
  status: "PENDING" as const,
  stewardUserId: "u1",
  ...over,
});

describe("canEditSection", () => {
  it("lets OWNER edit anything", () => {
    expect(canEditSection({ role: "OWNER", sections: [] }, "CONTRACTS")).toBe(true);
  });

  it("lets ADMIN edit anything", () => {
    expect(canEditSection({ role: "ADMIN", sections: [] }, "TOKENOMICS")).toBe(true);
  });

  it("limits EDITOR to granted sections", () => {
    const m = { role: "EDITOR" as const, sections: ["MARKETS" as const] };
    expect(canEditSection(m, "MARKETS")).toBe(true);
    expect(canEditSection(m, "TOKENOMICS")).toBe(false);
  });

  it("denies VIEWER everything", () => {
    expect(canEditSection({ role: "VIEWER", sections: ["MARKETS"] }, "MARKETS")).toBe(false);
  });

  it("denies a null member", () => {
    expect(canEditSection(null, "IDENTITY")).toBe(false);
  });
});

describe("canEditCardNow", () => {
  it("lets the steward edit a pending card", () => {
    expect(canEditCardNow(card(), "u1", false)).toBe(true);
  });

  it("stops the steward once the card is approved (edits need A2 revisions)", () => {
    expect(canEditCardNow(card({ status: "APPROVED" }), "u1", false)).toBe(false);
  });

  it("stops a stranger", () => {
    expect(canEditCardNow(card(), "u2", false)).toBe(false);
  });

  it("stops an anonymous visitor", () => {
    expect(canEditCardNow(card(), null, false)).toBe(false);
  });

  it("lets a site admin edit regardless of status", () => {
    expect(canEditCardNow(card({ status: "APPROVED" }), "admin", true)).toBe(true);
  });

  it("allows editing a rejected card so the author can fix it", () => {
    expect(canEditCardNow(card({ status: "REJECTED" }), "u1", false)).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/coin-card-access.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/coin-card-access.ts
import type { CardSection } from "@/lib/coin-card-risk";

export type CardRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type MemberLike = {
  role: CardRole;
  sections: readonly CardSection[];
};

/**
 * Section-level write permission. OWNER/ADMIN are unrestricted; EDITOR is
 * limited to granted sections; VIEWER is read-only.
 */
export function canEditSection(
  member: MemberLike | null | undefined,
  section: CardSection,
): boolean {
  if (!member) return false;
  if (member.role === "OWNER" || member.role === "ADMIN") return true;
  if (member.role === "EDITOR") return member.sections.includes(section);
  return false;
}

export function canManageMembers(member: MemberLike | null | undefined): boolean {
  return member?.role === "OWNER" || member?.role === "ADMIN";
}

export function canManagePolicy(member: MemberLike | null | undefined): boolean {
  return member?.role === "OWNER";
}

export type CardLike = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  stewardUserId: string | null;
};

/**
 * Slice A1 gate: direct writes to the card itself. Only before approval —
 * once a card is public, edits must go through the A2 revision pipeline.
 * Site admins bypass this.
 */
export function canEditCardNow(
  card: CardLike,
  userId: string | null | undefined,
  isSiteAdmin: boolean,
): boolean {
  if (isSiteAdmin) return true;
  if (!userId) return false;
  if (card.stewardUserId !== userId) return false;
  return card.status === "PENDING" || card.status === "REJECTED";
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/coin-card-access.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-access.ts tests/coin-card-access.test.ts
git commit -m "feat(coin-card): гейты доступа к карточке"
```

---

### Task 8: `approve-coin-card.ts` — ядро модерации

Повторяет приём из `src/lib/admin/approve-request.ts`: ядро принимает `PrismaLike`, поэтому тестируется без базы.

**Files:**
- Create: `src/lib/admin/approve-coin-card.ts`
- Test: `tests/approve-coin-card.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/approve-coin-card.test.ts
import { describe, expect, it } from "vitest";
import { approveCoinCardCore, rejectCoinCardCore } from "@/lib/admin/approve-coin-card";

type Row = {
  id: string; slug: string; name: string; symbol: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  completeness: number; logoUrl: string | null;
};

function fakeDb(card: Row | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    prisma: {
      coinCard: {
        findUnique: async () => card,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { ...(card as Row), ...data } as Row;
        },
      },
    },
  };
}

const CARD: Row = {
  id: "c1", slug: "foobar-chain", name: "Foobar Chain", symbol: "FOO",
  status: "PENDING", completeness: 55, logoUrl: "/uploads/coin-cards/c1/a.png",
};

describe("approveCoinCardCore", () => {
  it("approves a pending card and records the reviewer", async () => {
    const { prisma, updates } = fakeDb(CARD);
    const r = await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" });
    expect(r).toEqual({ ok: true, slug: "foobar-chain" });
    expect(updates[0]).toMatchObject({ status: "APPROVED", reviewedById: "admin" });
    expect(updates[0].reviewedAt).toBeInstanceOf(Date);
  });

  it("refuses a missing card", async () => {
    const { prisma } = fakeDb(null);
    expect(await approveCoinCardCore(prisma, { cardId: "nope", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a card that is not pending", async () => {
    const { prisma } = fakeDb({ ...CARD, status: "APPROVED" });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "not_pending" });
  });

  it("refuses a card below the minimum completeness", async () => {
    const { prisma } = fakeDb({ ...CARD, completeness: 10 });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "too_incomplete" });
  });

  it("refuses a card with no logo", async () => {
    const { prisma } = fakeDb({ ...CARD, logoUrl: null });
    expect(await approveCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin" }))
      .toEqual({ ok: false, reason: "logo_required" });
  });
});

describe("rejectCoinCardCore", () => {
  it("rejects with a reason", async () => {
    const { prisma, updates } = fakeDb(CARD);
    const r = await rejectCoinCardCore(prisma, {
      cardId: "c1", reviewerId: "admin", reason: "Нет подтверждения контракта",
    });
    expect(r).toEqual({ ok: true });
    expect(updates[0]).toMatchObject({
      status: "REJECTED",
      rejectReason: "Нет подтверждения контракта",
      reviewedById: "admin",
    });
  });

  it("requires a reason of at least 3 chars", async () => {
    const { prisma } = fakeDb(CARD);
    expect(await rejectCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin", reason: "ок" }))
      .toEqual({ ok: false, reason: "reason_too_short" });
  });

  it("refuses a card that is not pending", async () => {
    const { prisma } = fakeDb({ ...CARD, status: "REJECTED" });
    expect(await rejectCoinCardCore(prisma, { cardId: "c1", reviewerId: "admin", reason: "spam" }))
      .toEqual({ ok: false, reason: "not_pending" });
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `npx vitest run tests/approve-coin-card.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Минимальная реализация**

```ts
// src/lib/admin/approve-coin-card.ts

/** Cards below this completeness are not worth showing publicly. */
export const MIN_COMPLETENESS_TO_PUBLISH = 35;
const MIN_REJECT_REASON = 3;

type CardRow = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  completeness: number;
  logoUrl: string | null;
};

type PrismaLike = {
  coinCard: {
    findUnique(args: { where: { id: string } }): Promise<CardRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<CardRow>;
  };
};

export type ApproveCardResult =
  | { ok: true; slug: string }
  | { ok: false; reason: "not_found" | "not_pending" | "too_incomplete" | "logo_required" };

export async function approveCoinCardCore(
  prisma: PrismaLike,
  input: { cardId: string; reviewerId: string },
): Promise<ApproveCardResult> {
  const card = await prisma.coinCard.findUnique({ where: { id: input.cardId } });
  if (!card) return { ok: false, reason: "not_found" };
  if (card.status !== "PENDING") return { ok: false, reason: "not_pending" };
  if (card.completeness < MIN_COMPLETENESS_TO_PUBLISH) {
    return { ok: false, reason: "too_incomplete" };
  }
  if (!card.logoUrl) return { ok: false, reason: "logo_required" };

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      status: "APPROVED",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      rejectReason: null,
    },
  });
  return { ok: true, slug: card.slug };
}

export type RejectCardResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "reason_too_short" };

export async function rejectCoinCardCore(
  prisma: PrismaLike,
  input: { cardId: string; reviewerId: string; reason: string },
): Promise<RejectCardResult> {
  const reason = (input.reason ?? "").trim();
  if (reason.length < MIN_REJECT_REASON) {
    return { ok: false, reason: "reason_too_short" };
  }
  const card = await prisma.coinCard.findUnique({ where: { id: input.cardId } });
  if (!card) return { ok: false, reason: "not_found" };
  if (card.status !== "PENDING") return { ok: false, reason: "not_pending" };

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      status: "REJECTED",
      rejectReason: reason,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });
  return { ok: true };
}
```

- [ ] **Step 4: Запустить тест, убедиться что проходит**

Run: `npx vitest run tests/approve-coin-card.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/approve-coin-card.ts tests/approve-coin-card.test.ts
git commit -m "feat(coin-card): ядро модерации карточек"
```

---

### Task 9: Серверные действия подачи и сохранения

**Files:**
- Create: `src/app/actions/coin-card.ts`
- Read first: `src/app/actions/coin-request.ts` (образец стиля), `node_modules/next/dist/docs/01-app/02-guides/forms.md`

- [ ] **Step 1: Прочитать документацию и образец**

Run: `sed -n '1,120p' node_modules/next/dist/docs/01-app/02-guides/forms.md && cat src/app/actions/coin-request.ts`

Убедиться, что в этой версии Next серверные действия объявляются директивой `"use server"` в начале файла и возвращают обычный объект (никаких `useFormState`-специфик не требуется).

- [ ] **Step 2: Написать действие создания карточки**

```ts
// src/app/actions/coin-card.ts
"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { validateCardBasics } from "@/lib/coin-card-validate";
import { buildSlugCandidates } from "@/lib/coin-card-slug";
import { computeCompleteness, missingFields } from "@/lib/coin-card-completeness";
import { markSelfReported } from "@/lib/coin-card-provenance";

const MAX_PENDING_PER_USER = 3;

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? Record<string, never> : T))
  | { ok: false; reason: string };

/**
 * Step 1 of the wizard. Creates the card in PENDING with the minimum viable
 * field set; the remaining steps call saveCoinCardSection().
 */
export async function createCoinCard(input: {
  name: string;
  symbol: string;
  tagline?: string;
  description?: string;
  website: string;
}): Promise<{ ok: true; cardId: string; slug: string } | { ok: false; reason: string }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const v = validateCardBasics(input);
  if (!v.ok) return { ok: false, reason: v.reason };

  const pending = await prisma.coinCard.count({
    where: { stewardUserId: userId, status: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_USER) return { ok: false, reason: "too_many_pending" };

  const now = new Date();
  const links = { website: v.data.website };
  const completeness = computeCompleteness({ ...v.data, links });
  const provenance = markSelfReported(
    {},
    ["name", "symbol", "tagline", "description", "links.website"],
    now,
  );

  // Try slug candidates in order; P2002 on `slug` means someone took it first.
  for (const slug of buildSlugCandidates(v.data.name, v.data.symbol)) {
    try {
      const card = await prisma.coinCard.create({
        data: {
          slug,
          stewardUserId: userId,
          name: v.data.name,
          symbol: v.data.symbol,
          tagline: v.data.tagline,
          description: v.data.description,
          links,
          provenance,
          completeness,
          members: { create: { userId, role: "OWNER", isSigner: true } },
        },
        select: { id: true, slug: true },
      });
      revalidatePath("/", "layout");
      return { ok: true, cardId: card.id, slug: card.slug };
    } catch (e) {
      const taken =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002" &&
        String(e.meta?.target ?? "").includes("slug");
      if (!taken) throw e;
    }
  }
  return { ok: false, reason: "slug_taken" };
}
```

- [ ] **Step 3: Написать действие сохранения секции**

Дописать в тот же файл:

```ts
// Дописывается в тот же файл — `validateCardBasics`, `computeCompleteness`,
// `missingFields`, `markSelfReported`, `auth`, `prisma` уже импортированы выше.
// Добавить к существующим импортам:
import { canEditCardNow } from "@/lib/coin-card-access";
import { validateContract, validateTokenomics, normalizeHttpUrl } from "@/lib/coin-card-validate";
import type { CardSection } from "@/lib/coin-card-risk";

const MAX_CONTRACTS = 20;
const MAX_MARKETS = 200;

/**
 * Wizard steps 2-4. Writes directly to the card — allowed only while the card
 * is PENDING/REJECTED (see canEditCardNow). Post-approval edits land in slice A2.
 */
export async function saveCoinCardSection(input: {
  cardId: string;
  section: CardSection;
  payload: Record<string, unknown>;
}): Promise<
  { ok: true; completeness: number; missing: string[] } | { ok: false; reason: string }
> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const userId = user?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const card = await prisma.coinCard.findUnique({
    where: { id: input.cardId },
    select: {
      id: true, status: true, stewardUserId: true, name: true, symbol: true,
      tagline: true, description: true, logoUrl: true, launchDate: true, tags: true,
      links: true, tokenomics: true, security: true, teamInfo: true, marketing: true,
      provenance: true,
      contracts: { select: { id: true } },
      markets: { select: { id: true } },
    },
  });
  if (!card) return { ok: false, reason: "not_found" };
  if (!canEditCardNow(card, userId, user?.role === "ADMIN")) {
    return { ok: false, reason: "forbidden" };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};
  const touched: string[] = [];

  if (input.section === "CONTRACTS") {
    const raw = Array.isArray(input.payload.contracts) ? input.payload.contracts : [];
    if (raw.length > MAX_CONTRACTS) return { ok: false, reason: "too_many_contracts" };
    const rows = [];
    for (const c of raw) {
      const v = validateContract(c as Record<string, string>);
      if (!v.ok) return { ok: false, reason: v.reason };
      rows.push(v.data);
    }
    await prisma.$transaction([
      prisma.coinCardContract.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardContract.createMany({
        data: rows.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
    touched.push("contracts");
  } else if (input.section === "TOKENOMICS") {
    const t = (input.payload.tokenomics ?? {}) as Record<string, number | null>;
    const v = validateTokenomics(t);
    if (!v.ok) return { ok: false, reason: v.reason };
    data.tokenomics = t;
    touched.push("tokenomics.circulating", "tokenomics.total", "tokenomics.max");
  } else if (input.section === "MARKETS") {
    const raw = Array.isArray(input.payload.markets) ? input.payload.markets : [];
    if (raw.length > MAX_MARKETS) return { ok: false, reason: "too_many_markets" };
    const rows = [];
    for (const m of raw as Array<Record<string, string>>) {
      const kind = m.kind === "DEX" ? "DEX" : "CEX";
      const exchangeName = (m.exchangeName ?? "").trim();
      const pair = (m.pair ?? "").trim().toUpperCase();
      if (!exchangeName || !pair) return { ok: false, reason: "market_incomplete" };
      const tradeUrl = normalizeHttpUrl(m.tradeUrl);
      if (tradeUrl === "invalid") return { ok: false, reason: "url_invalid" };
      rows.push({
        cardId: card.id, kind, exchangeName, pair, tradeUrl,
        chain: (m.chain ?? "").trim() || null,
        poolAddress: (m.poolAddress ?? "").trim() || null,
      });
    }
    await prisma.$transaction([
      prisma.coinCardMarket.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardMarket.createMany({ data: rows, skipDuplicates: true }),
    ]);
    touched.push("markets");
  } else if (input.section === "LINKS") {
    const incoming = (input.payload.links ?? {}) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(incoming)) {
      const u = normalizeHttpUrl(val);
      if (u === "invalid") return { ok: false, reason: "url_invalid" };
      if (u) out[k] = u;
      touched.push(`links.${k}`);
    }
    if (!out.website) return { ok: false, reason: "website_required" };
    data.links = out;
  } else if (input.section === "SECURITY") {
    data.security = input.payload.security ?? {};
    touched.push("security");
  } else if (input.section === "TEAM") {
    data.teamInfo = input.payload.teamInfo ?? {};
    touched.push("teamInfo");
  } else if (input.section === "MARKETING") {
    data.marketing = input.payload.marketing ?? {};
    touched.push("marketing");
  } else if (input.section === "IDENTITY") {
    const v = validateCardBasics({
      name: (input.payload.name as string) ?? card.name,
      symbol: (input.payload.symbol as string) ?? card.symbol,
      tagline: (input.payload.tagline as string) ?? card.tagline,
      description: (input.payload.description as string) ?? card.description,
      website: ((card.links as Record<string, string> | null)?.website) ?? "",
    });
    if (!v.ok) return { ok: false, reason: v.reason };
    data.name = v.data.name;
    data.symbol = v.data.symbol;
    data.tagline = v.data.tagline;
    data.description = v.data.description;
    if (typeof input.payload.logoUrl === "string") data.logoUrl = input.payload.logoUrl;
    if (Array.isArray(input.payload.tags)) {
      data.tags = (input.payload.tags as string[]).map((s) => s.trim()).filter(Boolean).slice(0, 10);
    }
    if (typeof input.payload.launchDate === "string" && input.payload.launchDate) {
      const d = new Date(input.payload.launchDate);
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "date_invalid" };
      data.launchDate = d;
    }
    touched.push("name", "symbol", "tagline", "description", "logoUrl", "tags", "launchDate");
  } else {
    return { ok: false, reason: "section_unsupported" };
  }

  const merged = { ...card, ...data };
  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: card.id } }),
    prisma.coinCardMarket.count({ where: { cardId: card.id } }),
  ]);
  const forScore = {
    ...(merged as Record<string, unknown>),
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  };
  const completeness = computeCompleteness(forScore);
  const missing = missingFields(forScore);

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      ...data,
      completeness,
      provenance: markSelfReported(card.provenance, touched, now),
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, completeness, missing };
}
```

- [ ] **Step 4: Проверить типы и линт**

Run: `npx tsc --noEmit && npx eslint src/app/actions/coin-card.ts`
Expected: без ошибок. Если `Prisma.PrismaClientKnownRequestError` не импортируется — посмотреть, как это сделано в `src/app/actions/company.ts`, и повторить тот же импорт.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/coin-card.ts
git commit -m "feat(coin-card): серверные действия подачи и сохранения секций"
```

---

### Task 10: Загрузка логотипа

**Files:**
- Create: `src/app/api/coin-card/logo/upload/route.ts`
- Read first: `src/app/api/business/point/upload/route.ts`

- [ ] **Step 1: Прочитать образец**

Run: `cat src/app/api/business/point/upload/route.ts`

- [ ] **Step 2: Написать роут**

```ts
// src/app/api/coin-card/logo/upload/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditCardNow } from "@/lib/coin-card-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

const PUBLIC_ROOT =
  process.env.COIN_CARD_LOGO_ROOT ?? join(process.cwd(), "public", "uploads", "coin-cards");

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const userId = user?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const cardId = String(form.get("cardId") ?? "");
  if (!cardId) return NextResponse.json({ error: "card_required" }, { status: 400 });

  const card = await prisma.coinCard.findUnique({
    where: { id: cardId },
    select: { id: true, status: true, stewardUserId: true },
  });
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canEditCardNow(card, userId, user?.role === "ADMIN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const id = randomBytes(12).toString("hex");
  const dir = join(PUBLIC_ROOT, card.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${ext}`), Buffer.from(await file.arrayBuffer()));

  const url = `/uploads/coin-cards/${card.id}/${id}.${ext}`;
  await prisma.coinCard.update({ where: { id: card.id }, data: { logoUrl: url } });
  return NextResponse.json({ ok: true, url });
}
```

- [ ] **Step 3: Запретить индексацию каталога загрузок**

Проверить, что `public/uploads` уже закрыт в `.gitignore`:

Run: `grep -n "uploads" .gitignore`
Expected: строка с `public/uploads` присутствует. Если нет — дописать `public/uploads/` в `.gitignore`.

- [ ] **Step 4: Проверить типы**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/coin-card/logo/upload/route.ts .gitignore
git commit -m "feat(coin-card): загрузка логотипа карточки"
```

---

### Task 11: Визард подачи

**Files:**
- Create: `src/components/coin-card-wizard/wizard.tsx`
- Create: `src/components/coin-card-wizard/progress-bar.tsx`
- Create: `src/components/coin-card-wizard/step-basics.tsx`
- Create: `src/components/coin-card-wizard/step-contracts.tsx`
- Create: `src/components/coin-card-wizard/step-tokenomics.tsx`
- Create: `src/components/coin-card-wizard/step-trust.tsx`
- Modify: `src/app/[locale]/request/page.tsx`
- Read first: `src/components/coin-request-form.tsx` (стили полей), `src/components/cabinet/*` (образец многосекционной формы)

- [ ] **Step 1: Прочитать существующие образцы стиля**

Run: `cat src/components/coin-request-form.tsx && ls src/components/cabinet/`

Переиспользовать уже существующие константы классов `inputCls` и `labelCls` — вынести их в `src/components/coin-card-wizard/field.tsx`, чтобы не копировать в шести файлах:

```tsx
// src/components/coin-card-wizard/field.tsx
export const inputCls =
  "w-full bg-card border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted focus:ring-1 focus:ring-accent outline-none";
export const labelCls =
  "text-[12px] uppercase tracking-[0.15em] text-muted mb-2 block";

export function Field({
  id, label, hint, children,
}: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-muted text-xs mt-1">{hint}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Прогресс-бар**

```tsx
// src/components/coin-card-wizard/progress-bar.tsx
"use client";

export function ProgressBar({ value, missing }: { value: number; missing: string[] }) {
  return (
    <div className="mb-6">
      <div className="flex justify-between text-[12px] uppercase tracking-[0.15em] text-muted mb-2">
        <span>{value}%</span>
        <span>{missing.length > 0 ? `${missing.length}` : "✓"}</span>
      </div>
      <div className="h-1.5 w-full bg-card border border-hairline rounded-full overflow-hidden">
        <div
          className="h-full bg-accent glow-accent transition-all duration-500"
          style={{ width: `${value}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Шаг 1 — основа**

```tsx
// src/components/coin-card-wizard/step-basics.tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createCoinCard } from "@/app/actions/coin-card";
import { Field, inputCls } from "./field";

export function StepBasics({ onCreated }: { onCreated: (cardId: string) => void }) {
  const t = useTranslations("coinCard.wizard");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createCoinCard({ name, symbol, tagline, description, website });
          if (res.ok) onCreated(res.cardId);
          else setError(res.reason);
        });
      }}
    >
      <Field id="cc-name" label={t("name")}>
        <input id="cc-name" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={100} className={inputCls} />
      </Field>
      <Field id="cc-symbol" label={t("symbol")} hint={t("symbolHint")}>
        <input id="cc-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)}
          required maxLength={12} placeholder="BTC" className={inputCls} />
      </Field>
      <Field id="cc-tagline" label={t("tagline")} hint={t("taglineHint")}>
        <input id="cc-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)}
          maxLength={120} className={inputCls} />
      </Field>
      <Field id="cc-website" label={t("website")}>
        <input id="cc-website" value={website} onChange={(e) => setWebsite(e.target.value)}
          required placeholder="example.org" className={inputCls} />
      </Field>
      <Field id="cc-desc" label={t("description")} hint={t("descriptionHint")}>
        <textarea id="cc-desc" value={description} onChange={(e) => setDescription(e.target.value)}
          rows={6} maxLength={20000} className={`${inputCls} min-h-[140px]`} />
      </Field>
      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending}
        className="w-full sm:w-auto bg-accent text-accent-foreground glow-accent rounded-md px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all">
        {pending ? t("saving") : t("next")}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Шаг 2 — сети и контракты (полный код; шаги 3 и 4 строятся по этому же образцу)**

```tsx
// src/components/coin-card-wizard/step-contracts.tsx
"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { SUPPORTED_CHAINS } from "@/lib/coin-card-validate";
import { Field, inputCls, labelCls } from "./field";

type Row = {
  chain: string;
  address: string;
  decimals: string;
  standard: string;
  explorerUrl: string;
  isCanonical: boolean;
};

const EMPTY_ROW: Row = {
  chain: "ethereum", address: "", decimals: "", standard: "",
  explorerUrl: "", isCanonical: true,
};

export function StepContracts({
  cardId, onSaved,
}: {
  cardId: string;
  onSaved: (completeness: number, missing: string[]) => void;
}) {
  const t = useTranslations("coinCard.wizard");
  const [native, setNative] = useState(false);
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const contracts = native
            ? []
            : rows
                .filter((r) => r.address.trim())
                .map((r) => ({
                  chain: r.chain,
                  address: r.address.trim(),
                  decimals: r.decimals.trim() === "" ? null : Number(r.decimals),
                  standard: r.standard.trim() || null,
                  explorerUrl: r.explorerUrl.trim() || null,
                  isCanonical: r.isCanonical,
                }));
          const res = await saveCoinCardSection({
            cardId, section: "CONTRACTS", payload: { contracts },
          });
          if (res.ok) onSaved(res.completeness, res.missing);
          else setError(res.reason);
        });
      }}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={native} onChange={(e) => setNative(e.target.checked)} />
        {t("nativeCoin")}
      </label>

      {!native &&
        rows.map((r, i) => (
          <div key={i} className="border border-hairline rounded-md p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className={labelCls}>{t("contract")} {i + 1}</span>
              {rows.length > 1 && (
                <button type="button" className="text-down text-xs"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  {t("remove")}
                </button>
              )}
            </div>
            <Field id={`cc-chain-${i}`} label={t("chain")}>
              <select id={`cc-chain-${i}`} value={r.chain} className={inputCls}
                onChange={(e) => patch(i, { chain: e.target.value })}>
                {SUPPORTED_CHAINS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field id={`cc-addr-${i}`} label={t("address")} hint={t("addressHint")}>
              <input id={`cc-addr-${i}`} value={r.address} className={`${inputCls} font-mono`}
                onChange={(e) => patch(i, { address: e.target.value })} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field id={`cc-dec-${i}`} label={t("decimals")}>
                <input id={`cc-dec-${i}`} value={r.decimals} inputMode="numeric" className={inputCls}
                  onChange={(e) => patch(i, { decimals: e.target.value })} />
              </Field>
              <Field id={`cc-std-${i}`} label={t("standard")}>
                <input id={`cc-std-${i}`} value={r.standard} placeholder="ERC-20" className={inputCls}
                  onChange={(e) => patch(i, { standard: e.target.value })} />
              </Field>
            </div>
            <Field id={`cc-exp-${i}`} label={t("explorerUrl")}>
              <input id={`cc-exp-${i}`} value={r.explorerUrl} className={inputCls}
                onChange={(e) => patch(i, { explorerUrl: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={r.isCanonical}
                onChange={(e) => patch(i, { isCanonical: e.target.checked })} />
              {t("isCanonical")}
            </label>
          </div>
        ))}

      {!native && rows.length < 20 && (
        <button type="button" className="text-accent text-sm"
          onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW, isCanonical: false }])}>
          + {t("addChain")}
        </button>
      )}

      {error && <p className="text-down text-sm">{t(`errors.${error}`)}</p>}
      <button type="submit" disabled={pending}
        className="w-full sm:w-auto bg-accent text-accent-foreground glow-accent rounded-md px-5 py-2.5 text-sm font-semibold uppercase tracking-wider hover:brightness-110 disabled:opacity-50 transition-all">
        {pending ? t("saving") : t("next")}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Шаги 3 и 4 по образцу шага 2**

Тот же скелет (`useState` → `saveCoinCardSection` → `onSaved(res.completeness, res.missing)` → `t(\`errors.${reason}\`)` при ошибке), другие поля и другое число вызовов:

- `step-tokenomics.tsx`, props `{ cardId, onSaved }` как у `StepContracts`. Два последовательных сохранения в одном `onSubmit`: сначала `section: "TOKENOMICS"` с `payload: { tokenomics: { circulating, total, max, excludedAddresses, emission, burnMechanism } }` (числа — `Number()` или `null` на пустой строке; `excludedAddresses` — `textarea`, разбиваемый по строкам), затем `section: "MARKETS"` с `payload: { markets: rows }`, где строка рынка — `{ kind: "CEX"|"DEX", exchangeName, pair, tradeUrl, chain, poolAddress }`. Если первое сохранение вернуло ошибку — второе не отправлять.
- `step-trust.tsx`, props `{ cardId, onSaved, onDone }`. Четыре последовательных сохранения: `SECURITY` (`{ security: { audits: [{firm, date, reportUrl, scope}], legalEntity, jurisdiction, teamDoxxed } }`), `TEAM` (`{ teamInfo: { members: [{name, role, link}], investors, partners } }`), `MARKETING` (`{ marketing: { pitch, roadmap: [{title, date}], mediaKit, videoUrl } }`), `LINKS` (`{ links: { website, docs, whitepaper, github, x, telegram, discord, reddit, blog, youtube } }` — `website` обязателен, подставить уже сохранённый). На первой ошибке остановиться и показать её. После последнего успешного сохранения вызвать `onDone()`.

Все ключи переводов для этих полей добавляются в Task 14.

- [ ] **Step 6: Контейнер визарда**

```tsx
// src/components/coin-card-wizard/wizard.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProgressBar } from "./progress-bar";
import { StepBasics } from "./step-basics";
import { StepContracts } from "./step-contracts";
import { StepTokenomics } from "./step-tokenomics";
import { StepTrust } from "./step-trust";

const STEPS = ["basics", "contracts", "tokenomics", "trust"] as const;

export function CoinCardWizard() {
  const t = useTranslations("coinCard.wizard");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [cardId, setCardId] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);

  return (
    <div>
      <ProgressBar value={completeness} missing={missing} />
      <nav className="flex gap-2 mb-6 flex-wrap">
        {STEPS.map((s, i) => (
          <button key={s} type="button" disabled={!cardId && i > 0}
            onClick={() => setStep(i)}
            className={`text-[12px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-md border transition-colors ${
              i === step ? "border-accent text-accent" : "border-hairline text-muted hover:text-foreground"
            } disabled:opacity-40`}>
            {i + 1}. {t(`steps.${s}`)}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <StepBasics onCreated={(id) => { setCardId(id); setStep(1); }} />
      )}
      {step > 0 && cardId && (
        <>
          {step === 1 && <StepContracts cardId={cardId} onSaved={(c, m) => { setCompleteness(c); setMissing(m); setStep(2); }} />}
          {step === 2 && <StepTokenomics cardId={cardId} onSaved={(c, m) => { setCompleteness(c); setMissing(m); setStep(3); }} />}
          {step === 3 && <StepTrust cardId={cardId} onSaved={(c, m) => { setCompleteness(c); setMissing(m); }} onDone={() => router.push("/cabinet")} />}
        </>
      )}

      {cardId && (
        <p className="text-muted text-xs mt-6">{t("savedNotice")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Подключить визард на страницу подачи**

В `src/app/[locale]/request/page.tsx` заменить рендер `<CoinRequestForm />` на `<CoinCardWizard />`. Старый компонент `src/components/coin-request-form.tsx` **не удалять** — он ещё нужен существующим `PENDING` заявкам в старой админке.

Run: `grep -n "CoinRequestForm" -r src/app src/components`
Expected: единственное оставшееся упоминание — сам файл компонента.

- [ ] **Step 8: Проверить сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: сборка проходит.

- [ ] **Step 9: Commit**

```bash
git add src/components/coin-card-wizard src/app/\[locale\]/request/page.tsx
git commit -m "feat(coin-card): визард подачи карточки монеты"
```

---

### Task 12: Модерация новых карточек в админке

**Files:**
- Create: `src/app/actions/admin-coin-cards.ts`
- Create: `src/app/[locale]/admin/coin-cards/page.tsx`
- Create: `src/components/admin/coin-card-row.tsx`
- Modify: `src/components/admin/*` навигация по табам (найти командой из шага 1)
- Read first: `src/app/actions/admin-requests.ts`, `src/components/admin/request-row.tsx`

- [ ] **Step 1: Найти, где объявлены табы админки**

Run: `grep -rn "admin.tabs" src messages/en.json | head`

- [ ] **Step 2: Написать серверные действия**

```ts
// src/app/actions/admin-coin-cards.ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { approveCoinCardCore, rejectCoinCardCore } from "@/lib/admin/approve-coin-card";

async function requireAdmin() {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return user.id;
}

export async function approveCoinCard(cardId: string) {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false as const, reason: "forbidden" };

  const res = await approveCoinCardCore(prisma, { cardId, reviewerId: adminId });
  if (res.ok) {
    await prisma.adminAuditLog.create({
      data: {
        actorId: adminId,
        action: "APPROVE_COIN_CARD",
        targetType: "CoinCard",
        targetId: cardId,
        details: { slug: res.slug },
      },
    });
    revalidatePath("/", "layout");
  }
  return res;
}

export async function rejectCoinCard(cardId: string, reason: string) {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false as const, reason: "forbidden" };

  const res = await rejectCoinCardCore(prisma, { cardId, reviewerId: adminId, reason });
  if (res.ok) {
    await prisma.adminAuditLog.create({
      data: {
        actorId: adminId,
        action: "REJECT_COIN_CARD",
        targetType: "CoinCard",
        targetId: cardId,
        details: { reason },
      },
    });
    revalidatePath("/", "layout");
  }
  return res;
}
```

- [ ] **Step 3: Страница очереди**

```tsx
// src/app/[locale]/admin/coin-cards/page.tsx
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { CoinCardRow } from "@/components/admin/coin-card-row";

export default async function AdminCoinCardsPage() {
  const t = await getTranslations("admin.coinCards");
  const cards = await prisma.coinCard.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      contracts: true,
      markets: { take: 20 },
      steward: { select: { username: true, name: true, email: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">{t("title")}</h1>
      <p className="text-muted text-sm mb-6">{t("subtitle")}</p>
      {cards.length === 0 ? (
        <p className="text-muted text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {cards.map((c) => (
            <CoinCardRow key={c.id} card={JSON.parse(JSON.stringify(c))} />
          ))}
        </div>
      )}
    </div>
  );
}
```

Админ-гейт уже стоит на `src/app/[locale]/admin/layout.tsx` — отдельная проверка роли на странице не нужна (проверить это чтением файла, а не на веру).

- [ ] **Step 4: Строка очереди**

```tsx
// src/components/admin/coin-card-row.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { approveCoinCard, rejectCoinCard } from "@/app/actions/admin-coin-cards";

type Card = {
  id: string;
  slug: string;
  name: string;
  symbol: string;
  tagline: string | null;
  logoUrl: string | null;
  completeness: number;
  createdAt: string;
  steward: { username: string | null; name: string | null; email: string | null } | null;
  contracts: Array<{ id: string; chain: string; address: string; isCanonical: boolean }>;
  markets: Array<{ id: string; kind: string; exchangeName: string; pair: string }>;
};

const MIN_REASON = 3;

export function CoinCardRow({ card }: { card: Card }) {
  const t = useTranslations("admin.coinCards");
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; reason?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.reason ?? "unknown_error");
    });

  const author =
    card.steward?.username ?? card.steward?.name ?? card.steward?.email ?? "—";

  return (
    <div className="border border-hairline rounded-md p-4 bg-card">
      <div className="flex items-start gap-4">
        {card.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.logoUrl} alt="" width={48} height={48}
            className="rounded-full border border-hairline shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">
            {card.name} <span className="text-muted">{card.symbol}</span>
          </h3>
          {card.tagline && <p className="text-muted text-sm">{card.tagline}</p>}
          <p className="text-muted text-xs mt-1">
            /{card.slug} · {t("completeness")}: {card.completeness}% · {author} ·{" "}
            {new Date(card.createdAt).toISOString().slice(0, 10)}
          </p>
        </div>
      </div>

      {card.contracts.length > 0 && (
        <ul className="mt-3 space-y-1">
          {card.contracts.map((c) => (
            <li key={c.id} className="text-xs font-mono text-muted break-all">
              {c.chain}: {c.address}
              {c.isCanonical && <span className="ml-2 text-accent not-italic">★</span>}
            </li>
          ))}
        </ul>
      )}

      {card.markets.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {card.markets.map((m) => `${m.exchangeName} ${m.pair}`).join(" · ")}
        </p>
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <button type="button" disabled={pending}
          onClick={() => run(() => approveCoinCard(card.id))}
          className="bg-up/15 text-up border border-up/40 rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider disabled:opacity-50">
          {t("approve")}
        </button>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t("rejectReason")} maxLength={500}
          className="flex-1 bg-background border border-hairline rounded-md px-3 py-2 text-sm placeholder:text-muted outline-none focus:ring-1 focus:ring-accent" />
        <button type="button" disabled={pending || reason.trim().length < MIN_REASON}
          onClick={() => run(() => rejectCoinCard(card.id, reason))}
          className="bg-down/15 text-down border border-down/40 rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider disabled:opacity-50">
          {t("reject")}
        </button>
      </div>

      {error && <p className="text-down text-sm mt-2">{t(`errors.${error}`)}</p>}
    </div>
  );
}
```

Поле `createdAt` приходит строкой, потому что страница сериализует карточку через
`JSON.parse(JSON.stringify(c))` — `Date` в клиентский компонент передать нельзя.

- [ ] **Step 5: Добавить таб в навигацию админки**

В найденном на шаге 1 месте добавить пункт на `/admin/coin-cards` с ключом `admin.tabs.coinCards`.

- [ ] **Step 6: Проверить сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: сборка проходит.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/admin-coin-cards.ts src/app/\[locale\]/admin/coin-cards src/components/admin/coin-card-row.tsx
git commit -m "feat(coin-card): очередь модерации новых карточек"
```

---

### Task 13: Публичный рендер карточки с провенансом

**Files:**
- Create: `src/components/coin-card/provenance-badge.tsx`
- Create: `src/components/coin-card/trust-plaque.tsx`
- Create: `src/components/coin-card/sections/contracts-section.tsx`
- Create: `src/components/coin-card/sections/tokenomics-section.tsx`
- Create: `src/components/coin-card/sections/markets-section.tsx`
- Create: `src/components/coin-card/sections/security-section.tsx`
- Create: `src/components/coin-card/sections/team-section.tsx`
- Create: `src/components/coin-card/sections/marketing-section.tsx`
- Create: `src/lib/coin-card-public.ts` — загрузка одной карточки для публичного рендера
- Modify: `src/app/[locale]/coin/[slug]/page.tsx`
- Read first: `src/components/coin-detail/section-nav.tsx`, `src/components/coin-detail/links.tsx`

- [ ] **Step 1: Бейдж провенанса**

```tsx
// src/components/coin-card/provenance-badge.tsx
import { useTranslations } from "next-intl";
import type { ProvenanceEntry } from "@/lib/coin-card-provenance";

const TONE: Record<ProvenanceEntry["kind"], string> = {
  SELF_REPORTED: "text-muted border-hairline",
  AGGREGATED: "text-foreground border-hairline",
  VERIFIED_ONCHAIN: "text-up border-up/40",
  ADMIN_SET: "text-accent border-accent/40",
};

/**
 * The differentiator: every value states where it came from. Rendered inline,
 * next to the number it qualifies.
 */
export function ProvenanceBadge({ entry }: { entry: ProvenanceEntry }) {
  const t = useTranslations("coinCard.provenance");
  const at = entry.at && entry.at !== new Date(0).toISOString()
    ? new Date(entry.at).toISOString().slice(0, 10)
    : null;
  const title = [t(entry.kind), entry.source, at].filter(Boolean).join(" · ");
  return (
    <span
      title={title}
      className={`inline-block ml-2 align-middle text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${TONE[entry.kind]}`}
    >
      {t(`${entry.kind}_short`)}
    </span>
  );
}
```

- [ ] **Step 2: Плашка доверия**

```tsx
// src/components/coin-card/trust-plaque.tsx
import { useTranslations } from "next-intl";

type Trust = "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";

const TONE: Record<Trust, string> = {
  UNVERIFIED: "border-down/40 text-down",
  CONTRACT_VERIFIED: "border-hairline text-foreground",
  PROJECT_CLAIMED: "border-accent/40 text-accent",
  FULLY_VERIFIED: "border-up/40 text-up",
};

export function TrustPlaque({ trust }: { trust: Trust }) {
  const t = useTranslations("coinCard.trust");
  return (
    <div className={`rounded-md border px-4 py-3 text-sm mb-6 ${TONE[trust]}`}>
      <span className="font-semibold uppercase tracking-[0.12em] text-[12px] mr-2">
        {t(trust)}
      </span>
      <span className="text-muted">{t(`${trust}_note`)}</span>
    </div>
  );
}
```

`UNVERIFIED_note` — это ровно та фраза из спеки: «ведётся сообществом, проект не подтвердил причастность».

- [ ] **Step 3: Загрузчик публичной карточки**

```ts
// src/lib/coin-card-public.ts
import { prisma } from "@/lib/prisma";

/** Only APPROVED cards are ever public. */
export async function getPublicCoinCard(slug: string) {
  return prisma.coinCard.findFirst({
    where: { slug, status: "APPROVED" },
    include: {
      contracts: { orderBy: [{ isCanonical: "desc" }, { chain: "asc" }] },
      markets: { orderBy: { volumeUsd24h: "desc" }, take: 100 },
    },
  });
}
```

- [ ] **Step 4: Секция контрактов (полный код — остальные секции по этому образцу)**

```tsx
// src/components/coin-card/sections/contracts-section.tsx
import { getTranslations } from "next-intl/server";
import { getProvenance } from "@/lib/coin-card-provenance";
import { normalizeHttpUrl } from "@/lib/coin-card-validate";
import { ProvenanceBadge } from "../provenance-badge";

type Contract = {
  id: string;
  chain: string;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
  isCanonical: boolean;
  verifiedAt: Date | null;
};

export async function ContractsSection({
  contracts, provenance,
}: {
  contracts: Contract[];
  provenance: unknown;
}) {
  const t = await getTranslations("coinCard");
  if (contracts.length === 0) return null;

  return (
    <section id="contracts" className="mt-10">
      <h2 className="text-lg font-semibold mb-4">
        {t("sections.contracts")}
        <ProvenanceBadge entry={getProvenance(provenance, "contracts")} />
      </h2>
      <div className="space-y-3">
        {contracts.map((c) => {
          // Re-sanitize at render: a stored URL must never become javascript:.
          const explorer = normalizeHttpUrl(c.explorerUrl);
          const href = explorer && explorer !== "invalid" ? explorer : null;
          return (
            <div key={c.id} className="border border-hairline rounded-md p-3 bg-card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] uppercase tracking-[0.15em] text-muted">
                  {c.chain}
                </span>
                {c.isCanonical && (
                  <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-accent/40 text-accent">
                    {t("canonical")}
                  </span>
                )}
                {c.standard && <span className="text-muted text-xs">{c.standard}</span>}
                {c.decimals != null && (
                  <span className="text-muted text-xs">dec {c.decimals}</span>
                )}
                {c.verifiedAt && (
                  <span className="text-up text-xs">{t("contractVerified")}</span>
                )}
              </div>
              <p className="font-mono text-xs break-all mt-2">{c.address}</p>
              {href && (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow"
                  className="text-accent text-xs mt-1 inline-block">
                  {t("openInExplorer")}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Остальные секции по тому же образцу**

`tokenomics-section.tsx` (supply + методика с списком исключённых адресов),
`markets-section.tsx`, `security-section.tsx` (аудиты + флаги риска + юрлицо),
`team-section.tsx`, `marketing-section.tsx` (pitch, roadmap, mediaKit, video).
Каждая — серверный компонент, принимает свой срез карточки плюс `provenance`,
возвращает `null` на пустых данных. Обязательные правила:

- Любой внешний URL пропускать через `normalizeHttpUrl` **на рендере** и не выводить, если вернулось `"invalid"` — защита от `javascript:` в ссылках, тот же приём, что в маппере POI.
- `rel="noopener noreferrer nofollow"` и `target="_blank"` на всех внешних ссылках.
- Адреса контрактов выводить монospace-шрифтом с кнопкой «скопировать» и ссылкой на эксплорер.
- `markets-section.tsx`: если `priceUsd === null` (а в A1 он всегда null), колонку цены не показывать вовсе, а не рисовать прочерки — агрегатор появится в слайсе C.

- [ ] **Step 6: Подключить к странице монеты**

В `src/app/[locale]/coin/[slug]/page.tsx` сначала пробовать `getPublicCoinCard(slug)`; если карточка есть — рендерить `<TrustPlaque />` и новые секции в дополнение к существующему содержимому, встроив их в `section-nav.tsx`. Если карточки нет — страница работает как раньше, по данным `Coin`. Ни одна существующая монета не должна пропасть.

Run: `npx playwright test` (если e2e настроены) или вручную открыть `/en/coin/bitcoin`
Expected: страница биткоина выглядит как до изменений.

- [ ] **Step 7: Проверить сборку**

Run: `npx tsc --noEmit && npm run build`
Expected: сборка проходит.

- [ ] **Step 8: Commit**

```bash
git add src/components/coin-card src/lib/coin-card-public.ts src/app/\[locale\]/coin
git commit -m "feat(coin-card): публичный рендер карточки с провенансом"
```

---

### Task 14: Переводы на 10 локалей

**Files:**
- Modify: `messages/en.json`, `ru.json`, `de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt-BR.json`, `tr.json`, `zh-CN.json`

- [ ] **Step 1: Собрать список использованных ключей**

Run: `grep -rhoE "t\(\`?\"?(coinCard|admin\.coinCards|admin\.tabs\.coinCards)[^\"\`)]*" src | sort -u`

- [ ] **Step 2: Добавить ветку `coinCard` в `messages/en.json`**

Структура (значения — на английском; остальные локали переводятся с них):

```json
{
  "coinCard": {
    "wizard": {
      "title": "List a coin",
      "steps": { "basics": "Basics", "contracts": "Chains", "tokenomics": "Tokenomics", "trust": "Trust" },
      "name": "Name", "symbol": "Ticker", "symbolHint": "Short code, e.g. BTC",
      "tagline": "Tagline", "taglineHint": "One line, up to 120 characters",
      "website": "Website", "description": "Description",
      "descriptionHint": "At least 120 characters to count toward completeness",
      "next": "Continue", "saving": "Saving…", "savedNotice": "Saved as a draft. You can come back any time.",
      "nativeCoin": "Native coin of its own blockchain (no token contract)",
      "contract": "Contract", "chain": "Chain", "address": "Contract address",
      "addressHint": "Exact on-chain address — this is what tells your token from a fake with the same ticker",
      "decimals": "Decimals", "standard": "Token standard", "explorerUrl": "Explorer link",
      "isCanonical": "Canonical (not a bridged copy)", "addChain": "Add a chain", "remove": "Remove",
      "errors": {
        "unauth": "Please sign in.", "forbidden": "You cannot edit this card.",
        "not_found": "Card not found.", "name_required": "Name is required.",
        "name_too_long": "Name is too long.", "symbol_required": "Ticker is required.",
        "symbol_too_long": "Ticker is too long.", "symbol_invalid": "Ticker may contain only letters and digits.",
        "tagline_too_long": "Tagline is too long.", "description_too_long": "Description is too long.",
        "website_required": "Website is required.", "url_invalid": "That link is not a valid http(s) URL.",
        "chain_unknown": "Unsupported chain.", "contract_required": "Contract address is required.",
        "contract_invalid": "That contract address is malformed.", "decimals_invalid": "Decimals must be 0–36.",
        "supply_negative": "Supply cannot be negative.", "supply_inconsistent": "Circulating ≤ total ≤ max must hold.",
        "market_incomplete": "Exchange and pair are required.", "date_invalid": "That date is not valid.",
        "too_many_pending": "You already have 3 cards awaiting review.",
        "too_many_contracts": "Up to 20 contracts per card.", "too_many_markets": "Up to 200 markets per card.",
        "slug_taken": "That name is already taken — try a slightly different one.",
        "section_unsupported": "Unknown section.", "unknown_error": "Something went wrong."
      }
    },
    "provenance": {
      "SELF_REPORTED": "Self-reported by the project", "SELF_REPORTED_short": "claimed",
      "VERIFIED_ONCHAIN": "Verified on-chain", "VERIFIED_ONCHAIN_short": "on-chain",
      "AGGREGATED": "Aggregated across markets", "AGGREGATED_short": "aggregated",
      "ADMIN_SET": "Set by a moderator", "ADMIN_SET_short": "moderated"
    },
    "trust": {
      "UNVERIFIED": "Community-maintained",
      "UNVERIFIED_note": "Maintained by the community — the project has not confirmed involvement.",
      "CONTRACT_VERIFIED": "Contract verified",
      "CONTRACT_VERIFIED_note": "The contract address matches on-chain data.",
      "PROJECT_CLAIMED": "Claimed by the project",
      "PROJECT_CLAIMED_note": "The project proved control of the contract or domain.",
      "FULLY_VERIFIED": "Fully verified",
      "FULLY_VERIFIED_note": "Claimed, audited, with a disclosed team and legal entity."
    },
    "sections": {
      "contracts": "Chains & contracts", "tokenomics": "Tokenomics", "markets": "Markets",
      "security": "Security & audits", "team": "Team & funding", "marketing": "About the project"
    },
    "canonical": "canonical",
    "contractVerified": "verified on-chain",
    "openInExplorer": "Open in explorer"
  },
  "admin": {
    "tabs": { "coinCards": "Coin cards" },
    "coinCards": {
      "title": "Coin cards", "subtitle": "New listings awaiting review.", "empty": "Nothing to review.",
      "approve": "Approve", "reject": "Reject", "rejectReason": "Reason for rejection",
      "completeness": "Completeness",
      "errors": {
        "forbidden": "Admins only.", "not_found": "Card not found.",
        "not_pending": "This card is no longer pending.",
        "too_incomplete": "Card is below 35% completeness.",
        "logo_required": "A logo is required before publishing.",
        "reason_too_short": "Give a reason of at least 3 characters."
      }
    }
  }
}
```

Ветка `admin` в файлах уже существует — **сливать**, а не перезаписывать: добавить `coinCards` внутрь существующего `admin` и `coinCards` внутрь существующего `admin.tabs`.

- [ ] **Step 3: Перевести на остальные 9 локалей**

Те же ключи, переведённые значения. В `ru.json` формулировки взять из спеки (например `UNVERIFIED_note` → «Ведётся сообществом — проект не подтвердил причастность»).

- [ ] **Step 4: Проверить, что ни один ключ не потерян**

```bash
node -e '
const fs=require("fs");
const keys=(o,p="")=>Object.entries(o).flatMap(([k,v])=>
  v&&typeof v==="object"?keys(v,p+k+"."):[p+k]);
const en=new Set(keys(JSON.parse(fs.readFileSync("messages/en.json","utf8"))));
let bad=0;
for(const f of fs.readdirSync("messages")){
  if(f==="en.json")continue;
  const got=new Set(keys(JSON.parse(fs.readFileSync("messages/"+f,"utf8"))));
  const miss=[...en].filter(k=>!got.has(k));
  if(miss.length){bad++;console.log(f,"missing",miss.length,miss.slice(0,5));}
}
process.exit(bad?1:0);
'
```

Expected: без вывода, код выхода 0.

- [ ] **Step 5: Commit**

```bash
git add messages
git commit -m "i18n(coin-card): ключи карточки монеты на 10 локалей"
```

---

### Task 15: Полная проверка и выкладка

**Files:** нет новых

- [ ] **Step 1: Прогнать все тесты**

Run: `npm test`
Expected: все тесты проходят, включая существующие. Если упал какой-то старый тест — это регрессия, починить до выкладки, не глушить тест.

- [ ] **Step 2: Линт и типы**

Run: `npx tsc --noEmit && npm run lint`
Expected: без ошибок.

- [ ] **Step 3: Сборка**

Run: `npm run build`
Expected: сборка проходит.

- [ ] **Step 4: Проверить, нужен ли перезапуск воркера**

Воркер (`trientes-worker`) запускается через `tsx` и фиксирует исходники `src/lib` на момент старта. Проверить, импортирует ли он что-то из новых файлов:

Run: `grep -rn "coin-card" worker/ src/lib/*.ts | grep -v "^src/lib/coin-card"`
Expected: пустой вывод → воркер не затронут, достаточно перезапуска веба. Если вывод непустой — перезапускать **и** воркер.

- [ ] **Step 5: Применить миграцию в проде и перезапустить**

```bash
npx prisma migrate deploy
pm2 restart trientes-web
pm2 save
```

Expected: `migrate deploy` сообщает про применённую миграцию; `pm2 list` показывает `trientes-web` в статусе `online`.

- [ ] **Step 6: Проверить руками в проде**

- `https://trientes.org/en/request` — визард открывается, шаг 1 создаёт карточку.
- `https://trientes.org/en/admin/coin-cards` — карточка видна в очереди, Approve работает.
- `https://trientes.org/en/coin/<slug>` — карточка публична, бейджи провенанса и плашка доверия на месте.
- `https://trientes.org/en/coin/bitcoin` — существующая монета не сломалась.

- [ ] **Step 7: Запушить**

```bash
git push origin main
```

Expected: `main -> main`. Пушить **с этого сервера** — деплой-ключ здесь, и незапушенных коммитов оставлять нельзя.

---

## Что дальше: план A2

Пишется отдельным документом после сдачи A1, по той же спеке:

1. `coin-card-diff.ts` — построение и применение `diff` (TDD).
2. `coin-card-multisig.ts` — достижимость порога, авто-подпись автора, снимки `thresholdAt`/`signerCountAt`, арифметическое закрытие отказом (TDD).
3. Конвейер ревизий: `DRAFT → PENDING_SIGNERS → PENDING_ADMIN → APPLIED`, воркер чистит `EXPIRED`.
4. Команда карточки: `inviteMember`, ссылки-приглашения, страница `/invite/coin/[token]`, защита `last_owner` и `threshold_unreachable`.
5. Права по разделам в интерфейсе (`canEditSection` уже написан в A1 и покрыт тестами).
6. Очередь ревизий в админке + `FORCE_COIN_REVISION` / `DISABLE_COIN_MULTISIG` с записью в публичную историю.
7. Публичный блок «История изменений».
8. Перенос существующих `CoinRequest` в `CoinCard` скриптом, вывод старой формы из эксплуатации.
