# Роль комплайнса: права по очередям — план (слайс AS)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** владелец выдаёт сотруднику комплайнса уровень доступа по каждой из восьми очередей
дел, приглашает его ссылкой или по логину с уже отмеченными правами, а правило четырёх глаз
начинает считаться по тем, у кого есть право утверждать именно в этой очереди.

**Architecture:** политика прав — чистые функции (`src/lib/authz/policy.ts`), охранник над
Prisma — `src/lib/authz/guard.ts`; данные — `StaffMember` (должность, срок пересмотра, отзыв),
`StaffGrant` (`userId` × очередь × уровень, необязательный срок), `StaffInvite` (пакет доступа,
в базе только sha256 ссылки). Все 58 вызовов `checkAdmin()` заменяются на `requireStaff()` /
`requireQueue(queue, level)` / `requireOwner()` по карте из спеки.

**Tech Stack:** Next.js (App Router, server actions), Prisma + Postgres, vitest, next-intl,
PM2 (`trientes-web`, `trientes-worker`).

**Спека:** `docs/superpowers/specs/2026-11-17-compliance-staff-roles-design.md`

---

## Файлы

**Создать:**
- `prisma/migrations/20261118120000_staff_roles/migration.sql` — значения enum `Role`
- `prisma/migrations/20261118121000_staff_roles_backfill/migration.sql` — `ADMIN → OWNER`
- `prisma/migrations/20261118130000_staff_access/migration.sql` — три таблицы и `StaffLevel`
- `prisma/migrations/20261118140000_staff_access_enums/migration.sql` — звонок и коды аудита
- `src/lib/authz/policy.ts` — чистая политика (уровни, видимые очереди, владелец)
- `src/lib/authz/guard.ts` — чтение доступа из базы и охранники для действий
- `src/lib/authz/map.ts` — карта «экран/действие → требование» (ею же проверяется полнота)
- `src/lib/authz/conflict.ts` — конфликт интересов
- `src/lib/staff/presets.ts` — четыре готовые должности
- `src/lib/staff/invites.ts` — sha256 ссылки, разбор и проверка пакета прав
- `src/lib/staff-access-sweep.ts` — прогон пересмотра доступа
- `src/app/actions/staff-access.ts` — выдача, правка, отзыв, возврат, «пересмотр пройден»
- `src/app/actions/staff-invites.ts` — создать, отозвать, принять приглашение
- `src/components/admin/staff-access.tsx` — список сотрудников и матрица прав
- `src/components/admin/staff-invite-form.tsx` — форма приглашения
- `src/app/[locale]/staff-invite/[token]/page.tsx` — приём приглашения
- тесты: `tests/authz-policy.test.ts`, `tests/authz-map.test.ts`,
  `tests/authz-conflict.test.ts`, `tests/staff-presets.test.ts`,
  `tests/staff-invites.test.ts`, `tests/staff-access-review.test.ts`

**Изменить:**
- `prisma/schema.prisma` — `Role`, `StaffLevel`, три модели, связи в `User`, enum звонков и аудита
- `src/lib/is-admin.ts` — `checkAdmin` становится `requireStaff` (имя сохраняется как алиас)
- `src/auth.ts` — `ADMIN_WHITELIST` пишет `OWNER`
- `src/lib/admin/set-user-role.ts` — `last_admin` → `last_owner`, значения роли
- `src/lib/cases/approval.ts` — вторая подпись считается по очереди
- `src/app/actions/case-review.ts`, `cases.ts`, `case-messages.ts` — охранники уровня
- `src/app/actions/admin-coin-cards.ts`, `admin-company.ts`, `admin-points.ts`,
  `admin-exchange.ts`, `admin-fintech.ts`, `admin-requests.ts`, `kyb.ts`,
  `admin-coin-revisions.ts`, `point-supervision.ts`, `company-supervision.ts`,
  `admin-users.ts`, `admin-coins.ts` — охранники уровня
- страницы `/admin/**` — охранники и фильтр плиток
- `src/components/admin/nav.tsx` — закладки по доступу
- `worker/index.ts` — прогон `45 5 * * *`
- `messages/en.json` + `npm run i18n`
- `CLAUDE.md` — слайс AS

---

### Task 1: Схема и миграции

**Files:**
- Modify: `prisma/schema.prisma`
- Create: четыре файла миграций (пути выше)

- [ ] **Step 1: значения `Role`**

`prisma/migrations/20261118120000_staff_roles/migration.sql`:

```sql
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STAFF';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER';
```

- [ ] **Step 2: перевести владельцев**

`prisma/migrations/20261118121000_staff_roles_backfill/migration.sql`:

```sql
-- Отдельной миграцией: новое значение enum нельзя использовать в той же
-- транзакции, где оно добавлено.
UPDATE "User" SET "role" = 'OWNER' WHERE "role" = 'ADMIN';
```

- [ ] **Step 3: таблицы доступа**

`prisma/migrations/20261118130000_staff_access/migration.sql`:

```sql
CREATE TYPE "StaffLevel" AS ENUM ('VIEW', 'HANDLE', 'APPROVE');

CREATE TABLE "StaffMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "duties" TEXT,
  "invitedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accessReviewAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "revokeReason" TEXT,
  CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffMember_userId_key" ON "StaffMember"("userId");
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "queue" TEXT NOT NULL,
  "level" "StaffLevel" NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffGrant_userId_queue_key" ON "StaffGrant"("userId", "queue");
CREATE INDEX "StaffGrant_queue_level_idx" ON "StaffGrant"("queue", "level");
ALTER TABLE "StaffGrant" ADD CONSTRAINT "StaffGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffInvite" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "identifier" TEXT,
  "title" TEXT,
  "duties" TEXT,
  "grants" JSONB NOT NULL,
  "invitedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "acceptedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");
CREATE INDEX "StaffInvite_invitedById_idx" ON "StaffInvite"("invitedById");
```

- [ ] **Step 4: звонок и коды аудита**

`prisma/migrations/20261118140000_staff_access_enums/migration.sql`:

```sql
ALTER TYPE "AdminNotificationKind" ADD VALUE IF NOT EXISTS 'ACCESS_REVIEW_DUE';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_INVITED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_INVITE_REVOKED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_ACCESS_CHANGED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_ACCESS_REVOKED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'STAFF_ACCESS_RESTORED';
ALTER TYPE "AdminAction" ADD VALUE IF NOT EXISTS 'ACCESS_REVIEW_PASSED';
```

- [ ] **Step 5: `prisma/schema.prisma`** — добавить `STAFF`, `OWNER` в `Role` (значение `ADMIN`
      оставить: оно читается политикой как владелец), `enum StaffLevel`, три модели из спеки,
      обратные связи в `User` (`staffMember StaffMember?`, `staffGrants StaffGrant[]`),
      новые значения в `AdminNotificationKind` и `AdminAction`, `"StaffInvite"` в типах цели
      аудита (`src/lib/admin/audit.ts:14`).

- [ ] **Step 6: применить и сгенерировать**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: `4 migrations applied`, затем `Generated Prisma Client`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/admin/audit.ts
git commit -m "feat(db): права сотрудника по очередям, приглашение и пересмотр доступа"
```

---

### Task 2: Политика прав (чистая)

**Files:**
- Create: `src/lib/authz/policy.ts`
- Test: `tests/authz-policy.test.ts`

- [ ] **Step 1: тест**

```ts
import { describe, expect, it } from "vitest";
import { can, isOwnerRole, levelFor, visibleQueues, type ViewerAccess } from "@/lib/authz/policy";

const NOW = new Date("2026-11-18T10:00:00Z");

function access(p: Partial<ViewerAccess> = {}): ViewerAccess {
  return { userId: "u1", role: "STAFF", revokedAt: null, grants: [], ...p };
}

describe("уровни", () => {
  it("APPROVE включает HANDLE и VIEW", () => {
    const a = access({ grants: [{ queue: "coinCards", level: "APPROVE", expiresAt: null }] });
    expect(can(a, "coinCards", "VIEW", NOW)).toBe(true);
    expect(can(a, "coinCards", "HANDLE", NOW)).toBe(true);
    expect(can(a, "coinCards", "APPROVE", NOW)).toBe(true);
  });

  it("HANDLE не даёт APPROVE", () => {
    const a = access({ grants: [{ queue: "coinCards", level: "HANDLE", expiresAt: null }] });
    expect(can(a, "coinCards", "APPROVE", NOW)).toBe(false);
  });

  it("нет строки — нет доступа", () => {
    expect(can(access(), "coinCards", "VIEW", NOW)).toBe(false);
  });

  it("истёкший грант не действует", () => {
    const a = access({
      grants: [{ queue: "kyb", level: "APPROVE", expiresAt: new Date("2026-11-17T00:00:00Z") }],
    });
    expect(levelFor(a, "kyb", NOW)).toBe(null);
  });

  it("владелец может всё и видит все очереди", () => {
    const a = access({ role: "OWNER" });
    expect(can(a, "fintech", "APPROVE", NOW)).toBe(true);
    expect(visibleQueues(a, NOW)).toHaveLength(8);
  });

  it("ADMIN читается как владелец — наследие", () => {
    expect(isOwnerRole("ADMIN")).toBe(true);
    expect(can(access({ role: "ADMIN" }), "points", "APPROVE", NOW)).toBe(true);
  });

  it("отозванный доступ не действует даже с грантами", () => {
    const a = access({
      revokedAt: new Date("2026-11-17T00:00:00Z"),
      grants: [{ queue: "points", level: "APPROVE", expiresAt: null }],
    });
    expect(can(a, "points", "VIEW", NOW)).toBe(false);
    expect(visibleQueues(a, NOW)).toEqual([]);
  });

  it("видимые очереди — только выданные", () => {
    const a = access({
      grants: [
        { queue: "coinCards", level: "HANDLE", expiresAt: null },
        { queue: "exchanges", level: "VIEW", expiresAt: null },
      ],
    });
    expect(visibleQueues(a, NOW)).toEqual(["coinCards", "exchanges"]);
  });
});
```

- [ ] **Step 2: запустить — должен упасть**

Run: `npx vitest run tests/authz-policy.test.ts`
Expected: FAIL, `Cannot find module '@/lib/authz/policy'`.

- [ ] **Step 3: реализация**

```ts
/**
 * Политика прав: кто что может. Без Prisma и без сессии — всё, что нужно для
 * решения, приходит аргументом. Одна точка решения вместо 58 проверок
 * «ты админ или нет».
 */
import { QUEUES, type QueueKey } from "@/lib/cases/queues";

export type StaffLevel = "VIEW" | "HANDLE" | "APPROVE";
export type ViewerRole = "USER" | "STAFF" | "OWNER" | "ADMIN";

export type GrantRow = { queue: string; level: StaffLevel; expiresAt: Date | null };

export type ViewerAccess = {
  userId: string;
  role: ViewerRole;
  /** Отзыв доступа сотрудника. Строка сотрудника остаётся для журнала. */
  revokedAt: Date | null;
  grants: GrantRow[];
};

const ORDER: Record<StaffLevel, number> = { VIEW: 1, HANDLE: 2, APPROVE: 3 };

/**
 * `ADMIN` — наследие: значение из enum в Postgres внутри одной миграции не
 * убрать, а оставить его бесправным значило бы запереть живую запись владельца.
 */
export function isOwnerRole(role: ViewerRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function isStaffRole(role: ViewerRole): boolean {
  return role === "STAFF" || isOwnerRole(role);
}

export function levelFor(access: ViewerAccess, queue: string, now: Date): StaffLevel | null {
  if (access.revokedAt) return null;
  if (isOwnerRole(access.role)) return "APPROVE";
  const g = access.grants.find((x) => x.queue === queue);
  if (!g) return null;
  if (g.expiresAt && g.expiresAt.getTime() <= now.getTime()) return null;
  return g.level;
}

export function can(access: ViewerAccess, queue: string, need: StaffLevel, now: Date): boolean {
  const have = levelFor(access, queue, now);
  return !!have && ORDER[have] >= ORDER[need];
}

/** Любая из очередей на нужном уровне — для действий над объектом двух очередей. */
export function canAny(
  access: ViewerAccess,
  queues: string[],
  need: StaffLevel,
  now: Date,
): boolean {
  return queues.some((q) => can(access, q, need, now));
}

export function visibleQueues(access: ViewerAccess, now: Date): QueueKey[] {
  return QUEUES.map((q) => q.key).filter((key) => can(access, key, "VIEW", now));
}

/** Экраны, которые делами не являются: права, пользователи, аудит, аналитика, каталог. */
export function canOwnerOnly(access: ViewerAccess): boolean {
  return !access.revokedAt && isOwnerRole(access.role);
}
```

- [ ] **Step 4: запустить — должен пройти**

Run: `npx vitest run tests/authz-policy.test.ts`
Expected: PASS (8 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/lib/authz/policy.ts tests/authz-policy.test.ts
git commit -m "feat(authz): политика прав по очередям"
```

---

### Task 3: Карта требований по экранам и действиям

**Files:**
- Create: `src/lib/authz/map.ts`
- Test: `tests/authz-map.test.ts`

Карта нужна не коду охранников, а **полноте**: она перечисляет каждый экран и каждое
действие админки с его требованием, и тест ловит и забытый экран, и требование без экрана
(тот же приём, что у листов проверок в AP).

- [ ] **Step 1: тест**

```ts
import { describe, expect, it } from "vitest";
import { ACCESS_MAP, requirementFor, SUBJECT_QUEUES } from "@/lib/authz/map";
import { QUEUES } from "@/lib/cases/queues";

describe("карта прав", () => {
  it("у каждой записи внятное требование", () => {
    for (const row of ACCESS_MAP) {
      if (row.need === "owner" || row.need === "staff") continue;
      expect(row.queues.length).toBeGreaterThan(0);
      for (const q of row.queues) {
        expect(QUEUES.some((x) => x.key === q)).toBe(true);
      }
    }
  });

  it("ключи не повторяются", () => {
    const keys = ACCESS_MAP.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("у каждого типа дела есть своя очередь", () => {
    for (const [, queues] of Object.entries(SUBJECT_QUEUES)) {
      expect(queues.length).toBeGreaterThan(0);
    }
  });

  it("дело жалобы решает тот, кто вправе по точкам или по жалобам", () => {
    expect(SUBJECT_QUEUES.POINT_REPORT).toEqual(["points", "pointReports"]);
  });

  it("requirementFor находит запись по ключу", () => {
    expect(requirementFor("decideCase")?.need).toBe("APPROVE");
    expect(requirementFor("adminUsers")?.need).toBe("owner");
    expect(requirementFor("нет такого")).toBe(null);
  });
});
```

- [ ] **Step 2: запустить — упадёт**

Run: `npx vitest run tests/authz-map.test.ts`
Expected: FAIL, `Cannot find module '@/lib/authz/map'`.

- [ ] **Step 3: реализация**

```ts
/**
 * Карта «экран или действие → требование». Нужна полноте: по ней видно, что ни
 * один экран админки не остался без охранника, и ею же сверяется, что у
 * требования есть место применения.
 */
import type { CaseSubjectType } from "@prisma/client";
import type { StaffLevel } from "@/lib/authz/policy";
import type { QueueKey } from "@/lib/cases/queues";

export type Requirement = {
  key: string;
  /** `staff` — любая калитка в админку; `owner` — не дело, а управление системой. */
  need: StaffLevel | "staff" | "owner";
  queues: QueueKey[];
};

/**
 * Очередь объекта по типу дела. У жалобы на точку решение снимает саму точку,
 * поэтому надзор вправе вести и тот, кому выдали `points`, и тот, кому выдали
 * `pointReports`: обе очереди про один объект.
 */
export const SUBJECT_QUEUES: Record<CaseSubjectType, QueueKey[]> = {
  COIN_CARD: ["coinCards"],
  COMPANY: ["companies"],
  POINT: ["points"],
  EXCHANGE: ["exchanges"],
  FINTECH: ["fintech"],
  KYB: ["kyb"],
  COIN_REQUEST: ["coinRequests"],
  POINT_REPORT: ["points", "pointReports"],
};

export const ACCESS_MAP: Requirement[] = [
  { key: "adminRoot", need: "staff", queues: [] },
  { key: "adminQueues", need: "staff", queues: [] },
  { key: "adminNotifications", need: "staff", queues: [] },
  { key: "caseHeartbeatOnly", need: "staff", queues: [] },

  { key: "queueList", need: "VIEW", queues: [...allQueues()] },
  { key: "casePage", need: "VIEW", queues: [...allQueues()] },
  { key: "claimCase", need: "HANDLE", queues: [...allQueues()] },
  { key: "releaseCase", need: "HANDLE", queues: [...allQueues()] },
  { key: "adjustCaseTime", need: "HANDLE", queues: [...allQueues()] },
  { key: "sendStaffMessage", need: "HANDLE", queues: [...allQueues()] },
  { key: "setCaseCheck", need: "HANDLE", queues: [...allQueues()] },
  { key: "setDocumentVerdict", need: "HANDLE", queues: [...allQueues()] },
  { key: "markReviewed", need: "HANDLE", queues: [...allQueues()] },
  { key: "decideCase", need: "APPROVE", queues: [...allQueues()] },

  { key: "coinCardDecision", need: "APPROVE", queues: ["coinCards"] },
  { key: "coinCardRevisions", need: "APPROVE", queues: ["coinCards"] },
  { key: "companyDecision", need: "APPROVE", queues: ["companies"] },
  { key: "companySupervision", need: "APPROVE", queues: ["companies"] },
  { key: "kybDecision", need: "APPROVE", queues: ["kyb"] },
  { key: "pointDecision", need: "APPROVE", queues: ["points"] },
  { key: "pointSupervision", need: "APPROVE", queues: ["points", "pointReports"] },
  { key: "exchangeDecision", need: "APPROVE", queues: ["exchanges"] },
  { key: "fintechDecision", need: "APPROVE", queues: ["fintech"] },
  { key: "fintechCuration", need: "APPROVE", queues: ["fintech"] },
  { key: "coinRequestDecision", need: "APPROVE", queues: ["coinRequests"] },

  { key: "adminHistoryCoinCards", need: "VIEW", queues: ["coinCards"] },
  { key: "adminHistoryBusiness", need: "VIEW", queues: ["companies", "points", "kyb"] },
  { key: "adminHistoryExchanges", need: "VIEW", queues: ["exchanges"] },
  { key: "adminHistoryFintech", need: "VIEW", queues: ["fintech"] },
  { key: "adminHistoryRequests", need: "VIEW", queues: ["coinRequests"] },

  { key: "adminStaff", need: "owner", queues: [] },
  { key: "staffAccess", need: "owner", queues: [] },
  { key: "staffInvites", need: "owner", queues: [] },
  { key: "adminUsers", need: "owner", queues: [] },
  { key: "adminAudit", need: "owner", queues: [] },
  { key: "adminAnalytics", need: "owner", queues: [] },
  { key: "adminCoins", need: "owner", queues: [] },
];

function allQueues(): QueueKey[] {
  return [
    "coinCards",
    "companies",
    "points",
    "exchanges",
    "fintech",
    "kyb",
    "coinRequests",
    "pointReports",
  ];
}

export function requirementFor(key: string): Requirement | null {
  return ACCESS_MAP.find((r) => r.key === key) ?? null;
}
```

- [ ] **Step 4: запустить — пройдёт**

Run: `npx vitest run tests/authz-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/authz/map.ts tests/authz-map.test.ts
git commit -m "feat(authz): карта требований по экранам и действиям"
```

---

### Task 4: Охранник над базой

**Files:**
- Create: `src/lib/authz/guard.ts`
- Modify: `src/lib/is-admin.ts`

- [ ] **Step 1: реализация охранника**

```ts
/**
 * Охранник: читает доступ из базы и отвечает на вопрос действия. Политика
 * решает, охранник только подаёт ей факты (разделение политики и охранника).
 */
import { cache } from "react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  can,
  canAny,
  canOwnerOnly,
  isStaffRole,
  levelFor,
  type StaffLevel,
  type ViewerAccess,
  type ViewerRole,
} from "@/lib/authz/policy";
import { SUBJECT_QUEUES } from "@/lib/authz/map";
import type { CaseSubjectType } from "@prisma/client";

export type DenyReason = "unauth" | "no_access";
export type GuardResult =
  | { ok: true; userId: string; access: ViewerAccess }
  | { ok: false; reason: DenyReason };

/** Один запрос на запрос страницы: роль, отзыв и гранты. */
export const loadViewerAccess = cache(async (): Promise<ViewerAccess | null> => {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      role: true,
      staffMember: { select: { revokedAt: true } },
      staffGrants: { select: { queue: true, level: true, expiresAt: true } },
    },
  });
  if (!row) return null;
  return {
    userId: row.id,
    role: row.role as ViewerRole,
    revokedAt: row.staffMember?.revokedAt ?? null,
    grants: row.staffGrants,
  };
});

export async function requireStaff(): Promise<GuardResult> {
  const access = await loadViewerAccess();
  if (!access) return { ok: false, reason: "unauth" };
  if (access.revokedAt || !isStaffRole(access.role)) return { ok: false, reason: "no_access" };
  return { ok: true, userId: access.userId, access };
}

export async function requireQueue(queue: string, need: StaffLevel): Promise<GuardResult> {
  const r = await requireStaff();
  if (!r.ok) return r;
  if (!can(r.access, queue, need, new Date())) return { ok: false, reason: "no_access" };
  return r;
}

/** Объект, за который отвечают две очереди (точка в делах жалоб). */
export async function requireAnyQueue(queues: string[], need: StaffLevel): Promise<GuardResult> {
  const r = await requireStaff();
  if (!r.ok) return r;
  if (!canAny(r.access, queues, need, new Date())) return { ok: false, reason: "no_access" };
  return r;
}

export async function requireSubject(
  subjectType: CaseSubjectType,
  need: StaffLevel,
): Promise<GuardResult> {
  return requireAnyQueue(SUBJECT_QUEUES[subjectType], need);
}

export async function requireOwner(): Promise<GuardResult> {
  const access = await loadViewerAccess();
  if (!access) return { ok: false, reason: "unauth" };
  if (!canOwnerOnly(access)) return { ok: false, reason: "no_access" };
  return { ok: true, userId: access.userId, access };
}

export async function myLevel(queue: string): Promise<StaffLevel | null> {
  const access = await loadViewerAccess();
  return access ? levelFor(access, queue, new Date()) : null;
}
```

- [ ] **Step 2: `src/lib/is-admin.ts` — одна дверь**

`checkAdmin()` оставить именем (58 вызовов), но свести к `requireStaff()`, а причину
`not_admin` переименовать в `no_access`. Сигнатура результата сохраняется
(`{ ok: true; userId }`), чтобы правка шла по месту вызова, а не по всему файлу сразу:

```ts
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/authz/guard";

export type AdminCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unauth" | "no_access" };

/** Базовая калитка в админку: вошёл, сотрудник или владелец, доступ не отозван. */
export async function checkAdmin(): Promise<AdminCheckResult> {
  const r = await requireStaff();
  return r.ok ? { ok: true, userId: r.userId } : { ok: false, reason: r.reason };
}

export async function requireAdmin(redirectLocale: string): Promise<string> {
  const r = await checkAdmin();
  if (!r.ok) redirect(`/${redirectLocale}/login`);
  return r.userId;
}
```

- [ ] **Step 3: сборка типов**

Run: `npx tsc --noEmit`
Expected: ошибки только там, где код сравнивал `reason === "not_admin"` — поправить на
`"no_access"` (`grep -rn "not_admin" src/`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/authz/guard.ts src/lib/is-admin.ts src
git commit -m "feat(authz): охранник доступа над базой"
```

---

### Task 5: Охранники в действиях по делам

**Files:**
- Modify: `src/app/actions/cases.ts`, `src/app/actions/case-review.ts`,
  `src/app/actions/case-messages.ts`

Правило правки одно: вместо `const admin = await checkAdmin()` — чтение дела, затем
`requireSubject(c.subjectType, <уровень>)`. Порядок важен: сначала узнаём тип дела, потом
спрашиваем право; дело, которого нет, отвечает `not_found`, а не `no_access` — иначе по
коду отказа можно было бы перебирать существующие дела.

- [ ] **Step 1:** `cases.ts` — `claimCase`, `releaseCase`, `adjustCaseTime` → `HANDLE`;
      `caseHeartbeat` → `HANDLE` (сеанс времени не должен открываться у того, кто только смотрит).

```ts
const c = await prisma.complianceCase.findUnique({
  where: { id: input.caseId },
  select: { /* …как было… */ subjectType: true },
});
if (!c) return { ok: false as const, reason: "not_found" as const };
const guard = await requireSubject(c.subjectType, "HANDLE");
if (!guard.ok) return { ok: false as const, reason: guard.reason };
```

- [ ] **Step 2:** `case-review.ts` — `setCaseCheck`, `setDocumentVerdict`, `markReviewed` →
      `HANDLE`; `decideCase` → `APPROVE`. У `setDocumentVerdict` тип дела читается через
      `caseDocument.case.subjectType`.

- [ ] **Step 3:** `case-messages.ts` — отправка сообщения сотрудником → `HANDLE`;
      отметка прочтения — `requireStaff()` (чтение не меняет дела). Действия заявителя
      (`src/app/actions/case-messages.ts`, половина кабинета) не трогать.

- [ ] **Step 4: проверка**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, без ошибок типов.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/cases.ts src/app/actions/case-review.ts src/app/actions/case-messages.ts
git commit -m "feat(authz): уровень доступа в действиях по делу"
```

---

### Task 6: Охранники в действиях старых экранов

**Files:**
- Modify: `src/app/actions/admin-coin-cards.ts`, `admin-coin-revisions.ts`, `admin-company.ts`,
  `admin-points.ts`, `admin-exchange.ts`, `admin-fintech.ts`, `admin-requests.ts`, `kyb.ts`,
  `point-supervision.ts`, `company-supervision.ts`, `admin-users.ts`, `admin-coins.ts`

- [ ] **Step 1:** в каждом файле заменить `checkAdmin()` на охранник из карты:

| Файл | Требование |
|---|---|
| `admin-coin-cards.ts`, `admin-coin-revisions.ts` | `requireQueue("coinCards", "APPROVE")` |
| `admin-company.ts` (решения, удаление, восстановление) | `requireQueue("companies", "APPROVE")` |
| `company-supervision.ts` | `requireQueue("companies", "APPROVE")` |
| `kyb.ts` (решения админа) | `requireQueue("kyb", "APPROVE")` |
| `admin-points.ts` | `requireQueue("points", "APPROVE")` |
| `point-supervision.ts` | `requireAnyQueue(["points", "pointReports"], "APPROVE")` |
| `admin-exchange.ts` | `requireQueue("exchanges", "APPROVE")` |
| `admin-fintech.ts` | `requireQueue("fintech", "APPROVE")` |
| `admin-requests.ts` | `requireQueue("coinRequests", "APPROVE")` |
| `admin-users.ts`, `admin-coins.ts` | `requireOwner()` |

Действия заявителя в `kyb.ts` (подача документов владельцем компании) охранником админки не
накрываются — у них свой гейт `canEditCompany`.

- [ ] **Step 2:** `src/lib/admin/set-user-role.ts` — значения роли `"USER" | "STAFF" | "OWNER"`,
      код отказа `last_owner`, счёт владельцев `role: { in: ["OWNER", "ADMIN"] }`.

- [ ] **Step 3:** `src/auth.ts` — в обоих местах повышения по `ADMIN_WHITELIST` писать
      `role: "OWNER"`.

- [ ] **Step 4: проверка**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. Затем `grep -rn "checkAdmin(" src/app/actions/` — остаться должны только
`cases.ts` (биение) и чтение звонков.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions src/lib/admin/set-user-role.ts src/auth.ts tests
git commit -m "feat(authz): уровень доступа в действиях старых экранов"
```

---

### Task 7: Охранники и видимость на страницах

**Files:**
- Modify: `src/app/[locale]/admin/layout.tsx`, `queues/page.tsx`, `queues/[queue]/page.tsx`,
  `cases/[id]/page.tsx`, `staff/page.tsx`, `users/page.tsx`, `audit/page.tsx`,
  `analytics/page.tsx`, `coins/page.tsx`, `requests/page.tsx`, `coin-cards/page.tsx`,
  `business/page.tsx`, `companies/[id]/page.tsx`, `exchanges/page.tsx`, `fintech/page.tsx`,
  `src/components/admin/nav.tsx`

- [ ] **Step 1:** `layout.tsx` — остаётся `checkAdmin()`: калитка в админку общая.

- [ ] **Step 2:** `/admin/queues` — плитки фильтруются `visibleQueues(access, now)`; дела
      считаются только по видимым очередям (иначе число непрочитанного выдавало бы чужую
      очередь). Пустой список — строка «доступ не выдан» (`admin.errors.no_access`).

- [ ] **Step 3:** `/admin/queues/[queue]` и `/admin/cases/[id]` — `requireQueue(queue, "VIEW")`
      и `requireSubject(c.subjectType, "VIEW")`; отказ → `notFound()`. Кнопки раскрытия дела
      рисуются по `myLevel`: «взять», «написать», «проверил» — от `HANDLE`, «Одобрить» и
      «Отклонить» — от `APPROVE`. Серверная проверка остаётся: скрытая кнопка не защита.

- [ ] **Step 4:** страницы владельца (`staff`, `users`, `audit`, `analytics`, `coins`) —
      `requireOwner()`, отказ → `redirect(/{locale}/admin/queues)`.

- [ ] **Step 5:** старые экраны истории (`requests`, `coin-cards`, `business`, `exchanges`,
      `fintech`, `companies/[id]`) — `requireQueue(<своя очередь>, "VIEW")`, отказ → `notFound()`.

- [ ] **Step 6:** `nav.tsx` — закладка рисуется, если доступна: `queues` и `notifications`
      всем сотрудникам, `staff`/`users`/`audit`/`analytics`/`coins` — владельцу, остальные —
      по `VIEW` своей очереди.

- [ ] **Step 7: проверка**

Run: `npm run build`
Expected: сборка без ошибок.

- [ ] **Step 8: Commit**

```bash
git add src/app/[locale]/admin src/components/admin/nav.tsx
git commit -m "feat(admin): экраны и закладки по выданному доступу"
```

---

### Task 8: Вторая подпись считается по очереди

**Files:**
- Modify: `src/lib/cases/approval.ts`, `src/app/actions/case-review.ts`
- Test: `tests/case-approval.test.ts` (дополнить)

- [ ] **Step 1: тест**

```ts
import { countApprovers, type ApproverRow } from "@/lib/cases/approval";

const NOW = new Date("2026-11-18T10:00:00Z");

it("вторая подпись: HANDLE не считается", () => {
  const rows: ApproverRow[] = [
    { userId: "u2", level: "HANDLE", expiresAt: null, revokedAt: null, role: "STAFF" },
  ];
  expect(countApprovers(rows, "u1", NOW)).toBe(0);
});

it("вторая подпись: APPROVE считается, проверивший — нет", () => {
  const rows: ApproverRow[] = [
    { userId: "u1", level: "APPROVE", expiresAt: null, revokedAt: null, role: "STAFF" },
    { userId: "u2", level: "APPROVE", expiresAt: null, revokedAt: null, role: "STAFF" },
  ];
  expect(countApprovers(rows, "u1", NOW)).toBe(1);
});

it("вторая подпись: отозванный и истёкший не считаются", () => {
  const rows: ApproverRow[] = [
    { userId: "u2", level: "APPROVE", expiresAt: null, revokedAt: NOW, role: "STAFF" },
    {
      userId: "u3",
      level: "APPROVE",
      expiresAt: new Date("2026-11-17T00:00:00Z"),
      revokedAt: null,
      role: "STAFF",
    },
  ];
  expect(countApprovers(rows, "u1", NOW)).toBe(0);
});

it("владелец считается второй подписью без грантов", () => {
  const rows: ApproverRow[] = [
    { userId: "u9", level: null, expiresAt: null, revokedAt: null, role: "OWNER" },
  ];
  expect(countApprovers(rows, "u1", NOW)).toBe(1);
});
```

- [ ] **Step 2: запустить — упадёт** (`countApprovers` не существует).

- [ ] **Step 3: реализация в `approval.ts`**

```ts
export type ApproverRow = {
  userId: string;
  /** Уровень в очереди дела; `null` — гранта нет (владелец). */
  level: "VIEW" | "HANDLE" | "APPROVE" | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  role: "USER" | "STAFF" | "OWNER" | "ADMIN";
};

/**
 * Сколько людей, кроме проверившего, вправе поставить вторую подпись **в этой
 * очереди**. Прежде считались все `ADMIN` подряд, и правило четырёх глаз было
 * декорацией: три записи одного человека выглядели как три человека.
 */
export function countApprovers(rows: ApproverRow[], reviewedById: string, now: Date): number {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.userId === reviewedById) continue;
    if (r.revokedAt) continue;
    const owner = r.role === "OWNER" || r.role === "ADMIN";
    if (!owner) {
      if (r.level !== "APPROVE") continue;
      if (r.expiresAt && r.expiresAt.getTime() <= now.getTime()) continue;
    }
    seen.add(r.userId);
  }
  return seen.size;
}
```

- [ ] **Step 4:** в `decideCase` заменить запрос `otherApproversCount` на сбор `ApproverRow[]`:
      владельцы (`role in [OWNER, ADMIN]`, `staffMember.revokedAt = null`) + держатели
      `StaffGrant` с `queue in SUBJECT_QUEUES[c.subjectType]`, и посчитать `countApprovers`.

- [ ] **Step 5: запустить**

Run: `npx vitest run tests/case-approval.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/approval.ts src/app/actions/case-review.ts tests/case-approval.test.ts
git commit -m "feat(cases): вторая подпись считается по праву в этой очереди"
```

---

### Task 9: Конфликт интересов

**Files:**
- Create: `src/lib/authz/conflict.ts`
- Test: `tests/authz-conflict.test.ts`
- Modify: `src/app/actions/cases.ts`, `case-review.ts`, `case-messages.ts`

- [ ] **Step 1: тест** (чистая часть — решение по найденным связям)

```ts
import { conflictReason, type ConflictFacts } from "@/lib/authz/conflict";

const none: ConflictFacts = { isApplicant: false, isCompanyMember: false, isCardMember: false };

it("без связей конфликта нет", () => expect(conflictReason(none)).toBe(null));
it("сам подал заявку", () =>
  expect(conflictReason({ ...none, isApplicant: true })).toBe("conflict_of_interest"));
it("участник предприятия", () =>
  expect(conflictReason({ ...none, isCompanyMember: true })).toBe("conflict_of_interest"));
it("участник карточки", () =>
  expect(conflictReason({ ...none, isCardMember: true })).toBe("conflict_of_interest"));
```

- [ ] **Step 2: запустить — упадёт.**

- [ ] **Step 3: реализация**

```ts
/**
 * Конфликт интересов: сотрудник не ведёт и не решает дело объекта, с которым он
 * связан. Чтение остаётся — запрещать смотреть незачем, а знать причину отказа
 * полезно.
 */
import { prisma } from "@/lib/prisma";
import type { CaseSubjectType } from "@prisma/client";

export type ConflictFacts = {
  isApplicant: boolean;
  isCompanyMember: boolean;
  isCardMember: boolean;
};

export function conflictReason(f: ConflictFacts): "conflict_of_interest" | null {
  return f.isApplicant || f.isCompanyMember || f.isCardMember ? "conflict_of_interest" : null;
}

export async function caseConflict(input: {
  caseId: string;
  subjectType: CaseSubjectType;
  subjectId: string;
  applicantUserId: string | null;
  userId: string;
}): Promise<"conflict_of_interest" | null> {
  const facts: ConflictFacts = {
    isApplicant: input.applicantUserId === input.userId,
    isCompanyMember: false,
    isCardMember: false,
  };

  if (input.subjectType === "COMPANY" || input.subjectType === "KYB") {
    facts.isCompanyMember =
      (await prisma.companyMember.count({
        where: { companyId: input.subjectId, userId: input.userId },
      })) > 0;
  } else if (input.subjectType === "POINT" || input.subjectType === "POINT_REPORT") {
    const pointId =
      input.subjectType === "POINT"
        ? input.subjectId
        : (await prisma.pointReport.findUnique({
            where: { id: input.subjectId },
            select: { pointId: true },
          }))?.pointId ?? null;
    if (pointId) {
      const point = await prisma.companyPoint.findUnique({
        where: { id: pointId },
        select: { companyId: true },
      });
      if (point) {
        facts.isCompanyMember =
          (await prisma.companyMember.count({
            where: { companyId: point.companyId, userId: input.userId },
          })) > 0;
      }
    }
  } else if (input.subjectType === "COIN_CARD") {
    facts.isCardMember =
      (await prisma.coinCardMember.count({
        where: { cardId: input.subjectId, userId: input.userId },
      })) > 0;
  }

  return conflictReason(facts);
}
```

- [ ] **Step 4:** вставить проверку после охранника уровня в `claimCase`, `adjustCaseTime`,
      `sendStaffMessage`, `setCaseCheck`, `setDocumentVerdict`, `markReviewed`, `decideCase`.
      `releaseCase` и биение не проверяются: отпустить дело и закрыть сеанс можно всегда.

- [ ] **Step 5: запустить**

Run: `npx vitest run tests/authz-conflict.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/authz/conflict.ts tests/authz-conflict.test.ts src/app/actions
git commit -m "feat(authz): запрет вести дело объекта, с которым сотрудник связан"
```

---

### Task 10: Готовые должности и пакет прав

**Files:**
- Create: `src/lib/staff/presets.ts`, `src/lib/staff/invites.ts`
- Test: `tests/staff-presets.test.ts`, `tests/staff-invites.test.ts`

- [ ] **Step 1: тесты**

```ts
// tests/staff-presets.test.ts
import { STAFF_PRESETS, presetGrants } from "@/lib/staff/presets";
import { QUEUES } from "@/lib/cases/queues";

it("каждая должность высказывается о каждой очереди", () => {
  for (const p of STAFF_PRESETS) {
    const grants = presetGrants(p.key);
    for (const q of QUEUES) {
      expect(Object.prototype.hasOwnProperty.call(grants, q.key)).toBe(true);
    }
  }
});

it("только чтение не даёт ничего, кроме чтения", () => {
  expect(new Set(Object.values(presetGrants("readOnly")))).toEqual(new Set(["VIEW"]));
});
```

```ts
// tests/staff-invites.test.ts
import { hashInviteToken, parseGrants } from "@/lib/staff/invites";

it("в базу идёт хэш, а не ссылка", () => {
  const h = hashInviteToken("abc");
  expect(h).toHaveLength(64);
  expect(h).not.toContain("abc");
  expect(hashInviteToken("abc")).toBe(h);
});

it("пакет прав отвергает чужую очередь и чужой уровень", () => {
  expect(parseGrants([{ queue: "coinCards", level: "APPROVE" }]).ok).toBe(true);
  expect(parseGrants([{ queue: "wat", level: "APPROVE" }]).ok).toBe(false);
  expect(parseGrants([{ queue: "coinCards", level: "GOD" }]).ok).toBe(false);
  expect(parseGrants([]).ok).toBe(false); // приглашение без прав бессмысленно
});
```

- [ ] **Step 2: запустить — упадут.**

- [ ] **Step 3: реализация `presets.ts`**

```ts
/**
 * Четыре готовые должности. Это только заполнение матрицы — после нажатия
 * галочки правятся руками, иначе шаблон становится рамкой, из которой не выйти.
 */
import type { StaffLevel } from "@/lib/authz/policy";
import { QUEUES, type QueueKey } from "@/lib/cases/queues";

export type PresetKey = "readOnly" | "reviewer" | "senior" | "kybOfficer";
export const STAFF_PRESETS: { key: PresetKey }[] = [
  { key: "readOnly" },
  { key: "reviewer" },
  { key: "senior" },
  { key: "kybOfficer" },
];

export function presetGrants(key: PresetKey): Record<QueueKey, StaffLevel> {
  const all = (level: StaffLevel) =>
    Object.fromEntries(QUEUES.map((q) => [q.key, level])) as Record<QueueKey, StaffLevel>;

  switch (key) {
    case "readOnly":
      return all("VIEW");
    case "senior":
      return all("APPROVE");
    case "reviewer":
      return {
        ...all("VIEW"),
        coinCards: "HANDLE",
        coinRequests: "HANDLE",
        points: "HANDLE",
        pointReports: "HANDLE",
      };
    case "kybOfficer":
      return { ...all("VIEW"), kyb: "APPROVE", companies: "APPROVE" };
  }
}
```

- [ ] **Step 4: реализация `invites.ts`**

```ts
/**
 * Приглашение сотрудника. В базе лежит только sha256 ссылки: дамп таблицы не
 * должен давать доступ к админке (приём из сброса пароля). Жизненный цикл
 * ссылки — общий `invite-tokens.ts`.
 */
import { createHash } from "node:crypto";
import type { StaffLevel } from "@/lib/authz/policy";
import { queueByKey } from "@/lib/cases/queues";

export {
  INVITE_TTL_DAYS,
  MAX_ACTIVE_INVITES,
  generateInviteToken,
  inviteExpiry,
  inviteState,
  isInviteUsable,
} from "@/lib/invite-tokens";

export type GrantInput = { queue: string; level: string; expiresAt?: string | null };
export type ParsedGrant = { queue: string; level: StaffLevel; expiresAt: Date | null };
export type ParseResult =
  | { ok: true; grants: ParsedGrant[] }
  | { ok: false; reason: "empty" | "unknown_queue" | "unknown_level" | "bad_date" };

const LEVELS: StaffLevel[] = ["VIEW", "HANDLE", "APPROVE"];

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseGrants(raw: unknown): ParseResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: "empty" };
  const out: ParsedGrant[] = [];
  for (const item of raw as GrantInput[]) {
    if (!queueByKey(String(item?.queue))) return { ok: false, reason: "unknown_queue" };
    if (!LEVELS.includes(item?.level as StaffLevel)) return { ok: false, reason: "unknown_level" };
    let expiresAt: Date | null = null;
    if (item.expiresAt) {
      const d = new Date(item.expiresAt);
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "bad_date" };
      expiresAt = d;
    }
    out.push({ queue: String(item.queue), level: item.level as StaffLevel, expiresAt });
  }
  return { ok: true, grants: out };
}

export function buildStaffInviteUrl(origin: string, locale: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/${locale}/staff-invite/${token}`;
}

/** Полгода — обычная частота ревизии доступа в SOC 2 и ISO 27001. */
export const ACCESS_REVIEW_MONTHS = 6;

export function accessReviewAt(from: Date): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + ACCESS_REVIEW_MONTHS);
  return d;
}
```

- [ ] **Step 5: запустить**

Run: `npx vitest run tests/staff-presets.test.ts tests/staff-invites.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/staff tests/staff-presets.test.ts tests/staff-invites.test.ts
git commit -m "feat(staff): готовые должности и пакет прав приглашения"
```

---

### Task 11: Действия владельца над доступом

**Files:**
- Create: `src/app/actions/staff-access.ts`, `src/app/actions/staff-invites.ts`

- [ ] **Step 1: `staff-access.ts`** — все пять действий под `requireOwner()`:

| Действие | Что делает |
|---|---|
| `setStaffGrants({ userId, grants })` | `upsert` по `(userId, queue)`, лишние строки удаляет; аудит `STAFF_ACCESS_CHANGED` с прежним и новым уровнем по каждой изменённой очереди |
| `revokeStaffAccess({ userId, reason })` | `revokedAt`, `revokeReason` (≥3 символа); аудит `STAFF_ACCESS_REVOKED` |
| `restoreStaffAccess({ userId })` | `revokedAt = null`; аудит `STAFF_ACCESS_RESTORED` |
| `markAccessReviewPassed({ userId })` | `accessReviewAt = accessReviewAt(now)`, гасит непрочитанный звонок `ACCESS_REVIEW_DUE`; аудит `ACCESS_REVIEW_PASSED` |
| `grantStaffByIdentifier({ identifier, title, duties, grants })` | ищет запись по `username` или `email`; заводит `StaffMember` и гранты, `Role: USER → STAFF`; `notifyUser` на языке кабинета |

Отказы: `self_grant` (цель — сам владелец), `owner_target` (цель — владелец),
`not_found`, `reason_too_short`, `empty` (пакет прав пуст).

- [ ] **Step 2: `staff-invites.ts`:**

| Действие | Что делает |
|---|---|
| `createStaffInvite({ identifier?, title, duties, grants })` | `requireOwner()`, `parseGrants`, ≤20 активных (`MAX_ACTIVE_INVITES`), токен → ссылка, в базу `tokenHash`; аудит `STAFF_INVITED` |
| `revokeStaffInvite({ inviteId })` | `revokedAt`; аудит `STAFF_INVITE_REVOKED` |
| `acceptStaffInvite({ token })` | вошедший пользователь: `updateMany` по `tokenHash` + `acceptedAt: null` (гонку двух переходов снимает условное обновление — приём из приглашений предприятия) → `StaffMember` + гранты → `Role: USER → STAFF` (владельца не понижаем) → `notifyUser` владельцу |

- [ ] **Step 3: проверка**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/staff-access.ts src/app/actions/staff-invites.ts
git commit -m "feat(staff): выдача, отзыв и пересмотр доступа; приглашение сотрудника"
```

---

### Task 12: Экран доступа и приём приглашения

**Files:**
- Create: `src/components/admin/staff-access.tsx`, `src/components/admin/staff-invite-form.tsx`,
  `src/app/[locale]/staff-invite/[token]/page.tsx`
- Modify: `src/app/[locale]/admin/staff/page.tsx`

- [ ] **Step 1:** раздел «Сотрудники и доступ» на `/admin/staff` (только владелец): строка
      на сотрудника — имя и логин, должность, восемь очередей с уровнями, срок пересмотра,
      кнопки «Пересмотр пройден», «Отозвать» / «Вернуть». Правила вида — из
      `src/lib/admin-ui.ts` (`ADMIN_COLUMN`, кнопка 48 px во всю ширину).

- [ ] **Step 2:** форма приглашения: матрица 8 × 4 (радиокнопки `нет / смотрит / ведёт /
      утверждает`), четыре кнопки готовых должностей, поля должности и обязанностей,
      необязательная дата окончания, выбор «ссылкой» или «по логину». Готовая ссылка
      показывается один раз с кнопкой копирования (повторно её не узнать — в базе хэш).

- [ ] **Step 3:** `/{locale}/staff-invite/[token]` — приём: гостю ссылки на
      `/login?next=…` и `/register?next=…` (через `safeNext`), вошедшему — что именно ему
      выдают (должность, обязанности, таблица очередей) и кнопка «Принять». Недействительная
      ссылка объясняет причину: `expired` / `accepted` / `revoked`.

- [ ] **Step 4: проверка**

Run: `npm run build`
Expected: сборка без ошибок.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/staff-access.tsx src/components/admin/staff-invite-form.tsx \
  "src/app/[locale]/staff-invite" "src/app/[locale]/admin/staff/page.tsx"
git commit -m "feat(admin): экран доступа сотрудников и приём приглашения"
```

---

### Task 13: Прогон пересмотра доступа

**Files:**
- Create: `src/lib/staff-access-sweep.ts`
- Test: `tests/staff-access-review.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: тест чистой части**

```ts
import { reviewDue } from "@/lib/staff-access-sweep";

const NOW = new Date("2026-11-18T10:00:00Z");

it("срок в прошлом — пора пересматривать", () => {
  expect(reviewDue({ accessReviewAt: new Date("2026-11-17T00:00:00Z"), revokedAt: null }, NOW)).toBe(true);
});
it("срок в будущем — молчим", () => {
  expect(reviewDue({ accessReviewAt: new Date("2027-05-18T00:00:00Z"), revokedAt: null }, NOW)).toBe(false);
});
it("отозванный доступ пересматривать нечего", () => {
  expect(reviewDue({ accessReviewAt: new Date("2026-01-01T00:00:00Z"), revokedAt: NOW }, NOW)).toBe(false);
});
```

- [ ] **Step 2: запустить — упадёт.**

- [ ] **Step 3: реализация** — `reviewDue()` плюс `runStaffAccessReviewSweep()`: находит
      сотрудников с подошедшим сроком, звонит **владельцам** (`ACCESS_REVIEW_DUE`), один
      повод на сотрудника не плодится (непрочитанный звонок обновляется — приём из AO),
      пишет итог в лог (`{ due, notified }`).

- [ ] **Step 4:** `worker/index.ts` — `cron.schedule("45 5 * * *", () => void runStaffAccessReviewJob())`,
      сразу после пересмотра предприятий (`35 5 * * *`), с комментарием почему рядом.

- [ ] **Step 5: запустить**

Run: `npx vitest run tests/staff-access-review.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/staff-access-sweep.ts tests/staff-access-review.test.ts worker/index.ts
git commit -m "feat(worker): суточный прогон пересмотра доступа сотрудников"
```

---

### Task 14: Переводы

**Files:**
- Modify: `messages/en.json`, затем все локали прогоном

- [ ] **Step 1:** добавить в `messages/en.json`: `admin.tabs.staff` (есть), `admin.staff.access.*`,
      `admin.staff.invite.*`, `admin.staff.presets.*`, `admin.staff.levels.*`,
      `staffInvite.*`, `notify.staffAccess.*`, и коды отказов в `admin.errors.*`:
      `no_access`, `conflict_of_interest`, `self_grant`, `owner_target`, `last_owner`,
      `empty`, `reason_too_short`.

- [ ] **Step 2: перевести**

Run: `npm run i18n`
Expected: `11 locales`, изменённые файлы под `messages/`.

- [ ] **Step 3: граница**

Run: `npx vitest run tests/messages-parity.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add messages
git commit -m "feat(i18n): строки доступа сотрудников и приглашения"
```

---

### Task 15: Выпуск и живой прогон

- [ ] **Step 1: всё целиком**

Run: `npx vitest run && npm run build`
Expected: все тесты PASS, сборка без ошибок.

- [ ] **Step 2: выпуск**

```bash
pm2 restart trientes-web trientes-worker && pm2 save
```

(`trientes-worker` обязателен: прогон и `src/lib/authz/*` он импортирует, а `tsx` пришпиливает
источник на старте.)

- [ ] **Step 3: живой прогон** — восемь шагов из раздела «Живой прогон» спеки, временный
      сотрудник и приглашение убираются за собой.

- [ ] **Step 4: документы**

`CLAUDE.md` — раздел «Слайс AS» в линии Phase 11: решения, а не перечень файлов.

- [ ] **Step 5: Commit и push**

```bash
git add CLAUDE.md
git commit -m "docs: слайс AS в CLAUDE.md"
git push origin main
```

---

## Самопроверка плана

- **Покрытие спеки:** роли и наследие `ADMIN` — Task 1, 6; политика — 2; карта экранов — 3;
  охранник и одна дверь — 4; действия по делам — 5; старые экраны — 6; страницы, кнопки и
  закладки — 7; вторая подпись по очереди — 8; конфликт интересов — 9; должности и пакет
  прав — 10; выдача, отзыв, пересмотр, приглашение — 11; экраны — 12; прогон и звонок — 13;
  переводы — 14; выпуск и живой прогон — 15.
- **Без заглушек:** у каждого нового чистого модуля в плане полный код; мест с «добавить
  обработку ошибок» нет — коды отказов перечислены явно.
- **Согласованность имён:** `ViewerAccess`, `levelFor`, `can`, `canAny`, `visibleQueues`,
  `canOwnerOnly` (Task 2) используются в Task 4 и 7; `SUBJECT_QUEUES`, `requirementFor`
  (Task 3) — в Task 4, 5, 8; `countApprovers`/`ApproverRow` (Task 8) только в `case-review.ts`;
  `parseGrants`, `hashInviteToken`, `accessReviewAt`, `presetGrants` (Task 10) — в Task 11–13.
