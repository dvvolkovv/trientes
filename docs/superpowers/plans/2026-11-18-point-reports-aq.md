# Слайс AQ — жалобы на точки: приём, пороги, эскалация

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в карточке точки навигатора появляется «Сообщить о проблеме»; жалобы на одну
точку собираются в одно дело очереди `pointReports`, три независимые жалобы за 60 дней
ставят точке пометку «проверяется» и задают вопрос предприятию, молчание 14 дней даёт
предупреждение, ещё 14 — снятие точки с карты.

**Архитектура:** таблица `PointReport` (одна строка на жалобу) + уже существующий слой
дела (`ComplianceCase` с `subjectType = POINT_REPORT`, очередь, лист проверок и SLA для
него уже заведены слайсами AN–AP). Пороги и решения о переходах — чистые функции в
`src/lib/points/report-rules.ts`, им не нужна база. Ежедневный прогон
`runPointReportSweep()` в воркере двигает эскалацию; состояние переходов читается из
**журнала дела** (`CaseEvent` видов `POINT_REPORTED` / `POINT_ASKED` / `POINT_WARNED` /
`POINT_SUSPENDED`), а не из новых колонок — журнал неизменяем и уже есть.

**Границы слайса (сознательные решения):**

1. **Жалоба принимается только на наши точки** (`CompanyPoint`, id вида `company/<id>`
   в фиде). У точки зеркала BTC Map нет ни владельца, которому писать, ни способа её
   снять: ночной синк вернёт её обратно. Кнопка у чужой точки не показывается.
2. **Фото от анонима не принимаем.** Колонка `photoUrl` в таблице заводится (спека её
   называет), но форма её не показывает и маршрут не принимает: загрузка файла от
   неизвестного — отдельная дыра, а приватный корень вложений из AO рассчитан на
   автора, которого мы знаем. Текста и причины достаточно.
3. **С жалобщиком переписки нет** (так в спеке). `applicantUserId` дела — владелец
   предприятия: именно с ним ведётся диалог в нитке.

**Tech Stack:** Next.js (App Router, server actions), Prisma + PostgreSQL, next-intl,
vitest, node-cron в `worker/index.ts`.

---

## Структура файлов

| Файл | Ответственность |
| --- | --- |
| `prisma/schema.prisma` | `PointReport`, `PointReportReason`, поля пометки у `CompanyPoint`, новые виды события и звонка |
| `prisma/migrations/20261118060000_point_reports/migration.sql` | та же схема руками, применяется `migrate deploy` |
| `src/lib/points/report-rules.ts` | пороги и переходы — чистые функции, без базы |
| `src/lib/messages-raw.ts` | чтение строки перевода вне запроса (воркер) |
| `src/lib/points/reports.ts` | приём жалобы: проверки, запись, заведение дела, звонок |
| `src/app/api/point-report/route.ts` | публичный приём `POST` из навигатора |
| `src/lib/points/report-sweep.ts` | ежедневный прогон эскалации |
| `scripts/point-report-sweep.ts` | тот же прогон руками |
| `src/lib/cases/subject.ts` | анкета дела `POINT_REPORT` |
| `src/lib/cases/decide.ts` | решение по жалобе применяется к точке |
| `src/components/admin/case-reports.tsx` | раздел «Жалобы» в деле |
| `src/app/[locale]/admin/cases/[id]/page.tsx` | врезка раздела + сквозная нумерация разделов |
| `src/lib/company-points.ts` | снятая точка не отдаётся в фид, проверяемая помечается |
| `src/lib/crypto-map.ts` | поле `underReview` у `Poi` |
| `src/components/coin-detail/poi-report-dialog.tsx` | форма жалобы |
| `src/components/coin-detail/poi-pane-card.tsx` | кнопка и плашка «проверяется» |
| `worker/index.ts` | `cron.schedule("20 5 * * *", …)` |
| `messages/en.json` | ключи `cryptoMap.report.*`, `admin.case.reports.*`, `notify.pointReport.*` |

---

### Задача 1: Схема — таблица жалоб, пометка точки, новые виды события и звонка

**Файлы:**
- Изменить: `prisma/schema.prisma`
- Создать: `prisma/migrations/20261118060000_point_reports/migration.sql`

- [ ] **Шаг 1: добавить перечисление причин и таблицу жалоб**

В `prisma/schema.prisma` рядом с остальными перечислениями дела:

```prisma
/// Причина жалобы. Свободный текст лежит в comment — перечисление нужно, чтобы
/// считать однотипные жалобы, а не читать двести предложений.
enum PointReportReason {
  CLOSED
  NO_CRYPTO
  WRONG_ADDRESS
  OTHER
}

/// Жалоба посетителя на точку. Одна строка на жалобу; все жалобы по одной точке
/// собираются в одно дело (`ComplianceCase` с subjectType = POINT_REPORT).
model PointReport {
  id             String            @id @default(cuid())
  pointId        String
  point          CompanyPoint      @relation(fields: [pointId], references: [id], onDelete: Cascade)
  reporterUserId String?
  reporter       User?             @relation("PointReporter", fields: [reporterUserId], references: [id], onDelete: SetNull)
  /// sha256 адреса с солью: сам адрес хранить незачем, считать независимость — да.
  reporterIpHash String
  reason         PointReportReason
  comment        String?           @db.Text
  /// Спека называет фото; форма его пока не принимает (см. границы слайса AQ).
  photoUrl       String?
  createdAt      DateTime          @default(now())

  @@index([pointId, createdAt])
  @@index([reporterIpHash, pointId, createdAt])
}
```

- [ ] **Шаг 2: пометка и снятие у точки**

В модель `CompanyPoint` (после `rejectReason`) добавить:

```prisma
  /// Жалоб набралось достаточно: точка видна на карте с пометкой «проверяется».
  underReviewAt   DateTime?
  /// Точка снята с карты до выяснения. Статус APPROVED при этом не трогаем:
  /// снятие — мера надзора, а не отмена прошлого решения модератора.
  suspendedAt     DateTime?
  suspendReason   String?
  reports         PointReport[]
```

и индекс `@@index([suspendedAt])` к остальным индексам модели.

- [ ] **Шаг 3: обратные связи и новые значения перечислений**

В модель `User` добавить `pointReports PointReport[] @relation("PointReporter")`.

В `enum CaseEventKind` добавить четыре значения в конец:

```prisma
  POINT_REPORTED
  POINT_ASKED
  POINT_WARNED
  POINT_SUSPENDED
```

В `enum AdminNotificationKind` добавить `POINT_REPORTED`.

- [ ] **Шаг 4: миграция руками**

Создать `prisma/migrations/20261118060000_point_reports/migration.sql`:

```sql
CREATE TYPE "PointReportReason" AS ENUM ('CLOSED', 'NO_CRYPTO', 'WRONG_ADDRESS', 'OTHER');

ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_REPORTED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_ASKED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_WARNED';
ALTER TYPE "CaseEventKind" ADD VALUE 'POINT_SUSPENDED';
ALTER TYPE "AdminNotificationKind" ADD VALUE 'POINT_REPORTED';

ALTER TABLE "CompanyPoint"
  ADD COLUMN "underReviewAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendReason" TEXT;

CREATE INDEX "CompanyPoint_suspendedAt_idx" ON "CompanyPoint"("suspendedAt");

CREATE TABLE "PointReport" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "reporterUserId" TEXT,
    "reporterIpHash" TEXT NOT NULL,
    "reason" "PointReportReason" NOT NULL,
    "comment" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PointReport_pointId_createdAt_idx" ON "PointReport"("pointId", "createdAt");
CREATE INDEX "PointReport_reporterIpHash_pointId_createdAt_idx" ON "PointReport"("reporterIpHash", "pointId", "createdAt");

ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "CompanyPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PointReport" ADD CONSTRAINT "PointReport_reporterUserId_fkey"
  FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

`ALTER TYPE … ADD VALUE` в PostgreSQL до 12 не работает внутри транзакции; на проде
PostgreSQL 16, поэтому отдельных команд достаточно. Миграция пишется руками и
применяется `migrate deploy` — этот чекаут прод, `migrate dev` умеет предлагать сброс
базы.

- [ ] **Шаг 5: применить и сгенерировать клиент**

```bash
npx prisma migrate deploy && npx prisma generate
```
Ожидается: `1 migration found`, `Applied migration(s)`, затем `Generated Prisma Client`.

- [ ] **Шаг 6: проверить, что таблица на месте**

```bash
npx tsx -e 'import {prisma} from "./src/lib/prisma"; prisma.pointReport.count().then(n=>{console.log("reports",n);return prisma.$disconnect()})'
```
Ожидается: `reports 0`.

- [ ] **Шаг 7: коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20261118060000_point_reports
git commit -m "feat(points): таблица жалоб, пометка проверяемой точки, новые виды события"
```

---

### Задача 2: Пороги и переходы — чистые функции

**Файлы:**
- Создать: `src/lib/points/report-rules.ts`
- Тест: `tests/point-report-rules.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/point-report-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ESCALATE_AT,
  escalationFor,
  independentReporters,
  reporterIpHash,
  tooSoon,
} from "@/lib/points/report-rules";

const T0 = new Date("2026-11-18T10:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3600_000);
const days = (n: number) => new Date(T0.getTime() + n * 86400_000);

describe("reporterIpHash", () => {
  it("один адрес даёт один хэш и адрес в нём не читается", () => {
    expect(reporterIpHash("1.2.3.4")).toBe(reporterIpHash("1.2.3.4"));
    expect(reporterIpHash("1.2.3.4")).not.toContain("1.2.3.4");
    expect(reporterIpHash("1.2.3.4")).not.toBe(reporterIpHash("1.2.3.5"));
  });
});

describe("tooSoon", () => {
  it("вторая жалоба с того же адреса в те же сутки отвергается", () => {
    expect(tooSoon(T0, hours(5))).toBe(true);
  });
  it("через сутки можно снова", () => {
    expect(tooSoon(T0, hours(25))).toBe(false);
  });
  it("первой жалобе ничто не мешает", () => {
    expect(tooSoon(null, T0)).toBe(false);
  });
});

describe("independentReporters", () => {
  const row = (over: Partial<{ reporterUserId: string | null; reporterIpHash: string; createdAt: Date }>) => ({
    reporterUserId: null,
    reporterIpHash: "h1",
    createdAt: T0,
    ...over,
  });

  it("три разных адреса считаются тремя", () => {
    const n = independentReporters(
      [row({ reporterIpHash: "a" }), row({ reporterIpHash: "b" }), row({ reporterIpHash: "c" })],
      T0,
    );
    expect(n).toBe(3);
  });

  it("один адрес трижды — это одна жалоба", () => {
    const n = independentReporters(
      [row({ createdAt: days(-10) }), row({ createdAt: days(-5) }), row({})],
      T0,
    );
    expect(n).toBe(1);
  });

  it("вошедший считается по учётной записи, а не по адресу", () => {
    const n = independentReporters(
      [
        row({ reporterUserId: "u1", reporterIpHash: "a" }),
        row({ reporterUserId: "u1", reporterIpHash: "b" }),
      ],
      T0,
    );
    expect(n).toBe(1);
  });

  it("жалоба старше окна не считается", () => {
    const n = independentReporters(
      [row({ reporterIpHash: "a", createdAt: days(-61) }), row({ reporterIpHash: "b" })],
      T0,
    );
    expect(n).toBe(1);
  });
});

describe("escalationFor", () => {
  const base = {
    independent: ESCALATE_AT,
    underReviewAt: null,
    askedAt: null,
    warnedAt: null,
    suspendedAt: null,
    ownerRepliedAt: null,
    now: T0,
  };

  it("меньше порога — ничего не делаем", () => {
    expect(escalationFor({ ...base, independent: ESCALATE_AT - 1 })).toBeNull();
  });

  it("порог достигнут — пометка и вопрос предприятию", () => {
    expect(escalationFor(base)).toBe("REVIEW");
  });

  it("вопрос задан, две недели не прошли — ждём", () => {
    expect(
      escalationFor({ ...base, underReviewAt: T0, askedAt: T0, now: days(13) }),
    ).toBeNull();
  });

  it("две недели молчания — предупреждение", () => {
    expect(
      escalationFor({ ...base, underReviewAt: T0, askedAt: T0, now: days(14) }),
    ).toBe("WARN");
  });

  it("ответ предприятия останавливает эскалацию", () => {
    expect(
      escalationFor({
        ...base,
        underReviewAt: T0,
        askedAt: T0,
        ownerRepliedAt: days(1),
        now: days(30),
      }),
    ).toBeNull();
  });

  it("ещё две недели после предупреждения — снятие с карты", () => {
    expect(
      escalationFor({ ...base, underReviewAt: T0, askedAt: T0, warnedAt: days(14), now: days(28) }),
    ).toBe("SUSPEND");
  });

  it("снятая точка больше не эскалируется", () => {
    expect(
      escalationFor({
        ...base,
        underReviewAt: T0,
        askedAt: T0,
        warnedAt: days(14),
        suspendedAt: days(28),
        now: days(90),
      }),
    ).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/point-report-rules.test.ts
```
Ожидается: FAIL, `Failed to resolve import "@/lib/points/report-rules"`.

- [ ] **Шаг 3: написать реализацию**

Создать `src/lib/points/report-rules.ts`:

```ts
import { createHash } from "node:crypto";

/** Окно, в котором жалобы считаются относящимися к одному и тому же. */
export const REPORT_WINDOW_DAYS = 60;
/** Сколько независимых жалоб поднимают точку на проверку. */
export const ESCALATE_AT = 3;
/** Одна жалоба в сутки с адреса на одну точку. */
export const PER_IP_COOLDOWN_SECONDS = 86400;
/** Молчание предприятия до предупреждения и от предупреждения до снятия. */
export const OWNER_WAIT_SECONDS = 14 * 86400;

/**
 * Соль берётся из того же секрета, которым подписываются сеансы: отдельный ключ
 * пришлось бы заводить в .env на всех машинах, а дамп таблицы не должен давать
 * обратный перебор адресов (их всего четыре миллиарда).
 */
function salt(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "trientes";
}

export function reporterIpHash(ip: string): string {
  return createHash("sha256").update(`${salt()}|${ip}`).digest("hex").slice(0, 32);
}

export function tooSoon(lastAt: Date | null, now: Date): boolean {
  if (!lastAt) return false;
  return (now.getTime() - lastAt.getTime()) / 1000 < PER_IP_COOLDOWN_SECONDS;
}

export type ReportRow = {
  reporterUserId: string | null;
  reporterIpHash: string;
  createdAt: Date;
};

/**
 * Независимость считается по человеку, если он вошёл, и по адресу, если нет.
 * Иначе один человек с телефона и с ноутбука закрыл бы магазин вдвоём.
 */
export function independentReporters(rows: ReportRow[], now: Date): number {
  const edge = now.getTime() - REPORT_WINDOW_DAYS * 86400_000;
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.createdAt.getTime() < edge) continue;
    keys.add(r.reporterUserId ? `u:${r.reporterUserId}` : `i:${r.reporterIpHash}`);
  }
  return keys.size;
}

export type Escalation = "REVIEW" | "WARN" | "SUSPEND" | null;

export type EscalationInput = {
  independent: number;
  underReviewAt: Date | null;
  askedAt: Date | null;
  warnedAt: Date | null;
  suspendedAt: Date | null;
  /** Последний ответ предприятия в нитке дела. */
  ownerRepliedAt: Date | null;
  now: Date;
};

/**
 * Один шаг за прогон: сначала пометка и вопрос, потом предупреждение, потом
 * снятие. Ответ предприятия останавливает лестницу — дальше решает человек, а
 * не часы: разговор начался, и автоматическое снятие посреди него было бы
 * хамством.
 */
export function escalationFor(input: EscalationInput): Escalation {
  if (input.suspendedAt) return null;
  if (input.independent < ESCALATE_AT) return null;
  if (!input.underReviewAt) return "REVIEW";

  const asked = input.askedAt;
  if (!asked) return "REVIEW";
  if (input.ownerRepliedAt && input.ownerRepliedAt.getTime() > asked.getTime()) return null;

  const since = (from: Date) => (input.now.getTime() - from.getTime()) / 1000;
  if (!input.warnedAt) return since(asked) >= OWNER_WAIT_SECONDS ? "WARN" : null;
  return since(input.warnedAt) >= OWNER_WAIT_SECONDS ? "SUSPEND" : null;
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npx vitest run tests/point-report-rules.test.ts
```
Ожидается: `Test Files  1 passed`, 14 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add src/lib/points/report-rules.ts tests/point-report-rules.test.ts
git commit -m "feat(points): пороги и лестница эскалации жалоб"
```

---

### Задача 3: Строка перевода вне запроса (нужна воркеру)

**Файлы:**
- Создать: `src/lib/messages-raw.ts`
- Тест: `tests/messages-raw.test.ts`

Почему отдельный читатель: `getTranslations` из `next-intl/server` проходит через
`src/i18n.ts`, а тот вызывает `requestLocale`; вне запроса (в воркере) это падает.
Текст предупреждения предприятию пишется именно из воркера.

- [ ] **Шаг 1: написать падающий тест**

Создать `tests/messages-raw.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rawMessage } from "@/lib/messages-raw";

describe("rawMessage", () => {
  it("читает английскую строку по точечному пути", async () => {
    const text = await rawMessage("en", "common.cabinet");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("common.cabinet");
  });

  it("неизвестная локаль сводится к поддерживаемой", async () => {
    expect(await rawMessage("zz", "common.cabinet")).toBe(await rawMessage("en", "common.cabinet"));
  });

  it("подставляет переменные", async () => {
    const text = await rawMessage("en", "__test__", { name: "Alpha" }, "Point {name} is fine");
    expect(text).toBe("Point Alpha is fine");
  });

  it("неизвестный ключ отдаёт запасной текст, а не путь", async () => {
    expect(await rawMessage("en", "no.such.key", {}, "fallback")).toBe("fallback");
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/messages-raw.test.ts
```
Ожидается: FAIL, `Failed to resolve import "@/lib/messages-raw"`.

- [ ] **Шаг 3: написать реализацию**

Создать `src/lib/messages-raw.ts`:

```ts
import { pickLocale } from "@/lib/locales";

type Tree = { [k: string]: unknown };

const cache = new Map<string, Tree>();

async function load(locale: string): Promise<Tree> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const mod = (await import(`../../messages/${locale}.json`)) as { default: Tree };
  cache.set(locale, mod.default);
  return mod.default;
}

function lookup(tree: Tree, path: string): string | null {
  let node: unknown = tree;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Tree)[part];
  }
  return typeof node === "string" ? node : null;
}

function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m,
  );
}

/**
 * Строка перевода без контекста запроса. Нужна воркеру: `getTranslations`
 * ходит через `requestLocale` и вне запроса падает.
 *
 * Английский подмешивается как база — ровно как в `src/i18n.ts`: ключ, которого
 * нет в переводе, должен выйти читаемой фразой, а не точечным путём.
 */
export async function rawMessage(
  locale: string | null | undefined,
  path: string,
  vars: Record<string, string | number> = {},
  fallback?: string,
): Promise<string> {
  const l = pickLocale(locale);
  let text: string | null = null;
  try {
    text = lookup(await load(l), path);
    if (!text && l !== "en") text = lookup(await load("en"), path);
  } catch {
    text = null;
  }
  return interpolate(text ?? fallback ?? path, vars);
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npx vitest run tests/messages-raw.test.ts
```
Ожидается: `4 passed`.

- [ ] **Шаг 5: коммит**

```bash
git add src/lib/messages-raw.ts tests/messages-raw.test.ts
git commit -m "feat(i18n): чтение строки перевода вне контекста запроса"
```

---

### Задача 4: Приём жалобы

**Файлы:**
- Создать: `src/lib/points/reports.ts`
- Создать: `src/app/api/point-report/route.ts`
- Тест: `tests/point-report-input.test.ts`

- [ ] **Шаг 1: написать падающий тест на разбор входа**

Создать `tests/point-report-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeReportInput } from "@/lib/points/reports";

describe("normalizeReportInput", () => {
  it("принимает известную причину", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "CLOSED" })).toEqual({
      ok: true,
      pointId: "p1",
      reason: "CLOSED",
      comment: null,
    });
  });

  it("отвергает выдуманную причину", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "BANANA" })).toEqual({
      ok: false,
      reason: "bad_reason",
    });
  });

  it("отвергает пустой id точки", () => {
    expect(normalizeReportInput({ pointId: "  ", reason: "CLOSED" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("причина OTHER без текста не принимается — иначе жалоба ничего не говорит", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "OTHER", comment: "  " })).toEqual({
      ok: false,
      reason: "comment_required",
    });
  });

  it("слишком длинный текст отвергается", () => {
    const out = normalizeReportInput({ pointId: "p1", reason: "CLOSED", comment: "x".repeat(1001) });
    expect(out).toEqual({ ok: false, reason: "comment_too_long" });
  });

  it("лишние пробелы в тексте срезаются", () => {
    expect(normalizeReportInput({ pointId: "p1", reason: "CLOSED", comment: "  закрыто  " })).toEqual({
      ok: true,
      pointId: "p1",
      reason: "CLOSED",
      comment: "закрыто",
    });
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/point-report-input.test.ts
```
Ожидается: FAIL, `Failed to resolve import "@/lib/points/reports"`.

- [ ] **Шаг 3: написать реализацию приёма**

Создать `src/lib/points/reports.ts`:

```ts
import type { PointReportReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureCase } from "@/lib/cases/ensure";
import { appendCaseEvent } from "@/lib/cases/journal";
import { raiseAndNotify } from "@/lib/cases/admin-notify";
import { PER_IP_COOLDOWN_SECONDS, reporterIpHash, tooSoon } from "./report-rules";

export const COMMENT_MAX = 1000;

const REASONS: PointReportReason[] = ["CLOSED", "NO_CRYPTO", "WRONG_ADDRESS", "OTHER"];

export type NormalizedReport =
  | { ok: true; pointId: string; reason: PointReportReason; comment: string | null }
  | { ok: false; reason: "not_found" | "bad_reason" | "comment_required" | "comment_too_long" };

/** Разбор входа отделён от базы: правила видны тестом без сервера. */
export function normalizeReportInput(input: {
  pointId?: unknown;
  reason?: unknown;
  comment?: unknown;
}): NormalizedReport {
  const pointId = typeof input.pointId === "string" ? input.pointId.trim() : "";
  if (!pointId) return { ok: false, reason: "not_found" };

  const reason = REASONS.find((r) => r === input.reason);
  if (!reason) return { ok: false, reason: "bad_reason" };

  const raw = typeof input.comment === "string" ? input.comment.trim() : "";
  if (raw.length > COMMENT_MAX) return { ok: false, reason: "comment_too_long" };
  // «Другое» без слов — пустая строка в очереди: причины нет, текста нет.
  if (reason === "OTHER" && raw.length === 0) return { ok: false, reason: "comment_required" };

  return { ok: true, pointId, reason, comment: raw.length ? raw : null };
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: NormalizedReport extends { ok: false; reason: infer R } ? R : never | "too_soon" };

/**
 * Жалоба принимается только на нашу точку: у точки зеркала BTC Map нет ни
 * владельца, которому писать, ни способа её снять — ночной синк вернёт её.
 */
export async function submitPointReport(input: {
  pointId: unknown;
  reason: unknown;
  comment?: unknown;
  ip: string;
  userId?: string | null;
}): Promise<SubmitResult> {
  const parsed = normalizeReportInput(input);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const point = await prisma.companyPoint.findFirst({
    where: {
      id: parsed.pointId,
      status: "APPROVED",
      deletedAt: null,
      company: { status: "APPROVED", deletedAt: null },
    },
    include: { company: { select: { ownerUserId: true, displayName: true } } },
  });
  if (!point) return { ok: false, reason: "not_found" };

  const ipHash = reporterIpHash(input.ip);
  const last = await prisma.pointReport.findFirst({
    where: {
      pointId: point.id,
      reporterIpHash: ipHash,
      createdAt: { gte: new Date(Date.now() - PER_IP_COOLDOWN_SECONDS * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (tooSoon(last?.createdAt ?? null, new Date())) return { ok: false, reason: "too_soon" };

  await prisma.pointReport.create({
    data: {
      pointId: point.id,
      reporterUserId: input.userId ?? null,
      reporterIpHash: ipHash,
      reason: parsed.reason,
      comment: parsed.comment,
    },
  });

  // Дело на точку заводится при первой же жалобе: иначе вторая не нашла бы,
  // куда лечь. Сбой заведения дела жалобу не роняет (так же, как подачу заявки).
  const caseId = await ensureCase({
    subjectType: "POINT_REPORT",
    subjectId: point.id,
    title: `Reports: ${point.name}`,
    applicantUserId: point.company?.ownerUserId ?? null,
  });
  if (!caseId) return { ok: true };

  await appendCaseEvent({
    caseId,
    kind: "POINT_REPORTED",
    actorSide: "SYSTEM",
    payload: { reason: parsed.reason },
  });

  // Звоним один раз — на первой жалобе по делу. Каждая следующая звонила бы
  // по десять раз за вечер, а делать с одной жалобой всё равно нечего:
  // пороги считает ежедневный прогон.
  const total = await prisma.pointReport.count({ where: { pointId: point.id } });
  if (total === 1) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    for (const a of admins) {
      await raiseAndNotify({
        userId: a.id,
        kind: "POINT_REPORTED",
        caseId,
        title: `Reports: ${point.name}`,
      });
    }
  }
  return { ok: true };
}
```

Проверить сигнатуру `appendCaseEvent` в `src/lib/cases/journal.ts` и, если поле
называется иначе, привести вызовы к нему (там же видно, обязателен ли `actorSide`).

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npx vitest run tests/point-report-input.test.ts
```
Ожидается: `6 passed`.

- [ ] **Шаг 5: маршрут приёма**

Создать `src/app/api/point-report/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { submitPointReport } from "@/lib/points/reports";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_found: 404,
  bad_reason: 400,
  comment_required: 400,
  comment_too_long: 400,
  too_soon: 429,
};

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_reason" }, { status: 400 });
  }

  // Вошедший считается по учётной записи, а не по адресу (см. independentReporters).
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const res = await submitPointReport({
    pointId: body.pointId,
    reason: body.reason,
    comment: body.comment,
    ip: clientIp(req),
    userId,
  });
  if (res.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ error: res.reason }, { status: STATUS[res.reason] ?? 400 });
}
```

- [ ] **Шаг 6: проверить маршрут снаружи**

После `npm run build && pm2 restart trientes-web`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://trientes.org/api/point-report \
  -H 'content-type: application/json' -d '{"pointId":"nope","reason":"CLOSED"}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://trientes.org/api/point-report \
  -H 'content-type: application/json' -d '{"pointId":"nope","reason":"BANANA"}'
```
Ожидается: `404`, затем `400`.

- [ ] **Шаг 7: коммит**

```bash
git add src/lib/points/reports.ts src/app/api/point-report/route.ts tests/point-report-input.test.ts
git commit -m "feat(points): приём жалобы на точку и заведение дела"
```

---

### Задача 5: Жалоба видна в деле

**Файлы:**
- Изменить: `src/lib/cases/subject.ts:116-118` (ветка `POINT_REPORT`)
- Создать: `src/components/admin/case-reports.tsx`
- Изменить: `src/app/[locale]/admin/cases/[id]/page.tsx`

- [ ] **Шаг 1: анкета дела по жалобам**

В `src/lib/cases/subject.ts` заменить заглушку ветки `POINT_REPORT`:

```ts
    case "POINT_REPORT": {
      const p = await prisma.companyPoint.findUnique({
        where: { id: subjectId },
        include: { company: { select: { displayName: true, ownerUserId: true } } },
      });
      if (!p) return null;
      const reports = await prisma.pointReport.findMany({
        where: { pointId: p.id },
        select: { reason: true, reporterUserId: true, reporterIpHash: true, createdAt: true },
      });
      const now = new Date();
      const byReason = new Map<string, number>();
      for (const r of reports) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
      return {
        // Переписку по делу ведём с предприятием, а не с жалобщиком: с анонимом
        // диалога нет (так в спеке).
        title: p.name,
        applicantUserId: p.company?.ownerUserId ?? null,
        href: null,
        fields: [
          { label: "company", value: text(p.company?.displayName) },
          { label: "reports", value: String(reports.length) },
          { label: "independent", value: String(independentReporters(reports, now)) },
          {
            label: "reasons",
            value:
              [...byReason.entries()].map(([k, n]) => `${k}×${n}`).join(", ") || "—",
          },
          { label: "address", value: text(p.address) },
          { label: "underReview", value: p.underReviewAt ? p.underReviewAt.toISOString().slice(0, 10) : "—" },
          { label: "suspended", value: p.suspendedAt ? p.suspendedAt.toISOString().slice(0, 10) : "—" },
        ],
      };
    }
```

и добавить импорт в начало файла:

```ts
import { independentReporters } from "@/lib/points/report-rules";
```

- [ ] **Шаг 2: компонент списка жалоб**

Создать `src/components/admin/case-reports.tsx`:

```tsx
/**
 * Список жалоб в деле. Это чтение, а не действие: решение по жалобе принимается
 * в разделе «Решение» — две двери к одному решению означают, что правила нет.
 */
export type CaseReportItem = {
  id: string;
  reasonLabel: string;
  comment: string | null;
  who: string;
  createdAt: Date;
};

export function CaseReports({
  items,
  emptyLabel,
}: {
  items: CaseReportItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) return <p className="text-[12px] text-muted">{emptyLabel}</p>;
  return (
    <ul className="flex flex-col">
      {items.map((r) => (
        <li key={r.id} className="border-b border-hairline py-2.5 last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold">{r.reasonLabel}</span>
            <span className="num text-[10.5px] text-muted">
              {r.createdAt.toISOString().slice(0, 10)}
            </span>
          </div>
          <div className="text-[11px] text-muted">{r.who}</div>
          {r.comment && <p className="mt-1 text-[12px] leading-relaxed">{r.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Шаг 3: сквозная нумерация разделов на странице дела**

В `src/app/[locale]/admin/cases/[id]/page.tsx` перед `return (` добавить:

```ts
  // Номер раздела считается, а не вписан руками: раздел «Жалобы» появляется
  // только у дел по жалобам, и вписанные номера разъехались бы.
  let sectionNo = 0;
  const nextNo = () => String(++sectionNo);
```

и заменить каждое `n="1"`, `n="2"`, … на `n={nextNo()}` в порядке следования разделов.

- [ ] **Шаг 4: врезать раздел «Жалобы»**

Там же: после загрузки дела добавить чтение жалоб —

```ts
  const reports =
    c.subjectType === "POINT_REPORT"
      ? await prisma.pointReport.findMany({
          where: { pointId: c.subjectId },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: { reporter: { select: { name: true, username: true } } },
        })
      : [];
```

и в разметку, сразу после раздела «Заявитель»:

```tsx
        {c.subjectType === "POINT_REPORT" && (
          <CaseSection
            n={nextNo()}
            title={t("case.reports.title")}
            summary={t("case.reports.summary", { count: reports.length })}
            open
          >
            <CaseReports
              emptyLabel={t("case.reports.empty")}
              items={reports.map((r) => ({
                id: r.id,
                reasonLabel: t(`case.reports.reason.${r.reason}`),
                comment: r.comment,
                who: r.reporter?.name ?? r.reporter?.username ?? t("case.reports.anonymous"),
                createdAt: r.createdAt,
              }))}
            />
          </CaseSection>
        )}
```

плюс импорт `import { CaseReports } from "@/components/admin/case-reports";`.

- [ ] **Шаг 5: проверить сборку типов**

```bash
npx tsc --noEmit
```
Ожидается: без ошибок.

- [ ] **Шаг 6: коммит**

```bash
git add src/lib/cases/subject.ts src/components/admin/case-reports.tsx "src/app/[locale]/admin/cases/[id]/page.tsx"
git commit -m "feat(admin): раздел жалоб в деле и анкета дела по жалобам"
```

---

### Задача 6: Решение по жалобе применяется к точке

**Файлы:**
- Изменить: `src/lib/cases/decide.ts:70-74`
- Создать: `src/app/actions/point-supervision.ts`

- [ ] **Шаг 1: действия надзора над точкой**

Создать `src/app/actions/point-supervision.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";

export type SupervisionResult = { ok: true } | { ok: false; reason: string };

/** Снять точку с карты до выяснения. Статус APPROVED не трогаем: это надзор, а
 *  не отмена прошлого решения модератора. */
export async function suspendPoint(input: {
  pointId: string;
  reason: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  if (input.reason.trim().length < 3) return { ok: false, reason: "reason_required" };

  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };

  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { suspendedAt: new Date(), suspendReason: input.reason.trim().slice(0, 500) },
  });
  revalidatePath("/[locale]/admin/queues", "page");
  return { ok: true };
}

/** Вернуть точку на карту и снять пометку: жалоба не подтвердилась. */
export async function clearPointReview(input: { pointId: string }): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };

  const point = await prisma.companyPoint.findUnique({ where: { id: input.pointId } });
  if (!point) return { ok: false, reason: "not_found" };

  await prisma.companyPoint.update({
    where: { id: point.id },
    data: { underReviewAt: null, suspendedAt: null, suspendReason: null },
  });
  revalidatePath("/[locale]/admin/queues", "page");
  return { ok: true };
}
```

Сверить имя и форму `checkAdmin` с `src/lib/is-admin.ts` (в `case-messages.ts` он
возвращает `{ ok, userId, reason }`) и привести вызовы к ней.

- [ ] **Шаг 2: подключить решение к делу**

В `src/lib/cases/decide.ts` заменить ветку `POINT_REPORT`:

```ts
    case "POINT_REPORT":
      // «Одобрено» по делу жалобы значит «жалоба подтверждена»: точка уходит с
      // карты. «Отклонено» — жалоба не подтвердилась, точка возвращается.
      // Названия кнопок на экране свои (`admin.case.decision.pointReport.*`),
      // чтобы это не читалось как «одобрить точку».
      return normalize(
        approve
          ? await suspendPoint({ pointId: subjectId, reason })
          : await clearPointReview({ pointId: subjectId }),
      );
```

и импорт `import { clearPointReview, suspendPoint } from "@/app/actions/point-supervision";`.

- [ ] **Шаг 3: подписи кнопок решения для жалобы**

В `src/app/[locale]/admin/cases/[id]/page.tsx` там, где собирается `CaseDecision`,
подставить подписи по типу дела:

```ts
  const decisionLabels =
    c.subjectType === "POINT_REPORT"
      ? {
          approve: t("case.decision.pointReport.approve"),
          reject: t("case.decision.pointReport.reject"),
        }
      : { approve: t("case.decision.approve"), reject: t("case.decision.reject") };
```

и передать их в компонент вместо прежних литералов (посмотреть его текущие пропсы в
`src/components/admin/case-decision.tsx` и добавить необязательные `approveLabel` /
`rejectLabel`, если их там нет).

- [ ] **Шаг 4: проверить типы**

```bash
npx tsc --noEmit
```
Ожидается: без ошибок.

- [ ] **Шаг 5: коммит**

```bash
git add src/lib/cases/decide.ts src/app/actions/point-supervision.ts "src/app/[locale]/admin/cases/[id]/page.tsx" src/components/admin/case-decision.tsx
git commit -m "feat(cases): решение по жалобе снимает точку с карты или возвращает её"
```

---

### Задача 7: Навигатор — снятая точка не видна, проверяемая помечена

**Файлы:**
- Изменить: `src/lib/crypto-map.ts:134-161` (тип `Poi`)
- Изменить: `src/lib/company-points.ts:195-220` (запрос) и место сборки `Poi`
- Тест: `tests/poi-under-review.test.ts`

- [ ] **Шаг 1: написать падающий тест на сборку поля**

Создать `tests/poi-under-review.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pointUnderReview } from "@/lib/company-points";

describe("pointUnderReview", () => {
  it("точка без жалоб не помечена", () => {
    expect(pointUnderReview({ underReviewAt: null })).toBe(false);
  });
  it("точка с пометкой помечена", () => {
    expect(pointUnderReview({ underReviewAt: new Date() })).toBe(true);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/poi-under-review.test.ts
```
Ожидается: FAIL, `pointUnderReview is not a function`.

- [ ] **Шаг 3: поле в типе `Poi`**

В `src/lib/crypto-map.ts` в тип `Poi` добавить перед `slug?`:

```ts
  /** Жалоб набралось достаточно: точка на карте, но с пометкой «проверяется». */
  underReview?: boolean;
```

- [ ] **Шаг 4: запрос и сборка**

В `src/lib/company-points.ts` в `where` запроса `fetchApprovedPointsInBbox` добавить
`suspendedAt: null` (снятая точка с карты уходит) и экспортировать помощника:

```ts
/** Пометка «проверяется» — отдельное поле, а не статус: точка остаётся одобренной. */
export function pointUnderReview(p: { underReviewAt: Date | null }): boolean {
  return p.underReviewAt !== null;
}
```

В месте, где строится объект `Poi` (`id: \`company/${p.id}\``), добавить
`underReview: pointUnderReview(p),`.

- [ ] **Шаг 5: убедиться, что тест проходит**

```bash
npx vitest run tests/poi-under-review.test.ts
```
Ожидается: `2 passed`.

- [ ] **Шаг 6: коммит**

```bash
git add src/lib/crypto-map.ts src/lib/company-points.ts tests/poi-under-review.test.ts
git commit -m "feat(map): снятая точка уходит с карты, проверяемая помечается"
```

---

### Задача 8: Кнопка «Сообщить о проблеме» в карточке точки

**Файлы:**
- Создать: `src/components/coin-detail/poi-report-dialog.tsx`
- Изменить: `src/components/coin-detail/poi-pane-card.tsx`
- Тест: `tests/poi-report-eligible.test.ts`

- [ ] **Шаг 1: написать падающий тест на «кому можно жаловаться»**

Создать `tests/poi-report-eligible.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reportablePointId } from "@/lib/poi-tile";

describe("reportablePointId", () => {
  it("наша точка даёт id без приставки", () => {
    expect(reportablePointId("company/abc123")).toBe("abc123");
  });
  it("точка зеркала BTC Map жалобу не принимает", () => {
    expect(reportablePointId("node/12345")).toBeNull();
  });
  it("офис финтеха — не точка приёма, жалобы по нему не берём", () => {
    expect(reportablePointId("fintech/x1")).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/poi-report-eligible.test.ts
```
Ожидается: FAIL, `reportablePointId is not a function`.

- [ ] **Шаг 3: реализация помощника**

В `src/lib/poi-tile.ts` добавить:

```ts
/**
 * Жалоба принимается только на нашу точку. У точки зеркала BTC Map нет ни
 * владельца, которому писать, ни способа её снять: ночной синк вернёт её.
 */
export function reportablePointId(poiId: string): string | null {
  const m = /^company\/(.+)$/.exec(poiId);
  return m ? m[1] : null;
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npx vitest run tests/poi-report-eligible.test.ts
```
Ожидается: `3 passed`.

- [ ] **Шаг 5: форма жалобы**

Создать `src/components/coin-detail/poi-report-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";
import { ROW_BTN } from "@/components/coin-detail/poi-sheet-ui";

const REASONS = ["CLOSED", "NO_CRYPTO", "WRONG_ADDRESS", "OTHER"] as const;

/**
 * Лист жалобы поверх карточки. Фото не принимаем: загрузка файла от человека,
 * которого мы не знаем, — отдельная дыра (см. границы слайса AQ).
 */
export function PoiReportDialog({
  pointId,
  onClose,
  t,
}: {
  pointId: string;
  onClose: () => void;
  t: StepTranslator;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]>("CLOSED");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string>("failed");

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/point-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointId, reason, comment }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "failed");
      setState("error");
    } catch {
      setError("failed");
      setState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] bg-card p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <h3 className="mb-3 text-[15px] font-bold">{t("report.title")}</h3>

        {state === "sent" ? (
          <>
            <p className="mb-4 text-[13px] leading-relaxed text-muted">{t("report.sent")}</p>
            <button type="button" onClick={onClose} className={`${ROW_BTN} justify-center`}>
              {t("report.close")}
            </button>
          </>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`${ROW_BTN} ${reason === r ? "border-accent" : ""}`}
                >
                  {t(`report.reason.${r}`)}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={t("report.commentPlaceholder")}
              className="mb-3 w-full rounded-[12px] border border-hairline bg-bg-tint p-2.5 text-[13px]"
            />
            {state === "error" && (
              <p className="mb-2 text-[12px] text-down">{t(`report.errors.${error}`)}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={`${ROW_BTN} justify-center`}>
                {t("report.cancel")}
              </button>
              <button
                type="button"
                onClick={send}
                disabled={state === "sending"}
                className={`${ROW_BTN} justify-center border-accent`}
              >
                {state === "sending" ? t("report.sending") : t("report.submit")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Шаг 6: кнопка и плашка в карточке**

В `src/components/coin-detail/poi-pane-card.tsx`:

```tsx
import { PoiReportDialog } from "@/components/coin-detail/poi-report-dialog";
import { reportablePointId, TILE_PAD_CLASS, TILE_SHELL } from "@/lib/poi-tile";
```

внутри компонента рядом с `const [photoOpen, setPhotoOpen] = useState(false);`:

```tsx
  const [reportOpen, setReportOpen] = useState(false);
  const reportId = reportablePointId(poi.id);
```

в конце секции связи (после кнопки `onStreetView`):

```tsx
          {poi.underReview && (
            <p className="rounded-[12px] bg-bg-tint px-3 py-2 text-[12px] leading-snug text-muted">
              ⚠️ {t("report.underReview")}
            </p>
          )}

          {reportId && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className={`${ROW_BTN} text-muted`}
            >
              <span aria-hidden>🚩</span>
              {t("report.button")}
            </button>
          )}
```

и перед закрывающим тегом компонента:

```tsx
      {reportOpen && reportId && (
        <PoiReportDialog pointId={reportId} onClose={() => setReportOpen(false)} t={t} />
      )}
```

- [ ] **Шаг 7: проверить типы**

```bash
npx tsc --noEmit
```
Ожидается: без ошибок (ключей перевода ещё нет — это задача 10, но типы от них не зависят).

- [ ] **Шаг 8: коммит**

```bash
git add src/lib/poi-tile.ts src/components/coin-detail/poi-report-dialog.tsx src/components/coin-detail/poi-pane-card.tsx tests/poi-report-eligible.test.ts
git commit -m "feat(map): кнопка «сообщить о проблеме» и плашка «проверяется»"
```

---

### Задача 9: Ежедневный прогон эскалации

**Файлы:**
- Создать: `src/lib/points/report-sweep.ts`
- Создать: `scripts/point-report-sweep.ts`
- Изменить: `worker/index.ts`
- Тест: `tests/point-report-sweep.test.ts`

- [ ] **Шаг 1: написать падающий тест на шаг прогона**

Создать `tests/point-report-sweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planEscalation } from "@/lib/points/report-sweep";

const T0 = new Date("2026-11-18T10:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 86400_000);

const caseRow = {
  id: "c1",
  subjectId: "p1",
  applicantUserId: "owner1",
  pointName: "Shop",
  underReviewAt: null as Date | null,
  suspendedAt: null as Date | null,
  reports: [
    { reporterUserId: null, reporterIpHash: "a", createdAt: T0 },
    { reporterUserId: null, reporterIpHash: "b", createdAt: T0 },
    { reporterUserId: null, reporterIpHash: "c", createdAt: T0 },
  ],
  askedAt: null as Date | null,
  warnedAt: null as Date | null,
  ownerRepliedAt: null as Date | null,
};

describe("planEscalation", () => {
  it("три жалобы — пометка и вопрос", () => {
    expect(planEscalation(caseRow, T0)).toBe("REVIEW");
  });

  it("одна жалоба — ничего", () => {
    expect(planEscalation({ ...caseRow, reports: caseRow.reports.slice(0, 1) }, T0)).toBeNull();
  });

  it("две недели молчания после вопроса — предупреждение", () => {
    expect(
      planEscalation({ ...caseRow, underReviewAt: T0, askedAt: T0 }, days(15)),
    ).toBe("WARN");
  });

  it("ещё две недели — снятие", () => {
    expect(
      planEscalation(
        { ...caseRow, underReviewAt: T0, askedAt: T0, warnedAt: days(14) },
        days(29),
      ),
    ).toBe("SUSPEND");
  });

  it("предприятие ответило — лестница встала", () => {
    expect(
      planEscalation(
        { ...caseRow, underReviewAt: T0, askedAt: T0, ownerRepliedAt: days(2) },
        days(60),
      ),
    ).toBeNull();
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

```bash
npx vitest run tests/point-report-sweep.test.ts
```
Ожидается: FAIL, `Failed to resolve import "@/lib/points/report-sweep"`.

- [ ] **Шаг 3: написать прогон**

Создать `src/lib/points/report-sweep.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { appendCaseEvent } from "@/lib/cases/journal";
import { notifyApplicantOfMessage } from "@/lib/cases/notify-applicant";
import { pausePatch } from "@/lib/cases/sla";
import { rawMessage } from "@/lib/messages-raw";
import { escalationFor, independentReporters, type Escalation } from "./report-rules";

export type SweepStats = { checked: number; reviewed: number; warned: number; suspended: number };

export type SweepCase = {
  id: string;
  subjectId: string;
  applicantUserId: string | null;
  pointName: string;
  underReviewAt: Date | null;
  suspendedAt: Date | null;
  reports: { reporterUserId: string | null; reporterIpHash: string; createdAt: Date }[];
  askedAt: Date | null;
  warnedAt: Date | null;
  ownerRepliedAt: Date | null;
};

/** Чистая часть: что делать с этим делом прямо сейчас. */
export function planEscalation(row: SweepCase, now: Date): Escalation {
  return escalationFor({
    independent: independentReporters(row.reports, now),
    underReviewAt: row.underReviewAt,
    askedAt: row.askedAt,
    warnedAt: row.warnedAt,
    suspendedAt: row.suspendedAt,
    ownerRepliedAt: row.ownerRepliedAt,
    now,
  });
}

/**
 * Сообщение предприятию пишет система, а не сотрудник: `authorId` пуст, сторона
 * STAFF. Текст — на языке кабинета владельца (тот же довод, что у письма сброса
 * пароля), и читается он не через `getTranslations`: прогон живёт в воркере, где
 * контекста запроса нет.
 */
async function writeToOwner(input: {
  caseId: string;
  applicantUserId: string | null;
  caseTitle: string;
  path: string;
  vars: Record<string, string | number>;
  fallback: string;
}): Promise<void> {
  const user = input.applicantUserId
    ? await prisma.user.findUnique({
        where: { id: input.applicantUserId },
        select: { preferredLocale: true },
      })
    : null;
  const body = await rawMessage(user?.preferredLocale, input.path, input.vars, input.fallback);

  await prisma.caseMessage.create({
    data: { caseId: input.caseId, authorId: null, side: "STAFF", body },
  });
  // Вопрос требует ответа — часы срока встают, как и у письма сотрудника.
  await prisma.complianceCase.update({
    where: { id: input.caseId },
    data: { status: "WAITING_APPLICANT", ...pausePatch(new Date()) },
  });
  if (input.applicantUserId) {
    await notifyApplicantOfMessage({
      applicantUserId: input.applicantUserId,
      caseId: input.caseId,
      caseTitle: input.caseTitle,
      preview: body.slice(0, 300),
    }).catch(() => {});
  }
}

export async function runPointReportSweep(now: Date = new Date()): Promise<SweepStats> {
  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: "POINT_REPORT", status: { notIn: ["APPROVED", "REJECTED", "CLOSED"] } },
    select: { id: true, subjectId: true, applicantUserId: true, title: true },
    take: 200,
  });

  const stats: SweepStats = { checked: cases.length, reviewed: 0, warned: 0, suspended: 0 };

  for (const c of cases) {
    const point = await prisma.companyPoint.findUnique({
      where: { id: c.subjectId },
      select: { id: true, name: true, underReviewAt: true, suspendedAt: true },
    });
    if (!point) continue;

    const reports = await prisma.pointReport.findMany({
      where: { pointId: point.id },
      select: { reporterUserId: true, reporterIpHash: true, createdAt: true },
    });

    // Состояние лестницы читается из журнала: он неизменяем и уже есть, а новые
    // колонки под каждый шаг пришлось бы держать в согласии с ним руками.
    const events = await prisma.caseEvent.findMany({
      where: { caseId: c.id, kind: { in: ["POINT_ASKED", "POINT_WARNED"] } },
      select: { kind: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const askedAt = events.find((e) => e.kind === "POINT_ASKED")?.createdAt ?? null;
    const warnedAt = events.find((e) => e.kind === "POINT_WARNED")?.createdAt ?? null;

    const reply = await prisma.caseMessage.findFirst({
      where: { caseId: c.id, side: "APPLICANT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const row: SweepCase = {
      id: c.id,
      subjectId: point.id,
      applicantUserId: c.applicantUserId,
      pointName: point.name,
      underReviewAt: point.underReviewAt,
      suspendedAt: point.suspendedAt,
      reports,
      askedAt,
      warnedAt,
      ownerRepliedAt: reply?.createdAt ?? null,
    };

    const step = planEscalation(row, now);
    if (!step) continue;

    if (step === "REVIEW") {
      await prisma.companyPoint.update({
        where: { id: point.id },
        data: { underReviewAt: now },
      });
      await writeToOwner({
        caseId: c.id,
        applicantUserId: c.applicantUserId,
        caseTitle: c.title,
        path: "notify.pointReport.asked",
        vars: { point: point.name },
        fallback:
          "We have received several reports about your location \"{point}\". Please confirm it is open and still accepts crypto, or update its details.",
      });
      await appendCaseEvent({ caseId: c.id, kind: "POINT_ASKED", actorSide: "SYSTEM" });
      stats.reviewed += 1;
      continue;
    }

    if (step === "WARN") {
      await writeToOwner({
        caseId: c.id,
        applicantUserId: c.applicantUserId,
        caseTitle: c.title,
        path: "notify.pointReport.warned",
        vars: { point: point.name },
        fallback:
          "We have had no answer about \"{point}\" for 14 days. Without a reply within another 14 days the location will be taken off the map until the matter is clarified.",
      });
      await appendCaseEvent({ caseId: c.id, kind: "POINT_WARNED", actorSide: "SYSTEM" });
      stats.warned += 1;
      continue;
    }

    await prisma.companyPoint.update({
      where: { id: point.id },
      data: { suspendedAt: now, suspendReason: "point_reports_unanswered" },
    });
    await writeToOwner({
      caseId: c.id,
      applicantUserId: c.applicantUserId,
      caseTitle: c.title,
      path: "notify.pointReport.suspended",
      vars: { point: point.name },
      fallback:
        "\"{point}\" has been taken off the map because the reports about it went unanswered. Reply here and we will restore it.",
    });
    await appendCaseEvent({ caseId: c.id, kind: "POINT_SUSPENDED", actorSide: "SYSTEM" });
    stats.suspended += 1;
  }

  return stats;
}
```

- [ ] **Шаг 4: убедиться, что тест проходит**

```bash
npx vitest run tests/point-report-sweep.test.ts
```
Ожидается: `5 passed`.

- [ ] **Шаг 5: запуск руками**

Создать `scripts/point-report-sweep.ts`:

```ts
import { runPointReportSweep } from "@/lib/points/report-sweep";
import { prisma } from "@/lib/prisma";

async function main() {
  const stats = await runPointReportSweep();
  console.log(JSON.stringify(stats));
  await prisma.$disconnect();
}

void main();
```

Проверить, как другие скрипты в `scripts/` разрешают алиас `@/` (если они импортируют
по относительным путям — сделать так же).

```bash
npx tsx scripts/point-report-sweep.ts
```
Ожидается: `{"checked":0,"reviewed":0,"warned":0,"suspended":0}` (дел по жалобам ещё нет).

- [ ] **Шаг 6: включить в воркер**

В `worker/index.ts` рядом с остальными прогонами дел:

```ts
import { runPointReportSweep } from "../src/lib/points/report-sweep";

async function runPointReportJob() {
  try {
    const stats = await runPointReportSweep();
    console.log(`[point-reports] ${JSON.stringify(stats)}`);
  } catch (err) {
    console.error("[point-reports] sweep failed", err);
  }
}
```

и регистрация после строки `cron.schedule("10 * * * *", () => void runCaseDueJob());`:

```ts
  // Раз в сутки: лестница считается днями, и часовой прогон ничего не ускорит.
  cron.schedule("20 5 * * *", () => void runPointReportJob());
```

Сверить, как соседние задания импортируются (относительный путь или алиас), и повторить.

- [ ] **Шаг 7: коммит**

```bash
git add src/lib/points/report-sweep.ts scripts/point-report-sweep.ts worker/index.ts tests/point-report-sweep.test.ts
git commit -m "feat(points): ежедневная лестница эскалации жалоб"
```

---

### Задача 10: Переводы, прогон тестов, выкатка

**Файлы:**
- Изменить: `messages/en.json`

- [ ] **Шаг 1: ключи навигатора**

В `messages/en.json` в namespace `cryptoMap` добавить:

```json
"report": {
  "button": "Report a problem",
  "title": "Report a problem",
  "underReview": "Several visitors have reported a problem here. We are checking with the business.",
  "reason": {
    "CLOSED": "Permanently closed",
    "NO_CRYPTO": "Does not accept crypto",
    "WRONG_ADDRESS": "Wrong address or location",
    "OTHER": "Something else"
  },
  "commentPlaceholder": "What is wrong? (required for \"Something else\")",
  "submit": "Send report",
  "sending": "Sending…",
  "cancel": "Cancel",
  "close": "Close",
  "sent": "Thank you. We will check with the business. One report alone never takes a place off the map.",
  "errors": {
    "too_soon": "You have already reported this place today.",
    "comment_required": "Please tell us what is wrong.",
    "comment_too_long": "Please keep it under 1000 characters.",
    "bad_reason": "Please pick a reason.",
    "not_found": "This place is no longer on the map.",
    "failed": "Could not send. Please try again."
  }
}
```

- [ ] **Шаг 2: ключи дела**

В namespace `admin.case` добавить:

```json
"reports": {
  "title": "Reports",
  "summary": "{count} received",
  "empty": "No reports.",
  "anonymous": "Anonymous visitor",
  "reason": {
    "CLOSED": "Permanently closed",
    "NO_CRYPTO": "Does not accept crypto",
    "WRONG_ADDRESS": "Wrong address or location",
    "OTHER": "Something else"
  }
}
```

и в `admin.case.decision`:

```json
"pointReport": {
  "approve": "Confirm reports — take the place off the map",
  "reject": "Dismiss reports — keep the place on the map"
}
```

- [ ] **Шаг 3: ключи писем предприятию и звонка сотруднику**

В namespace `notify` добавить:

```json
"pointReport": {
  "asked": "We have received several reports about your location \"{point}\". Please confirm it is open and still accepts crypto, or update its details.",
  "warned": "We have had no answer about \"{point}\" for 14 days. Without a reply within another 14 days the location will be taken off the map until the matter is clarified.",
  "suspended": "\"{point}\" has been taken off the map because the reports about it went unanswered. Reply here and we will restore it."
}
```

и подпись звонка в `admin.notifications.kind` (посмотреть, как называются соседние
ключи для `APPLICANT_REPLIED` и повторить форму):

```json
"POINT_REPORTED": "A visitor reported a map point"
```

Плюс строка в `src/lib/cases/admin-notify.ts` в `TELEGRAM_LINE`:

```ts
  POINT_REPORTED: "🚩 New report on a map point",
```

- [ ] **Шаг 4: перевести на остальные языки**

```bash
npm run i18n
```
Ожидается: по строке на локаль, прогон идемпотентный.

- [ ] **Шаг 5: весь прогон тестов**

```bash
npx vitest run
```
Ожидается: все файлы passed, включая `tests/messages-parity.test.ts`.

- [ ] **Шаг 6: сборка и выкатка**

```bash
npm run build && pm2 restart trientes-web && pm2 restart trientes-worker && pm2 save
```
Ожидается: сборка без ошибок, оба процесса `online`.

Воркер перезапускается обязательно: `src/lib/points/report-sweep.ts` и
`src/lib/messages-raw.ts` импортируются им, а он пинит исходники `src/lib` при старте.

- [ ] **Шаг 7: живая проверка**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://trientes.org/api/point-report \
  -H 'content-type: application/json' -d '{"pointId":"nope","reason":"CLOSED"}'
npx tsx scripts/point-report-sweep.ts
```
Ожидается: `404`; затем `{"checked":0,…}` либо реальные числа, если жалобы уже есть.

- [ ] **Шаг 8: коммит и пуш**

```bash
git add messages src/lib/cases/admin-notify.ts
git commit -m "feat(i18n): ключи жалоб на точки"
git push origin main
```

- [ ] **Шаг 9: записать слайс в CLAUDE.md**

Добавить раздел «Слайс AQ — жалобы на точки» по образцу разделов AO и AP: живые
адреса, данные и миграция, три границы слайса из шапки этого плана, устройство
лестницы (пороги, откуда читается состояние), что показал живой прогон.

```bash
git add CLAUDE.md && git commit -m "docs: слайс AQ в CLAUDE.md" && git push origin main
```

---

## Самопроверка плана

**Покрытие спеки (раздел «Жалобы на точки»):**

| Требование спеки | Задача |
| --- | --- |
| Кнопка «Сообщить о проблеме» с четырьмя причинами и текстом | 8 |
| Фото по желанию | **сознательно не делаем** — колонка есть (задача 1), форма нет (границы слайса) |
| Не чаще одной жалобы в сутки с адреса на точку (`reporterIpHash`) | 2 (`tooSoon`), 4 (запрос) |
| Все жалобы на точку — в одно дело `POINT_REPORT` | 4 (`ensureCase`, `@@unique`) |
| Три независимые жалобы за 60 дней → пометка «проверяется» | 2 (`ESCALATE_AT`), 7 (пометка в фиде), 9 (постановка) |
| Дело поднимается в приоритете | **не делаем отдельно** — очередь `pointReports` уже сортируется по сроку, а SLA у `POINT_REPORT` 3 рабочих дня (`SLA_BUSINESS_DAYS`), то есть короче обычных пяти |
| Предприятию уходит вопрос через ту же переписку | 9 (`writeToOwner`) |
| Нет ответа 14 дней → предупреждение | 2, 9 |
| Ещё 14 дней молчания → точка снимается с карты с записью причины | 2, 7, 9 |
| Звонок «пришла жалоба на точку» | 1 (вид звонка), 4 (первая жалоба), 10 (подписи) |
| С анонимом переписки нет | 5 (`applicantUserId` — владелец предприятия) |

**Заглушки:** в плане нет «TBD» и «сделать по аналогии»; весь код приведён целиком.

**Согласованность имён:** `reporterIpHash`, `independentReporters`, `escalationFor`,
`planEscalation`, `runPointReportSweep`, `reportablePointId`, `pointUnderReview`,
`submitPointReport`, `normalizeReportInput`, `suspendPoint`, `clearPointReview`,
`rawMessage` — каждое определяется в своей задаче и дальше используется в этом же
написании. Виды события `POINT_REPORTED` / `POINT_ASKED` / `POINT_WARNED` /
`POINT_SUSPENDED` заводятся задачей 1 и пишутся задачами 4 и 9.
