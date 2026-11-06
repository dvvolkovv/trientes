# Собственный листинг монет — Слайс A2: команда, права, ревизии, мультисиг

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У опубликованной карточки монеты появляется команда с правами по разделам, любое изменение идёт пакетом-ревизией через мультиподпись команды и модератора сайта, а публичная карточка показывает историю изменений, которую нельзя обойти тихо.

**Architecture:** Вся недетерминированная часть (прав, порогов, маршрутизации ревизии, построения и применения diff) выносится в чистые функции `src/lib/coin-card-{access,diff,multisig,sections,history}.ts` и покрывается модульными тестами без базы. Поверх — тонкие серверные действия (`src/app/actions/coin-card-{revisions,members,invites,policy}.ts` и `admin-coin-revisions.ts`), которые только читают/пишут Prisma и логируют в `AdminAuditLog`. Миграция **не нужна**: все девять моделей и семь enum'ов слайса A уже созданы миграцией `20261106190000_coin_card` в A1, включая `CoinCardMember/Invite/Policy/Revision/Approval`, а значения `AdminAction` (`APPLY_COIN_REVISION`, `REJECT_COIN_REVISION`, `FORCE_COIN_REVISION`, `DISABLE_COIN_MULTISIG`, `TRANSFER_COIN_CARD`) уже в enum'е.

**Tech Stack:** Next.js 16.2.6 (App Router, server actions), Prisma + PostgreSQL, next-intl (10 локалей), Vitest (`npm test`), Tailwind. Прод — PM2 (`trientes-web`, `trientes-worker`).

**Важно перед кодом:** AGENTS.md требует читать документацию из `node_modules/next/dist/docs/` — это НЕ тот Next.js, что в обучающих данных. Минимум перед правкой UI: `node_modules/next/dist/docs/01-app/02-guides/forms.md` и `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidate-path.md`.

**Спека:** `docs/superpowers/specs/2026-11-06-coin-card-listing-design.md`
**Предыдущий слайс:** `docs/superpowers/plans/2026-11-06-coin-card-listing-a1.md`

---

## Граница слайса (сознательные решения)

1. **Конвейер ревизий управляет только опубликованными карточками** (`status = APPROVED`). Пока карточка `PENDING`/`REJECTED`, команда с правами на раздел пишет прямо в карточку (путь A1, `saveCoinCardSection`): публичного вреда ещё нет, а модератор при одобрении видит карточку целиком. Мультисиг до публикации не применяется — это зафиксированная граница, а не недоделка.
2. **Подписанты — аккаунты Trientes, не адреса кошельков** (ограничение спеки для A). Привязка к кошелькам — слайс D.
3. **Принудительные действия админа видны публично** не через новое поле в схеме (миграции в A2 нет), а через чтение `AdminAuditLog` по `targetId = card.id` и домешивание этих событий в публичную историю.
4. **Состав команды непубличен** (открытый вопрос спеки) — в публичной истории показывается только автор-хэндл того изменения, которое применено.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/lib/invite-tokens.ts` | **новый** — generateInviteToken / inviteExpiry / inviteState, вынесены из `company-invites.ts` (DRY: два потребителя) |
| `src/lib/company-invites.ts` | правка: реэкспорт из `invite-tokens.ts`, чтобы не ломать вызовы |
| `src/lib/coin-card-sections.ts` | **новый** — `normalizeSectionPayload()`: единственный нормализатор/валидатор payload секции; используют и прямое сохранение (A1), и ревизии (A2) |
| `src/lib/coin-card-diff.ts` | **новый** — `buildDiff`, `diffPaths`, `diffToCardUpdate` (чистые) |
| `src/lib/coin-card-multisig.ts` | **новый** — `REVISION_TTL_DAYS`, `policyApplies`, `routeSubmission`, `tally`, `thresholdReachable` (чистые) |
| `src/lib/coin-card-access.ts` | правка: `getViewerCard`, `listViewerCards`, `canVote`, `canAssignRole`, `canEditCardDirectly` |
| `src/lib/coin-card-invites.ts` | **новый** — `buildCardInviteUrl`, лимиты, реэкспорт состояния приглашения |
| `src/lib/coin-card-history.ts` | **новый** — `getPublicCardHistory()`: APPLIED-ревизии + админские принудительные события из `AdminAuditLog` |
| `src/lib/coin-card-expiry.ts` | **новый** — `expireStaleRevisions(prismaLike, now)` для воркера |
| `src/app/actions/coin-card-revisions.ts` | **новый** — `submitSectionRevision`, `voteOnRevision`, `withdrawRevision` |
| `src/app/actions/coin-card-members.ts` | **новый** — `inviteCardMember`, `updateCardMember`, `removeCardMember` |
| `src/app/actions/coin-card-invites.ts` | **новый** — `createCardInvite`, `revokeCardInvite`, `acceptCardInvite` |
| `src/app/actions/coin-card-policy.ts` | **новый** — `updateCardPolicy` (мультисиг; через ревизию `POLICY`, если мультисиг включён) |
| `src/app/actions/admin-coin-revisions.ts` | **новый** — `applyCoinRevision`, `rejectCoinRevision`, `forceCoinRevision`, `disableCoinMultisig`, `transferCoinCard` |
| `src/app/actions/coin-card.ts` | правка: `saveCoinCardSection` переводится на `normalizeSectionPayload` |
| `src/app/[locale]/cabinet/coins/[id]/page.tsx` | **новый** — управление карточкой: разделы, команда, политика, ревизии |
| `src/components/cabinet/coins-section.tsx` | **новый** — список карточек в `/cabinet` |
| `src/components/coin-card-manage/section-editor.tsx` | **новый** — редактор одной секции → ревизия или прямая запись |
| `src/components/coin-card-manage/team-section.tsx` | **новый** — участники, роли, разделы, подписанты |
| `src/components/coin-card-manage/member-row.tsx` | **новый** — строка участника |
| `src/components/coin-card-manage/invite-member-form.tsx` | **новый** — приглашение по юзернейму/email |
| `src/components/coin-card-manage/invite-links.tsx` | **новый** — одноразовые ссылки |
| `src/components/coin-card-manage/policy-section.tsx` | **новый** — мультисиг: вкл/выкл, порог, разделы |
| `src/components/coin-card-manage/revisions-section.tsx` | **новый** — список ревизий + голосование |
| `src/components/coin-card-manage/diff-view.tsx` | **новый** — рендер diff «было → стало» (переиспользуется админкой) |
| `src/app/[locale]/invite/coin/[token]/page.tsx` | **новый** — приём приглашения в команду карточки |
| `src/app/[locale]/admin/coin-cards/page.tsx` | правка: второй блок — очередь ревизий |
| `src/components/admin/coin-revision-row.tsx` | **новый** — ревизия в админке: diff, подписи, Apply/Reject/Force |
| `src/components/coin-card/history-section.tsx` | **новый** — публичная история изменений |
| `src/components/coin-card/card-sections.tsx` | правка: подключить историю |
| `worker/index.ts` | правка: часовой cron `expireStaleRevisions` |
| `tests/coin-card-diff.test.ts`, `tests/coin-card-multisig.test.ts`, `tests/coin-card-access.test.ts`, `tests/coin-card-sections.test.ts`, `tests/coin-card-expiry.test.ts` | модульные тесты |
| `messages/*.json` | `coinCard.manage.*`, `coinCard.team.*`, `coinCard.policy.*`, `coinCard.revision.*`, `coinCard.history.*`, `cabinet.coins.*`, `inviteCoin.*`, `admin.coinRevisions.*` в 10 локалях |

---

### Task 1: Общая выдача токенов приглашений (DRY)

**Files:**
- Create: `src/lib/invite-tokens.ts`
- Modify: `src/lib/company-invites.ts`

- [ ] **Step 1: Создать `src/lib/invite-tokens.ts`**

```ts
// Generic one-time invite-link primitives. Shared by company teams and coin
// card teams — two consumers, one implementation.

import { randomBytes } from "node:crypto";

export const INVITE_TTL_DAYS = 14;
/** Enough for a real team, low enough that a stolen session can't mint links forever. */
export const MAX_ACTIVE_INVITES = 20;

export type InviteState = "valid" | "expired" | "accepted" | "revoked";

export type InviteLifecycle = {
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
};

export function generateInviteToken(): string {
  // 24 random bytes → 32 base64url chars, URL-safe without escaping.
  return randomBytes(24).toString("base64url");
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// Revoked beats accepted beats expired: the strongest reason a link is dead is
// the one worth showing.
export function inviteState(invite: InviteLifecycle, now: Date = new Date()): InviteState {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "accepted";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

export function isInviteUsable(invite: InviteLifecycle, now: Date = new Date()): boolean {
  return inviteState(invite, now) === "valid";
}
```

- [ ] **Step 2: Переписать `src/lib/company-invites.ts` на реэкспорт**

Полное новое содержимое файла (вызывающий код не меняется — имена те же):

```ts
// Shareable invite links for company teams. inviteMember() can only add users
// that already have a Trientes account; a link covers the other case — the
// owner sends it over any channel and the invitee joins after signing up.
// The token lifecycle itself lives in invite-tokens.ts, shared with coin cards.

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";
export type { InviteState, InviteLifecycle } from "@/lib/invite-tokens";

export function buildInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/invite/${token}`;
}
```

- [ ] **Step 3: Проверить, что ничего не отвалилось**

Run: `npx tsc --noEmit && npm test -- --run company` (если тестов на company-invites нет, достаточно tsc)
Expected: tsc без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/lib/invite-tokens.ts src/lib/company-invites.ts
git commit -m "refactor(invites): вынести жизненный цикл токена приглашения в общий модуль"
```

---

### Task 2: Единый нормализатор секции (используют и прямая запись, и ревизии)

**Files:**
- Create: `src/lib/coin-card-sections.ts`
- Create: `tests/coin-card-sections.test.ts`
- Modify: `src/app/actions/coin-card.ts`

Сейчас вся валидация и нормализация payload'а секции вшита в тело
`saveCoinCardSection` (`src/app/actions/coin-card.ts:106-215`). Ревизиям нужна
ровно та же нормализация, но без записи в базу: ревизия сначала считает «стало»,
сравнивает с «было», и только потом (возможно, через дни и подписи) применяется.
Поэтому нормализация выносится в чистую функцию.

- [ ] **Step 1: Написать падающий тест `tests/coin-card-sections.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { normalizeSectionPayload, sectionValues, MAX_CONTRACTS } from "@/lib/coin-card-sections";

const current = {
  name: "Trientes Coin",
  symbol: "TRI",
  tagline: null,
  description: null,
  logoUrl: null,
  launchDate: null,
  tags: [] as string[],
  links: { website: "https://trientes.org" },
  tokenomics: null,
  security: null,
  teamInfo: null,
  marketing: null,
  contracts: [],
  markets: [],
};

describe("normalizeSectionPayload", () => {
  it("normalizes IDENTITY and reports touched paths", () => {
    const r = normalizeSectionPayload("IDENTITY", { name: "  New Name ", symbol: "tri" }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.card.name).toBe("New Name");
    expect(r.patch.card.symbol).toBe("TRI");
    expect(r.patch.touched).toContain("name");
  });

  it("rejects a bad ticker", () => {
    const r = normalizeSectionPayload("IDENTITY", { symbol: "T R I" }, current);
    expect(r).toEqual({ ok: false, reason: "symbol_invalid" });
  });

  it("lowercases EVM contract addresses and keeps the canonical flag", () => {
    const addr = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const r = normalizeSectionPayload(
      "CONTRACTS",
      { contracts: [{ chain: "ethereum", address: addr, isCanonical: true }] },
      current,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.patch.contracts?.[0].address).toBe(addr.toLowerCase());
    expect(r.patch.contracts?.[0].isCanonical).toBe(true);
    expect(r.patch.touched).toEqual(["contracts"]);
  });

  it("caps the contract count", () => {
    const contracts = new Array(MAX_CONTRACTS + 1).fill(null).map((_, i) => ({
      chain: "ethereum",
      address: `0x${String(i).padStart(40, "0")}`,
    }));
    const r = normalizeSectionPayload("CONTRACTS", { contracts }, current);
    expect(r).toEqual({ ok: false, reason: "too_many_contracts" });
  });

  it("rejects inconsistent supply", () => {
    const r = normalizeSectionPayload(
      "TOKENOMICS",
      { tokenomics: { circulating: 10, total: 5 } },
      current,
    );
    expect(r).toEqual({ ok: false, reason: "supply_inconsistent" });
  });

  it("requires a website in LINKS and rejects javascript: urls", () => {
    expect(normalizeSectionPayload("LINKS", { links: {} }, current)).toEqual({
      ok: false,
      reason: "website_required",
    });
    expect(
      normalizeSectionPayload("LINKS", { links: { website: "javascript:alert(1)" } }, current),
    ).toEqual({ ok: false, reason: "url_invalid" });
  });

  it("refuses an unknown section", () => {
    const r = normalizeSectionPayload("ACCEPTANCE", {}, current);
    expect(r).toEqual({ ok: false, reason: "section_unsupported" });
  });
});

describe("sectionValues", () => {
  it("reads the current value of every path the section owns", () => {
    expect(sectionValues("IDENTITY", current).name).toBe("Trientes Coin");
    expect(sectionValues("LINKS", current).links).toEqual({ website: "https://trientes.org" });
    expect(sectionValues("CONTRACTS", current).contracts).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- --run tests/coin-card-sections.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/coin-card-sections"`.

- [ ] **Step 3: Создать `src/lib/coin-card-sections.ts`**

```ts
// One normalizer for a section payload, used twice: by the direct write path
// (card still PENDING, slice A1) and by the revision pipeline (card published,
// slice A2). Pure — no Prisma — so a revision can compute "after" long before
// anyone decides to apply it.

import type { CardSection } from "@/lib/coin-card-risk";
import {
  normalizeHttpUrl,
  validateCardBasics,
  validateContract,
  validateTokenomics,
} from "@/lib/coin-card-validate";

export const MAX_CONTRACTS = 20;
export const MAX_MARKETS = 200;
export const MAX_TAGS = 10;

export type ContractRow = {
  chain: string;
  address: string;
  decimals: number | null;
  standard: string | null;
  explorerUrl: string | null;
  isCanonical: boolean;
};

export type MarketRow = {
  kind: "CEX" | "DEX";
  exchangeName: string;
  pair: string;
  tradeUrl: string | null;
  chain: string | null;
  poolAddress: string | null;
};

export type CardStateLike = {
  name: string;
  symbol: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  launchDate: Date | string | null;
  tags: string[];
  links: unknown;
  tokenomics: unknown;
  security: unknown;
  teamInfo: unknown;
  marketing: unknown;
  contracts?: ContractRow[];
  markets?: MarketRow[];
};

export type SectionPatch = {
  /** Scalar / JSON columns of CoinCard to set. */
  card: Record<string, unknown>;
  /** Whole-array replacement for the child table, only for its own section. */
  contracts?: ContractRow[];
  markets?: MarketRow[];
  /** Dotted paths touched — feeds provenance and risk classification. */
  touched: string[];
};

export type NormalizeResult =
  | { ok: true; patch: SectionPatch }
  | { ok: false; reason: string };

/** Which card paths a section owns. Used for diffing and for `sectionValues`. */
export const SECTION_PATHS: Record<CardSection, readonly string[]> = {
  IDENTITY: ["name", "symbol", "tagline", "description", "logoUrl", "tags", "launchDate"],
  CONTRACTS: ["contracts"],
  TOKENOMICS: ["tokenomics"],
  MARKETS: ["markets"],
  SECURITY: ["security"],
  TEAM: ["teamInfo"],
  LINKS: ["links"],
  MARKETING: ["marketing"],
  ACCEPTANCE: [],
};

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

/** Current values of everything the section owns, keyed by path. */
export function sectionValues(
  section: CardSection,
  card: CardStateLike,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of SECTION_PATHS[section]) {
    if (path === "contracts") out.contracts = card.contracts ?? [];
    else if (path === "markets") out.markets = card.markets ?? [];
    else out[path] = (card as unknown as Record<string, unknown>)[path] ?? null;
  }
  return out;
}

export function normalizeSectionPayload(
  section: CardSection,
  payload: Record<string, unknown>,
  current: CardStateLike,
): NormalizeResult {
  if (section === "CONTRACTS") {
    const raw = Array.isArray(payload.contracts) ? payload.contracts : [];
    if (raw.length > MAX_CONTRACTS) return { ok: false, reason: "too_many_contracts" };
    const rows: ContractRow[] = [];
    for (const c of raw) {
      const v = validateContract(c as Record<string, string>);
      if (!v.ok) return { ok: false, reason: v.reason };
      rows.push({
        ...v.data,
        isCanonical: Boolean((c as { isCanonical?: boolean }).isCanonical),
      });
    }
    return { ok: true, patch: { card: {}, contracts: rows, touched: ["contracts"] } };
  }

  if (section === "MARKETS") {
    const raw = Array.isArray(payload.markets) ? payload.markets : [];
    if (raw.length > MAX_MARKETS) return { ok: false, reason: "too_many_markets" };
    const rows: MarketRow[] = [];
    for (const m of raw as Array<Record<string, string>>) {
      const kind = m.kind === "DEX" ? "DEX" : "CEX";
      const exchangeName = (m.exchangeName ?? "").trim();
      const pair = (m.pair ?? "").trim().toUpperCase();
      if (!exchangeName || !pair) return { ok: false, reason: "market_incomplete" };
      const tradeUrl = normalizeHttpUrl(m.tradeUrl);
      if (tradeUrl === "invalid") return { ok: false, reason: "url_invalid" };
      rows.push({
        kind,
        exchangeName,
        pair,
        tradeUrl,
        chain: (m.chain ?? "").trim() || null,
        poolAddress: (m.poolAddress ?? "").trim() || null,
      });
    }
    return { ok: true, patch: { card: {}, markets: rows, touched: ["markets"] } };
  }

  if (section === "TOKENOMICS") {
    const t = asObject(payload.tokenomics);
    const v = validateTokenomics(t as Record<string, number | null>);
    if (!v.ok) return { ok: false, reason: v.reason };
    return {
      ok: true,
      patch: { card: { tokenomics: t }, touched: ["tokenomics"] },
    };
  }

  if (section === "LINKS") {
    const incoming = asObject(payload.links);
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(incoming)) {
      const u = normalizeHttpUrl(val as string);
      if (u === "invalid") return { ok: false, reason: "url_invalid" };
      if (u) out[k] = u;
    }
    if (!out.website) return { ok: false, reason: "website_required" };
    return { ok: true, patch: { card: { links: out }, touched: ["links"] } };
  }

  if (section === "SECURITY") {
    return {
      ok: true,
      patch: { card: { security: asObject(payload.security) }, touched: ["security"] },
    };
  }

  if (section === "TEAM") {
    return {
      ok: true,
      patch: { card: { teamInfo: asObject(payload.teamInfo) }, touched: ["teamInfo"] },
    };
  }

  if (section === "MARKETING") {
    return {
      ok: true,
      patch: { card: { marketing: asObject(payload.marketing) }, touched: ["marketing"] },
    };
  }

  if (section === "IDENTITY") {
    const website = asObject(current.links).website;
    const v = validateCardBasics({
      name: (payload.name as string) ?? current.name,
      symbol: (payload.symbol as string) ?? current.symbol,
      tagline: (payload.tagline as string) ?? current.tagline,
      description: (payload.description as string) ?? current.description,
      website: typeof website === "string" ? website : "https://placeholder.invalid",
    });
    if (!v.ok) return { ok: false, reason: v.reason };

    const card: Record<string, unknown> = {
      name: v.data.name,
      symbol: v.data.symbol,
      tagline: v.data.tagline,
      description: v.data.description,
    };
    const touched = ["name", "symbol", "tagline", "description"];

    if (typeof payload.logoUrl === "string") {
      card.logoUrl = payload.logoUrl;
      touched.push("logoUrl");
    }
    if (Array.isArray(payload.tags)) {
      card.tags = (payload.tags as string[])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, MAX_TAGS);
      touched.push("tags");
    }
    if (typeof payload.launchDate === "string") {
      if (payload.launchDate) {
        const d = new Date(payload.launchDate);
        if (Number.isNaN(d.getTime())) return { ok: false, reason: "date_invalid" };
        card.launchDate = d;
      } else {
        card.launchDate = null;
      }
      touched.push("launchDate");
    }
    return { ok: true, patch: { card, touched } };
  }

  // ACCEPTANCE has no editable fields until slice F wires it to CompanyPoint.
  return { ok: false, reason: "section_unsupported" };
}

/** Flat path → value map of what the patch sets. Feeds buildDiff(). */
export function patchValues(patch: SectionPatch): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch.card };
  if (patch.contracts) out.contracts = patch.contracts;
  if (patch.markets) out.markets = patch.markets;
  return out;
}
```

- [ ] **Step 4: Запустить тест — должен проходить**

Run: `npm test -- --run tests/coin-card-sections.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 5: Перевести `saveCoinCardSection` на новый нормализатор**

В `src/app/actions/coin-card.ts` заменить импорты валидаторов и весь блок
нормализации (строки с `const data: Record<string, unknown> = {}` и далее до
`return { ok: false, reason: "section_unsupported" };`) на вызов нормализатора.
Новое тело функции целиком:

```ts
export async function saveCoinCardSection(input: {
  cardId: string;
  section: CardSection;
  payload: Record<string, unknown>;
}): Promise<SaveResult> {
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
      members: { select: { userId: true, role: true, sections: true } },
    },
  });
  if (!card) return { ok: false, reason: "not_found" };

  const member = card.members.find((m) => m.userId === userId) ?? null;
  const isSiteAdmin = user?.role === "ADMIN";
  if (!canEditCardDirectly(card, member, input.section, isSiteAdmin)) {
    return { ok: false, reason: "forbidden" };
  }

  const norm = normalizeSectionPayload(input.section, input.payload, card);
  if (!norm.ok) return { ok: false, reason: norm.reason };
  const { patch } = norm;

  if (patch.contracts) {
    await prisma.$transaction([
      prisma.coinCardContract.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardContract.createMany({
        data: patch.contracts.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
  }
  if (patch.markets) {
    await prisma.$transaction([
      prisma.coinCardMarket.deleteMany({ where: { cardId: card.id } }),
      prisma.coinCardMarket.createMany({
        data: patch.markets.map((r) => ({ ...r, cardId: card.id })),
        skipDuplicates: true,
      }),
    ]);
  }

  // Child rows live in their own tables, so count them for the score rather
  // than trusting the in-memory payload.
  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: card.id } }),
    prisma.coinCardMarket.count({ where: { cardId: card.id } }),
  ]);
  const forScore = {
    ...(card as Record<string, unknown>),
    ...patch.card,
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  };
  const completeness = computeCompleteness(forScore);
  const missing = missingFields(forScore);

  await prisma.coinCard.update({
    where: { id: card.id },
    data: {
      ...patch.card,
      completeness,
      provenance: markSelfReported(card.provenance, patch.touched, new Date()),
    },
  });

  revalidatePath("/", "layout");
  return { ok: true, completeness, missing };
}
```

Импорты в начале файла привести к:

```ts
import { validateCardBasics } from "@/lib/coin-card-validate";
import { buildSlugCandidates } from "@/lib/coin-card-slug";
import { computeCompleteness, missingFields } from "@/lib/coin-card-completeness";
import { markSelfReported } from "@/lib/coin-card-provenance";
import { canEditCardDirectly } from "@/lib/coin-card-access";
import { normalizeSectionPayload } from "@/lib/coin-card-sections";
import type { CardSection } from "@/lib/coin-card-risk";
```

Константы `MAX_CONTRACTS` / `MAX_MARKETS` из этого файла удалить — они теперь в
`coin-card-sections.ts`. `canEditCardDirectly` появится в Task 5; до него
проект не компилируется — это ожидаемо, задачи 2 и 5 коммитятся вместе, если
исполнитель идёт строго по порядку, то Step 6 этой задачи выполняется после
Task 5.

- [ ] **Step 6: Проверка и коммит (после Task 5)**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: tsc чисто, все тесты зелёные.

```bash
git add src/lib/coin-card-sections.ts tests/coin-card-sections.test.ts src/app/actions/coin-card.ts
git commit -m "refactor(coin-card): единый нормализатор секции для прямой записи и ревизий"
```

---

### Task 3: Движок diff

**Files:**
- Create: `src/lib/coin-card-diff.ts`
- Create: `tests/coin-card-diff.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/coin-card-diff.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildDiff, diffPaths, diffToCardUpdate } from "@/lib/coin-card-diff";

describe("buildDiff", () => {
  it("records only changed paths", () => {
    const d = buildDiff({ name: "A", symbol: "TRI" }, { name: "B", symbol: "TRI" });
    expect(d).toEqual([{ path: "name", before: "A", after: "B" }]);
  });

  it("treats deep-equal objects as unchanged", () => {
    const d = buildDiff(
      { links: { website: "https://a.io", x: "https://x.com/a" } },
      { links: { x: "https://x.com/a", website: "https://a.io" } },
    );
    expect(d).toEqual([]);
  });

  it("compares Date against its ISO string without a false positive", () => {
    const at = new Date("2026-01-02T00:00:00.000Z");
    expect(buildDiff({ launchDate: at }, { launchDate: at.toISOString() })).toEqual([]);
  });

  it("diffs child arrays wholesale", () => {
    const before = { contracts: [{ chain: "ethereum", address: "0xa" }] };
    const after = { contracts: [{ chain: "ethereum", address: "0xb" }] };
    expect(diffPaths(buildDiff(before, after))).toEqual(["contracts"]);
  });

  it("ignores undefined in the after map — the section did not touch it", () => {
    expect(buildDiff({ tagline: "x" }, { tagline: undefined })).toEqual([]);
  });
});

describe("diffToCardUpdate", () => {
  it("splits scalar columns from child tables", () => {
    const u = diffToCardUpdate([
      { path: "name", before: "A", after: "B" },
      { path: "contracts", before: [], after: [{ chain: "ethereum", address: "0xb" }] },
      { path: "markets", before: [], after: [{ kind: "CEX", exchangeName: "X", pair: "TRI/USDT" }] },
    ]);
    expect(u.data).toEqual({ name: "B" });
    expect(u.contracts).toHaveLength(1);
    expect(u.markets).toHaveLength(1);
  });

  it("revives launchDate back into a Date for Prisma", () => {
    const u = diffToCardUpdate([
      { path: "launchDate", before: null, after: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(u.data.launchDate).toBeInstanceOf(Date);
  });

  it("keeps a null launchDate null", () => {
    const u = diffToCardUpdate([{ path: "launchDate", before: "2026-01-02", after: null }]);
    expect(u.data.launchDate).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test -- --run tests/coin-card-diff.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/lib/coin-card-diff.ts`**

```ts
// A revision is a diff, not a form submission: it is stored, shown to signers
// and to a moderator days later, then applied. So the diff must be plain JSON
// and must survive a round trip through the database.

export type DiffEntry = {
  path: string;
  before: unknown;
  after: unknown;
};

/** Dates arrive as Date on the server and as ISO strings out of JSONB. */
function canonical(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Key order must not create a phantom change.
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/**
 * Compares the section's current values against what the normalizer produced.
 * Paths absent from `after` were not touched by this section and never appear
 * in the diff — otherwise every save would claim it cleared the rest.
 */
export function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const [path, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const prev = before[path];
    if (same(prev, next)) continue;
    out.push({ path, before: canonical(prev), after: canonical(next) });
  }
  return out;
}

export function diffPaths(diff: readonly DiffEntry[]): string[] {
  return diff.map((e) => e.path);
}

export type CardUpdate = {
  /** Columns to write on CoinCard. */
  data: Record<string, unknown>;
  /** Present only when the diff replaces the child table. */
  contracts?: Record<string, unknown>[];
  markets?: Record<string, unknown>[];
};

/**
 * Turns a stored diff back into writes. Child tables are replaced wholesale —
 * the diff holds the whole array, which is also what the editor submits.
 */
export function diffToCardUpdate(diff: readonly DiffEntry[]): CardUpdate {
  const out: CardUpdate = { data: {} };
  for (const e of diff) {
    if (e.path === "contracts") {
      out.contracts = (e.after as Record<string, unknown>[]) ?? [];
    } else if (e.path === "markets") {
      out.markets = (e.after as Record<string, unknown>[]) ?? [];
    } else if (e.path === "launchDate") {
      out.data.launchDate = e.after ? new Date(String(e.after)) : null;
    } else {
      out.data[e.path] = e.after;
    }
  }
  return out;
}
```

- [ ] **Step 4: Тест должен проходить**

Run: `npm test -- --run tests/coin-card-diff.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-diff.ts tests/coin-card-diff.test.ts
git commit -m "feat(coin-card): движок diff для ревизий"
```

---

### Task 4: Ядро мультиподписи

**Files:**
- Create: `src/lib/coin-card-multisig.ts`
- Create: `tests/coin-card-multisig.test.ts`

Арифметика отказа выведена, а не назначена: ревизия закрывается ровно тогда,
когда набрать `M` одобрений уже невозможно — `rejects > N - M`. Снимки `M` и `N`
на момент подачи обязательны, иначе смена состава подписантов на ходу меняет
исход уже идущего голосования.

- [ ] **Step 1: Написать падающий тест `tests/coin-card-multisig.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  REVISION_TTL_DAYS,
  policyApplies,
  routeSubmission,
  tally,
  thresholdReachable,
  revisionExpiry,
} from "@/lib/coin-card-multisig";

describe("policyApplies", () => {
  it("is false when multisig is off", () => {
    expect(policyApplies({ multisig: false, threshold: 2, sections: [] }, "MARKETS")).toBe(false);
  });

  it("covers every section when the section list is empty", () => {
    expect(policyApplies({ multisig: true, threshold: 2, sections: [] }, "MARKETS")).toBe(true);
  });

  it("covers only the listed sections otherwise", () => {
    const p = { multisig: true, threshold: 2, sections: ["CONTRACTS" as const] };
    expect(policyApplies(p, "CONTRACTS")).toBe(true);
    expect(policyApplies(p, "MARKETING")).toBe(false);
  });

  it("always applies to a POLICY revision when multisig is on", () => {
    expect(policyApplies({ multisig: true, threshold: 2, sections: ["TEAM"] }, null)).toBe(true);
  });
});

describe("routeSubmission", () => {
  it("applies a low-risk change on a claimed card immediately", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "PROJECT_CLAIMED",
        signerCount: 1,
      }),
    ).toEqual({ status: "APPLIED" });
  });

  it("sends a high-risk change to the moderator even on a claimed card", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "CONTRACTS",
        highRisk: true,
        trust: "FULLY_VERIFIED",
        signerCount: 1,
      }),
    ).toEqual({ status: "PENDING_ADMIN" });
  });

  it("sends everything from an unverified card to the moderator", () => {
    expect(
      routeSubmission({
        policy: { multisig: false, threshold: 1, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "UNVERIFIED",
        signerCount: 1,
      }),
    ).toEqual({ status: "PENDING_ADMIN" });
  });

  it("collects signatures first when the policy applies", () => {
    expect(
      routeSubmission({
        policy: { multisig: true, threshold: 2, sections: [] },
        section: "MARKETING",
        highRisk: false,
        trust: "PROJECT_CLAIMED",
        signerCount: 3,
      }),
    ).toEqual({ status: "PENDING_SIGNERS", thresholdAt: 2, signerCountAt: 3 });
  });

  it("clamps a stale threshold to the live signer count", () => {
    const r = routeSubmission({
      policy: { multisig: true, threshold: 5, sections: [] },
      section: "MARKETING",
      highRisk: false,
      trust: "PROJECT_CLAIMED",
      signerCount: 2,
    });
    expect(r).toEqual({ status: "PENDING_SIGNERS", thresholdAt: 2, signerCountAt: 2 });
  });
});

describe("tally", () => {
  const snap = { thresholdAt: 2, signerCountAt: 3 };

  it("keeps waiting below the threshold", () => {
    expect(tally({ ...snap, approvals: 1, rejections: 0 })).toEqual({ outcome: "WAITING" });
  });

  it("passes at the threshold", () => {
    expect(tally({ ...snap, approvals: 2, rejections: 0 })).toEqual({ outcome: "PASSED" });
  });

  it("fails once the threshold is arithmetically out of reach", () => {
    // 3 signers, 2 needed → 2 rejections leave only 1 possible approval.
    expect(tally({ ...snap, approvals: 0, rejections: 2 })).toEqual({ outcome: "FAILED" });
  });

  it("does not fail while the threshold is still reachable", () => {
    expect(tally({ ...snap, approvals: 0, rejections: 1 })).toEqual({ outcome: "WAITING" });
  });

  it("prefers the pass when both conditions somehow hold", () => {
    expect(tally({ thresholdAt: 1, signerCountAt: 2, approvals: 1, rejections: 2 })).toEqual({
      outcome: "PASSED",
    });
  });
});

describe("thresholdReachable", () => {
  it("rejects a threshold above the signer count", () => {
    expect(thresholdReachable(3, 2)).toBe(false);
  });

  it("rejects a non-positive threshold", () => {
    expect(thresholdReachable(0, 2)).toBe(false);
  });

  it("accepts M <= N", () => {
    expect(thresholdReachable(2, 2)).toBe(true);
  });
});

describe("revisionExpiry", () => {
  it("is REVISION_TTL_DAYS ahead", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const exp = revisionExpiry(now);
    expect((exp.getTime() - now.getTime()) / 86_400_000).toBe(REVISION_TTL_DAYS);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test -- --run tests/coin-card-multisig.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/lib/coin-card-multisig.ts`**

```ts
// Off-chain M-of-N approval over Trientes accounts (wallet-bound signers are
// slice D). Pure arithmetic — no Prisma — so every edge case is unit-tested.

import type { CardSection } from "@/lib/coin-card-risk";

/** A revision nobody signs within two weeks is stale, not pending. */
export const REVISION_TTL_DAYS = 14;

export type PolicyLike = {
  multisig: boolean;
  threshold: number;
  sections: readonly CardSection[];
};

export type CardTrust =
  | "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";

const TRUST_RANK: Record<CardTrust, number> = {
  UNVERIFIED: 0,
  CONTRACT_VERIFIED: 1,
  PROJECT_CLAIMED: 2,
  FULLY_VERIFIED: 3,
};

/** Only a claimed project may publish without a moderator in the loop. */
export function trustSkipsModerator(trust: CardTrust): boolean {
  return TRUST_RANK[trust] >= TRUST_RANK.PROJECT_CLAIMED;
}

/**
 * `section === null` means a POLICY revision — changing the multisig itself.
 * It always goes through the multisig, otherwise an owner disarms it in one
 * click and the whole mechanism is decoration.
 */
export function policyApplies(policy: PolicyLike, section: CardSection | null): boolean {
  if (!policy.multisig) return false;
  if (section === null) return true;
  if (policy.sections.length === 0) return true;
  return policy.sections.includes(section);
}

export type SubmissionRoute =
  | { status: "APPLIED" }
  | { status: "PENDING_ADMIN" }
  | { status: "PENDING_SIGNERS"; thresholdAt: number; signerCountAt: number };

/**
 * Where a freshly submitted revision lands. Signatures come first; the
 * moderator question is asked again after the threshold is met.
 */
export function routeSubmission(input: {
  policy: PolicyLike;
  section: CardSection | null;
  highRisk: boolean;
  trust: CardTrust;
  signerCount: number;
}): SubmissionRoute {
  if (policyApplies(input.policy, input.section)) {
    // Clamp: a signer may have left after the threshold was set. Never demand
    // more signatures than there are signers, or the revision can never pass.
    const thresholdAt = Math.max(1, Math.min(input.policy.threshold, input.signerCount));
    return { status: "PENDING_SIGNERS", thresholdAt, signerCountAt: input.signerCount };
  }
  return routeAfterSigners(input.highRisk, input.trust);
}

/** The moderator test, applied both at submit time and after the threshold. */
export function routeAfterSigners(
  highRisk: boolean,
  trust: CardTrust,
): { status: "APPLIED" } | { status: "PENDING_ADMIN" } {
  if (highRisk) return { status: "PENDING_ADMIN" };
  if (!trustSkipsModerator(trust)) return { status: "PENDING_ADMIN" };
  return { status: "APPLIED" };
}

export type TallyOutcome = "WAITING" | "PASSED" | "FAILED";

/**
 * Uses the snapshots taken at submit time, never the live signer set: moving
 * people in and out of the signer group must not change a vote in flight.
 * FAILED is arithmetic, not a veto right — the threshold became unreachable.
 */
export function tally(input: {
  thresholdAt: number;
  signerCountAt: number;
  approvals: number;
  rejections: number;
}): { outcome: TallyOutcome } {
  if (input.approvals >= input.thresholdAt) return { outcome: "PASSED" };
  const maxPossible = input.signerCountAt - input.rejections;
  if (maxPossible < input.thresholdAt) return { outcome: "FAILED" };
  return { outcome: "WAITING" };
}

/** 1 <= M <= N. Explicit refusal beats silently lowering someone's threshold. */
export function thresholdReachable(threshold: number, signerCount: number): boolean {
  return Number.isInteger(threshold) && threshold >= 1 && threshold <= signerCount;
}

export function revisionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REVISION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 4: Тест должен проходить**

Run: `npm test -- --run tests/coin-card-multisig.test.ts`
Expected: PASS (17 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/lib/coin-card-multisig.ts tests/coin-card-multisig.test.ts
git commit -m "feat(coin-card): ядро мультиподписи — маршрутизация, подсчёт, пороги"
```

---

### Task 5: Гейты доступа карточки

**Files:**
- Modify: `src/lib/coin-card-access.ts`
- Modify: `tests/coin-card-access.test.ts`

`canEditSection` / `canManageMembers` / `canManagePolicy` уже есть в A1 и не
меняются. Добавляются: `canEditCardDirectly` (заменяет `canEditCardNow`,
который знал только куратора), `canAssignRole`, `canVote` и две асинхронные
выборки для страниц кабинета.

- [ ] **Step 1: Дописать тесты в `tests/coin-card-access.test.ts`**

Добавить в конец файла:

```ts
import { canEditCardDirectly, canAssignRole, canVote } from "@/lib/coin-card-access";

describe("canEditCardDirectly", () => {
  const pending = { status: "PENDING" as const, stewardUserId: "u1" };
  const approved = { status: "APPROVED" as const, stewardUserId: "u1" };
  const owner = { role: "OWNER" as const, sections: [] };

  it("lets an owner write straight to a card that is not public yet", () => {
    expect(canEditCardDirectly(pending, owner, "CONTRACTS", false)).toBe(true);
  });

  it("lets a rejected card be fixed in place", () => {
    expect(
      canEditCardDirectly({ status: "REJECTED", stewardUserId: "u1" }, owner, "IDENTITY", false),
    ).toBe(true);
  });

  it("closes direct writes once the card is published — revisions only", () => {
    expect(canEditCardDirectly(approved, owner, "CONTRACTS", false)).toBe(false);
  });

  it("still lets a site admin write to a published card", () => {
    expect(canEditCardDirectly(approved, null, "CONTRACTS", true)).toBe(true);
  });

  it("respects section grants for an EDITOR", () => {
    const m = { role: "EDITOR" as const, sections: ["MARKETS" as const] };
    expect(canEditCardDirectly(pending, m, "MARKETS", false)).toBe(true);
    expect(canEditCardDirectly(pending, m, "CONTRACTS", false)).toBe(false);
  });

  it("denies a stranger", () => {
    expect(canEditCardDirectly(pending, null, "IDENTITY", false)).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("lets an OWNER hand out any role", () => {
    expect(canAssignRole({ role: "OWNER", sections: [] }, "OWNER")).toBe(true);
    expect(canAssignRole({ role: "OWNER", sections: [] }, "VIEWER")).toBe(true);
  });

  it("stops an ADMIN from minting or touching an OWNER", () => {
    expect(canAssignRole({ role: "ADMIN", sections: [] }, "OWNER")).toBe(false);
    expect(canAssignRole({ role: "ADMIN", sections: [] }, "EDITOR")).toBe(true);
  });

  it("denies EDITOR and VIEWER entirely", () => {
    expect(canAssignRole({ role: "EDITOR", sections: [] }, "VIEWER")).toBe(false);
    expect(canAssignRole({ role: "VIEWER", sections: [] }, "VIEWER")).toBe(false);
  });
});

describe("canVote", () => {
  it("is exactly the signer flag", () => {
    expect(canVote({ role: "VIEWER", sections: [], isSigner: true })).toBe(true);
    expect(canVote({ role: "OWNER", sections: [], isSigner: false })).toBe(false);
    expect(canVote(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — упадёт на отсутствующих экспортах**

Run: `npm test -- --run tests/coin-card-access.test.ts`
Expected: FAIL — `canEditCardDirectly is not a function`.

- [ ] **Step 3: Дописать `src/lib/coin-card-access.ts`**

Удалить функцию `canEditCardNow` (её заменяет `canEditCardDirectly`) и
дописать в конец файла:

```ts
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export type SignerLike = MemberLike & { isSigner: boolean };

/** Only a signer votes. Role is irrelevant — a VIEWER lawyer can be a signer. */
export function canVote(member: SignerLike | null | undefined): boolean {
  return Boolean(member?.isSigner);
}

/**
 * An ADMIN runs the team but may neither create, change nor remove an OWNER —
 * otherwise "admin" is a silent path to taking the card over.
 */
export function canAssignRole(
  actor: MemberLike | null | undefined,
  targetRole: CardRole,
): boolean {
  if (!actor) return false;
  if (actor.role === "OWNER") return true;
  if (actor.role === "ADMIN") return targetRole !== "OWNER";
  return false;
}

/**
 * Direct writes to the card are allowed only before it goes public. Once
 * APPROVED, every change must become a reviewable revision — that is the whole
 * point of the pipeline. Site admins bypass it (they are the review).
 */
export function canEditCardDirectly(
  card: CardLike,
  member: MemberLike | null | undefined,
  section: CardSection,
  isSiteAdmin: boolean,
): boolean {
  if (isSiteAdmin) return true;
  if (card.status === "APPROVED") return false;
  return canEditSection(member, section);
}

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string } | undefined)?.id ?? null;
}

/** Every card the viewer is a member of — the cabinet list. */
export async function listViewerCards() {
  const userId = await viewerId();
  if (!userId) return { userId: null as string | null, cards: [] };
  const cards = await prisma.coinCard.findMany({
    where: { members: { some: { userId } } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, slug: true, name: true, symbol: true, logoUrl: true,
      status: true, trust: true, completeness: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  return { userId, cards };
}

export type ViewerCardResult = {
  userId: string | null;
  card: Awaited<ReturnType<typeof loadCardForMember>> | null;
  member: { id: string; role: CardRole; sections: CardSection[]; isSigner: boolean } | null;
};

function loadCardForMember(cardId: string) {
  return prisma.coinCard.findUnique({
    where: { id: cardId },
    include: {
      contracts: { orderBy: [{ isCanonical: "desc" }, { chain: "asc" }] },
      markets: { orderBy: { exchangeName: "asc" } },
      policy: true,
    },
  });
}

/** The card plus the viewer's membership, or nulls. Mirrors getViewerCompanyById. */
export async function getViewerCard(cardId: string): Promise<ViewerCardResult> {
  const userId = await viewerId();
  if (!userId) return { userId: null, card: null, member: null };
  const [card, member] = await Promise.all([
    loadCardForMember(cardId),
    prisma.coinCardMember.findUnique({
      where: { cardId_userId: { cardId, userId } },
      select: { id: true, role: true, sections: true, isSigner: true },
    }),
  ]);
  if (!card || !member) return { userId, card: null, member: null };
  return { userId, card, member };
}
```

- [ ] **Step 4: Тесты должны пройти**

Run: `npm test -- --run tests/coin-card-access.test.ts`
Expected: PASS. Если vitest ругается на импорт `@/auth` внутри теста —
функции `getViewerCard`/`listViewerCards` в тестах не вызываются, но импорт
модуля подтянет `@/auth`. Если это сломает тест, перенести обе async-функции
в отдельный файл `src/lib/coin-card-cards.ts` и в тесте импортировать только
чистые гейты. Проверить фактическим запуском, не угадывать.

- [ ] **Step 5: Запустить всё и закоммитить вместе с Task 2 Step 5**

Run: `npx tsc --noEmit && npm test -- --run`
Expected: чисто.

```bash
git add src/lib/coin-card-access.ts tests/coin-card-access.test.ts
git commit -m "feat(coin-card): права участника — прямая запись, роли, подписанты"
```

---

### Task 6: Серверные действия ревизий

**Files:**
- Create: `src/app/actions/coin-card-revisions.ts`

Коды ошибок — в едином стиле со спекой: `unauth`, `forbidden`, `not_found`,
`no_changes`, `revision_closed`, `not_a_signer`, `already_voted`.

- [ ] **Step 1: Создать `src/app/actions/coin-card-revisions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { CoinCardRevisionStatus } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getViewerCard, canEditSection, canVote } from "@/lib/coin-card-access";
import { normalizeSectionPayload, patchValues, sectionValues } from "@/lib/coin-card-sections";
import { buildDiff, diffPaths, diffToCardUpdate, type DiffEntry } from "@/lib/coin-card-diff";
import { diffNeedsModerator, isHighRiskSection, type CardSection } from "@/lib/coin-card-risk";
import {
  routeSubmission,
  routeAfterSigners,
  revisionExpiry,
  tally,
  type CardTrust,
} from "@/lib/coin-card-multisig";
import { markSelfReported } from "@/lib/coin-card-provenance";
import { computeCompleteness } from "@/lib/coin-card-completeness";
import { notifyUser } from "@/lib/notify";

export type RevisionResult =
  | { ok: true; revisionId: string; status: CoinCardRevisionStatus }
  | { ok: false; reason: string };

/**
 * Applies a revision's diff to the card inside one transaction and marks the
 * touched paths in the provenance map. Shared by the three ways a revision can
 * land: straight through, after signatures, and by a moderator.
 */
export async function applyRevisionNow(revisionId: string, by: "team" | "admin") {
  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, diff: true, kind: true },
  });
  if (!rev) return;
  const diff = (rev.diff as unknown as DiffEntry[]) ?? [];
  const update = diffToCardUpdate(diff);

  const card = await prisma.coinCard.findUnique({
    where: { id: rev.cardId },
    select: {
      name: true, symbol: true, tagline: true, description: true, logoUrl: true,
      launchDate: true, tags: true, links: true, tokenomics: true, security: true,
      teamInfo: true, marketing: true, provenance: true,
    },
  });
  if (!card) return;

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  if (update.contracts) {
    writes.push(prisma.coinCardContract.deleteMany({ where: { cardId: rev.cardId } }));
    writes.push(
      prisma.coinCardContract.createMany({
        data: update.contracts.map((r) => ({ ...r, cardId: rev.cardId })) as never,
        skipDuplicates: true,
      }),
    );
  }
  if (update.markets) {
    writes.push(prisma.coinCardMarket.deleteMany({ where: { cardId: rev.cardId } }));
    writes.push(
      prisma.coinCardMarket.createMany({
        data: update.markets.map((r) => ({ ...r, cardId: rev.cardId })) as never,
        skipDuplicates: true,
      }),
    );
  }
  if (writes.length) await prisma.$transaction(writes);

  const [contracts, markets] = await Promise.all([
    prisma.coinCardContract.count({ where: { cardId: rev.cardId } }),
    prisma.coinCardMarket.count({ where: { cardId: rev.cardId } }),
  ]);
  const completeness = computeCompleteness({
    ...(card as Record<string, unknown>),
    ...update.data,
    contracts: new Array(contracts).fill(null),
    markets: new Array(markets).fill(null),
  });

  await prisma.$transaction([
    prisma.coinCard.update({
      where: { id: rev.cardId },
      data: {
        ...update.data,
        completeness,
        // A moderator approving a project's own numbers does not make them
        // verified — the source is still the project.
        provenance: markSelfReported(card.provenance, diffPaths(diff), new Date()),
      },
    }),
    prisma.coinCardRevision.update({
      where: { id: rev.id },
      data: { status: "APPLIED", appliedAt: new Date(), decidedAt: new Date() },
    }),
  ]);
  void by;
  revalidatePath("/", "layout");
}

/**
 * The single entry point for changing a published card. Builds the diff,
 * classifies the risk, then routes: straight to APPLIED, to the signers, or to
 * the moderator.
 */
export async function submitSectionRevision(input: {
  cardId: string;
  section: CardSection;
  payload: Record<string, unknown>;
}): Promise<RevisionResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canEditSection(member, input.section)) return { ok: false, reason: "forbidden" };

  const state = {
    name: card.name, symbol: card.symbol, tagline: card.tagline,
    description: card.description, logoUrl: card.logoUrl, launchDate: card.launchDate,
    tags: card.tags, links: card.links, tokenomics: card.tokenomics,
    security: card.security, teamInfo: card.teamInfo, marketing: card.marketing,
    contracts: card.contracts.map((c) => ({
      chain: c.chain, address: c.address, decimals: c.decimals,
      standard: c.standard, explorerUrl: c.explorerUrl, isCanonical: c.isCanonical,
    })),
    markets: card.markets.map((m) => ({
      kind: m.kind as "CEX" | "DEX", exchangeName: m.exchangeName, pair: m.pair,
      tradeUrl: m.tradeUrl, chain: m.chain, poolAddress: m.poolAddress,
    })),
  };

  const norm = normalizeSectionPayload(input.section, input.payload, state);
  if (!norm.ok) return { ok: false, reason: norm.reason };

  const diff = buildDiff(sectionValues(input.section, state), patchValues(norm.patch));
  if (diff.length === 0) return { ok: false, reason: "no_changes" };

  const highRisk = isHighRiskSection(input.section) || diffNeedsModerator(diffPaths(diff));
  const policy = card.policy ?? { multisig: false, threshold: 1, sections: [] };
  const signerCount = await prisma.coinCardMember.count({
    where: { cardId: card.id, isSigner: true },
  });

  const route = routeSubmission({
    policy: { multisig: policy.multisig, threshold: policy.threshold, sections: policy.sections },
    section: input.section,
    highRisk,
    trust: card.trust as CardTrust,
    signerCount,
  });

  const revision = await prisma.coinCardRevision.create({
    data: {
      cardId: card.id,
      kind: "CONTENT",
      section: input.section,
      authorId: userId,
      status: route.status === "APPLIED" ? "PENDING_ADMIN" : route.status,
      highRisk,
      diff: diff as unknown as Prisma.InputJsonValue,
      thresholdAt: route.status === "PENDING_SIGNERS" ? route.thresholdAt : null,
      signerCountAt: route.status === "PENDING_SIGNERS" ? route.signerCountAt : null,
      expiresAt: route.status === "PENDING_SIGNERS" ? revisionExpiry() : null,
      // The author's own signature counts — asking someone to approve their own
      // edit is theatre.
      approvals:
        route.status === "PENDING_SIGNERS" && member.isSigner
          ? { create: { memberId: member.id, decision: "APPROVE" } }
          : undefined,
    },
    select: { id: true, status: true },
  });

  if (route.status === "APPLIED") {
    await applyRevisionNow(revision.id, "team");
    return { ok: true, revisionId: revision.id, status: "APPLIED" };
  }

  if (route.status === "PENDING_SIGNERS") {
    // One signer and that signer is the author → the threshold is already met.
    if (member.isSigner && route.thresholdAt <= 1) {
      return finishAfterSigners(revision.id, card.id, highRisk, card.trust as CardTrust);
    }
    await notifySigners(card.id, card.name, userId);
    return { ok: true, revisionId: revision.id, status: "PENDING_SIGNERS" };
  }

  return { ok: true, revisionId: revision.id, status: "PENDING_ADMIN" };
}

/** Threshold met: either publish or hand the diff to the moderator. */
async function finishAfterSigners(
  revisionId: string,
  cardId: string,
  highRisk: boolean,
  trust: CardTrust,
): Promise<RevisionResult> {
  const next = routeAfterSigners(highRisk, trust);
  if (next.status === "APPLIED") {
    await applyRevisionNow(revisionId, "team");
    return { ok: true, revisionId, status: "APPLIED" };
  }
  await prisma.coinCardRevision.update({
    where: { id: revisionId },
    data: { status: "PENDING_ADMIN" },
  });
  void cardId;
  revalidatePath("/", "layout");
  return { ok: true, revisionId, status: "PENDING_ADMIN" };
}

async function notifySigners(cardId: string, cardName: string, exceptUserId: string) {
  const signers = await prisma.coinCardMember.findMany({
    where: { cardId, isSigner: true },
    select: { userId: true },
  });
  for (const s of signers) {
    if (s.userId === exceptUserId) continue;
    void notifyUser({
      userId: s.userId,
      text: `✍️ A change to "${cardName}" on Trientes needs your signature.`,
      subject: `Signature needed for ${cardName}`,
    }).catch(() => {});
  }
}

export async function voteOnRevision(input: {
  revisionId: string;
  decision: "APPROVE" | "REJECT";
  comment?: string;
}): Promise<RevisionResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: input.revisionId },
    select: {
      id: true, cardId: true, status: true, highRisk: true, authorId: true,
      thresholdAt: true, signerCountAt: true,
      card: { select: { trust: true, name: true } },
    },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_SIGNERS") return { ok: false, reason: "revision_closed" };

  const member = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: rev.cardId, userId } },
    select: { id: true, role: true, sections: true, isSigner: true },
  });
  if (!canVote(member)) return { ok: false, reason: "not_a_signer" };

  try {
    await prisma.coinCardApproval.create({
      data: {
        revisionId: rev.id,
        memberId: member!.id,
        decision: input.decision,
        comment: (input.comment ?? "").trim() || null,
      },
    });
  } catch (e) {
    const dup =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
    if (dup) return { ok: false, reason: "already_voted" };
    throw e;
  }

  const [approvals, rejections] = await Promise.all([
    prisma.coinCardApproval.count({ where: { revisionId: rev.id, decision: "APPROVE" } }),
    prisma.coinCardApproval.count({ where: { revisionId: rev.id, decision: "REJECT" } }),
  ]);
  const t = tally({
    thresholdAt: rev.thresholdAt ?? 1,
    signerCountAt: rev.signerCountAt ?? 1,
    approvals,
    rejections,
  });

  if (t.outcome === "PASSED") {
    const r = await finishAfterSigners(
      rev.id,
      rev.cardId,
      rev.highRisk,
      rev.card.trust as CardTrust,
    );
    void notifyUser({
      userId: rev.authorId,
      text: `✅ Your change to "${rev.card.name}" collected enough signatures.`,
      subject: `Signatures collected for ${rev.card.name}`,
    }).catch(() => {});
    return r;
  }

  if (t.outcome === "FAILED") {
    await prisma.coinCardRevision.update({
      where: { id: rev.id },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    void notifyUser({
      userId: rev.authorId,
      text: `❌ Your change to "${rev.card.name}" cannot reach the signature threshold and was closed.`,
      subject: `Change to ${rev.card.name} declined`,
    }).catch(() => {});
    revalidatePath("/", "layout");
    return { ok: true, revisionId: rev.id, status: "REJECTED" };
  }

  revalidatePath("/", "layout");
  return { ok: true, revisionId: rev.id, status: "PENDING_SIGNERS" };
}

/** The author pulls their own revision back while it is still open. */
export async function withdrawRevision(input: {
  revisionId: string;
}): Promise<RevisionResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false, reason: "unauth" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: input.revisionId },
    select: { id: true, authorId: true, status: true },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.authorId !== userId) return { ok: false, reason: "forbidden" };
  if (rev.status !== "PENDING_SIGNERS" && rev.status !== "PENDING_ADMIN") {
    return { ok: false, reason: "revision_closed" };
  }

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  revalidatePath("/", "layout");
  return { ok: true, revisionId: rev.id, status: "WITHDRAWN" };
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit`
Expected: чисто. Если Prisma ругается на тип `data` в `createMany` — оставить
приведение `as never`, оно там именно для этого (строки собраны из JSONB).

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/coin-card-revisions.ts
git commit -m "feat(coin-card): конвейер ревизий — подача, подписи, отзыв"
```

---

### Task 7: Участники карточки

**Files:**
- Create: `src/app/actions/coin-card-members.ts`

Гарантии, которые обязаны соблюдаться (взяты из спеки и из `company-members.ts`):
последнего `OWNER` нельзя понизить или удалить (`last_owner`); `ADMIN` не трогает
`OWNER` (`forbidden`); `sections` обнуляются для не-`EDITOR`; снятие флага
подписанта, после которого `N < threshold`, блокируется (`threshold_unreachable`).

- [ ] **Step 1: Создать `src/app/actions/coin-card-members.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getViewerCard, canManageMembers, canAssignRole } from "@/lib/coin-card-access";
import { notifyUser } from "@/lib/notify";

const ROLES: CoinCardRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export type MemberResult = { ok: true } | { ok: false; reason: string };

/** Section grants only mean anything for an EDITOR; stale grants are a trap. */
function normalizeSections(role: CoinCardRole, sections: CoinCardSection[]): CoinCardSection[] {
  return role === "EDITOR" ? Array.from(new Set(sections)) : [];
}

async function ownerCount(cardId: string): Promise<number> {
  return prisma.coinCardMember.count({ where: { cardId, role: "OWNER" } });
}

/**
 * Would the card still have enough signers for its own threshold? An explicit
 * refusal beats silently lowering someone's multisig threshold.
 */
async function signersWouldHold(cardId: string, delta: number): Promise<boolean> {
  const policy = await prisma.coinCardPolicy.findUnique({ where: { cardId } });
  if (!policy?.multisig) return true;
  const signers = await prisma.coinCardMember.count({ where: { cardId, isSigner: true } });
  return signers + delta >= policy.threshold;
}

async function findUserByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  if (!id) return null;
  if (id.includes("@")) {
    return prisma.user.findUnique({ where: { email: id }, select: { id: true } });
  }
  return prisma.user.findUnique({ where: { username: id }, select: { id: true } });
}

export async function inviteCardMember(input: {
  cardId: string;
  identifier: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}): Promise<MemberResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!ROLES.includes(input.role)) return { ok: false, reason: "invalid" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };
  if (!canAssignRole(member, input.role)) return { ok: false, reason: "forbidden" };
  // Only an OWNER hands out signing rights — they are the multisig.
  if (input.isSigner && member.role !== "OWNER") return { ok: false, reason: "forbidden" };

  const target = await findUserByIdentifier(input.identifier);
  if (!target) return { ok: false, reason: "user_not_found" };
  if (target.id === userId) return { ok: false, reason: "self" };

  const existing = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    select: { role: true },
  });
  // An ADMIN must not be able to overwrite an OWNER's membership.
  if (existing && !canAssignRole(member, existing.role)) {
    return { ok: false, reason: "forbidden" };
  }

  await prisma.coinCardMember.upsert({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    create: {
      cardId: card.id,
      userId: target.id,
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: Boolean(input.isSigner),
      invitedById: userId,
    },
    update: {
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: Boolean(input.isSigner),
    },
  });

  void notifyUser({
    userId: target.id,
    text: `🪙 You were added to the "${card.name}" coin card on Trientes as ${input.role}.`,
    subject: `Added to ${card.name} on Trientes`,
  }).catch(() => {});

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateCardMember(input: {
  cardId: string;
  userId: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}): Promise<MemberResult> {
  const { userId: actorId, card, member } = await getViewerCard(input.cardId);
  if (!actorId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!ROLES.includes(input.role)) return { ok: false, reason: "invalid" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };

  const target = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    select: { role: true, isSigner: true },
  });
  if (!target) return { ok: false, reason: "not_found" };
  if (!canAssignRole(member, target.role)) return { ok: false, reason: "forbidden" };
  if (!canAssignRole(member, input.role)) return { ok: false, reason: "forbidden" };
  if (input.isSigner !== target.isSigner && member.role !== "OWNER") {
    return { ok: false, reason: "forbidden" };
  }

  // The card must never be left without an owner.
  if (target.role === "OWNER" && input.role !== "OWNER" && (await ownerCount(card.id)) <= 1) {
    return { ok: false, reason: "last_owner" };
  }
  if (target.isSigner && input.isSigner === false && !(await signersWouldHold(card.id, -1))) {
    return { ok: false, reason: "threshold_unreachable" };
  }

  await prisma.coinCardMember.update({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    data: {
      role: input.role,
      sections: normalizeSections(input.role, input.sections ?? []),
      isSigner: input.isSigner ?? target.isSigner,
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeCardMember(input: {
  cardId: string;
  userId: string;
}): Promise<MemberResult> {
  const { userId: actorId, card, member } = await getViewerCard(input.cardId);
  if (!actorId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canManageMembers(member)) return { ok: false, reason: "forbidden" };

  const target = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
    select: { role: true, isSigner: true },
  });
  if (!target) return { ok: false, reason: "not_found" };
  if (!canAssignRole(member, target.role)) return { ok: false, reason: "forbidden" };
  if (target.role === "OWNER" && (await ownerCount(card.id)) <= 1) {
    return { ok: false, reason: "last_owner" };
  }
  if (target.isSigner && !(await signersWouldHold(card.id, -1))) {
    return { ok: false, reason: "threshold_unreachable" };
  }

  await prisma.coinCardMember.delete({
    where: { cardId_userId: { cardId: card.id, userId: input.userId } },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Проверить типы и закоммитить**

Run: `npx tsc --noEmit`
Expected: чисто.

```bash
git add src/app/actions/coin-card-members.ts
git commit -m "feat(coin-card): участники карточки — роли, разделы, подписанты"
```

---

### Task 8: Ссылки-приглашения в команду карточки

**Files:**
- Create: `src/lib/coin-card-invites.ts`
- Create: `src/app/actions/coin-card-invites.ts`
- Create: `src/app/[locale]/invite/coin/[token]/page.tsx`
- Create: `src/components/coin-card-manage/accept-invite-button.tsx`

Маршрут `/{locale}/invite/coin/[token]` не конфликтует с существующим
`/{locale}/invite/[token]`: у них разная глубина сегментов. Токены лежат в
разных таблицах, поэтому одна ссылка никогда не попадёт не в тот обработчик.

- [ ] **Step 1: Создать `src/lib/coin-card-invites.ts`**

```ts
// Invite links for coin card teams. The token lifecycle is shared with company
// invites (src/lib/invite-tokens.ts); only the URL shape and the carried
// permissions differ — a card invite also carries sections and the signer flag.

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";
export type { InviteState, InviteLifecycle } from "@/lib/invite-tokens";

export function buildCardInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/invite/coin/${token}`;
}
```

- [ ] **Step 2: Создать `src/app/actions/coin-card-invites.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getViewerCard, canManageMembers, canAssignRole } from "@/lib/coin-card-access";
import {
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
} from "@/lib/coin-card-invites";
import { notifyUser } from "@/lib/notify";

const ROLES: CoinCardRole[] = ["OWNER", "ADMIN", "EDITOR", "VIEWER"];

export async function createCardInvite(input: {
  cardId: string;
  role: CoinCardRole;
  sections?: CoinCardSection[];
  isSigner?: boolean;
}) {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!card || !member) return { ok: false as const, reason: "not_found" as const };
  if (!ROLES.includes(input.role)) return { ok: false as const, reason: "invalid" as const };
  if (!canManageMembers(member)) return { ok: false as const, reason: "forbidden" as const };
  if (!canAssignRole(member, input.role)) return { ok: false as const, reason: "forbidden" as const };
  if (input.isSigner && member.role !== "OWNER") {
    return { ok: false as const, reason: "forbidden" as const };
  }

  const active = await prisma.coinCardInvite.count({
    where: {
      cardId: card.id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (active >= MAX_ACTIVE_INVITES) return { ok: false as const, reason: "too_many" as const };

  const invite = await prisma.coinCardInvite.create({
    data: {
      cardId: card.id,
      role: input.role,
      sections: input.role === "EDITOR" ? Array.from(new Set(input.sections ?? [])) : [],
      isSigner: Boolean(input.isSigner),
      token: generateInviteToken(),
      createdById: userId,
      expiresAt: inviteExpiry(),
    },
    select: { id: true, token: true, expiresAt: true, role: true },
  });
  revalidatePath("/", "layout");
  return { ok: true as const, ...invite };
}

export async function revokeCardInvite(input: { cardId: string; inviteId: string }) {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false as const, reason: "unauth" as const };
  if (!card || !member) return { ok: false as const, reason: "not_found" as const };
  if (!canManageMembers(member)) return { ok: false as const, reason: "forbidden" as const };

  // Scoped by cardId so a manager of card A cannot revoke B's links; guarded on
  // acceptedAt so an already-used link stays in its final state.
  const r = await prisma.coinCardInvite.updateMany({
    where: { id: input.inviteId, cardId: card.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (r.count === 0) return { ok: false as const, reason: "invalid" as const };
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function acceptCardInvite(input: { token: string }) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { ok: false as const, reason: "unauth" as const };

  const invite = await prisma.coinCardInvite.findUnique({
    where: { token: input.token },
    select: {
      id: true, cardId: true, role: true, sections: true, isSigner: true,
      expiresAt: true, acceptedAt: true, revokedAt: true,
      card: { select: { name: true } },
    },
  });
  if (!invite) return { ok: false as const, reason: "invalid" as const };

  const state = inviteState(invite);
  if (state !== "valid") return { ok: false as const, reason: state, cardId: invite.cardId };

  // Already on the team: don't burn the link and never downgrade an existing role.
  const existing = await prisma.coinCardMember.findUnique({
    where: { cardId_userId: { cardId: invite.cardId, userId } },
    select: { id: true },
  });
  if (existing) return { ok: true as const, cardId: invite.cardId, already: true };

  // Single-use: the conditional update is the lock. Two people opening the same
  // link at once → only one update touches a row.
  const claimed = await prisma.coinCardInvite.updateMany({
    where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date(), acceptedById: userId },
  });
  if (claimed.count === 0) {
    return { ok: false as const, reason: "accepted" as const, cardId: invite.cardId };
  }

  await prisma.coinCardMember.create({
    data: {
      cardId: invite.cardId,
      userId,
      role: invite.role,
      sections: invite.role === "EDITOR" ? invite.sections : [],
      isSigner: invite.isSigner,
      invitedById: null,
    },
  });

  const [joiner, owners] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } }),
    prisma.coinCardMember.findMany({
      where: { cardId: invite.cardId, role: "OWNER" },
      select: { userId: true },
    }),
  ]);
  const who = joiner?.username ?? joiner?.email ?? userId.slice(0, 6);
  for (const o of owners) {
    if (o.userId === userId) continue;
    void notifyUser({
      userId: o.userId,
      text: `🪙 ${who} joined the "${invite.card.name}" coin card team as ${invite.role}.`,
      subject: `New teammate on ${invite.card.name}`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true as const, cardId: invite.cardId, already: false };
}
```

- [ ] **Step 3: Создать `src/components/coin-card-manage/accept-invite-button.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { acceptCardInvite } from "@/app/actions/coin-card-invites";

export function AcceptCardInviteButton({
  token,
  locale,
}: {
  token: string;
  locale: string;
}) {
  const t = useTranslations("inviteCoin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            const r = await acceptCardInvite({ token });
            if (r.ok) router.push(`/${locale}/cabinet/coins/${r.cardId}`);
            else setError(r.reason);
          });
        }}
        className="px-5 py-2.5 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("joining") : t("join")}
      </button>
      {error ? <p className="text-red-500 text-xs mt-3">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Создать `src/app/[locale]/invite/coin/[token]/page.tsx`**

```tsx
import Link from "next/link";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { inviteState } from "@/lib/coin-card-invites";
import { AcceptCardInviteButton } from "@/components/coin-card-manage/accept-invite-button";

export const dynamic = "force-dynamic";

export default async function CoinCardInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("inviteCoin");
  const tr = await getTranslations("coinCard.team");

  const invite = await prisma.coinCardInvite.findUnique({
    where: { token },
    select: {
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      card: { select: { name: true, symbol: true } },
    },
  });

  const state = invite ? inviteState(invite) : "invalid";
  const session = await auth();
  const signedIn = Boolean((session?.user as { id?: string } | undefined)?.id);
  const next = `/${locale}/invite/coin/${token}`;

  return (
    <main className="max-w-md mx-auto px-6 py-10 md:py-24">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-accent mb-4">● {t("kicker")}</div>
      <h1 className="text-[32px] md:text-[44px] font-bold tracking-[-0.03em] mb-2">
        {invite ? t("title", { coin: invite.card.name }) : t("titleInvalid")}
      </h1>

      {state !== "valid" || !invite ? (
        <>
          <p className="text-muted mb-8">{t(`state.${state}`)}</p>
          <Link href={`/${locale}`} className="text-accent text-sm font-medium">
            {t("backHome")}
          </Link>
        </>
      ) : (
        <>
          <p className="text-muted mb-8">{t("roleLine", { role: tr(`role.${invite.role}`) })}</p>
          <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
            {signedIn ? (
              <AcceptCardInviteButton token={token} locale={locale} />
            ) : (
              <>
                <p className="text-sm text-muted mb-4">{t("signInFirst")}</p>
                <div className="flex gap-3 flex-wrap">
                  <Link
                    href={`/${locale}/login?next=${encodeURIComponent(next)}`}
                    className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium"
                  >
                    {t("signIn")}
                  </Link>
                  <Link
                    href={`/${locale}/register?next=${encodeURIComponent(next)}`}
                    className="px-4 py-2 rounded-md border border-hairline text-sm font-medium"
                  >
                    {t("register")}
                  </Link>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Проверить типы и закоммитить**

Run: `npx tsc --noEmit`
Expected: чисто (ключи i18n появятся в Task 14 — tsc их не проверяет).

```bash
git add src/lib/coin-card-invites.ts src/app/actions/coin-card-invites.ts \
  src/app/\[locale\]/invite/coin src/components/coin-card-manage/accept-invite-button.tsx
git commit -m "feat(coin-card): ссылки-приглашения в команду карточки"
```

---

### Task 9: Политика мультисига

**Files:**
- Create: `src/app/actions/coin-card-policy.ts`

Ключевое правило спеки: при **включённом** мультисиге изменение самой политики
само проходит через мультисиг (ревизия `kind = POLICY`, `section = null`,
`highRisk = true`), и такая ревизия применяется **без модератора сайта** — это
внутреннее дело команды. Включение мультисига с нуля — обычное действие
владельца: обходить ещё нечего.

- [ ] **Step 1: Создать `src/app/actions/coin-card-policy.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { CoinCardSection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getViewerCard, canManagePolicy } from "@/lib/coin-card-access";
import { policyApplies, thresholdReachable, revisionExpiry } from "@/lib/coin-card-multisig";
import { buildDiff } from "@/lib/coin-card-diff";
import { notifyUser } from "@/lib/notify";

export type PolicyResult =
  | { ok: true; via: "direct" | "revision"; revisionId?: string }
  | { ok: false; reason: string };

/**
 * Turning multisig on, raising a threshold or changing which sections it
 * covers. While multisig is off this is a plain owner action; once it is on,
 * the change has to pass the very mechanism it modifies — otherwise the owner
 * disarms it in one click and the multisig is decoration.
 */
export async function updateCardPolicy(input: {
  cardId: string;
  multisig: boolean;
  threshold: number;
  sections: CoinCardSection[];
}): Promise<PolicyResult> {
  const { userId, card, member } = await getViewerCard(input.cardId);
  if (!userId) return { ok: false, reason: "unauth" };
  if (!card || !member) return { ok: false, reason: "not_found" };
  if (!canManagePolicy(member)) return { ok: false, reason: "forbidden" };

  const signerCount = await prisma.coinCardMember.count({
    where: { cardId: card.id, isSigner: true },
  });
  if (input.multisig && !thresholdReachable(input.threshold, signerCount)) {
    return { ok: false, reason: "threshold_out_of_range" };
  }

  const current = card.policy ?? { multisig: false, threshold: 1, sections: [] };
  const sections = Array.from(new Set(input.sections));
  const next = { multisig: input.multisig, threshold: input.threshold, sections };

  const diff = buildDiff(
    {
      "policy.multisig": current.multisig,
      "policy.threshold": current.threshold,
      "policy.sections": current.sections,
    },
    {
      "policy.multisig": next.multisig,
      "policy.threshold": next.threshold,
      "policy.sections": next.sections,
    },
  );
  if (diff.length === 0) return { ok: false, reason: "no_changes" };

  // Multisig currently off → nothing to bypass yet.
  if (!policyApplies({ ...current, sections: current.sections }, null)) {
    await prisma.coinCardPolicy.upsert({
      where: { cardId: card.id },
      create: { cardId: card.id, ...next },
      update: next,
    });
    revalidatePath("/", "layout");
    return { ok: true, via: "direct" };
  }

  const thresholdAt = Math.max(1, Math.min(current.threshold, signerCount));
  const revision = await prisma.coinCardRevision.create({
    data: {
      cardId: card.id,
      kind: "POLICY",
      section: null,
      authorId: userId,
      status: "PENDING_SIGNERS",
      highRisk: true,
      diff: diff as unknown as Prisma.InputJsonValue,
      thresholdAt,
      signerCountAt: signerCount,
      expiresAt: revisionExpiry(),
      approvals: member.isSigner
        ? { create: { memberId: member.id, decision: "APPROVE" } }
        : undefined,
    },
    select: { id: true },
  });

  const signers = await prisma.coinCardMember.findMany({
    where: { cardId: card.id, isSigner: true },
    select: { userId: true },
  });
  for (const s of signers) {
    if (s.userId === userId) continue;
    void notifyUser({
      userId: s.userId,
      text: `✍️ A multisig policy change on "${card.name}" needs your signature.`,
      subject: `Signature needed for ${card.name}`,
    }).catch(() => {});
  }

  revalidatePath("/", "layout");
  return { ok: true, via: "revision", revisionId: revision.id };
}
```

- [ ] **Step 2: Применение POLICY-ревизии в `applyRevisionNow`**

В `src/app/actions/coin-card-revisions.ts` функция `applyRevisionNow` пока
умеет только `CONTENT`. Дописать в её начало, сразу после загрузки `rev`:

```ts
  if (rev.kind === "POLICY") {
    const diff = (rev.diff as unknown as DiffEntry[]) ?? [];
    const next: Record<string, unknown> = {};
    for (const e of diff) {
      if (e.path === "policy.multisig") next.multisig = Boolean(e.after);
      if (e.path === "policy.threshold") next.threshold = Number(e.after);
      if (e.path === "policy.sections") next.sections = e.after as string[];
    }
    await prisma.$transaction([
      prisma.coinCardPolicy.upsert({
        where: { cardId: rev.cardId },
        create: { cardId: rev.cardId, ...(next as { multisig?: boolean; threshold?: number }) },
        update: next as never,
      }),
      prisma.coinCardRevision.update({
        where: { id: rev.id },
        data: { status: "APPLIED", appliedAt: new Date(), decidedAt: new Date() },
      }),
    ]);
    revalidatePath("/", "layout");
    return;
  }
```

и в `finishAfterSigners` — учесть, что POLICY-ревизия модератору не уходит.
Новая версия функции целиком:

```ts
/** Threshold met: either publish or hand the diff to the moderator. */
async function finishAfterSigners(
  revisionId: string,
  cardId: string,
  highRisk: boolean,
  trust: CardTrust,
  kind: "CONTENT" | "POLICY" = "CONTENT",
): Promise<RevisionResult> {
  // A policy change is the team's own business: the site moderator has no
  // opinion on how many signatures a project wants.
  const next = kind === "POLICY" ? { status: "APPLIED" as const } : routeAfterSigners(highRisk, trust);
  if (next.status === "APPLIED") {
    await applyRevisionNow(revisionId, "team");
    return { ok: true, revisionId, status: "APPLIED" };
  }
  await prisma.coinCardRevision.update({
    where: { id: revisionId },
    data: { status: "PENDING_ADMIN" },
  });
  void cardId;
  revalidatePath("/", "layout");
  return { ok: true, revisionId, status: "PENDING_ADMIN" };
}
```

В `voteOnRevision` в выборку `select` добавить `kind: true` и передать его в
`finishAfterSigners(rev.id, rev.cardId, rev.highRisk, rev.card.trust as CardTrust, rev.kind)`.

- [ ] **Step 3: Проверить типы и закоммитить**

Run: `npx tsc --noEmit`
Expected: чисто.

```bash
git add src/app/actions/coin-card-policy.ts src/app/actions/coin-card-revisions.ts
git commit -m "feat(coin-card): политика мультисига и её изменение через мультисиг"
```

---

### Task 10: Админские действия и очередь ревизий

**Files:**
- Create: `src/app/actions/admin-coin-revisions.ts`
- Create: `src/components/coin-card-manage/diff-view.tsx`
- Create: `src/components/admin/coin-revision-row.tsx`
- Modify: `src/app/[locale]/admin/coin-cards/page.tsx`

Аварийный выход из спеки: `FORCE_COIN_REVISION` и `DISABLE_COIN_MULTISIG` —
законные действия админа по обращению владельца, но оба пишутся в
`AdminAuditLog` и **видны в публичной истории** (Task 12). Тихого обхода нет.

- [ ] **Step 1: Создать `src/app/actions/admin-coin-revisions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { applyRevisionNow } from "@/app/actions/coin-card-revisions";
import { notifyUser } from "@/lib/notify";

const MIN_REJECT_REASON = 3;

async function requireAdmin(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "ADMIN") return null;
  return user.id;
}

export type AdminRevisionResult = { ok: true } | { ok: false; reason: string };

export async function applyCoinRevision(revisionId: string): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true, authorId: true, card: { select: { name: true } } },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_ADMIN") return { ok: false, reason: "revision_closed" };

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { adminId, decidedAt: new Date() },
  });
  await applyRevisionNow(rev.id, "admin");
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "APPLY_COIN_REVISION",
      targetType: "CoinCardRevision",
      targetId: rev.id,
      details: { cardId: rev.cardId },
    },
  });
  void notifyUser({
    userId: rev.authorId,
    text: `✅ Your change to "${rev.card.name}" is live.`,
    subject: `${rev.card.name} updated`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function rejectCoinRevision(
  revisionId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true, authorId: true, card: { select: { name: true } } },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_ADMIN") return { ok: false, reason: "revision_closed" };

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { status: "REJECTED", adminId, adminNote: note, decidedAt: new Date() },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "REJECT_COIN_REVISION",
      targetType: "CoinCardRevision",
      targetId: rev.id,
      details: { cardId: rev.cardId, reason: note },
    },
  });
  void notifyUser({
    userId: rev.authorId,
    text: `❌ Your change to "${rev.card.name}" was rejected: ${note}`,
    subject: `${rev.card.name}: change rejected`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Emergency exit: signers are gone and the card is stuck. Applies a revision
 * that never collected its signatures. Audit-logged and shown publicly.
 */
export async function forceCoinRevision(
  revisionId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const rev = await prisma.coinCardRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, cardId: true, status: true },
  });
  if (!rev) return { ok: false, reason: "not_found" };
  if (rev.status !== "PENDING_SIGNERS" && rev.status !== "EXPIRED") {
    return { ok: false, reason: "revision_closed" };
  }

  await prisma.coinCardRevision.update({
    where: { id: rev.id },
    data: { adminId, adminNote: note, decidedAt: new Date() },
  });
  await applyRevisionNow(rev.id, "admin");
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "FORCE_COIN_REVISION",
      targetType: "CoinCard",
      targetId: rev.cardId,
      details: { revisionId: rev.id, reason: note },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function disableCoinMultisig(
  cardId: string,
  reason: string,
): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };
  const note = (reason ?? "").trim();
  if (note.length < MIN_REJECT_REASON) return { ok: false, reason: "reason_too_short" };

  const card = await prisma.coinCard.findUnique({ where: { id: cardId }, select: { id: true } });
  if (!card) return { ok: false, reason: "not_found" };

  await prisma.coinCardPolicy.upsert({
    where: { cardId },
    create: { cardId, multisig: false, threshold: 1, sections: [] },
    update: { multisig: false },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "DISABLE_COIN_MULTISIG",
      targetType: "CoinCard",
      targetId: cardId,
      details: { reason: note },
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Hands the card to the real project: the claimant becomes OWNER, the steward
 * is demoted to EDITOR rather than deleted — what happens next is the
 * project's call. Until slice D ships the proof flow, an admin does this by
 * hand on request.
 */
export async function transferCoinCard(input: {
  cardId: string;
  identifier: string;
}): Promise<AdminRevisionResult> {
  const adminId = await requireAdmin();
  if (!adminId) return { ok: false, reason: "forbidden" };

  const id = input.identifier.trim().toLowerCase();
  const target = id.includes("@")
    ? await prisma.user.findUnique({ where: { email: id }, select: { id: true } })
    : await prisma.user.findUnique({ where: { username: id }, select: { id: true } });
  if (!target) return { ok: false, reason: "user_not_found" };

  const card = await prisma.coinCard.findUnique({
    where: { id: input.cardId },
    select: { id: true, stewardUserId: true, name: true },
  });
  if (!card) return { ok: false, reason: "not_found" };

  await prisma.coinCardMember.upsert({
    where: { cardId_userId: { cardId: card.id, userId: target.id } },
    create: { cardId: card.id, userId: target.id, role: "OWNER", isSigner: true },
    update: { role: "OWNER", sections: [], isSigner: true },
  });
  if (card.stewardUserId && card.stewardUserId !== target.id) {
    await prisma.coinCardMember.updateMany({
      where: { cardId: card.id, userId: card.stewardUserId },
      data: { role: "EDITOR" },
    });
  }
  await prisma.coinCard.update({
    where: { id: card.id },
    data: { stewardUserId: target.id, trust: "PROJECT_CLAIMED" },
  });
  await prisma.adminAuditLog.create({
    data: {
      actorId: adminId,
      action: "TRANSFER_COIN_CARD",
      targetType: "CoinCard",
      targetId: card.id,
      details: { toUserId: target.id, fromUserId: card.stewardUserId },
    },
  });
  void notifyUser({
    userId: target.id,
    text: `🪙 You are now the owner of the "${card.name}" card on Trientes.`,
    subject: `${card.name}: ownership transferred`,
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Создать `src/components/coin-card-manage/diff-view.tsx`**

```tsx
import type { DiffEntry } from "@/lib/coin-card-diff";

function render(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v, null, 1);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

/** "before → after", one row per path. Shared by the cabinet and the admin queue. */
export function DiffView({ diff }: { diff: readonly DiffEntry[] }) {
  return (
    <ul className="space-y-2">
      {diff.map((e) => (
        <li key={e.path} className="text-xs border border-hairline rounded-md p-2 bg-bg-tint">
          <div className="num uppercase tracking-[0.12em] text-[10px] text-muted mb-1">{e.path}</div>
          <div className="grid md:grid-cols-2 gap-2">
            <pre className="whitespace-pre-wrap break-words text-red-400/90">{render(e.before)}</pre>
            <pre className="whitespace-pre-wrap break-words text-green-400/90">{render(e.after)}</pre>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Создать `src/components/admin/coin-revision-row.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { DiffView } from "@/components/coin-card-manage/diff-view";
import {
  applyCoinRevision,
  rejectCoinRevision,
  forceCoinRevision,
} from "@/app/actions/admin-coin-revisions";

export type AdminRevision = {
  id: string;
  kind: "CONTENT" | "POLICY";
  section: string | null;
  status: string;
  highRisk: boolean;
  diff: DiffEntry[];
  thresholdAt: number | null;
  signerCountAt: number | null;
  approvals: number;
  createdAt: string;
  cardName: string;
  cardSlug: string;
  authorLabel: string;
};

export function CoinRevisionRow({ revision }: { revision: AdminRevision }) {
  const t = useTranslations("admin.coinRevisions");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.reason ?? "unknown");
    });
  }

  return (
    <div className="border border-hairline rounded-lg p-4 bg-card">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="font-semibold">{revision.cardName}</span>
        <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
          {revision.kind === "POLICY" ? t("policyChange") : revision.section}
        </span>
        {revision.highRisk ? (
          <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border border-red-500/40 text-red-400">
            {t("highRisk")}
          </span>
        ) : null}
        <span className="text-[11px] text-muted">
          {t("author", { author: revision.authorLabel })}
        </span>
        {revision.thresholdAt ? (
          <span className="text-[11px] text-muted">
            {t("signatures", {
              approvals: revision.approvals,
              threshold: revision.thresholdAt,
              signers: revision.signerCountAt ?? 0,
            })}
          </span>
        ) : null}
        <span className="text-[11px] text-muted ml-auto">
          {new Date(revision.createdAt).toISOString().slice(0, 16).replace("T", " ")}
        </span>
      </div>

      <DiffView diff={revision.diff} />

      <div className="flex flex-wrap gap-2 mt-3 items-center">
        {revision.status === "PENDING_ADMIN" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => applyCoinRevision(revision.id))}
            className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium disabled:opacity-50"
          >
            {t("apply")}
          </button>
        ) : null}
        {revision.status === "PENDING_SIGNERS" || revision.status === "EXPIRED" ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => forceCoinRevision(revision.id, reason))}
            className="px-3 py-1.5 rounded-md border border-hairline text-xs font-medium disabled:opacity-50"
          >
            {t("force")}
          </button>
        ) : null}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("reasonPlaceholder")}
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-md border border-hairline bg-bg-tint text-xs"
        />
        {revision.status === "PENDING_ADMIN" ? (
          <button
            type="button"
            disabled={pending || reason.trim().length < 3}
            onClick={() => run(() => rejectCoinRevision(revision.id, reason))}
            className="px-3 py-1.5 rounded-md border border-hairline text-red-500 text-xs font-medium disabled:opacity-50"
          >
            {t("reject")}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Дописать очередь ревизий в `src/app/[locale]/admin/coin-cards/page.tsx`**

Добавить импорты:

```tsx
import { CoinRevisionRow, type AdminRevision } from "@/components/admin/coin-revision-row";
import type { DiffEntry } from "@/lib/coin-card-diff";
```

После запроса `cards` добавить запрос ревизий:

```tsx
  const revisions = await prisma.coinCardRevision.findMany({
    where: { status: { in: ["PENDING_ADMIN", "PENDING_SIGNERS", "EXPIRED"] } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: {
      card: { select: { name: true, slug: true } },
      author: { select: { username: true, email: true, name: true } },
      _count: { select: { approvals: true } },
    },
  });
  const revisionRows: AdminRevision[] = revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    section: r.section,
    status: r.status,
    highRisk: r.highRisk,
    diff: (r.diff as unknown as DiffEntry[]) ?? [],
    thresholdAt: r.thresholdAt,
    signerCountAt: r.signerCountAt,
    approvals: r._count.approvals,
    createdAt: r.createdAt.toISOString(),
    cardName: r.card.name,
    cardSlug: r.card.slug,
    authorLabel: r.author.username ?? r.author.email ?? r.author.name ?? r.authorId.slice(0, 6),
  }));
```

И отрендерить вторым блоком, после списка новых карточек (внутри корневого
`<div>`, сразу перед его закрытием):

```tsx
      <h2 className="text-xl font-semibold mt-12 mb-1">{tr("title")}</h2>
      <p className="text-muted text-sm mb-6">{tr("subtitle")}</p>
      {revisionRows.length === 0 ? (
        <p className="text-muted text-sm">{tr("empty")}</p>
      ) : (
        <div className="space-y-4">
          {revisionRows.map((r) => (
            <CoinRevisionRow key={r.id} revision={r} />
          ))}
        </div>
      )}
```

где `const tr = await getTranslations("admin.coinRevisions");` добавляется
рядом с существующим `const t = await getTranslations("admin.coinCards");`.
Счётчик одобрений считается только по `approvals`, без разделения на APPROVE и
REJECT — в админке важен сам факт, что команда подписала; разбор голосов живёт
в кабинете.

- [ ] **Step 5: Проверить типы и закоммитить**

Run: `npx tsc --noEmit`
Expected: чисто.

```bash
git add src/app/actions/admin-coin-revisions.ts src/components/admin/coin-revision-row.tsx \
  src/components/coin-card-manage/diff-view.tsx src/app/\[locale\]/admin/coin-cards/page.tsx
git commit -m "feat(coin-card): модерация ревизий, аварийный выход и передача карточки"
```

---

### Task 11: Декларативный редактор секции

**Files:**
- Create: `src/lib/coin-card-form-spec.ts`
- Create: `tests/coin-card-form-spec.test.ts`
- Create: `src/components/coin-card-manage/section-editor.tsx`

Визард A1 (`src/components/coin-card-wizard/step-*.tsx`) заполняет пустую
карточку и не умеет показывать текущие значения — для кабинета нужен редактор
**с префиллом**. Писать восемь отдельных форм — это восемь копий одной логики,
поэтому поля описываются декларативно, а рендер один. Чистые функции
(`specToInitial`, `stateToPayload`, `getPath`, `setPath`) тестируются без DOM.

- [ ] **Step 1: Написать падающий тест `tests/coin-card-form-spec.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  SECTION_SPECS,
  getPath,
  setPath,
  specToInitial,
  stateToPayload,
} from "@/lib/coin-card-form-spec";

describe("getPath / setPath", () => {
  it("reads a nested path", () => {
    expect(getPath({ tokenomics: { circulating: 7 } }, "tokenomics.circulating")).toBe(7);
  });

  it("returns undefined for a missing branch", () => {
    expect(getPath({}, "security.audits")).toBeUndefined();
  });

  it("creates intermediate objects when writing", () => {
    const out = {};
    setPath(out, "tokenomics.max", 10);
    expect(out).toEqual({ tokenomics: { max: 10 } });
  });
});

describe("specToInitial", () => {
  it("prefills scalars, line blocks and row groups from the card", () => {
    const init = specToInitial(SECTION_SPECS.TOKENOMICS, {
      tokenomics: {
        circulating: 1000,
        excludedAddresses: ["0xa", "0xb"],
        emission: "fixed",
      },
    });
    expect(init["tokenomics.circulating"]).toBe("1000");
    expect(init["tokenomics.excludedAddresses"]).toBe("0xa\n0xb");
    expect(init["tokenomics.emission"]).toBe("fixed");
  });

  it("prefills a row group as an array of row objects", () => {
    const init = specToInitial(SECTION_SPECS.CONTRACTS, {
      contracts: [{ chain: "ethereum", address: "0xa", decimals: 18, isCanonical: true }],
    });
    expect(Array.isArray(init.contracts)).toBe(true);
    expect((init.contracts as Record<string, unknown>[])[0].address).toBe("0xa");
  });

  it("gives an empty string for a missing scalar, never undefined", () => {
    expect(specToInitial(SECTION_SPECS.IDENTITY, {}).tagline).toBe("");
  });
});

describe("stateToPayload", () => {
  it("casts numbers and drops blanks", () => {
    const p = stateToPayload(SECTION_SPECS.TOKENOMICS, {
      "tokenomics.circulating": "1000",
      "tokenomics.total": "",
      "tokenomics.excludedAddresses": "0xa\n\n0xb",
      "tokenomics.emission": " fixed ",
    });
    const t = (p.tokenomics ?? {}) as Record<string, unknown>;
    expect(t.circulating).toBe(1000);
    expect(t.total).toBeNull();
    expect(t.excludedAddresses).toEqual(["0xa", "0xb"]);
    expect(t.emission).toBe("fixed");
  });

  it("keeps booleans as booleans", () => {
    const p = stateToPayload(SECTION_SPECS.SECURITY, { "security.teamDoxxed": true });
    expect((p.security as Record<string, unknown>).teamDoxxed).toBe(true);
  });

  it("drops fully blank rows from a row group", () => {
    const p = stateToPayload(SECTION_SPECS.CONTRACTS, {
      contracts: [
        { chain: "ethereum", address: "0xa", decimals: "18", standard: "", explorerUrl: "", isCanonical: true },
        { chain: "ethereum", address: "", decimals: "", standard: "", explorerUrl: "", isCanonical: false },
      ],
    });
    expect(p.contracts).toHaveLength(1);
    expect((p.contracts as Record<string, unknown>[])[0].decimals).toBe(18);
  });

  it("splits tags on commas", () => {
    const p = stateToPayload(SECTION_SPECS.IDENTITY, { tags: "defi, l2 , " });
    expect(p.tags).toEqual(["defi", "l2"]);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test -- --run tests/coin-card-form-spec.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/lib/coin-card-form-spec.ts`**

```ts
// Declarative description of the editable fields of every card section. One
// spec, one renderer (components/coin-card-manage/section-editor.tsx) — the
// alternative was eight near-identical forms.
//
// `label` is an i18n key under coinCard.wizard / coinCard.manage.fields, so the
// labels the wizard already ships are reused verbatim.

import type { CardSection } from "@/lib/coin-card-risk";
import { SUPPORTED_CHAINS } from "@/lib/coin-card-validate";

export type FieldSpec =
  | { kind: "text" | "url" | "textarea" | "date"; path: string; label: string }
  | { kind: "number"; path: string; label: string }
  | { kind: "bool"; path: string; label: string }
  | { kind: "lines"; path: string; label: string }
  | { kind: "tags"; path: string; label: string }
  | { kind: "select"; path: string; label: string; options: readonly string[] }
  | { kind: "rows"; path: string; label: string; fields: FieldSpec[] };

export type FormState = Record<string, unknown>;

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (!cur[key] || typeof cur[key] !== "object") cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

const ROW_SUBFIELDS = {
  contract: [
    { kind: "select", path: "chain", label: "chain", options: SUPPORTED_CHAINS },
    { kind: "text", path: "address", label: "address" },
    { kind: "number", path: "decimals", label: "decimals" },
    { kind: "text", path: "standard", label: "standard" },
    { kind: "url", path: "explorerUrl", label: "explorerUrl" },
    { kind: "bool", path: "isCanonical", label: "canonical" },
  ] as FieldSpec[],
  market: [
    { kind: "select", path: "kind", label: "marketKind", options: ["CEX", "DEX"] },
    { kind: "text", path: "exchangeName", label: "exchange" },
    { kind: "text", path: "pair", label: "pair" },
    { kind: "url", path: "tradeUrl", label: "tradeUrl" },
    { kind: "text", path: "chain", label: "chain" },
    { kind: "text", path: "poolAddress", label: "poolAddress" },
  ] as FieldSpec[],
  audit: [
    { kind: "text", path: "firm", label: "auditFirm" },
    { kind: "date", path: "date", label: "auditDate" },
    { kind: "url", path: "reportUrl", label: "auditReport" },
    { kind: "text", path: "scope", label: "auditScope" },
  ] as FieldSpec[],
  member: [
    { kind: "text", path: "name", label: "memberName" },
    { kind: "text", path: "role", label: "memberRole" },
    { kind: "url", path: "link", label: "memberLink" },
  ] as FieldSpec[],
  milestone: [
    { kind: "text", path: "title", label: "milestoneTitle" },
    { kind: "text", path: "date", label: "milestoneDate" },
    { kind: "text", path: "status", label: "milestoneStatus" },
  ] as FieldSpec[],
};

export const SECTION_SPECS: Record<CardSection, FieldSpec[]> = {
  IDENTITY: [
    { kind: "text", path: "name", label: "name" },
    { kind: "text", path: "symbol", label: "symbol" },
    { kind: "text", path: "tagline", label: "tagline" },
    { kind: "textarea", path: "description", label: "description" },
    { kind: "date", path: "launchDate", label: "launchDate" },
    { kind: "tags", path: "tags", label: "tags" },
  ],
  CONTRACTS: [
    { kind: "rows", path: "contracts", label: "contract", fields: ROW_SUBFIELDS.contract },
  ],
  TOKENOMICS: [
    { kind: "number", path: "tokenomics.circulating", label: "circulating" },
    { kind: "number", path: "tokenomics.total", label: "totalSupply" },
    { kind: "number", path: "tokenomics.max", label: "maxSupply" },
    { kind: "lines", path: "tokenomics.excludedAddresses", label: "excluded" },
    { kind: "text", path: "tokenomics.emission", label: "emission" },
    { kind: "text", path: "tokenomics.burn", label: "burn" },
  ],
  MARKETS: [{ kind: "rows", path: "markets", label: "market", fields: ROW_SUBFIELDS.market }],
  SECURITY: [
    { kind: "rows", path: "security.audits", label: "audit", fields: ROW_SUBFIELDS.audit },
    { kind: "text", path: "security.legalEntity", label: "legalEntity" },
    { kind: "text", path: "security.jurisdiction", label: "jurisdiction" },
    { kind: "bool", path: "security.teamDoxxed", label: "teamDoxxed" },
    { kind: "bool", path: "security.riskFlags.mintable", label: "flagMintable" },
    { kind: "bool", path: "security.riskFlags.pausable", label: "flagPausable" },
    { kind: "bool", path: "security.riskFlags.blacklist", label: "flagBlacklist" },
    { kind: "bool", path: "security.riskFlags.transferTax", label: "flagTransferTax" },
    { kind: "bool", path: "security.riskFlags.upgradeableProxy", label: "flagProxy" },
    { kind: "bool", path: "security.riskFlags.lpLocked", label: "flagLpLocked" },
  ],
  TEAM: [
    { kind: "rows", path: "teamInfo.members", label: "member", fields: ROW_SUBFIELDS.member },
    { kind: "lines", path: "teamInfo.investors", label: "investors" },
    { kind: "lines", path: "teamInfo.partners", label: "partners" },
  ],
  LINKS: [
    { kind: "url", path: "links.website", label: "website" },
    { kind: "url", path: "links.docs", label: "docs" },
    { kind: "url", path: "links.whitepaper", label: "whitepaper" },
    { kind: "url", path: "links.github", label: "github" },
    { kind: "url", path: "links.x", label: "x" },
    { kind: "url", path: "links.telegram", label: "telegram" },
    { kind: "url", path: "links.discord", label: "discord" },
    { kind: "url", path: "links.reddit", label: "reddit" },
    { kind: "url", path: "links.blog", label: "blog" },
    { kind: "url", path: "links.youtube", label: "youtube" },
  ],
  MARKETING: [
    { kind: "textarea", path: "marketing.pitch", label: "pitch" },
    { kind: "rows", path: "marketing.roadmap", label: "milestone", fields: ROW_SUBFIELDS.milestone },
    { kind: "url", path: "marketing.mediaKit", label: "mediaKit" },
    { kind: "url", path: "marketing.videoUrl", label: "videoUrl" },
  ],
  ACCEPTANCE: [],
};

/** Sections a team can actually edit today. ACCEPTANCE waits for slice F. */
export const EDITABLE_SECTIONS: CardSection[] = [
  "IDENTITY", "CONTRACTS", "TOKENOMICS", "MARKETS",
  "SECURITY", "TEAM", "LINKS", "MARKETING",
];

function scalarToInput(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return String(v);
}

/**
 * Flat form state keyed by field path. Row groups hold an array of plain row
 * objects whose values are already input-shaped strings.
 */
export function specToInitial(spec: readonly FieldSpec[], card: unknown): FormState {
  const state: FormState = {};
  for (const f of spec) {
    const raw = getPath(card, f.path);
    if (f.kind === "rows") {
      const rows = Array.isArray(raw) ? raw : [];
      state[f.path] = rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const sub of f.fields) {
          const v = getPath(row, sub.path);
          out[sub.path] = sub.kind === "bool" ? Boolean(v) : scalarToInput(v);
        }
        return out;
      });
    } else if (f.kind === "bool") {
      state[f.path] = Boolean(raw);
    } else if (f.kind === "lines") {
      state[f.path] = Array.isArray(raw) ? raw.join("\n") : scalarToInput(raw);
    } else if (f.kind === "tags") {
      state[f.path] = Array.isArray(raw) ? raw.join(", ") : scalarToInput(raw);
    } else {
      state[f.path] = scalarToInput(raw);
    }
  }
  return state;
}

function parseScalar(kind: FieldSpec["kind"], v: unknown): unknown {
  if (kind === "bool") return Boolean(v);
  if (kind === "number") {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Form state → the payload shape `normalizeSectionPayload` expects. */
export function stateToPayload(
  spec: readonly FieldSpec[],
  state: FormState,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of spec) {
    const raw = state[f.path];
    if (f.kind === "rows") {
      const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      const out = rows
        .map((row) => {
          const o: Record<string, unknown> = {};
          for (const sub of f.fields) o[sub.path] = parseScalar(sub.kind, row[sub.path]);
          return o;
        })
        // A row the user added and never filled is not data.
        .filter((o) =>
          Object.entries(o).some(([, v]) => v !== null && v !== false && v !== ""),
        );
      setPath(payload, f.path, out);
    } else if (f.kind === "lines") {
      setPath(
        payload,
        f.path,
        String(raw ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      );
    } else if (f.kind === "tags") {
      setPath(
        payload,
        f.path,
        String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      );
    } else {
      setPath(payload, f.path, parseScalar(f.kind, raw));
    }
  }
  return payload;
}
```

- [ ] **Step 4: Тест должен пройти**

Run: `npm test -- --run tests/coin-card-form-spec.test.ts`
Expected: PASS (9 тестов). `tokenomics.total` в payload ожидается `null`, а
`validateTokenomics` трактует `null` как «не задано» — поведение совпадает.

- [ ] **Step 5: Создать `src/components/coin-card-manage/section-editor.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  SECTION_SPECS,
  specToInitial,
  stateToPayload,
  type FieldSpec,
  type FormState,
} from "@/lib/coin-card-form-spec";
import type { CardSection } from "@/lib/coin-card-risk";
import { saveCoinCardSection } from "@/app/actions/coin-card";
import { submitSectionRevision } from "@/app/actions/coin-card-revisions";

const inputCls =
  "w-full px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm";
const labelCls = "num text-[10px] uppercase tracking-[0.14em] text-muted";

function Scalar({
  field,
  value,
  onChange,
  label,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
}) {
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="block">
        <span className={labelCls}>{label}</span>
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        >
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const multiline = field.kind === "textarea" || field.kind === "lines";
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {multiline ? (
        <textarea
          rows={field.kind === "textarea" ? 6 : 3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      ) : (
        <input
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputCls} mt-1`}
        />
      )}
    </label>
  );
}

/**
 * One form for every section, driven by SECTION_SPECS. Submits through the
 * revision pipeline for a published card and straight to the card while it is
 * still a draft — the server re-checks both, this only picks the action.
 */
export function SectionEditor({
  cardId,
  section,
  card,
  published,
}: {
  cardId: string;
  section: CardSection;
  card: unknown;
  published: boolean;
}) {
  const spec = SECTION_SPECS[section];
  const t = useTranslations("coinCard.wizard");
  const tm = useTranslations("coinCard.manage");
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => specToInitial(spec, card));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const label = (key: string) => {
    try {
      return t(key);
    } catch {
      return key;
    }
  };

  const set = (path: string, v: unknown) => setState((s) => ({ ...s, [path]: v }));

  const setRow = (path: string, i: number, sub: string, v: unknown) =>
    setState((s) => {
      const rows = [...((s[path] as Record<string, unknown>[]) ?? [])];
      rows[i] = { ...rows[i], [sub]: v };
      return { ...s, [path]: rows };
    });

  const addRow = (f: Extract<FieldSpec, { kind: "rows" }>) =>
    setState((s) => {
      const rows = [...((s[f.path] as Record<string, unknown>[]) ?? [])];
      const blank: Record<string, unknown> = {};
      for (const sub of f.fields) blank[sub.path] = sub.kind === "bool" ? false : "";
      return { ...s, [f.path]: [...rows, blank] };
    });

  const dropRow = (path: string, i: number) =>
    setState((s) => {
      const rows = [...((s[path] as Record<string, unknown>[]) ?? [])];
      rows.splice(i, 1);
      return { ...s, [path]: rows };
    });

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setDone(null);
        const payload = stateToPayload(spec, state);
        start(async () => {
          const res = published
            ? await submitSectionRevision({ cardId, section, payload })
            : await saveCoinCardSection({ cardId, section, payload });
          if (!res.ok) {
            setError(res.reason);
            return;
          }
          setDone(published && "status" in res ? String(res.status) : "SAVED");
          router.refresh();
        });
      }}
    >
      {spec.map((f) =>
        f.kind === "rows" ? (
          <div key={f.path} className="space-y-3">
            <span className={labelCls}>{label(f.label)}</span>
            {((state[f.path] as Record<string, unknown>[]) ?? []).map((row, i) => (
              <div key={i} className="border border-hairline rounded-md p-3 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  {f.fields.map((sub) => (
                    <Scalar
                      key={sub.path}
                      field={sub}
                      label={label(sub.label)}
                      value={row[sub.path]}
                      onChange={(v) => setRow(f.path, i, sub.path, v)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => dropRow(f.path, i)}
                  className="text-xs text-red-500"
                >
                  {tm("removeRow")}
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addRow(f)} className="text-accent text-sm">
              + {tm("addRow")}
            </button>
          </div>
        ) : (
          <Scalar
            key={f.path}
            field={f}
            label={label(f.label)}
            value={state[f.path]}
            onChange={(v) => set(f.path, v)}
          />
        ),
      )}

      {error ? <p className="text-down text-sm">{tm(`errors.${error}`)}</p> : null}
      {done ? <p className="text-up text-sm">{tm(`submitted.${done}`)}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? tm("saving") : published ? tm("submitChange") : tm("save")}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/coin-card-form-spec.ts tests/coin-card-form-spec.test.ts \
  src/components/coin-card-manage/section-editor.tsx
git commit -m "feat(coin-card): декларативный редактор секций с префиллом"
```

---

### Task 12: Кабинет карточки

**Files:**
- Create: `src/components/cabinet/coins-section.tsx`
- Create: `src/components/coin-card-manage/team-section.tsx`
- Create: `src/components/coin-card-manage/member-row.tsx`
- Create: `src/components/coin-card-manage/invite-member-form.tsx`
- Create: `src/components/coin-card-manage/invite-links.tsx`
- Create: `src/components/coin-card-manage/policy-section.tsx`
- Create: `src/components/coin-card-manage/revisions-section.tsx`
- Create: `src/app/[locale]/cabinet/coins/[id]/page.tsx`
- Modify: `src/app/[locale]/cabinet/page.tsx`

- [ ] **Step 1: Список карточек в кабинете — `src/components/cabinet/coins-section.tsx`**

```tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listViewerCards } from "@/lib/coin-card-access";

export async function CoinsSection({ locale }: { locale: string }) {
  const t = await getTranslations("cabinet.coins");
  const { cards } = await listViewerCards();

  return (
    <section id="coins">
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {cards.length === 0 ? (
        <p className="text-sm text-muted">
          {t("empty")}{" "}
          <Link href={`/${locale}/request`} className="text-accent">
            {t("submitLink")}
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((c) => (
            <li key={c.id}>
              <Link
                href={`/${locale}/cabinet/coins/${c.id}`}
                className="flex items-center gap-3 border border-hairline rounded-md px-3 py-2.5 hover:bg-card-alt"
              >
                <span className="font-medium">{c.name}</span>
                <span className="num text-xs text-muted">{c.symbol}</span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded ${
                    c.status === "APPROVED"
                      ? "bg-green-500/15 text-green-500"
                      : c.status === "REJECTED"
                        ? "bg-red-500/15 text-red-500"
                        : "bg-yellow-500/15 text-yellow-500"
                  }`}
                >
                  {t(`status.${c.status}`)}
                </span>
                <span className="text-[11px] text-muted ml-auto">
                  {t("role", { role: c.members[0]?.role ?? "" })} · {c.completeness}%
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

В `src/app/[locale]/cabinet/page.tsx` добавить импорт
`import { CoinsSection } from "@/components/cabinet/coins-section";` и
отрендерить `<CoinsSection locale={locale} />` сразу после `<CompaniesSection …/>`.

- [ ] **Step 2: Строка участника — `src/components/coin-card-manage/member-row.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardRole, CoinCardSection } from "@prisma/client";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import { updateCardMember, removeCardMember } from "@/app/actions/coin-card-members";

export function CardMemberRow({
  cardId,
  userId,
  isSelf,
  displayLabel,
  handle,
  role,
  sections,
  isSigner,
  canManage,
  canManageSigners,
}: {
  cardId: string;
  userId: string;
  isSelf: boolean;
  displayLabel: string;
  handle: string | null;
  role: CoinCardRole;
  sections: CoinCardSection[];
  isSigner: boolean;
  canManage: boolean;
  canManageSigners: boolean;
}) {
  const t = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftRole, setDraftRole] = useState<CoinCardRole>(role);
  const [draftSections, setDraftSections] = useState<CoinCardSection[]>(sections);
  const [draftSigner, setDraftSigner] = useState(isSigner);

  const dirty =
    draftRole !== role ||
    draftSigner !== isSigner ||
    draftSections.join(",") !== sections.join(",");

  function save() {
    setError(null);
    start(async () => {
      const r = await updateCardMember({
        cardId,
        userId,
        role: draftRole,
        sections: draftSections,
        isSigner: draftSigner,
      });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  function remove() {
    if (!confirm(t("confirmRemove", { name: displayLabel }))) return;
    setError(null);
    start(async () => {
      const r = await removeCardMember({ cardId, userId });
      if (r.ok) router.refresh();
      else setError(r.reason);
    });
  }

  return (
    <div className="border border-hairline rounded-md px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {displayLabel}
            {isSelf ? <span className="text-xs text-muted ml-2">{t("you")}</span> : null}
          </div>
          {handle ? <div className="text-xs text-muted truncate">{handle}</div> : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canManage ? (
            <select
              value={draftRole}
              disabled={pending}
              onChange={(e) => setDraftRole(e.target.value as CoinCardRole)}
              className="text-xs px-2 py-1 rounded-md border border-hairline bg-bg-tint"
            >
              <option value="VIEWER">{t("role.VIEWER")}</option>
              <option value="EDITOR">{t("role.EDITOR")}</option>
              <option value="ADMIN">{t("role.ADMIN")}</option>
              <option value="OWNER">{t("role.OWNER")}</option>
            </select>
          ) : (
            <span className="text-xs px-2 py-1 rounded-md bg-bg-tint text-muted">
              {t(`role.${role}`)}
            </span>
          )}
          {canManageSigners ? (
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftSigner}
                disabled={pending}
                onChange={(e) => setDraftSigner(e.target.checked)}
              />
              {t("signer")}
            </label>
          ) : isSigner ? (
            <span className="text-xs text-accent">{t("signer")}</span>
          ) : null}
          {canManage ? (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="text-xs px-2 py-1 rounded-md border border-hairline text-red-500 hover:bg-red-500/10 disabled:opacity-50"
            >
              {t("remove")}
            </button>
          ) : null}
        </div>
      </div>

      {canManage && draftRole === "EDITOR" ? (
        <div className="flex flex-wrap gap-2">
          {EDITABLE_SECTIONS.map((s) => (
            <label key={s} className="text-[11px] flex items-center gap-1">
              <input
                type="checkbox"
                checked={draftSections.includes(s as CoinCardSection)}
                disabled={pending}
                onChange={(e) =>
                  setDraftSections((cur) =>
                    e.target.checked
                      ? [...cur, s as CoinCardSection]
                      : cur.filter((x) => x !== s),
                  )
                }
              />
              {t(`section.${s}`)}
            </label>
          ))}
        </div>
      ) : null}

      {dirty && canManage ? (
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground font-medium disabled:opacity-50"
        >
          {pending ? t("saving") : t("saveMember")}
        </button>
      ) : null}
      {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Приглашение по хэндлу — `src/components/coin-card-manage/invite-member-form.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardRole } from "@prisma/client";
import { inviteCardMember } from "@/app/actions/coin-card-members";

export function CardInviteMemberForm({
  cardId,
  canAssignOwner,
}: {
  cardId: string;
  canAssignOwner: boolean;
}) {
  const t = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<CoinCardRole>("EDITOR");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);
        start(async () => {
          const r = await inviteCardMember({ cardId, identifier, role });
          if (r.ok) {
            setIdentifier("");
            setSuccess(true);
            router.refresh();
          } else {
            setError(r.reason);
          }
        });
      }}
      className="flex flex-wrap gap-2 items-stretch border border-hairline rounded-md p-3 bg-card-alt"
    >
      <input
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder={t("identifierPlaceholder")}
        className="flex-1 min-w-[180px] px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
      />
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as CoinCardRole)}
        className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
      >
        <option value="VIEWER">{t("role.VIEWER")}</option>
        <option value="EDITOR">{t("role.EDITOR")}</option>
        <option value="ADMIN">{t("role.ADMIN")}</option>
        {canAssignOwner ? <option value="OWNER">{t("role.OWNER")}</option> : null}
      </select>
      <button
        type="submit"
        disabled={pending || identifier.trim().length < 2}
        className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
      >
        {pending ? t("inviting") : t("invite")}
      </button>
      {error ? <p className="basis-full text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
      {success ? <p className="basis-full text-green-500 text-xs">{t("inviteSuccess")}</p> : null}
    </form>
  );
}
```

- [ ] **Step 4: Ссылки-приглашения — `src/components/coin-card-manage/invite-links.tsx`**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { CoinCardRole } from "@prisma/client";
import { createCardInvite, revokeCardInvite } from "@/app/actions/coin-card-invites";
import { buildCardInviteUrl } from "@/lib/coin-card-invites";

export type CardInviteItem = {
  id: string;
  token: string;
  role: CoinCardRole;
  isSigner: boolean;
  expiresAt: string; // ISO — Date can't cross the server/client boundary
};

export function CardInviteLinks({
  cardId,
  invites,
  canAssignOwner,
}: {
  cardId: string;
  invites: CardInviteItem[];
  canAssignOwner: boolean;
}) {
  const t = useTranslations("coinCard.team.invites");
  const tr = useTranslations("coinCard.team");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [role, setRole] = useState<CoinCardRole>("EDITOR");
  const [signer, setSigner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Rendered on the server too, where window is absent — fill in after mount.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const urlFor = (token: string) =>
    origin ? buildCardInviteUrl(origin, locale, token) : `/${locale}/invite/coin/${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="mt-4 border border-hairline rounded-md p-3 bg-card-alt">
      <h3 className="text-sm font-semibold mb-1">{t("title")}</h3>
      <p className="text-xs text-muted mb-3">{t("subtitle")}</p>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as CoinCardRole)}
          className="px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
        >
          <option value="VIEWER">{tr("role.VIEWER")}</option>
          <option value="EDITOR">{tr("role.EDITOR")}</option>
          <option value="ADMIN">{tr("role.ADMIN")}</option>
          {canAssignOwner ? <option value="OWNER">{tr("role.OWNER")}</option> : null}
        </select>
        {canAssignOwner ? (
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={signer} onChange={(e) => setSigner(e.target.checked)} />
            {tr("signer")}
          </label>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const r = await createCardInvite({ cardId, role, isSigner: signer });
              if (r.ok) router.refresh();
              else setError(r.reason);
            });
          }}
          className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
        >
          {pending ? t("creating") : t("create")}
        </button>
      </div>
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}

      {invites.length === 0 ? (
        <p className="text-xs text-muted mt-3">{t("empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-2 text-xs border border-hairline rounded-md px-2 py-2 bg-bg-tint"
            >
              <span className="px-2 py-1 rounded bg-card text-[11px] uppercase tracking-[0.1em]">
                {tr(`role.${inv.role}`)}
              </span>
              {inv.isSigner ? <span className="text-accent">{tr("signer")}</span> : null}
              <code className="flex-1 min-w-[160px] truncate" title={urlFor(inv.token)}>
                {urlFor(inv.token)}
              </code>
              <span className="text-muted whitespace-nowrap">
                {t("expires", { date: new Date(inv.expiresAt).toLocaleDateString(locale) })}
              </span>
              <button
                type="button"
                onClick={() => void copy(inv.token)}
                className="px-2 py-1 rounded border border-hairline hover:bg-card"
              >
                {copied === inv.token ? t("copied") : t("copy")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const r = await revokeCardInvite({ cardId, inviteId: inv.id });
                    if (r.ok) router.refresh();
                    else setError(r.reason);
                  });
                }}
                className="px-2 py-1 rounded border border-hairline text-red-500 hover:bg-card disabled:opacity-50"
              >
                {t("revoke")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Серверная секция команды — `src/components/coin-card-manage/team-section.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import type { CoinCardRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CardMemberRow } from "./member-row";
import { CardInviteMemberForm } from "./invite-member-form";
import { CardInviteLinks, type CardInviteItem } from "./invite-links";

export async function CardTeamSection({
  cardId,
  viewerId,
  viewerRole,
  canManage,
}: {
  cardId: string;
  viewerId: string;
  viewerRole: CoinCardRole;
  canManage: boolean;
}) {
  const t = await getTranslations("coinCard.team");
  const isOwner = viewerRole === "OWNER";

  const members = await prisma.coinCardMember.findMany({
    where: { cardId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } },
    },
  });

  // Only managers see links, so skip the query entirely for everyone else.
  const invites: CardInviteItem[] = canManage
    ? (
        await prisma.coinCardInvite.findMany({
          where: { cardId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { id: true, token: true, role: true, isSigner: true, expiresAt: true },
        })
      ).map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() }))
    : [];

  return (
    <section>
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">
        {canManage ? t("subtitleManager") : t("subtitleViewer", { role: t(`role.${viewerRole}`) })}
      </p>

      {canManage ? <CardInviteMemberForm cardId={cardId} canAssignOwner={isOwner} /> : null}
      {canManage ? (
        <CardInviteLinks cardId={cardId} invites={invites} canAssignOwner={isOwner} />
      ) : null}

      <ul className="space-y-2 mt-4">
        {members.map((m) => (
          <li key={m.id}>
            <CardMemberRow
              cardId={cardId}
              userId={m.user.id}
              isSelf={m.user.id === viewerId}
              displayLabel={
                [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") ||
                m.user.username ||
                m.user.email ||
                m.user.id.slice(0, 6)
              }
              handle={m.user.username ?? m.user.email ?? null}
              role={m.role}
              sections={m.sections}
              isSigner={m.isSigner}
              canManage={canManage}
              canManageSigners={isOwner}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Политика мультисига — `src/components/coin-card-manage/policy-section.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { CoinCardSection } from "@prisma/client";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import { updateCardPolicy } from "@/app/actions/coin-card-policy";

export function PolicySection({
  cardId,
  multisig,
  threshold,
  sections,
  signerCount,
  canManage,
}: {
  cardId: string;
  multisig: boolean;
  threshold: number;
  sections: CoinCardSection[];
  signerCount: number;
  canManage: boolean;
}) {
  const t = useTranslations("coinCard.policy");
  const tr = useTranslations("coinCard.team");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(multisig);
  const [m, setM] = useState(threshold);
  const [secs, setSecs] = useState<CoinCardSection[]>(sections);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle", { signers: signerCount })}</p>

      <div className="border border-hairline rounded-md p-4 space-y-4 bg-card-alt">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={!canManage || pending}
            onChange={(e) => setOn(e.target.checked)}
          />
          {t("enable")}
        </label>

        {on ? (
          <>
            <label className="block max-w-[200px]">
              <span className="num text-[10px] uppercase tracking-[0.14em] text-muted">
                {t("threshold")}
              </span>
              <input
                type="number"
                min={1}
                max={Math.max(1, signerCount)}
                value={m}
                disabled={!canManage || pending}
                onChange={(e) => setM(Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 rounded-md border border-hairline bg-bg-tint text-sm"
              />
              <span className="text-xs text-muted">
                {t("thresholdHint", { m, n: signerCount })}
              </span>
            </label>

            <div>
              <span className="num text-[10px] uppercase tracking-[0.14em] text-muted">
                {t("sections")}
              </span>
              <p className="text-xs text-muted mb-2">{t("sectionsHint")}</p>
              <div className="flex flex-wrap gap-2">
                {EDITABLE_SECTIONS.map((s) => (
                  <label key={s} className="text-[11px] flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={secs.includes(s as CoinCardSection)}
                      disabled={!canManage || pending}
                      onChange={(e) =>
                        setSecs((cur) =>
                          e.target.checked
                            ? [...cur, s as CoinCardSection]
                            : cur.filter((x) => x !== s),
                        )
                      }
                    />
                    {tr(`section.${s}`)}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {canManage ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              setNote(null);
              start(async () => {
                const r = await updateCardPolicy({
                  cardId,
                  multisig: on,
                  threshold: m,
                  sections: secs,
                });
                if (r.ok) {
                  setNote(r.via);
                  router.refresh();
                } else {
                  setError(r.reason);
                }
              });
            }}
            className="px-4 py-2 rounded-md bg-accent text-accent-foreground text-sm font-medium disabled:opacity-50"
          >
            {pending ? t("saving") : t("save")}
          </button>
        ) : null}

        {error ? <p className="text-red-500 text-xs">{t(`errors.${error}`)}</p> : null}
        {note ? <p className="text-green-500 text-xs">{t(`applied.${note}`)}</p> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Ревизии и голосование — `src/components/coin-card-manage/revisions-section.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { DiffView } from "./diff-view";
import { voteOnRevision, withdrawRevision } from "@/app/actions/coin-card-revisions";

export type RevisionItem = {
  id: string;
  kind: "CONTENT" | "POLICY";
  section: string | null;
  status: string;
  highRisk: boolean;
  diff: DiffEntry[];
  thresholdAt: number | null;
  signerCountAt: number | null;
  approvals: number;
  rejections: number;
  myVote: "APPROVE" | "REJECT" | null;
  isMine: boolean;
  authorLabel: string;
  createdAt: string;
  adminNote: string | null;
};

export function RevisionsSection({
  revisions,
  canVote,
}: {
  revisions: RevisionItem[];
  canVote: boolean;
}) {
  const t = useTranslations("coinCard.revision");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) router.refresh();
      else setError(r.reason ?? "unknown");
    });
  }

  return (
    <section>
      <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-1">{t("title")}</h2>
      <p className="text-sm text-muted mb-4">{t("subtitle")}</p>

      {revisions.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {revisions.map((r) => (
            <li key={r.id} className="border border-hairline rounded-md p-3 bg-card-alt">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="num text-[11px] uppercase tracking-[0.12em] text-muted">
                  {r.kind === "POLICY" ? t("policyChange") : r.section}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-bg-tint">
                  {t(`status.${r.status}`)}
                </span>
                {r.highRisk ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-red-400">
                    {t("highRisk")}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted">
                  {t("author", { author: r.authorLabel })}
                </span>
                {r.thresholdAt ? (
                  <span className="text-[11px] text-muted">
                    {t("signatures", {
                      approvals: r.approvals,
                      threshold: r.thresholdAt,
                      rejections: r.rejections,
                    })}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted ml-auto">
                  {new Date(r.createdAt).toISOString().slice(0, 10)}
                </span>
              </div>

              <DiffView diff={r.diff} />

              {r.adminNote ? (
                <p className="text-xs text-muted mt-2">
                  {t("adminNote", { note: r.adminNote })}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 mt-3">
                {r.status === "PENDING_SIGNERS" && canVote && !r.myVote ? (
                  <>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => voteOnRevision({ revisionId: r.id, decision: "APPROVE" }))}
                      className="px-3 py-1.5 rounded-md bg-accent text-accent-foreground text-xs font-medium disabled:opacity-50"
                    >
                      {t("approve")}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => voteOnRevision({ revisionId: r.id, decision: "REJECT" }))}
                      className="px-3 py-1.5 rounded-md border border-hairline text-red-500 text-xs font-medium disabled:opacity-50"
                    >
                      {t("reject")}
                    </button>
                  </>
                ) : null}
                {r.myVote ? (
                  <span className="text-xs text-muted">{t(`voted.${r.myVote}`)}</span>
                ) : null}
                {r.isMine && (r.status === "PENDING_SIGNERS" || r.status === "PENDING_ADMIN") ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => withdrawRevision({ revisionId: r.id }))}
                    className="px-3 py-1.5 rounded-md border border-hairline text-xs disabled:opacity-50"
                  >
                    {t("withdraw")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="text-red-500 text-xs mt-2">{t(`errors.${error}`)}</p> : null}
    </section>
  );
}
```

- [ ] **Step 8: Страница управления — `src/app/[locale]/cabinet/coins/[id]/page.tsx`**

```tsx
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import {
  getViewerCard,
  canEditSection,
  canManageMembers,
  canManagePolicy,
  canVote,
} from "@/lib/coin-card-access";
import { EDITABLE_SECTIONS } from "@/lib/coin-card-form-spec";
import type { CardSection } from "@/lib/coin-card-risk";
import type { DiffEntry } from "@/lib/coin-card-diff";
import { SectionEditor } from "@/components/coin-card-manage/section-editor";
import { CardTeamSection } from "@/components/coin-card-manage/team-section";
import { PolicySection } from "@/components/coin-card-manage/policy-section";
import {
  RevisionsSection,
  type RevisionItem,
} from "@/components/coin-card-manage/revisions-section";

export const dynamic = "force-dynamic";

export default async function CoinCardManagePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coinCard.manage");
  const { userId, card, member } = await getViewerCard(id);
  if (!userId) redirect(`/${locale}/login?next=/${locale}/cabinet/coins/${id}`);
  if (!card || !member) notFound();

  const published = card.status === "APPROVED";
  const policy = card.policy ?? { multisig: false, threshold: 1, sections: [] };

  const [signerCount, revisions] = await Promise.all([
    prisma.coinCardMember.count({ where: { cardId: card.id, isSigner: true } }),
    prisma.coinCardRevision.findMany({
      where: { cardId: card.id, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        author: { select: { username: true, email: true, name: true } },
        approvals: { select: { decision: true, memberId: true } },
      },
    }),
  ]);

  const revisionItems: RevisionItem[] = revisions.map((r) => ({
    id: r.id,
    kind: r.kind,
    section: r.section,
    status: r.status,
    highRisk: r.highRisk,
    diff: (r.diff as unknown as DiffEntry[]) ?? [],
    thresholdAt: r.thresholdAt,
    signerCountAt: r.signerCountAt,
    approvals: r.approvals.filter((a) => a.decision === "APPROVE").length,
    rejections: r.approvals.filter((a) => a.decision === "REJECT").length,
    myVote: r.approvals.find((a) => a.memberId === member.id)?.decision ?? null,
    isMine: r.authorId === userId,
    authorLabel: r.author.username ?? r.author.email ?? r.author.name ?? "—",
    createdAt: r.createdAt.toISOString(),
    adminNote: r.adminNote,
  }));

  const editable = EDITABLE_SECTIONS.filter((s) => canEditSection(member, s as CardSection));
  // The JSONB/child-row shape the editor prefills from.
  const cardForForm = JSON.parse(JSON.stringify(card)) as unknown;

  return (
    <main className="max-w-[860px] mx-auto px-4 md:px-12 py-12 space-y-12">
      <header>
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <h1 className="text-[36px] font-bold tracking-[-0.03em]">{card.name}</h1>
          <span className="num text-sm text-muted">{card.symbol}</span>
          <span
            className={`text-xs px-2 py-1 rounded ${
              card.status === "APPROVED"
                ? "bg-green-500/15 text-green-500"
                : card.status === "REJECTED"
                  ? "bg-red-500/15 text-red-500"
                  : "bg-yellow-500/15 text-yellow-500"
            }`}
          >
            {t(`status.${card.status}`)}
          </span>
          {published ? (
            <a
              href={`/${locale}/coin/${card.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] underline text-muted hover:text-foreground"
            >
              {t("viewPublic")} ↗
            </a>
          ) : null}
        </div>
        <p className="text-muted">
          {published ? t("introPublished") : t("introDraft")} · {card.completeness}%
        </p>
        {card.status === "REJECTED" && card.rejectReason ? (
          <div className="mt-4 p-4 rounded-md border border-red-500/30 bg-red-500/10">
            <div className="text-xs uppercase tracking-wider text-red-400 mb-1">
              {t("rejectReason")}
            </div>
            <div className="text-sm text-red-300">{card.rejectReason}</div>
          </div>
        ) : null}
      </header>

      {editable.length === 0 ? (
        <p className="text-sm text-muted">{t("noSections")}</p>
      ) : (
        editable.map((s) => (
          <section key={s} id={s.toLowerCase()}>
            <h2 className="text-[24px] font-bold tracking-[-0.02em] mb-4">
              {t(`sections.${s}`)}
            </h2>
            <SectionEditor
              cardId={card.id}
              section={s as CardSection}
              card={cardForForm}
              published={published}
            />
          </section>
        ))
      )}

      <RevisionsSection revisions={revisionItems} canVote={canVote(member)} />

      <CardTeamSection
        cardId={card.id}
        viewerId={userId}
        viewerRole={member.role}
        canManage={canManageMembers(member)}
      />

      <PolicySection
        cardId={card.id}
        multisig={policy.multisig}
        threshold={policy.threshold}
        sections={policy.sections}
        signerCount={signerCount}
        canManage={canManagePolicy(member)}
      />
    </main>
  );
}
```

- [ ] **Step 9: Проверить типы и собрать**

Run: `npx tsc --noEmit`
Expected: чисто.

- [ ] **Step 10: Commit**

```bash
git add src/components/cabinet/coins-section.tsx src/components/coin-card-manage \
  src/app/\[locale\]/cabinet/coins src/app/\[locale\]/cabinet/page.tsx
git commit -m "feat(coin-card): кабинет карточки — секции, команда, политика, ревизии"
```

---

### Task 13: Публичная история изменений

**Files:**
- Create: `src/lib/coin-card-history.ts`
- Create: `src/components/coin-card/history-section.tsx`
- Modify: `src/components/coin-card/card-sections.tsx`

Принудительные действия админа (`FORCE_COIN_REVISION`, `DISABLE_COIN_MULTISIG`)
домешиваются в ту же ленту из `AdminAuditLog` — именно поэтому «тихого обхода
не существует».

- [ ] **Step 1: Создать `src/lib/coin-card-history.ts`**

```ts
import { prisma } from "@/lib/prisma";
import type { DiffEntry } from "@/lib/coin-card-diff";

export type HistoryItem =
  | {
      kind: "revision";
      id: string;
      at: string;
      section: string | null;
      isPolicy: boolean;
      author: string;
      diff: DiffEntry[];
    }
  | {
      kind: "admin";
      id: string;
      at: string;
      action: "FORCE_COIN_REVISION" | "DISABLE_COIN_MULTISIG" | "TRANSFER_COIN_CARD";
      reason: string | null;
    };

/**
 * The public audit trail of a card: applied revisions plus the admin's
 * emergency actions. Both halves are shown, so an override is never silent.
 */
export async function getPublicCardHistory(
  cardId: string,
  limit = 30,
): Promise<HistoryItem[]> {
  const [revisions, overrides] = await Promise.all([
    prisma.coinCardRevision.findMany({
      where: { cardId, status: "APPLIED" },
      orderBy: { appliedAt: "desc" },
      take: limit,
      select: {
        id: true, section: true, kind: true, appliedAt: true, createdAt: true,
        author: { select: { username: true, name: true } },
        diff: true,
      },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        targetId: cardId,
        action: { in: ["FORCE_COIN_REVISION", "DISABLE_COIN_MULTISIG", "TRANSFER_COIN_CARD"] },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, action: true, createdAt: true, details: true },
    }),
  ]);

  const items: HistoryItem[] = [
    ...revisions.map((r) => ({
      kind: "revision" as const,
      id: r.id,
      at: (r.appliedAt ?? r.createdAt).toISOString(),
      section: r.section,
      isPolicy: r.kind === "POLICY",
      // A handle, never an email — the team roster itself stays private.
      author: r.author.username ?? r.author.name ?? "—",
      diff: (r.diff as unknown as DiffEntry[]) ?? [],
    })),
    ...overrides.map((a) => ({
      kind: "admin" as const,
      id: a.id,
      at: a.createdAt.toISOString(),
      action: a.action as "FORCE_COIN_REVISION" | "DISABLE_COIN_MULTISIG" | "TRANSFER_COIN_CARD",
      reason:
        a.details && typeof a.details === "object" && "reason" in a.details
          ? String((a.details as { reason?: unknown }).reason ?? "") || null
          : null,
    })),
  ];

  return items.sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, limit);
}
```

- [ ] **Step 2: Создать `src/components/coin-card/history-section.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { getPublicCardHistory } from "@/lib/coin-card-history";

function short(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** Public, by design: who changed what, when, from what to what. */
export async function CardHistorySection({ cardId }: { cardId: string }) {
  const t = await getTranslations("coinCard.history");
  const items = await getPublicCardHistory(cardId);
  if (items.length === 0) return null;

  return (
    <section id="history" className="py-10 border-t border-hairline">
      <div className="num text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
        {t("kicker")}
      </div>
      <h2 className="text-[24px] md:text-[28px] font-bold tracking-[-0.02em] mb-1">
        {t("title")}
      </h2>
      <p className="text-sm text-muted mb-5">{t("subtitle")}</p>

      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.id} className="border border-hairline rounded-md p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="num text-[11px] text-muted">{it.at.slice(0, 10)}</span>
              {it.kind === "revision" ? (
                <>
                  <span className="num text-[11px] uppercase tracking-[0.12em]">
                    {it.isPolicy ? t("policyChange") : t(`section.${it.section}`)}
                  </span>
                  <span className="text-[11px] text-muted">
                    {t("by", { author: it.author })}
                  </span>
                </>
              ) : (
                <span className="text-[11px] uppercase tracking-[0.12em] text-accent">
                  {t(`admin.${it.action}`)}
                </span>
              )}
            </div>
            {it.kind === "revision" ? (
              <ul className="space-y-1">
                {it.diff.slice(0, 6).map((e) => (
                  <li key={e.path} className="text-xs text-muted">
                    <span className="num">{e.path}</span>: {short(e.before)} → {short(e.after)}
                  </li>
                ))}
                {it.diff.length > 6 ? (
                  <li className="text-xs text-muted">{t("more", { count: it.diff.length - 6 })}</li>
                ) : null}
              </ul>
            ) : it.reason ? (
              <p className="text-xs text-muted">{it.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Подключить историю в `src/components/coin-card/card-sections.tsx`**

Добавить импорт `import { CardHistorySection } from "./history-section";` и
вставить `<CardHistorySection cardId={card.id} />` последним элементом внутри
фрагмента, после `<CardLinksSection links={card.links} />`.

- [ ] **Step 4: Проверить типы и закоммитить**

Run: `npx tsc --noEmit`
Expected: чисто.

```bash
git add src/lib/coin-card-history.ts src/components/coin-card/history-section.tsx \
  src/components/coin-card/card-sections.tsx
git commit -m "feat(coin-card): публичная история изменений с админскими переопределениями"
```

---

### Task 14: Истечение ревизий в воркере

**Files:**
- Create: `src/lib/coin-card-expiry.ts`
- Create: `tests/coin-card-expiry.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Написать падающий тест `tests/coin-card-expiry.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { expireStaleRevisions } from "@/lib/coin-card-expiry";

describe("expireStaleRevisions", () => {
  it("expires only unsigned revisions whose deadline has passed", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const now = new Date("2026-11-20T00:00:00.000Z");
    const count = await expireStaleRevisions({ coinCardRevision: { updateMany } }, now);

    expect(count).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: "PENDING_SIGNERS", expiresAt: { lt: now } },
      data: { status: "EXPIRED", decidedAt: now },
    });
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test -- --run tests/coin-card-expiry.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Создать `src/lib/coin-card-expiry.ts`**

```ts
// A revision nobody signed within REVISION_TTL_DAYS is stale, not pending —
// leaving it open forever would make the queue meaningless. Takes a PrismaLike
// so the worker's only scheduled coin-card job is unit-testable.

type PrismaLike = {
  coinCardRevision: {
    updateMany(args: {
      where: { status: "PENDING_SIGNERS"; expiresAt: { lt: Date } };
      data: { status: "EXPIRED"; decidedAt: Date };
    }): Promise<{ count: number }>;
  };
};

export async function expireStaleRevisions(
  prisma: PrismaLike,
  now: Date = new Date(),
): Promise<number> {
  const r = await prisma.coinCardRevision.updateMany({
    where: { status: "PENDING_SIGNERS", expiresAt: { lt: now } },
    data: { status: "EXPIRED", decidedAt: now },
  });
  return r.count;
}
```

- [ ] **Step 4: Тест должен пройти**

Run: `npm test -- --run tests/coin-card-expiry.test.ts`
Expected: PASS.

- [ ] **Step 5: Подключить в `worker/index.ts`**

Добавить импорт рядом с остальными:

```ts
import { expireStaleRevisions } from "../src/lib/coin-card-expiry";
```

Добавить функцию рядом с `runCleanup`:

```ts
async function runRevisionExpiry() {
  const t0 = Date.now();
  try {
    const count = await expireStaleRevisions(prisma);
    if (count > 0) {
      console.log(`[worker] coin revision expiry ok: ${count} expired in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[worker] coin revision expiry failed:", err);
  }
}
```

И расписание в `main()`, рядом с остальными `cron.schedule` — раз в час в 50-ю
минуту, в зазор между другими задачами:

```ts
  cron.schedule("50 * * * *", () => void runRevisionExpiry());
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/coin-card-expiry.ts tests/coin-card-expiry.test.ts worker/index.ts
git commit -m "feat(coin-card): воркер закрывает неподписанные ревизии по истечении срока"
```

**Важно при деплое:** `worker/index.ts` теперь импортирует новый файл из
`src/lib`, значит перезапуск нужен и для `trientes-worker`, а не только для
`trientes-web` (см. CLAUDE.md про stale-lib).

---

### Task 15: Переводы на 10 локалей

**Files:**
- Modify: `messages/en.json`, `messages/ru.json`, `messages/de.json`, `messages/es.json`, `messages/fr.json`, `messages/ja.json`, `messages/ko.json`, `messages/pt-BR.json`, `messages/tr.json`, `messages/zh-CN.json`

Новые пространства ключей:

- `coinCard.manage.*` — `status.{PENDING,APPROVED,REJECTED}`, `sections.{IDENTITY,CONTRACTS,TOKENOMICS,MARKETS,SECURITY,TEAM,LINKS,MARKETING}`, `introDraft`, `introPublished`, `viewPublic`, `rejectReason`, `noSections`, `save`, `saving`, `submitChange`, `addRow`, `removeRow`, `submitted.{SAVED,APPLIED,PENDING_SIGNERS,PENDING_ADMIN}`, `errors.*`
- `coinCard.team.*` — `title`, `subtitleManager`, `subtitleViewer`, `you`, `signer`, `remove`, `saveMember`, `saving`, `confirmRemove`, `invite`, `inviting`, `inviteSuccess`, `identifierPlaceholder`, `role.{OWNER,ADMIN,EDITOR,VIEWER}`, `section.{…8 разделов}`, `errors.*`, `invites.{title,subtitle,create,creating,empty,expires,copy,copied,revoke,errors.*}`
- `coinCard.policy.*` — `title`, `subtitle`, `enable`, `threshold`, `thresholdHint`, `sections`, `sectionsHint`, `save`, `saving`, `applied.{direct,revision}`, `errors.*`
- `coinCard.revision.*` — `title`, `subtitle`, `empty`, `policyChange`, `highRisk`, `author`, `signatures`, `adminNote`, `approve`, `reject`, `withdraw`, `voted.{APPROVE,REJECT}`, `status.{PENDING_SIGNERS,PENDING_ADMIN,APPLIED,REJECTED,EXPIRED,WITHDRAWN,DRAFT}`, `errors.*`
- `coinCard.history.*` — `kicker`, `title`, `subtitle`, `by`, `more`, `policyChange`, `section.*`, `admin.{FORCE_COIN_REVISION,DISABLE_COIN_MULTISIG,TRANSFER_COIN_CARD}`
- `coinCard.wizard.*` — дозаписать метки полей, которых не было в A1 и которые
  требует `SECTION_SPECS`: `address`, `decimals`, `standard`, `explorerUrl`,
  `canonical`, `marketKind`, `exchange`, `pair`, `tradeUrl`, `poolAddress`,
  `milestoneDate`, `milestoneStatus`, `partners`, `burn`, `flagMintable`,
  `flagPausable`, `flagBlacklist`, `flagTransferTax`, `flagProxy`,
  `flagLpLocked`, `tags`, `launchDate`
- `cabinet.coins.*` — `title`, `subtitle`, `empty`, `submitLink`, `role`, `status.*`
- `inviteCoin.*` — `kicker`, `title`, `titleInvalid`, `roleLine`, `state.{valid,expired,accepted,revoked,invalid}`, `signInFirst`, `signIn`, `register`, `join`, `joining`, `backHome`, `errors.*`
- `admin.coinRevisions.*` — `title`, `subtitle`, `empty`, `policyChange`, `highRisk`, `author`, `signatures`, `apply`, `reject`, `force`, `reasonPlaceholder`, `errors.*`

Коды в `errors.*` обязаны покрывать все возвраты серверных действий:
`unauth`, `forbidden`, `not_found`, `invalid`, `no_changes`, `revision_closed`,
`not_a_signer`, `already_voted`, `last_owner`, `threshold_unreachable`,
`threshold_out_of_range`, `user_not_found`, `self`, `too_many`, `accepted`,
`expired`, `revoked`, `reason_too_short`, `section_unsupported`,
`too_many_contracts`, `too_many_markets`, `market_incomplete`, `url_invalid`,
`website_required`, `supply_inconsistent`, `supply_negative`, `date_invalid`,
`symbol_required`, `symbol_too_long`, `symbol_invalid`, `name_required`,
`name_too_long`, `tagline_too_long`, `description_too_long`, `chain_unknown`,
`contract_required`, `contract_invalid`, `decimals_invalid`, `unknown`.

- [ ] **Step 1: Написать блок ключей для `messages/en.json`**

Это текстовая работа, механически одинаковая для всех локалей. Порядок:
сначала полный блок на английском, затем перевод на остальные девять. Значения
берутся по смыслу, placeholders — в формате next-intl (`{role}`, `{m}`, `{n}`,
`{count}`, `{author}`, `{approvals}`, `{threshold}`, `{rejections}`,
`{signers}`, `{date}`, `{note}`, `{coin}`, `{name}`).

- [ ] **Step 2: Проверить, что все 10 файлов — валидный JSON и ключи совпадают**

```bash
node -e '
const fs=require("fs");
const en=JSON.parse(fs.readFileSync("messages/en.json","utf8"));
const paths=(o,p="")=>Object.entries(o).flatMap(([k,v])=>
  v&&typeof v==="object"&&!Array.isArray(v)?paths(v,p+k+"."):[p+k]);
const want=paths(en);
for(const f of fs.readdirSync("messages")){
  const m=JSON.parse(fs.readFileSync("messages/"+f,"utf8"));
  const have=new Set(paths(m));
  const miss=want.filter(k=>!have.has(k));
  console.log(f, miss.length?("MISSING "+miss.length+": "+miss.slice(0,10).join(", ")):"ok");
}'
```

Expected: `ok` для всех десяти файлов.

- [ ] **Step 3: Commit**

```bash
git add messages
git commit -m "i18n(coin-card): переводы команды, политики и ревизий на 10 локалей"
```

---

### Task 16: Сборка, проверка, деплой

**Files:** —

- [ ] **Step 1: Весь набор тестов**

Run: `npm test -- --run`
Expected: PASS, включая новые `coin-card-{sections,diff,multisig,access,form-spec,expiry}`.

- [ ] **Step 2: Типы и линт**

Run: `npx tsc --noEmit && npm run lint`
Expected: чисто.

- [ ] **Step 3: Прод-сборка**

Run: `npm run build`
Expected: сборка без ошибок; в списке маршрутов должны появиться
`/[locale]/cabinet/coins/[id]` и `/[locale]/invite/coin/[token]`.

- [ ] **Step 4: Рестарт процессов**

```bash
pm2 restart trientes-web
pm2 restart trientes-worker   # worker импортирует новый src/lib/coin-card-expiry.ts
pm2 save
```

- [ ] **Step 5: Дымовой тест в проде**

```bash
curl -s -o /dev/null -w '%{http_code} ' https://trientes.org/ru/cabinet
curl -s -o /dev/null -w '%{http_code} ' https://trientes.org/ru/admin/coin-cards
curl -s -o /dev/null -w '%{http_code}\n' https://trientes.org/ru/invite/coin/nope
```

Expected: `/cabinet` и `/admin/coin-cards` отдают 200 либо 307 на `/login`
(зависит от cookie), страница приглашения с мусорным токеном — 200 с текстом
«ссылка недействительна» (она рендерит состояние `invalid`, а не 404).

- [ ] **Step 6: Push**

```bash
git push origin main
```

---

## Самопроверка плана против спеки

| Требование спеки | Задача |
|---|---|
| Участники карточки, роли `OWNER/ADMIN/EDITOR/VIEWER` | 7, 12 |
| Права по разделам (`sections[]` значимы только для EDITOR) | 5, 7, 11, 12 |
| `ADMIN` не трогает `OWNER`, последний `OWNER` защищён | 5, 7 |
| Приглашение по юзернейму/email | 7 |
| Одноразовые ссылки-приглашения, ≤20 активных, 14 дней, гонка через `updateMany` | 1, 8 |
| Ревизия = одно сохранение одной секции, diff `[{path,before,after}]` | 3, 6 |
| `highRisk` из `coin-card-risk.ts`, маршрут «модератор / сразу» | 4, 6 |
| Мультисиг M-из-N, авто-подпись автора, снимки `thresholdAt/signerCountAt` | 4, 6 |
| Отказ по арифметике `rejects > N - M`, без права вето | 4, 6 |
| `threshold_out_of_range`, `threshold_unreachable` | 4, 7, 9 |
| Изменение политики при включённом мультисиге — через мультисиг, без модератора | 9 |
| `EXPIRED` по истечении `REVISION_TTL_DAYS`, чистит воркер | 14 |
| Очередь модерации показывает ревизию как diff, Reject с причиной ≥3 | 10 |
| Аварийный выход админа (`FORCE`, `DISABLE_MULTISIG`), виден публично | 10, 13 |
| Передача карточки проекту (`TRANSFER_COIN_CARD`), куратор → `EDITOR` | 10 |
| Публичная история изменений | 13 |
| Уведомления подписантам и автору через `notifyUser` | 6, 7, 8, 9, 10 |
| Переводы на 10 локалей | 15 |
| Тесты: матрица прав, мультисиг, diff, нормализация, истечение | 2, 3, 4, 5, 11, 14 |

**Сознательно вне A2** (и вне A в целом): автопроверка контрактов через RPC (B),
агрегатор рынков (C), доказательство владения подписью/DNS (D), календарь
разлоков (E), автосвязка с POI (F), донаты (G). Гонка двух переходов по одной
ссылке проверяется условным `updateMany` в коде (Task 8), интеграционного теста
с живой базой в этом слайсе нет — как и в слайсе с `company-invites`.
