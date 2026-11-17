# Слайс AN — основа управления делами: план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Завести слой «дела» поверх всех типов заявок и дать админке экран плиток-очередей
и экран раскрытия дела, которыми можно пользоваться с телефона: взятие в работу, срок с
остановкой часов, учёт времени сеансами и неизменяемый журнал.

**Architecture:** Чистое ядро + тонкие обёртки, как в `src/lib/admin/*`. Вся арифметика
(срок, часы, сеансы времени, сборка плиток) живёт в чистых функциях `src/lib/cases/*.ts`
без обращения к Prisma и покрыта юнит-тестами. Запись в базу — тонкие серверные экшены
`src/app/actions/cases.ts`, которые зовут ядро и пишут `CaseEvent`. Экраны — серверные
компоненты, единственная клиентская часть — кнопка «взять в работу» и биение таймера.

**Tech Stack:** Next.js (App Router, server actions), Prisma + PostgreSQL, vitest,
next-intl, Tailwind v4 с токенами из `src/app/globals.css`.

**Спека:** `docs/superpowers/specs/2026-11-17-compliance-case-management-design.md`

---

## Карта файлов

Создаём:

| Файл | Ответственность |
|---|---|
| `src/lib/cases/types.ts` | Типы очередей и состояний, общие для ядра и экранов |
| `src/lib/cases/sla.ts` | Срок: расчёт `dueAt`, состояние (ok/warn/late/paused), остановка и запуск часов |
| `src/lib/cases/time.ts` | Время в руках: сеансы, биение, закрытие протухшего сеанса |
| `src/lib/cases/queues.ts` | Реестр очередей и сборка плиток из строк дел |
| `src/lib/cases/journal.ts` | Запись события в журнал + описание события строкой |
| `src/lib/cases/ensure.ts` | Идемпотентное заведение дела под объект |
| `src/lib/cases/subject.ts` | Чтение объекта заявки (название, заявитель, поля анкеты) |
| `src/lib/admin-ui.ts` | Классы правил вида: кнопка ≥44 px во всю ширину, колонка по центру |
| `src/app/actions/cases.ts` | Экшены: взять в работу, отпустить, биение таймера, правка времени |
| `src/app/[locale]/admin/queues/page.tsx` | Плитки очередей |
| `src/app/[locale]/admin/queues/[queue]/page.tsx` | Список дел одной очереди |
| `src/app/[locale]/admin/cases/[id]/page.tsx` | Раскрытие дела |
| `src/components/admin/queue-tile.tsx` | Квадратная плитка |
| `src/components/admin/case-row.tsx` | Строка дела в списке очереди |
| `src/components/admin/case-section.tsx` | Раскрывающийся раздел дела |
| `src/components/admin/case-journal.tsx` | Журнал дела |
| `src/components/admin/case-claim.tsx` | Клиентская кнопка «взять в работу» / «отпустить» |
| `src/components/admin/case-timer.tsx` | Клиентское биение таймера |
| `scripts/backfill-cases.ts` | Разовый посев дел под уже лежащие заявки |
| `tests/case-sla.test.ts`, `tests/case-time.test.ts`, `tests/case-queues.test.ts`, `tests/case-ensure.test.ts`, `tests/admin-ui-rules.test.ts` | Юнит-тесты ядра |

Меняем: `prisma/schema.prisma`, `src/components/admin/nav.tsx`, `src/app/[locale]/admin/page.tsx`,
`src/app/actions/{company,coin-card,exchange,fintech,coin-request}.ts`, `messages/en.json`.

**Колокольчик непрочитанных сообщений на плитке в этом слайсе не появляется** — переписки
ещё нет, она в слайсе AO. Старые экраны очередей (`/admin/requests` и прочие) остаются
рабочими и не трогаются до слайса AP.

---

### Task 1: Схема и миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261117120000_compliance_cases/migration.sql` (генерируется)

- [ ] **Step 1: Добавить перечисления и модели в конец `prisma/schema.prisma`**

```prisma
enum CaseSubjectType {
  COIN_CARD
  COMPANY
  POINT
  EXCHANGE
  FINTECH
  KYB
  COIN_REQUEST
  POINT_REPORT
}

enum CaseStatus {
  NEW
  IN_REVIEW
  WAITING_APPLICANT
  READY_FOR_APPROVAL
  APPROVED
  REJECTED
  CLOSED
}

enum CaseRisk {
  LOW
  MEDIUM
  HIGH
}

enum CaseActorSide {
  STAFF
  APPLICANT
  SYSTEM
}

enum CaseEventKind {
  OPENED
  CLAIMED
  RELEASED
  STATUS_CHANGED
  CLOCK_PAUSED
  CLOCK_RESUMED
  TIME_ADJUSTED
  NOTE
  DECIDED
}

enum CaseTimeSource {
  AUTO
  MANUAL
}

/// Дело — один слой процесса поверх всех типов заявок. Статус самого объекта
/// (CoinCard.status, Company.status …) остаётся источником правды для публикации;
/// дело ведёт работу и в конце проставляет этот статус.
model ComplianceCase {
  id          String          @id @default(cuid())
  subjectType CaseSubjectType
  subjectId   String
  status      CaseStatus      @default(NEW)
  risk        CaseRisk        @default(MEDIUM)

  /// Снимок названия на момент заведения: очередь должна читаться, даже если
  /// объект мягко удалили.
  title String

  applicantUserId String?
  applicant       User?   @relation("CaseApplicant", fields: [applicantUserId], references: [id], onDelete: SetNull)
  assigneeId      String?
  assignee        User?   @relation("CaseAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)

  openedAt       DateTime  @default(now())
  dueAt          DateTime
  /// Исходный размер срока в секундах — нужен, чтобы считать порог «жёлтой» точки.
  slaSeconds     Int
  /// Непусто, пока часы срока стоят (ждём ответ заявителя).
  clockStoppedAt DateTime?
  handledSeconds Int       @default(0)
  decidedAt      DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events      CaseEvent[]
  timeEntries CaseTimeEntry[]

  @@unique([subjectType, subjectId])
  @@index([status, dueAt])
  @@index([assigneeId, status])
  @@index([subjectType, status])
}

/// Неизменяемый журнал дела: только вставка, ни update, ни delete.
model CaseEvent {
  id        String         @id @default(cuid())
  caseId    String
  case      ComplianceCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  actorId   String?
  actor     User?          @relation("CaseEventActor", fields: [actorId], references: [id], onDelete: SetNull)
  actorSide CaseActorSide  @default(STAFF)
  kind      CaseEventKind
  payload   Json?
  createdAt DateTime       @default(now())

  @@index([caseId, createdAt])
}

/// Сеанс работы над делом. Время в руках — сумма сеансов, а не разница дат.
model CaseTimeEntry {
  id         String         @id @default(cuid())
  caseId     String
  case       ComplianceCase @relation(fields: [caseId], references: [id], onDelete: Cascade)
  userId     String
  user       User           @relation("CaseTimeUser", fields: [userId], references: [id], onDelete: Cascade)
  startedAt  DateTime
  lastBeatAt DateTime
  endedAt    DateTime?
  seconds    Int            @default(0)
  source     CaseTimeSource @default(AUTO)
  note       String?

  @@index([caseId, startedAt])
  @@index([userId, startedAt])
}
```

- [ ] **Step 2: Добавить обратные связи в `model User`**

Найти `model User {` в `prisma/schema.prisma` и дописать внутрь модели, рядом с
остальными связями:

```prisma
  casesApplied   ComplianceCase[] @relation("CaseApplicant")
  casesAssigned  ComplianceCase[] @relation("CaseAssignee")
  caseEvents     CaseEvent[]      @relation("CaseEventActor")
  caseTimeEntries CaseTimeEntry[] @relation("CaseTimeUser")
```

- [ ] **Step 3: Создать миграцию**

Run: `npx prisma migrate dev --name compliance_cases`
Expected: создан каталог `prisma/migrations/<timestamp>_compliance_cases`, в конце
`Your database is now in sync with your schema` и `Generated Prisma Client`.

- [ ] **Step 4: Проверить, что таблицы встали**

Run:
```bash
source .env && psql "$DATABASE_URL" -c '\d "ComplianceCase"' | head -25
```
Expected: перечень колонок, среди них `subjectType`, `dueAt`, `slaSeconds`,
`clockStoppedAt`, `handledSeconds`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cases): модель дела, журнала и сеансов времени"
```

---

### Task 2: Срок (`src/lib/cases/types.ts` + `src/lib/cases/sla.ts`)

**Files:**
- Create: `src/lib/cases/types.ts`, `src/lib/cases/sla.ts`
- Test: `tests/case-sla.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/case-sla.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { addBusinessDays, computeDue, pausePatch, resumePatch, slaState } from "@/lib/cases/sla";

const T = (s: string) => new Date(s);

describe("addBusinessDays", () => {
  it("пропускает выходные", () => {
    // пятница 13 ноября 2026 + 1 рабочий день = понедельник 16-е
    expect(addBusinessDays(T("2026-11-13T10:00:00Z"), 1).toISOString()).toBe("2026-11-16T10:00:00.000Z");
  });

  it("считает пять рабочих дней через выходные", () => {
    expect(addBusinessDays(T("2026-11-13T10:00:00Z"), 5).toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  it("стартуя в субботу, первый рабочий день — понедельник", () => {
    expect(addBusinessDays(T("2026-11-14T10:00:00Z"), 1).toISOString()).toBe("2026-11-16T10:00:00.000Z");
  });
});

describe("computeDue", () => {
  it("у обычной заявки пять рабочих дней", () => {
    const r = computeDue(T("2026-11-13T10:00:00Z"), "COMPANY");
    expect(r.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(r.slaSeconds).toBe(7 * 24 * 3600); // календарных секунд между датами
  });

  it("у KYB срок вдвое длиннее", () => {
    const a = computeDue(T("2026-11-13T10:00:00Z"), "COMPANY").dueAt.getTime();
    const b = computeDue(T("2026-11-13T10:00:00Z"), "KYB").dueAt.getTime();
    expect(b).toBeGreaterThan(a);
  });
});

describe("slaState", () => {
  const base = { dueAt: T("2026-11-20T10:00:00Z"), slaSeconds: 7 * 24 * 3600, clockStoppedAt: null };

  it("в сроке, пока осталось больше четверти", () => {
    const r = slaState({ ...base, now: T("2026-11-15T10:00:00Z") });
    expect(r.state).toBe("ok");
    expect(r.remainingSeconds).toBe(5 * 24 * 3600);
  });

  it("жёлтая, когда осталось меньше четверти срока", () => {
    expect(slaState({ ...base, now: T("2026-11-19T12:00:00Z") }).state).toBe("warn");
  });

  it("красная после срока", () => {
    const r = slaState({ ...base, now: T("2026-11-21T10:00:00Z") });
    expect(r.state).toBe("late");
    expect(r.remainingSeconds).toBe(0);
  });

  it("остановленные часы — своё состояние, а не просрочка", () => {
    const r = slaState({ ...base, clockStoppedAt: T("2026-11-19T10:00:00Z"), now: T("2026-11-30T10:00:00Z") });
    expect(r.state).toBe("paused");
    expect(r.remainingSeconds).toBe(24 * 3600);
  });
});

describe("остановка и запуск часов", () => {
  it("пауза запоминает момент", () => {
    expect(pausePatch(T("2026-11-18T10:00:00Z"))).toEqual({ clockStoppedAt: T("2026-11-18T10:00:00Z") });
  });

  it("запуск сдвигает срок ровно на простой", () => {
    const patch = resumePatch({
      dueAt: T("2026-11-20T10:00:00Z"),
      clockStoppedAt: T("2026-11-18T10:00:00Z"),
      now: T("2026-11-21T10:00:00Z"),
    });
    expect(patch.dueAt.toISOString()).toBe("2026-11-23T10:00:00.000Z");
    expect(patch.clockStoppedAt).toBeNull();
  });

  it("запуск не сдвигает срок, если часы и не стояли", () => {
    const patch = resumePatch({ dueAt: T("2026-11-20T10:00:00Z"), clockStoppedAt: null, now: T("2026-11-21T10:00:00Z") });
    expect(patch.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npx vitest run tests/case-sla.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/sla"`.

- [ ] **Step 3: Написать `src/lib/cases/types.ts`**

```ts
import type { CaseStatus, CaseSubjectType } from "@prisma/client";

export type { CaseStatus, CaseSubjectType };

/** Дело считается открытым, пока по нему не принято решение. */
export const OPEN_STATUSES: CaseStatus[] = [
  "NEW",
  "IN_REVIEW",
  "WAITING_APPLICANT",
  "READY_FOR_APPROVAL",
];

export function isOpen(status: CaseStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Состояние часов срока. */
export type SlaState = "ok" | "warn" | "late" | "paused";
```

- [ ] **Step 4: Написать `src/lib/cases/sla.ts`**

```ts
import type { CaseSubjectType, SlaState } from "./types";

/**
 * Срок в рабочих днях. Праздничного календаря в проекте нет и заводить его
 * ради этого не станем: суббота с воскресеньем — всё, что мы знаем наверняка.
 */
export const SLA_BUSINESS_DAYS: Record<CaseSubjectType, number> = {
  COIN_CARD: 5,
  COMPANY: 5,
  POINT: 3,
  EXCHANGE: 5,
  FINTECH: 5,
  KYB: 10,
  COIN_REQUEST: 5,
  POINT_REPORT: 3,
};

/** Доля срока, после которой точка желтеет. */
export const WARN_FRACTION = 0.25;

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return d;
}

export function computeDue(
  openedAt: Date,
  subjectType: CaseSubjectType,
): { dueAt: Date; slaSeconds: number } {
  const dueAt = addBusinessDays(openedAt, SLA_BUSINESS_DAYS[subjectType]);
  return { dueAt, slaSeconds: Math.round((dueAt.getTime() - openedAt.getTime()) / 1000) };
}

export function slaState(input: {
  now: Date;
  dueAt: Date;
  slaSeconds: number;
  clockStoppedAt: Date | null;
}): { state: SlaState; remainingSeconds: number } {
  // Пока часы стоят, остаток считается от момента остановки: простой заявителя
  // не должен съедать срок проверяющего.
  const at = input.clockStoppedAt ?? input.now;
  const remaining = Math.max(0, Math.round((input.dueAt.getTime() - at.getTime()) / 1000));
  if (input.clockStoppedAt) return { state: "paused", remainingSeconds: remaining };
  if (remaining <= 0) return { state: "late", remainingSeconds: 0 };
  if (remaining < input.slaSeconds * WARN_FRACTION) return { state: "warn", remainingSeconds: remaining };
  return { state: "ok", remainingSeconds: remaining };
}

export function pausePatch(now: Date): { clockStoppedAt: Date } {
  return { clockStoppedAt: now };
}

export function resumePatch(input: {
  dueAt: Date;
  clockStoppedAt: Date | null;
  now: Date;
}): { dueAt: Date; clockStoppedAt: null } {
  if (!input.clockStoppedAt) return { dueAt: input.dueAt, clockStoppedAt: null };
  const idle = input.now.getTime() - input.clockStoppedAt.getTime();
  return { dueAt: new Date(input.dueAt.getTime() + idle), clockStoppedAt: null };
}
```

- [ ] **Step 5: Запустить тест и убедиться, что он проходит**

Run: `npx vitest run tests/case-sla.test.ts`
Expected: PASS, 10 тестов.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/types.ts src/lib/cases/sla.ts tests/case-sla.test.ts
git commit -m "feat(cases): срок дела с остановкой часов на время ожидания заявителя"
```

---

### Task 3: Время в руках (`src/lib/cases/time.ts`)

**Files:**
- Create: `src/lib/cases/time.ts`
- Test: `tests/case-time.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/case-time.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { beatPatch, closePatch, IDLE_MS, isStale, totalSeconds } from "@/lib/cases/time";

const T = (s: string) => new Date(s);

describe("биение таймера", () => {
  it("продлевает сеанс и копит секунды", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:01:00Z") };
    const patch = beatPatch(entry, T("2026-11-17T10:02:00Z"));
    expect(patch.lastBeatAt.toISOString()).toBe("2026-11-17T10:02:00.000Z");
    expect(patch.seconds).toBe(120);
  });

  it("биение после простоя сеанс не продлевает", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:01:00Z") };
    expect(isStale(entry, T("2026-11-17T10:07:00Z"))).toBe(true);
    expect(isStale(entry, T("2026-11-17T10:03:00Z"))).toBe(false);
  });
});

describe("закрытие сеанса", () => {
  it("закрывается последним биением, а не сейчас — простой не считается работой", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:04:00Z") };
    const patch = closePatch(entry);
    expect(patch.endedAt.toISOString()).toBe("2026-11-17T10:04:00.000Z");
    expect(patch.seconds).toBe(240);
  });

  it("сеанс без единого биения стоит ноль", () => {
    const entry = { startedAt: T("2026-11-17T10:00:00Z"), lastBeatAt: T("2026-11-17T10:00:00Z") };
    expect(closePatch(entry).seconds).toBe(0);
  });
});

describe("сумма", () => {
  it("складывает секунды всех сеансов", () => {
    expect(totalSeconds([{ seconds: 120 }, { seconds: 240 }, { seconds: 0 }])).toBe(360);
  });
});

describe("порог простоя", () => {
  it("пять минут", () => {
    expect(IDLE_MS).toBe(5 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npx vitest run tests/case-time.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/time"`.

- [ ] **Step 3: Написать `src/lib/cases/time.ts`**

```ts
/**
 * Время в руках. Измерение заведомо приблизительное: оно меряет время с
 * открытым делом, а не время размышления. Поэтому правка руками разрешена,
 * но только с причиной и записью в журнал (см. adjustCaseTime).
 */

/** Нет биения дольше этого — человек ушёл, сеанс закрывается задним числом. */
export const IDLE_MS = 5 * 60 * 1000;

/** Как часто страница дела шлёт биение. */
export const BEAT_MS = 60 * 1000;

export type OpenEntry = { startedAt: Date; lastBeatAt: Date };

export function isStale(entry: OpenEntry, now: Date, idleMs: number = IDLE_MS): boolean {
  return now.getTime() - entry.lastBeatAt.getTime() > idleMs;
}

export function beatPatch(entry: OpenEntry, now: Date): { lastBeatAt: Date; seconds: number } {
  return {
    lastBeatAt: now,
    seconds: Math.max(0, Math.round((now.getTime() - entry.startedAt.getTime()) / 1000)),
  };
}

export function closePatch(entry: OpenEntry): { endedAt: Date; seconds: number } {
  return {
    endedAt: entry.lastBeatAt,
    seconds: Math.max(0, Math.round((entry.lastBeatAt.getTime() - entry.startedAt.getTime()) / 1000)),
  };
}

export function totalSeconds(entries: { seconds: number }[]): number {
  return entries.reduce((sum, e) => sum + e.seconds, 0);
}

/** «2 ч 14 мин», «9 мин», «—». Для показа в деле и в списке. */
export function formatHandled(seconds: number): string {
  if (seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}
```

- [ ] **Step 4: Запустить тест — проходит**

Run: `npx vitest run tests/case-time.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/time.ts tests/case-time.test.ts
git commit -m "feat(cases): учёт времени в руках сеансами с порогом простоя"
```

---

### Task 4: Реестр очередей и сборка плиток (`src/lib/cases/queues.ts`)

**Files:**
- Create: `src/lib/cases/queues.ts`
- Test: `tests/case-queues.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/case-queues.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildTiles, QUEUES, queueOfSubject } from "@/lib/cases/queues";

const T = (s: string) => new Date(s);
const NOW = T("2026-11-17T10:00:00Z");

function row(over: Partial<Parameters<typeof buildTiles>[0][number]> = {}) {
  return {
    subjectType: "COMPANY" as const,
    status: "IN_REVIEW" as const,
    openedAt: T("2026-11-16T10:00:00Z"),
    dueAt: T("2026-11-23T10:00:00Z"),
    slaSeconds: 7 * 24 * 3600,
    clockStoppedAt: null as Date | null,
    ...over,
  };
}

describe("реестр очередей", () => {
  it("у каждого типа заявки есть очередь", () => {
    const types = ["COIN_CARD", "COMPANY", "POINT", "EXCHANGE", "FINTECH", "KYB", "COIN_REQUEST", "POINT_REPORT"] as const;
    for (const t of types) expect(queueOfSubject(t)).toBeTruthy();
  });

  it("ключи очередей не повторяются", () => {
    const keys = QUEUES.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("сборка плиток", () => {
  it("считает только открытые дела", () => {
    const tiles = buildTiles([row(), row({ status: "APPROVED" }), row({ status: "REJECTED" })], NOW);
    expect(tiles.find((t) => t.key === "companies")!.open).toBe(1);
  });

  it("показывает возраст самой старой заявки", () => {
    const tiles = buildTiles(
      [row({ openedAt: T("2026-11-16T10:00:00Z") }), row({ openedAt: T("2026-11-10T10:00:00Z") })],
      NOW,
    );
    expect(tiles.find((t) => t.key === "companies")!.oldestOpenedAt!.toISOString()).toBe("2026-11-10T10:00:00.000Z");
  });

  it("берёт худшее состояние срока по очереди", () => {
    const tiles = buildTiles(
      [row(), row({ dueAt: T("2026-11-16T10:00:00Z") })], // второе просрочено
      NOW,
    );
    expect(tiles.find((t) => t.key === "companies")!.worst).toBe("late");
  });

  it("пустая очередь остаётся в списке с нулём", () => {
    const tiles = buildTiles([], NOW);
    expect(tiles).toHaveLength(QUEUES.length);
    expect(tiles.every((t) => t.open === 0 && t.worst === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run tests/case-queues.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/queues"`.

- [ ] **Step 3: Написать `src/lib/cases/queues.ts`**

```ts
import { slaState } from "./sla";
import { isOpen, type CaseStatus, type CaseSubjectType, type SlaState } from "./types";

export type QueueKey =
  | "coinCards"
  | "companies"
  | "points"
  | "exchanges"
  | "fintech"
  | "kyb"
  | "coinRequests"
  | "pointReports";

export type QueueDef = {
  key: QueueKey;
  subjectTypes: CaseSubjectType[];
  /** Знак на плитке. Один символ: растры и svg чужих хостов тут не нужны. */
  icon: string;
};

export const QUEUES: QueueDef[] = [
  { key: "coinCards", subjectTypes: ["COIN_CARD"], icon: "🪙" },
  { key: "companies", subjectTypes: ["COMPANY"], icon: "🏢" },
  { key: "points", subjectTypes: ["POINT"], icon: "📍" },
  { key: "exchanges", subjectTypes: ["EXCHANGE"], icon: "🏦" },
  { key: "fintech", subjectTypes: ["FINTECH"], icon: "💳" },
  { key: "kyb", subjectTypes: ["KYB"], icon: "🛡️" },
  { key: "coinRequests", subjectTypes: ["COIN_REQUEST"], icon: "📝" },
  { key: "pointReports", subjectTypes: ["POINT_REPORT"], icon: "⚠️" },
];

export function queueOfSubject(subjectType: CaseSubjectType): QueueDef | null {
  return QUEUES.find((q) => q.subjectTypes.includes(subjectType)) ?? null;
}

export function queueByKey(key: string): QueueDef | null {
  return QUEUES.find((q) => q.key === key) ?? null;
}

export type CaseRow = {
  subjectType: CaseSubjectType;
  status: CaseStatus;
  openedAt: Date;
  dueAt: Date;
  slaSeconds: number;
  clockStoppedAt: Date | null;
};

export type QueueTile = {
  key: QueueKey;
  icon: string;
  open: number;
  oldestOpenedAt: Date | null;
  worst: SlaState | null;
};

const SEVERITY: Record<SlaState, number> = { ok: 0, paused: 1, warn: 2, late: 3 };

export function buildTiles(rows: CaseRow[], now: Date): QueueTile[] {
  return QUEUES.map((q) => {
    const mine = rows.filter((r) => q.subjectTypes.includes(r.subjectType) && isOpen(r.status));
    let oldest: Date | null = null;
    let worst: SlaState | null = null;
    for (const r of mine) {
      if (!oldest || r.openedAt < oldest) oldest = r.openedAt;
      const { state } = slaState({ now, dueAt: r.dueAt, slaSeconds: r.slaSeconds, clockStoppedAt: r.clockStoppedAt });
      if (!worst || SEVERITY[state] > SEVERITY[worst]) worst = state;
    }
    return { key: q.key, icon: q.icon, open: mine.length, oldestOpenedAt: oldest, worst };
  });
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `npx vitest run tests/case-queues.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/queues.ts tests/case-queues.test.ts
git commit -m "feat(cases): реестр очередей и сборка плиток"
```

---

### Task 5: Журнал дела (`src/lib/cases/journal.ts`)

**Files:**
- Create: `src/lib/cases/journal.ts`
- Test: добавляется в `tests/case-ensure.test.ts` (Task 6) — здесь тестируется только
  чистая часть, в `tests/case-queues.test.ts` её держать нельзя.
- Test: `tests/case-journal.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/case-journal.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { describeEvent } from "@/lib/cases/journal";

describe("описание события журнала", () => {
  it("взятие в работу", () => {
    expect(describeEvent({ kind: "CLAIMED", payload: null })).toEqual({ key: "claimed", params: {} });
  });

  it("смена статуса несёт оба статуса", () => {
    expect(describeEvent({ kind: "STATUS_CHANGED", payload: { from: "NEW", to: "IN_REVIEW" } })).toEqual({
      key: "statusChanged",
      params: { from: "NEW", to: "IN_REVIEW" },
    });
  });

  it("правка времени несёт минуты и причину", () => {
    expect(describeEvent({ kind: "TIME_ADJUSTED", payload: { minutes: 30, note: "созвон" } })).toEqual({
      key: "timeAdjusted",
      params: { minutes: 30, note: "созвон" },
    });
  });

  it("неизвестное событие не роняет журнал", () => {
    expect(describeEvent({ kind: "NOTE", payload: null })).toEqual({ key: "note", params: {} });
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run tests/case-journal.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/journal"`.

- [ ] **Step 3: Написать `src/lib/cases/journal.ts`**

```ts
import type { CaseActorSide, CaseEventKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Журнал дела — только вставка. Ни одного update/delete по CaseEvent в проекте
 * быть не должно: это и есть «неизменяемый».
 */
export async function appendCaseEvent(input: {
  caseId: string;
  actorId?: string | null;
  actorSide?: CaseActorSide;
  kind: CaseEventKind;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.caseEvent.create({
      data: {
        caseId: input.caseId,
        actorId: input.actorId ?? null,
        actorSide: input.actorSide ?? "STAFF",
        kind: input.kind,
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Журнал не должен ронять само действие — ровно как logAdminAction.
    console.error("[case-journal] failed to append:", err);
  }
}

const KEYS: Record<CaseEventKind, string> = {
  OPENED: "opened",
  CLAIMED: "claimed",
  RELEASED: "released",
  STATUS_CHANGED: "statusChanged",
  CLOCK_PAUSED: "clockPaused",
  CLOCK_RESUMED: "clockResumed",
  TIME_ADJUSTED: "timeAdjusted",
  NOTE: "note",
  DECIDED: "decided",
};

/** Событие → ключ перевода `admin.case.journal.<key>` и его параметры. */
export function describeEvent(event: {
  kind: CaseEventKind;
  payload: unknown;
}): { key: string; params: Record<string, string | number> } {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" || typeof v === "number") params[k] = v;
  }
  return { key: KEYS[event.kind] ?? "note", params };
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `npx vitest run tests/case-journal.test.ts`
Expected: PASS, 4 теста.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/journal.ts tests/case-journal.test.ts
git commit -m "feat(cases): неизменяемый журнал дела"
```

---

### Task 6: Заведение дела (`src/lib/cases/ensure.ts`)

**Files:**
- Create: `src/lib/cases/ensure.ts`
- Test: `tests/case-ensure.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/case-ensure.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { ensureCaseCore } from "@/lib/cases/ensure";

function makeFakePrisma() {
  const cases: Record<string, any> = {};
  const events: any[] = [];
  let seq = 0;
  return {
    state: { cases, events },
    prisma: {
      complianceCase: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = `${where.subjectType_subjectId.subjectType}:${where.subjectType_subjectId.subjectId}`;
          return cases[key] ?? null;
        }),
        create: vi.fn(async ({ data }: any) => {
          const key = `${data.subjectType}:${data.subjectId}`;
          if (cases[key]) {
            const err: any = new Error("unique");
            err.code = "P2002";
            throw err;
          }
          cases[key] = { id: `case${++seq}`, ...data };
          return cases[key];
        }),
      },
      caseEvent: { create: vi.fn(async ({ data }: any) => { events.push(data); return data; }) },
    },
  };
}

const INPUT = {
  subjectType: "COMPANY" as const,
  subjectId: "co1",
  title: "ACME d.o.o.",
  applicantUserId: "u1",
  openedAt: new Date("2026-11-13T10:00:00Z"),
};

describe("ensureCaseCore", () => {
  it("заводит дело со сроком и журнальной записью", async () => {
    const f = makeFakePrisma();
    const id = await ensureCaseCore(f.prisma as any, INPUT);
    expect(id).toBe("case1");
    const created = f.state.cases["COMPANY:co1"];
    expect(created.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(created.slaSeconds).toBe(7 * 24 * 3600);
    expect(created.status).toBe("NEW");
    expect(f.state.events).toHaveLength(1);
    expect(f.state.events[0].kind).toBe("OPENED");
  });

  it("второй вызов не плодит второе дело", async () => {
    const f = makeFakePrisma();
    const a = await ensureCaseCore(f.prisma as any, INPUT);
    const b = await ensureCaseCore(f.prisma as any, INPUT);
    expect(b).toBe(a);
    expect(Object.keys(f.state.cases)).toHaveLength(1);
    expect(f.state.events).toHaveLength(1);
  });

  it("гонку двух заведений снимает P2002, а не падение", async () => {
    const f = makeFakePrisma();
    f.prisma.complianceCase.findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // первая проверка: дела нет
      .mockResolvedValue({ id: "case9" }); // после P2002 читаем чужое
    f.prisma.complianceCase.create = vi.fn(async () => {
      const err: any = new Error("unique");
      err.code = "P2002";
      throw err;
    });
    await expect(ensureCaseCore(f.prisma as any, INPUT)).resolves.toBe("case9");
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run tests/case-ensure.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/ensure"`.

- [ ] **Step 3: Написать `src/lib/cases/ensure.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeDue } from "./sla";
import type { CaseRisk, CaseSubjectType } from "@prisma/client";

export type EnsureCaseInput = {
  subjectType: CaseSubjectType;
  subjectId: string;
  title: string;
  applicantUserId: string | null;
  risk?: CaseRisk;
  openedAt?: Date;
};

/**
 * Идемпотентно: у объекта ровно одно дело (@@unique([subjectType, subjectId])).
 * Параллельная подача ловится P2002 и читает чужое дело, а не падает.
 */
export async function ensureCaseCore(
  db: Pick<PrismaClient, "complianceCase" | "caseEvent">,
  input: EnsureCaseInput,
): Promise<string> {
  const key = { subjectType_subjectId: { subjectType: input.subjectType, subjectId: input.subjectId } };
  const existing = await db.complianceCase.findUnique({ where: key });
  if (existing) return existing.id;

  const openedAt = input.openedAt ?? new Date();
  const { dueAt, slaSeconds } = computeDue(openedAt, input.subjectType);
  try {
    const created = await db.complianceCase.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        title: input.title.slice(0, 200),
        applicantUserId: input.applicantUserId,
        risk: input.risk ?? "MEDIUM",
        status: "NEW",
        openedAt,
        dueAt,
        slaSeconds,
      },
    });
    await db.caseEvent.create({
      data: { caseId: created.id, actorSide: "SYSTEM", kind: "OPENED", payload: { title: input.title } },
    });
    return created.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const other = await db.complianceCase.findUnique({ where: key });
      if (other) return other.id;
    }
    throw err;
  }
}

export async function ensureCase(input: EnsureCaseInput): Promise<string> {
  return ensureCaseCore(prisma, input);
}
```

- [ ] **Step 4: Запустить — проходит**

Run: `npx vitest run tests/case-ensure.test.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cases/ensure.ts tests/case-ensure.test.ts
git commit -m "feat(cases): идемпотентное заведение дела под объект"
```

---

### Task 7: Чтение объекта заявки (`src/lib/cases/subject.ts`)

**Files:**
- Create: `src/lib/cases/subject.ts`

Тут нет арифметики — только выборки, поэтому юнит-теста нет; проверка живым прогоном
в Task 9 (backfill покажет настоящие названия).

- [ ] **Step 1: Написать `src/lib/cases/subject.ts`**

```ts
import { prisma } from "@/lib/prisma";
import type { CaseSubjectType } from "@prisma/client";

export type SubjectField = { label: string; value: string };
export type SubjectSummary = {
  title: string;
  applicantUserId: string | null;
  /** Куда смотреть сам объект на публичной стороне, если он там есть. */
  href: string | null;
  fields: SubjectField[];
};

function text(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export async function loadSubject(
  subjectType: CaseSubjectType,
  subjectId: string,
): Promise<SubjectSummary | null> {
  switch (subjectType) {
    case "COMPANY":
    case "KYB": {
      const c = await prisma.company.findUnique({ where: { id: subjectId } });
      if (!c) return null;
      return {
        title: c.displayName,
        applicantUserId: c.ownerUserId,
        href: `/en/companies/${c.id}`,
        fields: [
          { label: "legalName", value: text(c.legalName) },
          { label: "country", value: text(c.country) },
          { label: "city", value: text(c.city) },
          { label: "address", value: text(c.address ?? `${c.street ?? ""} ${c.houseNumber ?? ""}`.trim()) },
          { label: "email", value: text(c.email) },
          { label: "phone", value: text(c.phone) },
          { label: "website", value: text(c.website) },
        ],
      };
    }
    case "POINT": {
      const p = await prisma.companyPoint.findUnique({
        where: { id: subjectId },
        include: { company: { select: { displayName: true, ownerUserId: true } } },
      });
      if (!p) return null;
      return {
        title: p.name,
        applicantUserId: p.company?.ownerUserId ?? null,
        href: null,
        fields: [
          { label: "company", value: text(p.company?.displayName) },
          { label: "country", value: text(p.countryCode) },
          { label: "address", value: text(p.address) },
          { label: "coords", value: `${p.lat}, ${p.lng}` },
        ],
      };
    }
    case "COIN_CARD": {
      const card = await prisma.coinCard.findUnique({ where: { id: subjectId } });
      if (!card) return null;
      return {
        title: `${card.name} (${card.symbol})`,
        applicantUserId: card.stewardUserId,
        href: `/en/cards/${card.slug}`,
        fields: [
          { label: "symbol", value: card.symbol },
          { label: "completeness", value: `${card.completeness}%` },
          { label: "trust", value: card.trust },
          { label: "website", value: text(card.tagline) },
        ],
      };
    }
    case "EXCHANGE": {
      const e = await prisma.registeredExchange.findUnique({ where: { id: subjectId } });
      if (!e) return null;
      return {
        title: e.displayName,
        applicantUserId: e.ownerUserId,
        href: null,
        fields: [{ label: "legalName", value: text(e.legalName) }],
      };
    }
    case "FINTECH": {
      const f = await prisma.fintechCompany.findUnique({ where: { id: subjectId } });
      if (!f) return null;
      return {
        title: f.displayName,
        applicantUserId: f.ownerUserId ?? null,
        href: null,
        fields: [{ label: "legalName", value: text(f.legalName) }],
      };
    }
    case "COIN_REQUEST": {
      const r = await prisma.coinRequest.findUnique({ where: { id: subjectId } });
      if (!r) return null;
      return {
        title: `${r.name} (${r.symbol})`,
        applicantUserId: r.userId,
        href: null,
        fields: [
          { label: "symbol", value: r.symbol },
          { label: "coingeckoId", value: text(r.coingeckoId) },
          { label: "reason", value: r.reason },
        ],
      };
    }
    case "POINT_REPORT":
      // Появится в слайсе AQ вместе с таблицей PointReport.
      return null;
  }
}
```

- [ ] **Step 2: Проверить, что типы сходятся**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: пусто (или только ошибки, не относящиеся к `src/lib/cases/`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/cases/subject.ts
git commit -m "feat(cases): чтение объекта заявки для раскрытия дела"
```

---

### Task 8: Дела заводятся при подаче заявки

**Files:**
- Modify: `src/app/actions/company.ts:52` (создание Company), `src/app/actions/company.ts:117` (создание CompanyPoint)
- Modify: `src/app/actions/coin-card.ts:94`, `src/app/actions/exchange.ts:18`, `src/app/actions/fintech.ts:139`, `src/app/actions/coin-request.ts:68`

- [ ] **Step 1: Подключить `ensureCase` после создания компании**

В `src/app/actions/company.ts` добавить импорт в шапку файла:

```ts
import { ensureCase } from "@/lib/cases/ensure";
```

Сразу после `const company = await prisma.company.create({ … });` (строка ~52) дописать:

```ts
  await ensureCase({
    subjectType: "COMPANY",
    subjectId: company.id,
    title: company.displayName,
    applicantUserId: company.ownerUserId,
  });
```

- [ ] **Step 2: Подключить `ensureCase` после создания точки**

В том же файле создание точки (строка ~117) вернуть в переменную и завести дело:

```ts
  const point = await prisma.companyPoint.create({ /* существующие данные без изменений */ });
  await ensureCase({
    subjectType: "POINT",
    subjectId: point.id,
    title: point.name,
    applicantUserId: company.ownerUserId,
  });
```

(Если переменной `company` в этой области нет — взять владельца запросом
`await prisma.company.findUnique({ where: { id: point.companyId }, select: { ownerUserId: true } })`.)

- [ ] **Step 3: То же для карточки монеты, биржи, финтеха и заявки на монету**

`src/app/actions/coin-card.ts` после `const card = await prisma.coinCard.create(...)`:

```ts
  await ensureCase({
    subjectType: "COIN_CARD",
    subjectId: card.id,
    title: `${card.name} (${card.symbol})`,
    applicantUserId: card.stewardUserId,
  });
```

`src/app/actions/exchange.ts` после `const exchange = await prisma.registeredExchange.create(...)`:

```ts
  await ensureCase({
    subjectType: "EXCHANGE",
    subjectId: exchange.id,
    title: exchange.displayName,
    applicantUserId: exchange.ownerUserId,
  });
```

`src/app/actions/fintech.ts` после `const row = await prisma.fintechCompany.create(...)`:

```ts
  await ensureCase({
    subjectType: "FINTECH",
    subjectId: row.id,
    title: row.displayName,
    applicantUserId: row.ownerUserId ?? null,
  });
```

`src/app/actions/coin-request.ts` после `const request = await prisma.coinRequest.create(...)`:

```ts
  await ensureCase({
    subjectType: "COIN_REQUEST",
    subjectId: request.id,
    title: `${request.name} (${request.symbol})`,
    applicantUserId: request.userId,
  });
```

В каждый файл добавить импорт `import { ensureCase } from "@/lib/cases/ensure";`.

- [ ] **Step 4: Проверить сборку типов**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/company.ts src/app/actions/coin-card.ts src/app/actions/exchange.ts src/app/actions/fintech.ts src/app/actions/coin-request.ts
git commit -m "feat(cases): новая заявка сразу заводит дело"
```

---

### Task 9: Посев дел под уже лежащие заявки

**Files:**
- Create: `scripts/backfill-cases.ts`

- [ ] **Step 1: Написать `scripts/backfill-cases.ts`**

```ts
/**
 * Разовый посев: заводит дела под заявки, поданные до слайса AN. Без него
 * очереди после выкатки окажутся пустыми, хотя заявки лежат.
 *
 *   npx tsx scripts/backfill-cases.ts --dump    # показать, что будет заведено
 *   npx tsx scripts/backfill-cases.ts           # завести
 */
import { prisma } from "../src/lib/prisma";
import { ensureCase } from "../src/lib/cases/ensure";

const DUMP = process.argv.includes("--dump");

async function main() {
  const planned: { type: string; id: string; title: string; openedAt: Date }[] = [];

  for (const c of await prisma.company.findMany({ where: { status: "PENDING", deletedAt: null } })) {
    planned.push({ type: "COMPANY", id: c.id, title: c.displayName, openedAt: c.createdAt });
  }
  for (const p of await prisma.companyPoint.findMany({
    where: { status: "PENDING", deletedAt: null, company: { deletedAt: null } },
    include: { company: { select: { ownerUserId: true } } },
  })) {
    planned.push({ type: "POINT", id: p.id, title: p.name, openedAt: p.createdAt });
  }
  for (const card of await prisma.coinCard.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "COIN_CARD", id: card.id, title: `${card.name} (${card.symbol})`, openedAt: card.createdAt });
  }
  for (const r of await prisma.coinRequest.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "COIN_REQUEST", id: r.id, title: `${r.name} (${r.symbol})`, openedAt: r.createdAt });
  }
  for (const e of await prisma.registeredExchange.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "EXCHANGE", id: e.id, title: e.displayName, openedAt: e.createdAt });
  }
  for (const f of await prisma.fintechCompany.findMany({ where: { status: "PENDING" } })) {
    planned.push({ type: "FINTECH", id: f.id, title: f.displayName, openedAt: f.createdAt });
  }

  if (DUMP) {
    for (const p of planned) console.log(`${p.type}\t${p.id}\t${p.openedAt.toISOString()}\t${p.title}`);
    console.log(`\nвсего: ${planned.length}`);
    return;
  }

  let made = 0;
  for (const p of planned) {
    const summary = await import("../src/lib/cases/subject").then((m) =>
      m.loadSubject(p.type as never, p.id),
    );
    await ensureCase({
      subjectType: p.type as never,
      subjectId: p.id,
      title: p.title,
      applicantUserId: summary?.applicantUserId ?? null,
      openedAt: p.openedAt,
    });
    made += 1;
  }
  console.log(`дел заведено или уже было: ${made}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Посмотреть, что посеется**

Run: `npx tsx scripts/backfill-cases.ts --dump`
Expected: список строк вида `COMPANY<TAB>cm…<TAB>2026-…<TAB>Название` и итоговое число.
На сегодняшних данных это 1 компания и 1 точка.

- [ ] **Step 3: Посеять**

Run: `npx tsx scripts/backfill-cases.ts`
Expected: `дел заведено или уже было: N`, где N совпадает с числом из `--dump`.

- [ ] **Step 4: Убедиться, что повтор не плодит дел**

Run:
```bash
npx tsx scripts/backfill-cases.ts
source .env && psql "$DATABASE_URL" -t -A -c 'select count(*) from "ComplianceCase"'
```
Expected: число во второй команде равно N (а не 2N).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-cases.ts
git commit -m "feat(cases): посев дел под уже лежащие заявки"
```

---

### Task 10: Правила вида (`src/lib/admin-ui.ts`)

**Files:**
- Create: `src/lib/admin-ui.ts`
- Test: `tests/admin-ui-rules.test.ts`

- [ ] **Step 1: Написать падающий тест `tests/admin-ui-rules.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY, ADMIN_COLUMN, ADMIN_TILE } from "@/lib/admin-ui";

describe("правила вида админки", () => {
  it("кнопка не ниже 44 px и во всю ширину", () => {
    for (const cls of [ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY]) {
      expect(cls).toContain("h-12");
      expect(cls).toContain("w-full");
      expect(cls).toContain("rounded-");
    }
  });

  it("колонка содержимого по центру", () => {
    expect(ADMIN_COLUMN).toContain("mx-auto");
    expect(ADMIN_COLUMN).toContain("max-w-");
  });

  it("плитка квадратная", () => {
    expect(ADMIN_TILE).toContain("aspect-square");
  });
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run tests/admin-ui-rules.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/admin-ui"`.

- [ ] **Step 3: Написать `src/lib/admin-ui.ts`**

```ts
/**
 * Правила вида админки в одном месте, а не россыпью по экранам.
 *
 * Два требования владельца (17.11): действие — всегда кнопка, а не подчёркнутое
 * слово (пальцем в слово не попасть), и содержимое идёт колонкой по центру —
 * на телефоне и на компьютере одинаково, компьютер просто шире.
 */

/** Высота 48 px — выше порога 44 px, который считается пригодным для пальца. */
export const ADMIN_BUTTON =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40";

export const ADMIN_BUTTON_SECONDARY =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-hairline bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-card-alt disabled:opacity-40";

export const ADMIN_BUTTON_DANGER =
  "flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border border-down/40 bg-transparent px-4 text-sm font-semibold text-down transition-colors hover:bg-down/10 disabled:opacity-40";

/** Колонка содержимого: по центру всегда, на большом экране просто шире. */
export const ADMIN_COLUMN = "mx-auto w-full max-w-[1100px] px-4 md:px-6";

/** Квадратная плитка со скруглением 22 px. */
export const ADMIN_TILE =
  "relative flex aspect-square flex-col justify-between overflow-hidden rounded-[22px] border border-hairline bg-card p-4";

/** Цвет точки срока. */
export const SLA_DOT: Record<"ok" | "warn" | "late" | "paused", string> = {
  ok: "bg-up",
  warn: "bg-[#e2a33c]",
  late: "bg-down",
  paused: "bg-muted",
};
```

- [ ] **Step 4: Запустить — проходит**

Run: `npx vitest run tests/admin-ui-rules.test.ts`
Expected: PASS, 3 теста.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-ui.ts tests/admin-ui-rules.test.ts
git commit -m "feat(admin): правила вида — кнопка во всю ширину, колонка по центру"
```

---

### Task 11: Экшены дела (`src/app/actions/cases.ts`)

**Files:**
- Create: `src/app/actions/cases.ts`

- [ ] **Step 1: Написать `src/app/actions/cases.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { appendCaseEvent } from "@/lib/cases/journal";
import { beatPatch, closePatch, IDLE_MS, isStale } from "@/lib/cases/time";

export async function claimCase(input: { caseId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };
  if (c.assigneeId && c.assigneeId !== admin.userId) return { ok: false, reason: "taken" };

  await prisma.complianceCase.update({
    where: { id: c.id },
    data: { assigneeId: admin.userId, status: c.status === "NEW" ? "IN_REVIEW" : c.status },
  });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "CLAIMED" });
  if (c.status === "NEW") {
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: "NEW", to: "IN_REVIEW" },
    });
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function releaseCase(input: { caseId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };
  if (c.assigneeId !== admin.userId) return { ok: false, reason: "not_yours" };

  await closeOpenEntries(c.id, admin.userId);
  await prisma.complianceCase.update({ where: { id: c.id }, data: { assigneeId: null } });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "RELEASED" });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Биение страницы дела. Открытый сеанс продлевается, протухший закрывается
 * задним числом последним биением — простой работой не считается.
 */
export async function caseHeartbeat(input: { caseId: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const now = new Date();

  const open = await prisma.caseTimeEntry.findFirst({
    where: { caseId: input.caseId, userId: admin.userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  if (open && !isStale({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }, now, IDLE_MS)) {
    const patch = beatPatch({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }, now);
    await prisma.caseTimeEntry.update({ where: { id: open.id }, data: patch });
    await recomputeHandled(input.caseId);
    return { ok: true, seconds: patch.seconds };
  }

  if (open) {
    await prisma.caseTimeEntry.update({
      where: { id: open.id },
      data: closePatch({ startedAt: open.startedAt, lastBeatAt: open.lastBeatAt }),
    });
  }
  await prisma.caseTimeEntry.create({
    data: { caseId: input.caseId, userId: admin.userId, startedAt: now, lastBeatAt: now, seconds: 0 },
  });
  await recomputeHandled(input.caseId);
  return { ok: true, seconds: 0 };
}

export async function adjustCaseTime(input: { caseId: string; minutes: number; note: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const note = input.note.trim();
  // Тихая правка обессмыслила бы показатель: причина обязательна.
  if (note.length < 3) return { ok: false, reason: "note_too_short" };
  if (!Number.isFinite(input.minutes) || input.minutes === 0) return { ok: false, reason: "bad_minutes" };

  const now = new Date();
  await prisma.caseTimeEntry.create({
    data: {
      caseId: input.caseId,
      userId: admin.userId,
      startedAt: now,
      lastBeatAt: now,
      endedAt: now,
      seconds: Math.round(input.minutes * 60),
      source: "MANUAL",
      note,
    },
  });
  await appendCaseEvent({
    caseId: input.caseId,
    actorId: admin.userId,
    kind: "TIME_ADJUSTED",
    payload: { minutes: input.minutes, note },
  });
  await recomputeHandled(input.caseId);
  revalidatePath("/", "layout");
  return { ok: true };
}

async function closeOpenEntries(caseId: string, userId: string) {
  const open = await prisma.caseTimeEntry.findMany({ where: { caseId, userId, endedAt: null } });
  for (const e of open) {
    await prisma.caseTimeEntry.update({
      where: { id: e.id },
      data: closePatch({ startedAt: e.startedAt, lastBeatAt: e.lastBeatAt }),
    });
  }
}

async function recomputeHandled(caseId: string) {
  const agg = await prisma.caseTimeEntry.aggregate({ where: { caseId }, _sum: { seconds: true } });
  await prisma.complianceCase.update({
    where: { id: caseId },
    data: { handledSeconds: agg._sum.seconds ?? 0 },
  });
}
```

- [ ] **Step 2: Проверить типы**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/cases.ts
git commit -m "feat(cases): взятие в работу, отпускание, биение таймера, правка времени"
```

---

### Task 12: Экран плиток `/admin/queues`

**Files:**
- Create: `src/components/admin/queue-tile.tsx`, `src/app/[locale]/admin/queues/page.tsx`
- Modify: `messages/en.json`

- [ ] **Step 1: Написать `src/components/admin/queue-tile.tsx`**

```tsx
import Link from "next/link";
import { ADMIN_TILE, SLA_DOT } from "@/lib/admin-ui";
import type { QueueTile as Tile } from "@/lib/cases/queues";

export function QueueTileCard({
  tile,
  label,
  href,
  ageLabel,
  slaLabel,
  emptyLabel,
}: {
  tile: Tile;
  label: string;
  href: string;
  ageLabel: string | null;
  slaLabel: string | null;
  emptyLabel: string;
}) {
  const hot = tile.worst === "late" || tile.worst === "warn";
  return (
    <Link
      href={href}
      className={`${ADMIN_TILE} ${hot ? "border-accent/45" : ""} transition-colors hover:border-accent/60`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-card-alt text-base">
        {tile.icon}
      </div>
      <div>
        <div
          className={
            tile.open > 0
              ? "text-[34px] font-bold leading-none tracking-[-0.04em]"
              : "text-[26px] font-semibold leading-none text-muted"
          }
        >
          {tile.open}
        </div>
        <div className="mt-1 text-[13px] font-semibold leading-tight">{label}</div>
        <div className="mt-0.5 text-[10.5px] leading-snug text-muted">
          {tile.open > 0 ? ageLabel : emptyLabel}
        </div>
        {tile.worst && slaLabel ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted">
            <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[tile.worst]}`} />
            {slaLabel}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Написать `src/app/[locale]/admin/queues/page.tsx`**

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { QueueTileCard } from "@/components/admin/queue-tile";
import { buildTiles, queueOfSubject, type CaseRow } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { OPEN_STATUSES } from "@/lib/cases/types";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

function days(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

function hoursLeft(seconds: number): { d: number; h: number } {
  return { d: Math.floor(seconds / 86400), h: Math.floor((seconds % 86400) / 3600) };
}

export default async function AdminQueuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const now = new Date();

  const rows = (await prisma.complianceCase.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: { subjectType: true, status: true, openedAt: true, dueAt: true, slaSeconds: true, clockStoppedAt: true },
  })) as CaseRow[];

  const tiles = buildTiles(rows, now);
  const totalOpen = tiles.reduce((s, x) => s + x.open, 0);

  // Худший остаток по очереди — для подписи под точкой срока.
  const worstLeft = new Map<string, number>();
  for (const tile of tiles) {
    const mine = rows.filter((r) => queueOfSubject(r.subjectType)?.key === tile.key);
    let min = Number.POSITIVE_INFINITY;
    for (const r of mine) {
      const { remainingSeconds } = slaState({ now, dueAt: r.dueAt, slaSeconds: r.slaSeconds, clockStoppedAt: r.clockStoppedAt });
      min = Math.min(min, remainingSeconds);
    }
    if (Number.isFinite(min)) worstLeft.set(tile.key, min);
  }

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      <header className="mb-6 text-center">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">{t("tabs.queues")}</div>
        <h1 className="mb-1 text-[32px] font-bold tracking-[-0.03em]">{t("queues.title")}</h1>
        <p className="text-sm text-muted">{t("queues.subtitle", { count: totalOpen })}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const left = worstLeft.get(tile.key);
          const { d, h } = hoursLeft(left ?? 0);
          return (
            <QueueTileCard
              key={tile.key}
              tile={tile}
              label={t(`queues.names.${tile.key}`)}
              href={`/${locale}/admin/queues/${tile.key}`}
              ageLabel={
                tile.oldestOpenedAt ? t("queues.oldest", { days: days(tile.oldestOpenedAt, now) }) : null
              }
              slaLabel={
                tile.worst === "late"
                  ? t("queues.late")
                  : tile.worst === "paused"
                    ? t("queues.paused")
                    : left !== undefined
                      ? t("queues.left", { d, h })
                      : null
              }
              emptyLabel={t("queues.empty")}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Добавить ключи в `messages/en.json`**

В объект `admin` дописать (рядом с `tabs`):

```json
    "queues": {
      "title": "Queues",
      "subtitle": "{count} cases waiting for a decision",
      "oldest": "oldest — {days}d",
      "left": "due in {d}d {h}h",
      "late": "overdue",
      "paused": "waiting for applicant",
      "empty": "queue is empty",
      "names": {
        "coinCards": "Coin cards",
        "companies": "Companies",
        "points": "Map points",
        "exchanges": "Exchanges",
        "fintech": "Fintech",
        "kyb": "KYB documents",
        "coinRequests": "Coin requests",
        "pointReports": "Point reports"
      }
    },
```

И в `admin.tabs` добавить `"queues": "Queues"`.

- [ ] **Step 4: Проверить, что страница собирается**

Run: `npm run build 2>&1 | tail -20`
Expected: `✓ Compiled successfully`, среди маршрутов есть `/[locale]/admin/queues`.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/queue-tile.tsx "src/app/[locale]/admin/queues/page.tsx" messages/en.json
git commit -m "feat(admin): плитки очередей вместо полосы закладок"
```

---

### Task 13: Список дел очереди `/admin/queues/[queue]`

**Files:**
- Create: `src/components/admin/case-row.tsx`, `src/app/[locale]/admin/queues/[queue]/page.tsx`
- Modify: `messages/en.json`

- [ ] **Step 1: Написать `src/components/admin/case-row.tsx`**

```tsx
import Link from "next/link";
import { SLA_DOT } from "@/lib/admin-ui";
import type { SlaState } from "@/lib/cases/types";

export function CaseRowCard({
  href,
  title,
  statusLabel,
  slaLabel,
  slaState,
  assigneeLabel,
  handledLabel,
}: {
  href: string;
  title: string;
  statusLabel: string;
  slaLabel: string;
  slaState: SlaState;
  assigneeLabel: string | null;
  handledLabel: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[18px] border border-hairline bg-card p-4 transition-colors hover:border-accent/50"
    >
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <b className="text-[14px] font-semibold leading-tight">{title}</b>
        <span className="shrink-0 rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[slaState]}`} />
          {slaLabel}
        </span>
        {assigneeLabel ? <span>· {assigneeLabel}</span> : null}
        <span>· {handledLabel}</span>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Написать `src/app/[locale]/admin/queues/[queue]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { AdminNav } from "@/components/admin/nav";
import { CaseRowCard } from "@/components/admin/case-row";
import { queueByKey } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { formatHandled } from "@/lib/cases/time";
import { OPEN_STATUSES } from "@/lib/cases/types";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage({
  params,
}: {
  params: Promise<{ locale: string; queue: string }>;
}) {
  const { locale, queue } = await params;
  setRequestLocale(locale);
  const def = queueByKey(queue);
  if (!def) notFound();

  const t = await getTranslations("admin");
  const now = new Date();

  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: { in: def.subjectTypes }, status: { in: OPEN_STATUSES } },
    orderBy: { dueAt: "asc" },
    take: 100,
    include: { assignee: { select: { name: true, username: true } } },
  });

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      <header className="mb-6 text-center">
        <h1 className="text-[26px] font-bold tracking-[-0.03em]">{t(`queues.names.${def.key}`)}</h1>
        <p className="mt-1 text-sm text-muted">{t("queues.subtitle", { count: cases.length })}</p>
      </header>

      {cases.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("queues.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {cases.map((c) => {
            const s = slaState({ now, dueAt: c.dueAt, slaSeconds: c.slaSeconds, clockStoppedAt: c.clockStoppedAt });
            const d = Math.floor(s.remainingSeconds / 86400);
            const h = Math.floor((s.remainingSeconds % 86400) / 3600);
            return (
              <CaseRowCard
                key={c.id}
                href={`/${locale}/admin/cases/${c.id}`}
                title={c.title}
                statusLabel={t(`case.status.${c.status}`)}
                slaState={s.state}
                slaLabel={
                  s.state === "late"
                    ? t("queues.late")
                    : s.state === "paused"
                      ? t("queues.paused")
                      : t("queues.left", { d, h })
                }
                assigneeLabel={c.assignee ? (c.assignee.name ?? c.assignee.username) : null}
                handledLabel={formatHandled(c.handledSeconds)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Добавить ключи статусов в `messages/en.json`**

В объект `admin` дописать:

```json
    "case": {
      "status": {
        "NEW": "new",
        "IN_REVIEW": "in review",
        "WAITING_APPLICANT": "waiting for applicant",
        "READY_FOR_APPROVAL": "ready for approval",
        "APPROVED": "approved",
        "REJECTED": "rejected",
        "CLOSED": "closed"
      }
    },
```

- [ ] **Step 4: Собрать**

Run: `npm run build 2>&1 | tail -20`
Expected: `✓ Compiled successfully`, маршрут `/[locale]/admin/queues/[queue]` в списке.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/case-row.tsx "src/app/[locale]/admin/queues/[queue]/page.tsx" messages/en.json
git commit -m "feat(admin): список дел очереди"
```

---

### Task 14: Раскрытие дела `/admin/cases/[id]`

**Files:**
- Create: `src/components/admin/case-section.tsx`, `src/components/admin/case-journal.tsx`,
  `src/components/admin/case-claim.tsx`, `src/components/admin/case-timer.tsx`,
  `src/app/[locale]/admin/cases/[id]/page.tsx`
- Modify: `messages/en.json`

- [ ] **Step 1: Написать `src/components/admin/case-section.tsx`**

```tsx
/** Раскрывающийся раздел дела. `details` — без JS, работает и до гидрации. */
export function CaseSection({
  n,
  title,
  summary,
  open = false,
  children,
}: {
  n: string;
  title: string;
  summary: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="overflow-hidden rounded-[20px] border border-hairline bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="flex h-6.5 w-6.5 items-center justify-center rounded-[9px] bg-card-alt px-2 text-[11.5px] font-bold text-muted-strong">
          {n}
        </span>
        <span className="flex-1">
          <b className="block text-[14px] font-semibold">{title}</b>
          <span className="text-[11px] text-muted">{summary}</span>
        </span>
        <span className="text-[12px] text-muted">▾</span>
      </summary>
      <div className="border-t border-hairline px-4 pb-4 pt-3.5">{children}</div>
    </details>
  );
}
```

- [ ] **Step 2: Написать `src/components/admin/case-journal.tsx`**

```tsx
import { describeEvent } from "@/lib/cases/journal";
import type { CaseEventKind } from "@prisma/client";

export type JournalEntry = {
  id: string;
  kind: CaseEventKind;
  payload: unknown;
  createdAt: Date;
  actorName: string | null;
};

export function CaseJournal({
  entries,
  locale,
  tr,
}: {
  entries: JournalEntry[];
  locale: string;
  tr: (key: string, params: Record<string, string | number>) => string;
}) {
  return (
    <div>
      {entries.map((e) => {
        const d = describeEvent({ kind: e.kind, payload: e.payload });
        return (
          <div key={e.id} className="flex gap-3 border-b border-hairline py-2.5 last:border-b-0">
            <div className="num w-[58px] shrink-0 text-[10px] text-muted">
              {new Intl.DateTimeFormat(locale, {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(e.createdAt)}
            </div>
            <div className="text-[11.5px] leading-snug">
              {e.actorName ? <b className="font-semibold">{e.actorName} </b> : null}
              {tr(`case.journal.${d.key}`, d.params)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Написать `src/components/admin/case-claim.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { claimCase, releaseCase } from "@/app/actions/cases";
import { ADMIN_BUTTON, ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export function CaseClaim({
  caseId,
  mine,
  claimLabel,
  releaseLabel,
  takenLabel,
  taken,
}: {
  caseId: string;
  mine: boolean;
  claimLabel: string;
  releaseLabel: string;
  takenLabel: string;
  taken: boolean;
}) {
  const [pending, start] = useTransition();

  if (taken && !mine) {
    return <div className="text-center text-[11px] text-muted">{takenLabel}</div>;
  }

  return (
    <button
      type="button"
      disabled={pending}
      className={mine ? ADMIN_BUTTON_SECONDARY : ADMIN_BUTTON}
      onClick={() =>
        start(async () => {
          if (mine) await releaseCase({ caseId });
          else await claimCase({ caseId });
        })
      }
    >
      {mine ? releaseLabel : claimLabel}
    </button>
  );
}
```

- [ ] **Step 4: Написать `src/components/admin/case-timer.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { caseHeartbeat } from "@/app/actions/cases";
import { BEAT_MS } from "@/lib/cases/time";

/**
 * Биение, пока дело открыто у взявшего его сотрудника. Вкладка в фоне не бьёт:
 * время в руках не должно капать, пока человек смотрит в другое окно.
 */
export function CaseTimer({ caseId }: { caseId: string }) {
  useEffect(() => {
    let alive = true;
    const beat = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void caseHeartbeat({ caseId });
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [caseId]);

  return null;
}
```

- [ ] **Step 5: Написать `src/app/[locale]/admin/cases/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { AdminNav } from "@/components/admin/nav";
import { CaseSection } from "@/components/admin/case-section";
import { CaseJournal } from "@/components/admin/case-journal";
import { CaseClaim } from "@/components/admin/case-claim";
import { CaseTimer } from "@/components/admin/case-timer";
import { loadSubject } from "@/lib/cases/subject";
import { queueOfSubject } from "@/lib/cases/queues";
import { slaState } from "@/lib/cases/sla";
import { formatHandled } from "@/lib/cases/time";
import { ADMIN_COLUMN, SLA_DOT } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminCasePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const c = await prisma.complianceCase.findUnique({
    where: { id },
    include: {
      assignee: { select: { id: true, name: true, username: true } },
      applicant: { select: { name: true, username: true, email: true } },
      events: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { name: true, username: true } } },
      },
    },
  });
  if (!c) notFound();

  const session = await auth();
  const meId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const mine = !!meId && c.assigneeId === meId;

  const subject = await loadSubject(c.subjectType, c.subjectId);
  const now = new Date();
  const s = slaState({ now, dueAt: c.dueAt, slaSeconds: c.slaSeconds, clockStoppedAt: c.clockStoppedAt });
  const d = Math.floor(s.remainingSeconds / 86400);
  const h = Math.floor((s.remainingSeconds % 86400) / 3600);

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      {mine ? <CaseTimer caseId={c.id} /> : null}

      <header className="mb-5 text-center">
        <div className="num mb-2 text-[10px] uppercase tracking-[0.3em] text-muted">
          {t(`queues.names.${queueOfSubject(c.subjectType)?.key ?? "companies"}`)}
        </div>
        <h1 className="mb-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">{c.title}</h1>
        <div className="flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
            {t(`case.status.${c.status}`)}
          </span>
          <span className="rounded-full bg-card-alt px-2 py-1 text-[10px] font-semibold text-muted-strong">
            {t(`case.risk.${c.risk}`)}
          </span>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-[14px] border border-hairline bg-card p-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">{t("case.due")}</div>
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <span className={`block h-1.5 w-1.5 rounded-full ${SLA_DOT[s.state]}`} />
            {s.state === "late" ? t("queues.late") : t("queues.left", { d, h })}
          </div>
        </div>
        <div className="rounded-[14px] border border-hairline bg-card p-3">
          <div className="mb-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">{t("case.handled")}</div>
          <div className="text-[13px] font-semibold">{formatHandled(c.handledSeconds)}</div>
        </div>
      </div>

      <div className="mb-4">
        <CaseClaim
          caseId={c.id}
          mine={mine}
          taken={!!c.assigneeId}
          claimLabel={t("case.claim")}
          releaseLabel={t("case.release")}
          takenLabel={t("case.takenBy", { name: c.assignee?.name ?? c.assignee?.username ?? "—" })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <CaseSection
          n="1"
          title={t("case.sections.form")}
          summary={t("case.sections.formSummary", { count: subject?.fields.length ?? 0 })}
          open
        >
          {subject ? (
            <dl className="flex flex-col">
              {subject.fields.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 border-b border-hairline py-2 last:border-b-0">
                  <dt className="text-[11px] uppercase tracking-wider text-muted">{f.label}</dt>
                  <dd className="text-right text-[12.5px]">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[12px] text-muted">{t("case.sections.subjectGone")}</p>
          )}
        </CaseSection>

        <CaseSection n="2" title={t("case.sections.applicant")} summary={c.applicant?.email ?? "—"}>
          <div className="text-[12.5px]">
            {c.applicant?.name ?? c.applicant?.username ?? "—"}
            <div className="text-[11px] text-muted">{c.applicant?.email ?? "—"}</div>
          </div>
        </CaseSection>

        <CaseSection
          n="3"
          title={t("case.sections.journal")}
          summary={t("case.sections.journalSummary", { count: c.events.length })}
          open
        >
          <CaseJournal
            locale={locale}
            entries={c.events.map((e) => ({
              id: e.id,
              kind: e.kind,
              payload: e.payload,
              createdAt: e.createdAt,
              actorName: e.actor?.name ?? e.actor?.username ?? null,
            }))}
            tr={(key, paramsForKey) => t(key, paramsForKey)}
          />
        </CaseSection>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Дописать ключи в `messages/en.json` (внутрь `admin.case`)**

```json
      "risk": { "LOW": "low risk", "MEDIUM": "medium risk", "HIGH": "high risk" },
      "due": "Due in",
      "handled": "Time spent",
      "claim": "Take this case",
      "release": "Release the case",
      "takenBy": "Taken by {name}",
      "sections": {
        "form": "Application form",
        "formSummary": "{count} fields",
        "applicant": "Applicant",
        "journal": "Case journal",
        "journalSummary": "{count} entries, immutable",
        "subjectGone": "The object behind this case no longer exists"
      },
      "journal": {
        "opened": "opened the case",
        "claimed": "took the case",
        "released": "released the case",
        "statusChanged": "changed status: {from} → {to}",
        "clockPaused": "stopped the clock — waiting for the applicant",
        "clockResumed": "restarted the clock",
        "timeAdjusted": "adjusted time by {minutes} min — {note}",
        "note": "left a note",
        "decided": "made a decision"
      }
```

- [ ] **Step 7: Собрать**

Run: `npm run build 2>&1 | tail -20`
Expected: `✓ Compiled successfully`, маршрут `/[locale]/admin/cases/[id]` в списке.

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/case-section.tsx src/components/admin/case-journal.tsx src/components/admin/case-claim.tsx src/components/admin/case-timer.tsx "src/app/[locale]/admin/cases/[id]/page.tsx" messages/en.json
git commit -m "feat(admin): раскрытие дела — анкета, заявитель, журнал, таймер"
```

---

### Task 15: Очереди становятся входом в админку

**Files:**
- Modify: `src/components/admin/nav.tsx`, `src/app/[locale]/admin/page.tsx`

- [ ] **Step 1: Добавить закладку «Очереди» первой**

В `src/components/admin/nav.tsx` в массив `TABS` первым элементом:

```ts
  { key: "queues", path: "queues" },
```

- [ ] **Step 2: Перенаправлять `/admin` на очереди**

В `src/app/[locale]/admin/page.tsx` заменить строку редиректа:

```ts
  redirect(`/${locale}/admin/queues`);
```

- [ ] **Step 3: Собрать и проверить**

Run: `npm run build 2>&1 | tail -5`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/nav.tsx "src/app/[locale]/admin/page.tsx"
git commit -m "feat(admin): вход в админку ведёт на очереди"
```

---

### Task 16: Переводы, полный прогон тестов, выкатка

**Files:**
- Modify: `messages/*.json` (генерируется), `ecosystem` не трогаем

- [ ] **Step 1: Перевести новые ключи на все локали**

Run: `npm run i18n`
Expected: отчёт по каждой локали; прогон идемпотентный, уже переведённое не трогается.

- [ ] **Step 2: Прогнать все тесты**

Run: `npm test`
Expected: PASS целиком, включая `tests/messages-parity.test.ts` (он требует повтора формы
`en.json` всеми локалями).

- [ ] **Step 3: Собрать и выкатить**

Run:
```bash
npm run build && pm2 restart trientes-web && pm2 save
```
Expected: сборка без ошибок, `trientes-web` в статусе `online`.

Воркер не перезапускаем: ничего из `src/lib/cases/*` он не импортирует.

- [ ] **Step 4: Живая проверка**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://trientes.org/ru/admin
curl -s -o /dev/null -w "%{http_code}\n" https://trientes.org/ru/admin/queues
```
Expected: первый — `307` с перенаправлением (на `/ru/login?next=…` для анонима — это
нормально, страница под гейтом), второй — тоже `307`. Войти в браузере под админом и
открыть `/ru/admin/queues`: видны плитки, на плитке «Предприятия» и «Точки на карте»
стоят единицы из посева, остальные пусты.

- [ ] **Step 5: Проверить, что таймер считает**

Открыть дело, нажать «Взять в работу», подождать две минуты на странице, затем:

```bash
source .env && psql "$DATABASE_URL" -c 'select "caseId", seconds, source from "CaseTimeEntry" order by "startedAt" desc limit 3'
```
Expected: строка с `seconds` около 60–120 и `source = AUTO`.

- [ ] **Step 6: Commit и push**

```bash
git add messages
git commit -m "chore(i18n): переводы очередей и дела"
git push origin main
```

---

## Проверка плана против спеки

- Плитки очередей, возраст старейшей заявки, цветная точка срока — Task 12. ✅
- Раскрытие дела, анкета, журнал — Task 14. ✅
- Взятие в работу — Task 11 + 14. ✅
- Срок с остановкой часов — Task 2 (ядро готово; **сами переходы в
  `WAITING_APPLICANT` ставит слайс AO**, когда появится отправка сообщения; в AN
  функции `pausePatch`/`resumePatch` покрыты тестами и не вызываются из UI). ✅
- Учёт времени сеансами + правка с причиной — Task 3, 11, 14. ✅
- Неизменяемый журнал — Task 5. ✅
- Один слой дела поверх всех типов — Task 1, 6, 7, 8. ✅
- Бэкфилл — Task 9. ✅
- Кнопки вместо ссылок, колонка по центру — Task 10, применено в 12–14. ✅
- Колокольчик непрочитанных, переписка, лист проверок, четыре глаза, жалобы на точки,
  панель предприятия — **не в этом слайсе** (AO, AP, AQ, AR). Так и записано в спеке.
