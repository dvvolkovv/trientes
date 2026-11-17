# Слайс AO — переписка по делу и колокольчики: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У дела появляется одна нитка переписки с заявителем (с вложениями, заготовками и
остановкой часов срока), у заявителя — раздел «Переписка по заявке» в кабинете, у сотрудника —
колокольчик в шапке админки и значки непрочитанного на плитках очередей.

**Architecture:** Переписка — ещё один слой поверх `ComplianceCase`, как журнал и сеансы времени:
две новые таблицы (`CaseMessage`, `AdminNotification`), чистая логика в `src/lib/cases/*`,
серверные действия в `src/app/actions/case-messages.ts`, один общий компонент нитки на обе
стороны. Статус объекта (`CoinCard.status`, `Company.status`…) не трогаем — сообщение двигает
только дело. Вложения, в отличие от логотипов и фото точек, лежат в **приватном** корне и
отдаются маршрутом с проверкой прав: в переписке комплайнса ходят те же документы, что в KYB.

**Tech Stack:** Next.js (App Router, RSC + server actions), Prisma/PostgreSQL, next-intl,
vitest, node-cron (воркер), nodemailer + Telegram через `notifyUser`.

---

## Решения, принятые до написания кода

Они объясняют, почему шаги ниже выглядят именно так. Менять их по ходу — только сознательно.

1. **Вложения приватны.** Спека говорит «те же корни загрузок, что у логотипов и фото точек».
   Берём строже: в переписке по делу ходят выписки, уставы, паспорта — ровно то, что та же
   спека велит держать вне публичных корней («KYB-документы по-прежнему вне публичных корней
   загрузок»). Публичный `/uploads/...` отдаётся nginx без всякой проверки: пересланная ссылка
   навсегда открыта любому. Поэтому файлы пишем в `CASE_ATTACHMENTS_ROOT`
   (`/var/www/trientes-private/cases`), наружу отдаёт `GET /api/case-attachment/[caseId]/[name]`
   после проверки, что спрашивает админ или заявитель этого дела.
2. **Непрочитанное считается по стороне, а не по человеку** (так в спеке). У сообщения два
   штампа: `readByStaffAt`, `readByApplicantAt`. Значит, любой админ, открывший дело, гасит
   «непрочитано» для всей смены. Это честная модель общего стола заявок; личного «непрочитано»
   у сотрудника нет — личное живёт в `AdminNotification`.
3. **Сообщение сотрудника останавливает часы — но не всякое.** У формы есть флажок «нужен
   ответ» (включён по умолчанию): с ним дело уходит в `WAITING_APPLICANT` и часы встают, без
   него статус и часы не трогаются. Без флажка любезная приписка «спасибо, смотрим» навсегда
   заморозила бы срок и дело выпало бы из поля зрения.
4. **Молчание заявителя не бесконечно.** Часы стоят — значит, просрочки не будет никогда.
   Поэтому прогон срока звонит и про молчание: `WAITING_APPLICANT` дольше 14 дней → колокольчик
   `APPLICANT_SILENT` взявшему дело. Четырнадцать дней — то же число, которым спека меряет
   молчание в слайсе AQ.
5. **Заготовки — на языке заявителя, а не сотрудника.** Текст идёт человеку, и прецедент уже
   есть (письмо сброса пароля — на языке кабинета). Сотрудник видит заготовку сразу в той
   локали, в которой её прочитает заявитель.
6. **Заявителю статус пишем другими словами.** `WAITING_APPLICANT` для сотрудника —
   «ждём заявителя», для заявителя — «ждём ваш ответ». Поэтому у кабинета свои ключи
   `cabinet.cases.status.*`, а не переиспользование `admin.case.status.*`.
7. **Колокольчик сотрудника не дублируется на каждое сообщение.** Непрочитанное уведомление с
   тем же `(userId, kind, caseId)` не плодится, а обновляется: пять ответов заявителя — один
   звонок, пока его не прочли.
8. **Дело без взявшего личных колокольчиков не рассылает.** Иначе каждый ответ заявителя
   звонил бы всем админам. Неразобранное видно значком на плитке очереди — этого достаточно.
9. **Текст уведомления сотруднику — по-английски,** как во всех существующих вызовах
   `notifyUser` в проекте. Локализация служебных уведомлений — отдельный вопрос, не этого слайса.
10. **Переписка по закрытому делу не открывает его заново.** На `APPROVED`/`REJECTED`/`CLOSED`
    сообщение пишется, статус и часы не меняются.

## Файлы

**Создаём:**
- `prisma/migrations/20261117190000_case_messaging/migration.sql` — таблицы и перечисления.
- `src/lib/cases/messages.ts` — чистое: нормализация текста, счёт непрочитанного, переход статуса.
- `src/lib/cases/attachments.ts` — чистое: разбор колонки `attachments`, белый список типов, безопасное имя файла.
- `src/lib/cases/notifications.ts` — чистое: нужен ли звонок (срок/просрочка/молчание).
- `src/lib/cases/admin-notify.ts` — запись `AdminNotification` (схлопывание непрочитанного) + дубль в Telegram. Зовётся и из действий, и из воркера.
- `src/lib/cases/notify-applicant.ts` — письмо/Telegram заявителю на языке его кабинета.
- `src/lib/cases/due-sweep.ts` — прогон сроков: звонки за сутки до срока, по просрочке и по молчанию.
- `src/app/actions/case-messages.ts` — отправка сотрудником, отправка заявителем, отметка о прочтении, гашение колокольчиков.
- `src/app/api/case-attachment/upload/route.ts` — загрузка вложения (обе стороны).
- `src/app/api/case-attachment/[caseId]/[name]/route.ts` — отдача вложения по праву.
- `src/components/cases/case-thread.tsx` — нитка (общая для админки и кабинета).
- `src/components/cases/case-composer.tsx` — форма отправки (клиентская).
- `src/components/cases/case-read-marker.tsx` — отметка «прочитано» на монтировании.
- `src/components/admin/admin-bell.tsx` — колокольчик в шапке админки.
- `src/components/admin/notifications-read-marker.tsx` — гашение колокольчиков при открытии списка.
- `src/components/cabinet/cases-section.tsx` — «Переписка по заявке» в кабинете.
- `src/app/[locale]/admin/notifications/page.tsx` — список уведомлений сотрудника.
- `src/app/[locale]/cabinet/cases/[id]/page.tsx` — нитка на стороне заявителя.
- `tests/case-messages.test.ts`, `tests/case-attachments.test.ts`, `tests/case-notifications.test.ts`.

**Правим:**
- `prisma/schema.prisma` — модели `CaseMessage`, `AdminNotification`, перечисления, `firstResponseAt`, связи.
- `src/lib/locales.ts` — общий `pickLocale` (сейчас копия живёт внутри маршрута сброса пароля).
- `src/app/api/auth/password/forgot/route.ts` — использовать общий `pickLocale` вместо своей копии.
- `src/lib/cases/queues.ts` — у плитки появляется число непрочитанного.
- `src/components/admin/queue-tile.tsx`, `src/components/admin/case-row.tsx` — значок непрочитанного.
- `src/app/[locale]/admin/queues/page.tsx`, `src/app/[locale]/admin/queues/[queue]/page.tsx` — считать непрочитанное.
- `src/app/[locale]/admin/cases/[id]/page.tsx` — раздел 4 «Переписка».
- `src/components/admin/nav.tsx` — колокольчик.
- `src/lib/cases/journal.ts` — два новых вида события.
- `src/app/[locale]/cabinet/page.tsx`, `src/app/[locale]/business/page.tsx` — раздел переписки.
- `messages/en.json` — новые ключи (остальные локали — `npm run i18n`).
- `worker/index.ts` — прогон сроков.
- `tests/case-queues.test.ts` — непрочитанное в плитках.
- `.env`, `CLAUDE.md`.

---

### Task 1: Схема и миграция

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261117190000_case_messaging/migration.sql`

- [ ] **Step 1: Добавить перечисления в схему**

В `prisma/schema.prisma` сразу после `enum CaseTimeSource { ... }` (строка ~1249):

```prisma
/// У сообщения ровно две стороны. Третье значение (SYSTEM из CaseActorSide)
/// нечем было бы нарисовать в нитке, поэтому перечисление своё.
enum CaseMessageSide {
  STAFF
  APPLICANT
}

enum AdminNotificationKind {
  APPLICANT_REPLIED
  DUE_SOON
  CASE_OVERDUE
  APPLICANT_SILENT
}
```

- [ ] **Step 2: Добавить два вида события в журнал**

В `enum CaseEventKind` (строка ~1234) после `NOTE`:

```prisma
  MESSAGE_SENT
  MESSAGE_RECEIVED
```

- [ ] **Step 3: Добавить поля и связи в `ComplianceCase`**

В модель `ComplianceCase` после `decidedAt DateTime?`:

```prisma
  /// Когда сотрудник впервые написал заявителю. Считается один раз и только
  /// вперёд: это показатель отзывчивости, его нельзя пересчитать потом.
  firstResponseAt DateTime?
```

и в блок связей после `timeEntries CaseTimeEntry[]`:

```prisma
  messages      CaseMessage[]
  notifications AdminNotification[]
```

- [ ] **Step 4: Добавить модели**

После модели `CaseTimeEntry`:

```prisma
/// Одна нитка на дело: слева заявитель, справа мы.
model CaseMessage {
  id       String          @id @default(cuid())
  caseId   String
  case     ComplianceCase  @relation(fields: [caseId], references: [id], onDelete: Cascade)
  authorId String?
  author   User?           @relation(fields: [authorId], references: [id], onDelete: SetNull)
  side     CaseMessageSide
  body     String
  /// [{ name, filename, size, mime }] — разбирается через parseAttachments.
  attachments Json?

  /// Непрочитанное считается по стороне, а не по человеку: общий стол заявок.
  readByStaffAt     DateTime?
  readByApplicantAt DateTime?

  createdAt DateTime @default(now())

  @@index([caseId, createdAt])
  @@index([side, readByStaffAt])
}

/// Личный колокольчик сотрудника. Непрочитанное с тем же (userId, kind, caseId)
/// не плодится, а обновляется — иначе пять ответов дают пять звонков.
model AdminNotification {
  id     String                @id @default(cuid())
  userId String
  user   User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind   AdminNotificationKind
  caseId String?
  case   ComplianceCase?       @relation(fields: [caseId], references: [id], onDelete: Cascade)

  /// Снимок названия дела: список должен читаться, даже если дело удалили.
  title  String
  body   String?
  readAt DateTime?

  createdAt DateTime @default(now())

  @@index([userId, readAt])
  @@index([userId, createdAt])
  @@index([kind, caseId])
}
```

- [ ] **Step 5: Добавить обратные связи в `User`**

Найти модель `User` и в её блок связей (рядом с `caseEvents`/`complianceCasesAssigned`,
как они там названы) добавить:

```prisma
  caseMessages       CaseMessage[]
  adminNotifications AdminNotification[]
```

- [ ] **Step 6: Проверить схему**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 7: Написать миграцию руками**

Этот чекаут — прод, поэтому `prisma migrate dev` не зовём: он умеет предлагать сброс базы.
Изменения только добавляющие, значит безопасный путь — свой SQL плюс `migrate deploy`.

```bash
mkdir -p prisma/migrations/20261117190000_case_messaging
cat > prisma/migrations/20261117190000_case_messaging/migration.sql <<'SQL'
-- Слайс AO — переписка по делу и колокольчики.

CREATE TYPE "CaseMessageSide" AS ENUM ('STAFF', 'APPLICANT');
CREATE TYPE "AdminNotificationKind" AS ENUM ('APPLICANT_REPLIED', 'DUE_SOON', 'CASE_OVERDUE', 'APPLICANT_SILENT');

-- Новые значения в существующем перечислении. Внутри транзакции их добавить
-- можно (PostgreSQL 12+), использовать в той же транзакции — нельзя; мы и не используем.
ALTER TYPE "CaseEventKind" ADD VALUE 'MESSAGE_SENT';
ALTER TYPE "CaseEventKind" ADD VALUE 'MESSAGE_RECEIVED';

ALTER TABLE "ComplianceCase" ADD COLUMN "firstResponseAt" TIMESTAMP(3);

CREATE TABLE "CaseMessage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT,
    "side" "CaseMessageSide" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "readByStaffAt" TIMESTAMP(3),
    "readByApplicantAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseMessage_caseId_createdAt_idx" ON "CaseMessage"("caseId", "createdAt");
CREATE INDEX "CaseMessage_side_readByStaffAt_idx" ON "CaseMessage"("side", "readByStaffAt");

ALTER TABLE "CaseMessage" ADD CONSTRAINT "CaseMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaseMessage" ADD CONSTRAINT "CaseMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AdminNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AdminNotificationKind" NOT NULL,
    "caseId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminNotification_userId_readAt_idx" ON "AdminNotification"("userId", "readAt");
CREATE INDEX "AdminNotification_userId_createdAt_idx" ON "AdminNotification"("userId", "createdAt");
CREATE INDEX "AdminNotification_kind_caseId_idx" ON "AdminNotification"("kind", "caseId");

ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminNotification" ADD CONSTRAINT "AdminNotification_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ComplianceCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
SQL
```

- [ ] **Step 8: Применить миграцию и сгенерировать клиент**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration found` / `Applying migration 20261117190000_case_messaging` / `✔ Generated Prisma Client`

- [ ] **Step 9: Проверить, что таблицы на месте**

Run: `npx tsx -e "import {prisma} from './src/lib/prisma'; prisma.caseMessage.count().then(n=>console.log('messages',n)).then(()=>prisma.adminNotification.count()).then(n=>console.log('notifications',n)).then(()=>process.exit(0))"`
Expected: `messages 0` и `notifications 0`

- [ ] **Step 10: Коммит**

```bash
git add prisma/schema.prisma prisma/migrations/20261117190000_case_messaging
git commit -m "feat(cases): таблицы переписки и колокольчиков"
```

---

### Task 2: Чистая логика сообщения

**Files:**
- Create: `src/lib/cases/messages.ts`
- Test: `tests/case-messages.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/case-messages.test.ts
import { describe, expect, it } from "vitest";
import {
  MESSAGE_MAX,
  normalizeBody,
  statusAfterApplicantMessage,
  statusAfterStaffMessage,
  unreadCount,
  TEMPLATE_KEYS,
} from "@/lib/cases/messages";

describe("normalizeBody", () => {
  it("срезает пробелы и приводит переводы строк", () => {
    const r = normalizeBody("  привет\r\nмир  ", false);
    expect(r).toEqual({ ok: true, body: "привет\nмир" });
  });

  it("пустой текст без вложения не сообщение", () => {
    expect(normalizeBody("   ", false)).toEqual({ ok: false, reason: "empty" });
  });

  it("пустой текст с вложением разрешён — файл и есть сообщение", () => {
    expect(normalizeBody("", true)).toEqual({ ok: true, body: "" });
  });

  it("слишком длинный текст отвергается, а не обрезается молча", () => {
    expect(normalizeBody("a".repeat(MESSAGE_MAX + 1), false)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("unreadCount", () => {
  const msgs = [
    { side: "APPLICANT" as const, readByStaffAt: null, readByApplicantAt: new Date() },
    { side: "APPLICANT" as const, readByStaffAt: new Date(), readByApplicantAt: new Date() },
    { side: "STAFF" as const, readByStaffAt: new Date(), readByApplicantAt: null },
  ];

  it("сотруднику непрочитано то, что написал заявитель", () => {
    expect(unreadCount(msgs, "STAFF")).toBe(1);
  });

  it("заявителю непрочитано то, что написали мы", () => {
    expect(unreadCount(msgs, "APPLICANT")).toBe(1);
  });

  it("своё непрочитанным не считается", () => {
    expect(unreadCount([{ side: "STAFF", readByStaffAt: null, readByApplicantAt: new Date() }], "STAFF")).toBe(0);
  });
});

describe("statusAfterStaffMessage", () => {
  it("вопрос заявителю переводит дело в ожидание", () => {
    expect(statusAfterStaffMessage("IN_REVIEW", true)).toBe("WAITING_APPLICANT");
    expect(statusAfterStaffMessage("NEW", true)).toBe("WAITING_APPLICANT");
  });

  it("приписка без ожидания ответа статуса не трогает", () => {
    expect(statusAfterStaffMessage("IN_REVIEW", false)).toBeNull();
  });

  it("уже ждём — ничего не меняется, часы не встают дважды", () => {
    expect(statusAfterStaffMessage("WAITING_APPLICANT", true)).toBeNull();
  });

  it("решённое дело сообщением не открывается заново", () => {
    expect(statusAfterStaffMessage("APPROVED", true)).toBeNull();
    expect(statusAfterStaffMessage("REJECTED", true)).toBeNull();
    expect(statusAfterStaffMessage("CLOSED", true)).toBeNull();
  });
});

describe("statusAfterApplicantMessage", () => {
  it("ответ заявителя возвращает дело в работу", () => {
    expect(statusAfterApplicantMessage("WAITING_APPLICANT")).toBe("IN_REVIEW");
  });

  it("неразобранное дело ответом в работу не попадает — его никто не взял", () => {
    expect(statusAfterApplicantMessage("NEW")).toBeNull();
  });

  it("решённое дело ответом не открывается", () => {
    expect(statusAfterApplicantMessage("CLOSED")).toBeNull();
  });
});

describe("TEMPLATE_KEYS", () => {
  it("четыре заготовки в одно нажатие", () => {
    expect(TEMPLATE_KEYS).toEqual(["requestDocument", "clarifyData", "needTranslation", "deadline7"]);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run tests/case-messages.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/messages"`

- [ ] **Step 3: Написать реализацию**

```ts
// src/lib/cases/messages.ts
import type { CaseStatus } from "@prisma/client";
import { isOpen } from "./types";

export type MessageSide = "STAFF" | "APPLICANT";

export const MESSAGE_MAX = 4000;

/** Заготовки в одно нажатие. Текст живёт в i18n на языке заявителя. */
export const TEMPLATE_KEYS = [
  "requestDocument",
  "clarifyData",
  "needTranslation",
  "deadline7",
] as const;

export type NormalizedBody =
  | { ok: true; body: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * Текст без вложения обязателен: пустая реплика в нитке читается как сбой.
 * С вложением текст можно не писать — файл и есть сообщение.
 */
export function normalizeBody(raw: string, hasAttachments: boolean): NormalizedBody {
  const body = raw.replace(/\r\n/g, "\n").trim();
  if (body.length > MESSAGE_MAX) return { ok: false, reason: "too_long" };
  if (body.length === 0 && !hasAttachments) return { ok: false, reason: "empty" };
  return { ok: true, body };
}

export type ReadFlags = {
  side: MessageSide;
  readByStaffAt: Date | null;
  readByApplicantAt: Date | null;
};

/** Непрочитанное — только написанное другой стороной. */
export function unreadCount(messages: ReadFlags[], side: MessageSide): number {
  return messages.filter((m) =>
    side === "STAFF"
      ? m.side === "APPLICANT" && m.readByStaffAt === null
      : m.side === "STAFF" && m.readByApplicantAt === null,
  ).length;
}

/**
 * `null` — статус не меняется. Решённое дело сообщением не открывается:
 * вернуть его в работу должен человек, а не реплика в нитке.
 */
export function statusAfterStaffMessage(status: CaseStatus, needsReply: boolean): CaseStatus | null {
  if (!needsReply) return null;
  if (!isOpen(status)) return null;
  if (status === "WAITING_APPLICANT") return null;
  return "WAITING_APPLICANT";
}

export function statusAfterApplicantMessage(status: CaseStatus): CaseStatus | null {
  return status === "WAITING_APPLICANT" ? "IN_REVIEW" : null;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/case-messages.test.ts`
Expected: PASS, 13 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/lib/cases/messages.ts tests/case-messages.test.ts
git commit -m "feat(cases): переход статуса и счёт непрочитанного по сообщению"
```

---

### Task 3: Вложения — белый список и безопасное имя

**Files:**
- Create: `src/lib/cases/attachments.ts`
- Test: `tests/case-attachments.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/case-attachments.test.ts
import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_MESSAGE,
  attachmentUrl,
  extForMime,
  isSafeAttachmentName,
  parseAttachments,
} from "@/lib/cases/attachments";

describe("extForMime", () => {
  it("пропускает документы и картинки", () => {
    expect(extForMime("application/pdf")).toBe("pdf");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
  });

  it("всё прочее отвергает", () => {
    expect(extForMime("image/svg+xml")).toBeNull();
    expect(extForMime("text/html")).toBeNull();
    expect(extForMime("")).toBeNull();
  });
});

describe("isSafeAttachmentName", () => {
  it("принимает только наше собственное имя", () => {
    expect(isSafeAttachmentName("0123456789abcdef01234567.pdf")).toBe(true);
  });

  it("не пускает выход из каталога и чужие расширения", () => {
    expect(isSafeAttachmentName("../../etc/passwd")).toBe(false);
    expect(isSafeAttachmentName("0123456789abcdef01234567.sh")).toBe(false);
    expect(isSafeAttachmentName("0123456789abcdef01234567.pdf/../x.pdf")).toBe(false);
    expect(isSafeAttachmentName("ZZZ456789abcdef01234567.pdf")).toBe(false);
    expect(isSafeAttachmentName("")).toBe(false);
  });
});

describe("parseAttachments", () => {
  it("читает нашу запись", () => {
    const list = parseAttachments([
      { name: "0123456789abcdef01234567.pdf", filename: "устав.pdf", size: 12, mime: "application/pdf" },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.filename).toBe("устав.pdf");
  });

  it("мусор роняет не страницу, а только запись", () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments("строка")).toEqual([]);
    expect(parseAttachments([{ name: "../x.pdf", filename: "a", size: 1, mime: "application/pdf" }])).toEqual([]);
    expect(parseAttachments([{ nope: true }])).toEqual([]);
  });

  it("имя файла от заявителя не кусается", () => {
    const list = parseAttachments([
      { name: "0123456789abcdef01234567.png", filename: "<img src=x onerror=1>.png", size: 1, mime: "image/png" },
    ]);
    expect(list[0]!.filename).toBe("img src=x onerror=1.png");
  });

  it("больше пяти вложений в сообщении не бывает", () => {
    const one = { name: "0123456789abcdef01234567.png", filename: "a.png", size: 1, mime: "image/png" };
    expect(parseAttachments(Array.from({ length: 9 }, () => one))).toHaveLength(ATTACHMENT_MAX_PER_MESSAGE);
  });
});

describe("attachmentUrl", () => {
  it("ведёт на маршрут с проверкой прав, а не в публичный корень", () => {
    expect(attachmentUrl("case1", "0123456789abcdef01234567.pdf")).toBe(
      "/api/case-attachment/case1/0123456789abcdef01234567.pdf",
    );
  });
});

describe("ATTACHMENT_MAX_BYTES", () => {
  it("восемь мегабайт, как у KYB", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run tests/case-attachments.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/attachments"`

- [ ] **Step 3: Написать реализацию**

```ts
// src/lib/cases/attachments.ts

/**
 * Вложения переписки лежат в приватном корне и отдаются маршрутом с проверкой
 * прав: здесь ходят те же документы, что в KYB, а публичный /uploads/ отдаётся
 * nginx вообще без проверки — пересланная ссылка была бы открыта навсегда.
 */

export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_MESSAGE = 5;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** svg сознательно не в списке: это исполняемая разметка, а не картинка. */
export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

const NAME_RE = /^[0-9a-f]{24}\.(pdf|png|jpg|webp)$/;

/**
 * Имя файла придумываем мы сами (24 hex + расширение), поэтому проверка строгая
 * и единственная: маршрут отдачи склеивает путь из этого имени.
 */
export function isSafeAttachmentName(name: string): boolean {
  return NAME_RE.test(name);
}

export function attachmentUrl(caseId: string, name: string): string {
  return `/api/case-attachment/${caseId}/${name}`;
}

export type Attachment = { name: string; filename: string; size: number; mime: string };

/** Имя, которое дал человек, показываем — значит, чистим от разметки. */
function cleanFilename(raw: string): string {
  return raw.replace(/[<>"'`\\/]/g, "").trim().slice(0, 120) || "file";
}

/** Колонка `attachments` — JSONB: читаем её терпимо, мусор отбрасываем. */
export function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const mime = typeof r.mime === "string" ? r.mime : "";
    if (!isSafeAttachmentName(name) || !extForMime(mime)) continue;
    out.push({
      name,
      filename: cleanFilename(typeof r.filename === "string" ? r.filename : name),
      size: typeof r.size === "number" && Number.isFinite(r.size) ? Math.max(0, Math.round(r.size)) : 0,
      mime,
    });
    if (out.length === ATTACHMENT_MAX_PER_MESSAGE) break;
  }
  return out;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/case-attachments.test.ts`
Expected: PASS, 11 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/lib/cases/attachments.ts tests/case-attachments.test.ts
git commit -m "feat(cases): вложения переписки — белый список типов и своё имя файла"
```

---

### Task 4: Когда звонить колокольчику

**Files:**
- Create: `src/lib/cases/notifications.ts`
- Test: `tests/case-notifications.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/case-notifications.test.ts
import { describe, expect, it } from "vitest";
import {
  DUE_SOON_SECONDS,
  SILENT_WAIT_SECONDS,
  dueNotificationFor,
} from "@/lib/cases/notifications";

const T = (s: string) => new Date(s);
const now = T("2026-11-17T12:00:00Z");

const base = {
  status: "IN_REVIEW" as const,
  assigneeId: "u1",
  dueAt: T("2026-11-25T12:00:00Z"),
  clockStoppedAt: null as Date | null,
  lastStaffMessageAt: null as Date | null,
};

describe("dueNotificationFor", () => {
  it("далёкий срок никого не трогает", () => {
    expect(dueNotificationFor(base, now)).toBeNull();
  });

  it("за сутки до срока — звонок", () => {
    expect(dueNotificationFor({ ...base, dueAt: T("2026-11-18T06:00:00Z") }, now)).toBe("DUE_SOON");
  });

  it("просрочка важнее приближения", () => {
    expect(dueNotificationFor({ ...base, dueAt: T("2026-11-16T12:00:00Z") }, now)).toBe("CASE_OVERDUE");
  });

  it("дело без взявшего личных звонков не рассылает", () => {
    expect(dueNotificationFor({ ...base, assigneeId: null, dueAt: T("2026-11-16T12:00:00Z") }, now)).toBeNull();
  });

  it("решённое дело не звонит", () => {
    expect(dueNotificationFor({ ...base, status: "APPROVED", dueAt: T("2026-11-16T12:00:00Z") }, now)).toBeNull();
  });

  it("пока часы стоят, про срок не звоним — он не течёт", () => {
    expect(
      dueNotificationFor(
        { ...base, status: "WAITING_APPLICANT", clockStoppedAt: T("2026-11-17T11:00:00Z"), dueAt: T("2026-11-18T06:00:00Z") },
        now,
      ),
    ).toBeNull();
  });

  it("но про долгое молчание заявителя звоним — иначе дело висит вечно", () => {
    expect(
      dueNotificationFor(
        {
          ...base,
          status: "WAITING_APPLICANT",
          clockStoppedAt: T("2026-11-01T12:00:00Z"),
          lastStaffMessageAt: T("2026-11-01T12:00:00Z"),
          dueAt: T("2026-11-25T12:00:00Z"),
        },
        now,
      ),
    ).toBe("APPLICANT_SILENT");
  });

  it("две недели ещё не прошли — молчим", () => {
    expect(
      dueNotificationFor(
        {
          ...base,
          status: "WAITING_APPLICANT",
          clockStoppedAt: T("2026-11-10T12:00:00Z"),
          lastStaffMessageAt: T("2026-11-10T12:00:00Z"),
          dueAt: T("2026-11-25T12:00:00Z"),
        },
        now,
      ),
    ).toBeNull();
  });
});

describe("пороги", () => {
  it("сутки и четырнадцать дней", () => {
    expect(DUE_SOON_SECONDS).toBe(86400);
    expect(SILENT_WAIT_SECONDS).toBe(14 * 86400);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run tests/case-notifications.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cases/notifications"`

- [ ] **Step 3: Написать реализацию**

```ts
// src/lib/cases/notifications.ts
import type { AdminNotificationKind, CaseStatus } from "@prisma/client";
import { isOpen } from "./types";

export const DUE_SOON_SECONDS = 86400;

/** Молчание заявителя. Четырнадцать дней — то же число, что в слайсе AQ. */
export const SILENT_WAIT_SECONDS = 14 * 86400;

export type DueInput = {
  status: CaseStatus;
  assigneeId: string | null;
  dueAt: Date;
  clockStoppedAt: Date | null;
  lastStaffMessageAt: Date | null;
};

/**
 * Какой звонок нужен делу прямо сейчас — или ни одного.
 *
 * Дело без взявшего молчит: иначе каждый срок звонил бы всем админам сразу.
 * Пока часы стоят, про срок не звоним (он не течёт), но и бросать дело нельзя —
 * поэтому у стоящих часов свой повод: заявитель молчит две недели.
 */
export function dueNotificationFor(input: DueInput, now: Date): AdminNotificationKind | null {
  if (!isOpen(input.status)) return null;
  if (!input.assigneeId) return null;

  if (input.clockStoppedAt) {
    const since = input.lastStaffMessageAt ?? input.clockStoppedAt;
    const silent = (now.getTime() - since.getTime()) / 1000;
    return silent >= SILENT_WAIT_SECONDS ? "APPLICANT_SILENT" : null;
  }

  const left = (input.dueAt.getTime() - now.getTime()) / 1000;
  if (left <= 0) return "CASE_OVERDUE";
  if (left <= DUE_SOON_SECONDS) return "DUE_SOON";
  return null;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/case-notifications.test.ts`
Expected: PASS, 9 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/lib/cases/notifications.ts tests/case-notifications.test.ts
git commit -m "feat(cases): правило, когда звонить сотруднику"
```

---

### Task 5: Запись колокольчика и письмо заявителю

**Files:**
- Create: `src/lib/cases/admin-notify.ts`
- Create: `src/lib/cases/notify-applicant.ts`
- Modify: `src/lib/locales.ts`
- Modify: `src/app/api/auth/password/forgot/route.ts:29-36`

- [ ] **Step 1: Вынести `pickLocale` в общее место**

Сейчас эта функция живёт копией внутри маршрута сброса пароля. Нам она нужна вторым
местом, а своя копия списка локалей в проекте уже однажды отставала на язык.

В конец `src/lib/locales.ts`:

```ts
/** Непроверенное значение (из базы, из тела запроса) → поддерживаемая локаль. */
export function pickLocale(value: unknown): Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : DEFAULT_LOCALE;
}
```

- [ ] **Step 2: Убрать копию из маршрута сброса пароля**

В `src/app/api/auth/password/forgot/route.ts` удалить локальное объявление
`function pickLocale(value: unknown): Locale { ... }` (строки ~29-36) и добавить
импорт в существующую строку:

```ts
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, pickLocale, type Locale } from "@/lib/locales";
```

- [ ] **Step 3: Проверить, что ничего не сломалось**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто (либо только ошибки, существовавшие до правки — проверить `git stash` при сомнении)

- [ ] **Step 4: Написать запись колокольчика**

```ts
// src/lib/cases/admin-notify.ts
import type { AdminNotificationKind, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/** Текст сотруднику — по-английски, как во всех существующих вызовах notifyUser. */
const TELEGRAM_LINE: Record<AdminNotificationKind, string> = {
  APPLICANT_REPLIED: "💬 Applicant replied",
  DUE_SOON: "⏰ Case due within 24 hours",
  CASE_OVERDUE: "🔴 Case overdue",
  APPLICANT_SILENT: "🕸 Applicant silent for 14 days",
};

export type RaiseInput = {
  userId: string;
  kind: AdminNotificationKind;
  caseId: string;
  /** Снимок названия дела: список должен читаться, даже если дело удалили. */
  title: string;
  body?: string | null;
  /** Дубль в Telegram/почту. Для прогона сроков — да, для каждой реплики — да. */
  alsoNotify?: boolean;
};

/**
 * Один звонок на (сотрудник, повод, дело), пока он не прочитан: пять ответов
 * заявителя подряд не должны давать пять колокольчиков. Прочитанный звонок
 * тем же поводом может прозвенеть заново — это новое событие.
 */
export async function raiseAdminNotification(
  db: Pick<PrismaClient, "adminNotification">,
  input: RaiseInput,
): Promise<"created" | "collapsed"> {
  const existing = await db.adminNotification.findFirst({
    where: { userId: input.userId, kind: input.kind, caseId: input.caseId, readAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    await db.adminNotification.update({
      where: { id: existing.id },
      data: { title: input.title.slice(0, 200), body: input.body?.slice(0, 400) ?? null, createdAt: new Date() },
    });
    return "collapsed";
  }

  await db.adminNotification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      caseId: input.caseId,
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 400) ?? null,
    },
  });
  return "created";
}

/** Колокольчик плюс дубль в Telegram/почту. Сбой канала звонок не отменяет. */
export async function raiseAndNotify(input: RaiseInput): Promise<void> {
  const state = await raiseAdminNotification(prisma, input).catch((err) => {
    console.error("[case-notify] failed to raise:", err);
    return null;
  });
  // Схлопнутый звонок второй раз в Telegram не шлём: это то же событие.
  if (state !== "created" || input.alsoNotify === false) return;
  const url = `${SITE_ORIGIN}/en/admin/cases/${input.caseId}`;
  void notifyUser({
    userId: input.userId,
    subject: `${TELEGRAM_LINE[input.kind]}: ${input.title}`,
    text: `${TELEGRAM_LINE[input.kind]}\n${input.title}\n${url}`,
    url,
  }).catch(() => {});
}
```

- [ ] **Step 5: Написать письмо заявителю**

```ts
// src/lib/cases/notify-applicant.ts
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notify";
import { pickLocale } from "@/lib/locales";

const SITE_ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://trientes.org";

/**
 * Письмо и Telegram — на языке кабинета заявителя, а не страницы сотрудника:
 * тот же довод, что у письма сброса пароля.
 *
 * Сбой уведомления сообщение не отменяет: оно уже в нитке, человек увидит его
 * в кабинете. Поэтому — console.error и ничего больше.
 */
export async function notifyApplicantOfMessage(input: {
  applicantUserId: string;
  caseId: string;
  caseTitle: string;
  preview: string;
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.applicantUserId },
      select: { preferredLocale: true },
    });
    const locale = pickLocale(user?.preferredLocale);
    const t = await getTranslations({ locale, namespace: "notify.caseMessage" });
    const url = `${SITE_ORIGIN}/${locale}/cabinet/cases/${input.caseId}`;
    const text = [t("body", { title: input.caseTitle }), input.preview, url].join("\n\n");
    await notifyUser({
      userId: input.applicantUserId,
      subject: t("subject", { title: input.caseTitle }),
      text,
      url,
    });
  } catch (err) {
    console.error("[case-notify] applicant notification failed", { caseId: input.caseId, err });
  }
}
```

- [ ] **Step 6: Проверить сборку типов**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто

- [ ] **Step 7: Коммит**

```bash
git add src/lib/cases/admin-notify.ts src/lib/cases/notify-applicant.ts src/lib/locales.ts src/app/api/auth/password/forgot/route.ts
git commit -m "feat(cases): запись колокольчика и письмо заявителю"
```

---

### Task 6: Серверные действия переписки

**Files:**
- Create: `src/app/actions/case-messages.ts`
- Modify: `src/lib/cases/journal.ts:29-40`

- [ ] **Step 1: Добавить два вида события в журнал**

В `src/lib/cases/journal.ts`, в объект `KEYS`, после `NOTE: "note"`:

```ts
  MESSAGE_SENT: "messageSent",
  MESSAGE_RECEIVED: "messageReceived",
```

- [ ] **Step 2: Написать действия**

```ts
// src/app/actions/case-messages.ts
"use server";

import { revalidatePath } from "next/cache";
import type { CaseStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { checkAdmin } from "@/lib/is-admin";
import { appendCaseEvent } from "@/lib/cases/journal";
import { pausePatch, resumePatch } from "@/lib/cases/sla";
import { normalizeBody, statusAfterApplicantMessage, statusAfterStaffMessage } from "@/lib/cases/messages";
import { parseAttachments, type Attachment } from "@/lib/cases/attachments";
import { notifyApplicantOfMessage } from "@/lib/cases/notify-applicant";
import { raiseAndNotify } from "@/lib/cases/admin-notify";

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "unauth" | "forbidden" | "not_found" | "empty" | "too_long" };

const PREVIEW = 300;

/** Сообщение сотрудника заявителю. */
export async function sendStaffMessage(input: {
  caseId: string;
  body: string;
  attachments?: unknown;
  needsReply?: boolean;
}): Promise<SendResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason === "unauth" ? "unauth" : "forbidden" };

  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };

  const files = parseAttachments(input.attachments);
  const text = normalizeBody(input.body, files.length > 0);
  if (!text.ok) return { ok: false, reason: text.reason };

  const now = new Date();
  const needsReply = input.needsReply !== false;

  await prisma.caseMessage.create({
    data: {
      caseId: c.id,
      authorId: admin.userId,
      side: "STAFF",
      body: text.body,
      attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const nextStatus = statusAfterStaffMessage(c.status, needsReply);
  const patch: Prisma.ComplianceCaseUpdateInput = {};
  // Отзывчивость считается один раз и только вперёд: пересчитать её потом нечем.
  if (!c.firstResponseAt) patch.firstResponseAt = now;
  if (nextStatus) {
    patch.status = nextStatus;
    // Часы срока встают: молчание заявителя не должно съедать срок проверяющего.
    Object.assign(patch, pausePatch(now));
  }
  if (Object.keys(patch).length) {
    await prisma.complianceCase.update({ where: { id: c.id }, data: patch });
  }

  await appendCaseEvent({
    caseId: c.id,
    actorId: admin.userId,
    kind: "MESSAGE_SENT",
    payload: { preview: text.body.slice(0, 120), files: files.length },
  });
  if (nextStatus) {
    await appendCaseEvent({
      caseId: c.id,
      actorId: admin.userId,
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: nextStatus },
    });
    await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "CLOCK_PAUSED" });
  }

  if (c.applicantUserId) {
    void notifyApplicantOfMessage({
      applicantUserId: c.applicantUserId,
      caseId: c.id,
      caseTitle: c.title,
      preview: text.body.slice(0, PREVIEW),
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/** Ответ заявителя. Права — только сам заявитель этого дела. */
export async function sendApplicantMessage(input: {
  caseId: string;
  body: string;
  attachments?: unknown;
}): Promise<SendResult> {
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!me) return { ok: false, reason: "unauth" };

  const c = await prisma.complianceCase.findUnique({ where: { id: input.caseId } });
  if (!c) return { ok: false, reason: "not_found" };
  if (c.applicantUserId !== me) return { ok: false, reason: "forbidden" };

  const files = parseAttachments(input.attachments);
  const text = normalizeBody(input.body, files.length > 0);
  if (!text.ok) return { ok: false, reason: text.reason };

  const now = new Date();
  await prisma.caseMessage.create({
    data: {
      caseId: c.id,
      authorId: me,
      side: "APPLICANT",
      body: text.body,
      attachments: files.length ? (files as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const nextStatus: CaseStatus | null = statusAfterApplicantMessage(c.status);
  if (nextStatus) {
    // Часы идут снова, и dueAt сдвигается ровно на простой.
    const resumed = resumePatch({ dueAt: c.dueAt, clockStoppedAt: c.clockStoppedAt, now });
    await prisma.complianceCase.update({
      where: { id: c.id },
      data: { status: nextStatus, ...resumed },
    });
  }

  await appendCaseEvent({
    caseId: c.id,
    actorId: me,
    actorSide: "APPLICANT",
    kind: "MESSAGE_RECEIVED",
    payload: { preview: text.body.slice(0, 120), files: files.length },
  });
  if (nextStatus) {
    await appendCaseEvent({
      caseId: c.id,
      actorId: me,
      actorSide: "APPLICANT",
      kind: "STATUS_CHANGED",
      payload: { from: c.status, to: nextStatus },
    });
    await appendCaseEvent({ caseId: c.id, actorId: me, actorSide: "APPLICANT", kind: "CLOCK_RESUMED" });
  }

  // Звоним только взявшему дело: иначе каждый ответ будил бы всех админов.
  if (c.assigneeId) {
    void raiseAndNotify({
      userId: c.assigneeId,
      kind: "APPLICANT_REPLIED",
      caseId: c.id,
      title: c.title,
      body: text.body.slice(0, PREVIEW),
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Отметка о прочтении. Сторона определяется по тому, кто спрашивает: заявитель
 * гасит наши сообщения, сотрудник — сообщения заявителя (по стороне, а не по
 * человеку: это общий стол заявок).
 *
 * Без revalidatePath — вызов идёт из эффекта при открытии нитки, а счётчики
 * страницы всё равно пересчитываются при следующем переходе (все экраны
 * админки — force-dynamic).
 */
export async function markCaseRead(input: { caseId: string }): Promise<{ ok: boolean }> {
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id ?? null;
  if (!me) return { ok: false };

  const c = await prisma.complianceCase.findUnique({
    where: { id: input.caseId },
    select: { applicantUserId: true },
  });
  if (!c) return { ok: false };
  const now = new Date();

  if (c.applicantUserId === me) {
    await prisma.caseMessage.updateMany({
      where: { caseId: input.caseId, side: "STAFF", readByApplicantAt: null },
      data: { readByApplicantAt: now },
    });
    return { ok: true };
  }

  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false };
  await prisma.caseMessage.updateMany({
    where: { caseId: input.caseId, side: "APPLICANT", readByStaffAt: null },
    data: { readByStaffAt: now },
  });
  // Колокольчик про ответ гаснет вместе с ниткой: прочитано — значит прочитано.
  await prisma.adminNotification.updateMany({
    where: { userId: admin.userId, caseId: input.caseId, kind: "APPLICANT_REPLIED", readAt: null },
    data: { readAt: now },
  });
  return { ok: true };
}

/** Гашение всех моих колокольчиков — зовётся при открытии списка уведомлений. */
export async function markNotificationsRead(): Promise<{ ok: boolean }> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false };
  await prisma.adminNotification.updateMany({
    where: { userId: admin.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { ok: true };
}

export type { Attachment };
```

- [ ] **Step 3: Проверить типы**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто

- [ ] **Step 4: Коммит**

```bash
git add src/app/actions/case-messages.ts src/lib/cases/journal.ts
git commit -m "feat(cases): отправка сообщений, остановка часов, отметка о прочтении"
```

---

### Task 7: Загрузка и отдача вложений

**Files:**
- Create: `src/app/api/case-attachment/upload/route.ts`
- Create: `src/app/api/case-attachment/[caseId]/[name]/route.ts`
- Modify: `.env`

- [ ] **Step 1: Завести приватный корень на сервере**

```bash
sudo mkdir -p /var/www/trientes-private/cases
sudo chown -R "$USER":"$USER" /var/www/trientes-private
sudo chmod 750 /var/www/trientes-private
printf '\n# Вложения переписки по делам — приватно, отдаёт не nginx, а маршрут с проверкой прав\nCASE_ATTACHMENTS_ROOT=/var/www/trientes-private/cases\n' >> .env
```

Run: `grep -c CASE_ATTACHMENTS_ROOT .env && test -w /var/www/trientes-private/cases && echo writable`
Expected: `1` и `writable`

- [ ] **Step 2: Написать маршрут загрузки**

```ts
// src/app/api/case-attachment/upload/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { ATTACHMENT_MAX_BYTES, extForMime } from "@/lib/cases/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.CASE_ATTACHMENTS_ROOT ?? join(process.cwd(), ".private-uploads", "cases");

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const caseId = String(form.get("caseId") ?? "");
  if (!caseId) return NextResponse.json({ error: "case_required" }, { status: 400 });

  const c = await prisma.complianceCase.findUnique({
    where: { id: caseId },
    select: { applicantUserId: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (c.applicantUserId !== userId) {
    const admin = await checkAdmin();
    if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const ext = extForMime(file.type);
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  // Имя придумываем мы: 24 hex — ровно то, что пропускает isSafeAttachmentName.
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(ROOT, caseId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    ok: true,
    name,
    filename: file.name,
    size: file.size,
    mime: file.type,
  });
}
```

- [ ] **Step 3: Написать маршрут отдачи**

```ts
// src/app/api/case-attachment/[caseId]/[name]/route.ts
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { isSafeAttachmentName } from "@/lib/cases/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.CASE_ATTACHMENTS_ROOT ?? join(process.cwd(), ".private-uploads", "cases");

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Приватная отдача: nginx этот путь не знает, файл проходит через проверку прав.
 * Так вложение по делу ведёт себя как KYB-документ, а не как логотип монеты.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string; name: string }> },
) {
  const { caseId, name } = await params;
  if (!isSafeAttachmentName(name)) return NextResponse.json({ error: "bad_name" }, { status: 400 });

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const c = await prisma.complianceCase.findUnique({
    where: { id: caseId },
    select: { applicantUserId: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (c.applicantUserId !== userId) {
    const admin = await checkAdmin();
    if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const bytes = await readFile(join(ROOT, caseId, name)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "gone" }, { status: 404 });

  const ext = name.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-disposition": "inline",
      // Приватный файл не должен оседать в общих кэшах.
      "cache-control": "private, no-store",
    },
  });
}
```

- [ ] **Step 4: Проверить типы**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто

- [ ] **Step 5: Коммит**

```bash
git add src/app/api/case-attachment
git commit -m "feat(cases): вложения переписки — приватный корень и отдача по праву"
```

---

### Task 8: Ключи интерфейса

**Files:**
- Modify: `messages/en.json`

- [ ] **Step 1: Добавить ключи нитки и заготовок**

В `messages/en.json`, в объект `admin.case`, рядом с `sections`:

```json
    "thread": {
      "title": "Correspondence",
      "summary": "{count} messages",
      "unreadSummary": "{count} messages, {unread} unread",
      "empty": "No messages yet. The applicant sees whatever you send here.",
      "staff": "Us",
      "applicant": "Applicant",
      "placeholder": "Write to the applicant…",
      "send": "Send to applicant",
      "needsReply": "I expect an answer (stops the clock)",
      "templates": "Ready-made",
      "attach": "Attach a file",
      "attaching": "Uploading…",
      "attached": "{count} attached",
      "errors": {
        "empty": "Write something or attach a file",
        "too_long": "Too long — 4000 characters max",
        "too_large": "File is over 8 MB",
        "bad_type": "Only PDF, PNG, JPEG or WebP",
        "failed": "Could not send — try again"
      }
    },
    "templates": {
      "requestDocument": "Hello! To continue the review we need a document confirming the data in your application. Please attach a scan or a photo in reply to this message.",
      "clarifyData": "Hello! Some details in your application need clarification. Please check the data and reply here with the correct values.",
      "needTranslation": "Hello! The document you sent is in a language we cannot verify. Please attach a translation into English.",
      "deadline7": "Please reply within 7 days. Without an answer we will have to close the application without a decision."
    }
```

- [ ] **Step 2: Добавить ключи журнала, значка очереди и колокольчика**

В `admin.case.journal` после `"note"`:

```json
      "messageSent": "wrote to the applicant",
      "messageReceived": "applicant replied",
```

В `admin.queues` после `"empty"`:

```json
  "unread": "{count} unread",
```

Новым объектом внутри `admin`:

```json
  "bell": {
    "title": "Notifications",
    "subtitle": "{count} unread",
    "empty": "Nothing new",
    "open": "Open the case",
    "kinds": {
      "APPLICANT_REPLIED": "Applicant replied",
      "DUE_SOON": "Due within 24 hours",
      "CASE_OVERDUE": "Overdue",
      "APPLICANT_SILENT": "Applicant has been silent for 14 days"
    }
  },
```

- [ ] **Step 3: Добавить ключи кабинета заявителя и уведомления**

Новым объектом внутри `cabinet`:

```json
  "cases": {
    "title": "Your applications",
    "subtitle": "Correspondence with the moderators about everything you have submitted.",
    "empty": "You have no applications under review.",
    "unread": "{count} new",
    "open": "Open correspondence",
    "placeholder": "Write to the moderators…",
    "send": "Send",
    "status": {
      "NEW": "received, waiting for a reviewer",
      "IN_REVIEW": "under review",
      "WAITING_APPLICANT": "waiting for your answer",
      "READY_FOR_APPROVAL": "awaiting approval",
      "APPROVED": "approved",
      "REJECTED": "rejected",
      "CLOSED": "closed"
    }
  },
```

Новым объектом верхнего уровня (рядом с `cabinet`):

```json
  "notify": {
    "caseMessage": {
      "subject": "Trientes: a question about \"{title}\"",
      "body": "The moderators wrote to you about your application \"{title}\". Open the link below to read it and reply."
    }
  },
```

- [ ] **Step 4: Проверить, что файл — валидный JSON**

Run: `node -e "const m=require('./messages/en.json'); console.log(m.admin.case.thread.send, '|', m.cabinet.cases.title, '|', m.notify.caseMessage.subject, '|', m.admin.bell.kinds.DUE_SOON)"`
Expected: `Send to applicant | Your applications | Trientes: a question about "{title}" | Due within 24 hours`

- [ ] **Step 5: Коммит**

```bash
git add messages/en.json
git commit -m "feat(i18n): ключи переписки по делу и колокольчиков"
```

---

### Task 9: Нитка, форма и отметка о прочтении

**Files:**
- Create: `src/components/cases/case-thread.tsx`
- Create: `src/components/cases/case-composer.tsx`
- Create: `src/components/cases/case-read-marker.tsx`

- [ ] **Step 1: Написать нитку**

```tsx
// src/components/cases/case-thread.tsx
import { attachmentUrl, type Attachment } from "@/lib/cases/attachments";

export type ThreadMessage = {
  id: string;
  side: "STAFF" | "APPLICANT";
  body: string;
  attachments: Attachment[];
  createdAt: Date;
  authorName: string | null;
};

/**
 * Одна нитка на дело: заявитель слева, мы справа. Один компонент на админку и
 * кабинет — расходиться этим двум видам нельзя, это один и тот же разговор.
 */
export function CaseThread({
  caseId,
  messages,
  locale,
  mySide,
  staffLabel,
  applicantLabel,
  emptyLabel,
}: {
  caseId: string;
  messages: ThreadMessage[];
  locale: string;
  mySide: "STAFF" | "APPLICANT";
  staffLabel: string;
  applicantLabel: string;
  emptyLabel: string;
}) {
  if (messages.length === 0) {
    return <p className="text-[12px] text-muted">{emptyLabel}</p>;
  }

  // Часы в языке страницы, а не браузера: тот же довод, что в ведении по маршруту.
  const time = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <ol className="flex flex-col gap-2.5">
      {messages.map((m) => {
        const mine = m.side === mySide;
        return (
          <li
            key={m.id}
            className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}
          >
            <div className="flex items-center gap-2 px-1 text-[10px] text-muted">
              <span className="font-semibold uppercase tracking-wider">
                {m.side === "STAFF" ? staffLabel : applicantLabel}
              </span>
              {m.authorName ? <span>{m.authorName}</span> : null}
              <span>{time.format(m.createdAt)}</span>
            </div>
            <div
              className={`max-w-[85%] rounded-[16px] px-3.5 py-2.5 text-[13px] leading-relaxed ${
                mine
                  ? "bg-accent/12 border border-accent/30"
                  : "bg-card-alt border border-hairline"
              }`}
            >
              {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
              {m.attachments.length > 0 ? (
                <ul className={m.body ? "mt-2 flex flex-col gap-1" : "flex flex-col gap-1"}>
                  {m.attachments.map((a) => (
                    <li key={a.name}>
                      <a
                        href={attachmentUrl(caseId, a.name)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent underline underline-offset-2"
                      >
                        📎 {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2: Написать форму отправки**

```tsx
// src/components/cases/case-composer.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { sendApplicantMessage, sendStaffMessage } from "@/app/actions/case-messages";
import { ATTACHMENT_MAX_PER_MESSAGE, type Attachment } from "@/lib/cases/attachments";
import { ADMIN_BUTTON } from "@/lib/admin-ui";

export type ComposerLabels = {
  placeholder: string;
  send: string;
  needsReply: string;
  templates: string;
  attach: string;
  attaching: string;
  attached: string;
  errors: Record<string, string>;
};

/**
 * Одна форма на обе стороны. Заготовки показываются только сотруднику и уже на
 * языке заявителя: текст прочитает он, а не мы.
 */
export function CaseComposer({
  caseId,
  side,
  labels,
  templates,
}: {
  caseId: string;
  side: "STAFF" | "APPLICANT";
  labels: ComposerLabels;
  templates?: { key: string; label: string; text: string }[];
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [needsReply, setNeedsReply] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.set("caseId", caseId);
      form.set("file", file);
      const res = await fetch("/api/case-attachment/upload", { method: "POST", body: form });
      const json = (await res.json()) as { ok?: boolean; error?: string } & Attachment;
      if (!res.ok || !json.ok) {
        setError(labels.errors[json.error ?? "failed"] ?? labels.errors.failed!);
        return;
      }
      setFiles((prev) =>
        prev.length >= ATTACHMENT_MAX_PER_MESSAGE
          ? prev
          : [...prev, { name: json.name, filename: json.filename, size: json.size, mime: json.mime }],
      );
    } catch {
      setError(labels.errors.failed!);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit() {
    setError(null);
    start(async () => {
      const payload = { caseId, body, attachments: files };
      const res =
        side === "STAFF"
          ? await sendStaffMessage({ ...payload, needsReply })
          : await sendApplicantMessage(payload);
      if (!res.ok) {
        setError(labels.errors[res.reason] ?? labels.errors.failed!);
        return;
      }
      setBody("");
      setFiles([]);
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5">
      {templates && templates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">{labels.templates}</span>
          <div className="flex flex-wrap gap-1.5">
            {templates.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => setBody((prev) => (prev ? `${prev}\n\n${tpl.text}` : tpl.text))}
                className="rounded-full border border-hairline bg-card-alt px-3 py-2 text-[11.5px] font-medium hover:border-accent/60"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={labels.placeholder}
        rows={4}
        className="w-full rounded-[14px] border border-hairline bg-card-alt p-3 text-[13px] outline-none focus:border-accent/60"
      />

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          type="button"
          disabled={uploading || files.length >= ATTACHMENT_MAX_PER_MESSAGE}
          onClick={() => fileInput.current?.click()}
          className="flex h-12 items-center gap-2 rounded-[14px] border border-hairline bg-card px-4 text-[12.5px] font-semibold disabled:opacity-40"
        >
          📎 {uploading ? labels.attaching : labels.attach}
        </button>
        {files.length > 0 ? (
          <span className="text-[11.5px] text-muted">
            {labels.attached.replace("{count}", String(files.length))}
          </span>
        ) : null}
      </div>

      {side === "STAFF" ? (
        <label className="flex items-center gap-2.5 text-[12px]">
          <input
            type="checkbox"
            checked={needsReply}
            onChange={(e) => setNeedsReply(e.target.checked)}
            className="h-4 w-4"
          />
          {labels.needsReply}
        </label>
      ) : null}

      {error ? <p className="text-[12px] text-down">{error}</p> : null}

      <button type="button" disabled={pending || uploading} onClick={submit} className={ADMIN_BUTTON}>
        {labels.send}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Написать отметку о прочтении**

```tsx
// src/components/cases/case-read-marker.tsx
"use client";

import { useEffect } from "react";
import { markCaseRead } from "@/app/actions/case-messages";

/**
 * Прочитано — значит открыли нитку. Отметка идёт из эффекта, а не из рендера:
 * изменять данные во время отрисовки серверного компонента нельзя.
 */
export function CaseReadMarker({ caseId }: { caseId: string }) {
  useEffect(() => {
    void markCaseRead({ caseId });
  }, [caseId]);
  return null;
}
```

- [ ] **Step 4: Проверить типы**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто

- [ ] **Step 5: Коммит**

```bash
git add src/components/cases
git commit -m "feat(cases): нитка переписки, форма отправки, отметка о прочтении"
```

---

### Task 10: Раздел «Переписка» в деле

**Files:**
- Modify: `src/app/[locale]/admin/cases/[id]/page.tsx`

- [ ] **Step 1: Добавить импорты**

После существующих импортов компонентов дела:

```tsx
import { getTranslations as getT } from "next-intl/server";
import { CaseThread } from "@/components/cases/case-thread";
import { CaseComposer } from "@/components/cases/case-composer";
import { CaseReadMarker } from "@/components/cases/case-read-marker";
import { parseAttachments } from "@/lib/cases/attachments";
import { TEMPLATE_KEYS, unreadCount } from "@/lib/cases/messages";
import { pickLocale } from "@/lib/locales";
```

- [ ] **Step 2: Подгрузить сообщения вместе с делом**

В `prisma.complianceCase.findUnique({ include: { ... } })` добавить к `include`:

```tsx
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, username: true } } },
      },
```

и в `applicant: { select: ... }` добавить `preferredLocale: true`.

- [ ] **Step 3: Посчитать непрочитанное и собрать заготовки**

После вычисления `queueKey`:

```tsx
  const unread = unreadCount(
    c.messages.map((m) => ({
      side: m.side,
      readByStaffAt: m.readByStaffAt,
      readByApplicantAt: m.readByApplicantAt,
    })),
    "STAFF",
  );

  // Заготовки — на языке кабинета заявителя: читать их будет он.
  const applicantLocale = pickLocale(c.applicant?.preferredLocale);
  const tpl = await getT({ locale: applicantLocale, namespace: "admin.case.templates" });
  const templates = TEMPLATE_KEYS.map((key) => ({
    key,
    label: t(`thread.templateLabels.${key}`),
    text: tpl(key),
  }));
```

- [ ] **Step 4: Добавить подписи кнопок заготовок в `messages/en.json`**

В `admin.case.thread` добавить:

```json
      "templateLabels": {
        "requestDocument": "Request a document",
        "clarifyData": "Clarify data",
        "needTranslation": "Need a translation",
        "deadline7": "Answer within 7 days"
      },
```

- [ ] **Step 5: Добавить раздел в разметку**

После раздела `3` (журнал) — журнал становится разделом 4, переписка 3: разговор нужнее
журнала, и он должен быть выше. Поменять `n="3"` у журнала на `n="4"` и вставить перед ним:

```tsx
        <CaseSection
          n="3"
          title={t("case.thread.title")}
          summary={
            unread > 0
              ? t("case.thread.unreadSummary", { count: c.messages.length, unread })
              : t("case.thread.summary", { count: c.messages.length })
          }
          open
        >
          {unread > 0 ? <CaseReadMarker caseId={c.id} /> : null}
          <CaseThread
            caseId={c.id}
            locale={locale}
            mySide="STAFF"
            messages={c.messages.map((m) => ({
              id: m.id,
              side: m.side,
              body: m.body,
              attachments: parseAttachments(m.attachments),
              createdAt: m.createdAt,
              authorName: m.author?.name ?? m.author?.username ?? null,
            }))}
            staffLabel={t("case.thread.staff")}
            applicantLabel={t("case.thread.applicant")}
            emptyLabel={t("case.thread.empty")}
          />
          {c.applicantUserId ? (
            <CaseComposer
              caseId={c.id}
              side="STAFF"
              templates={templates}
              labels={{
                placeholder: t("case.thread.placeholder"),
                send: t("case.thread.send"),
                needsReply: t("case.thread.needsReply"),
                templates: t("case.thread.templates"),
                attach: t("case.thread.attach"),
                attaching: t("case.thread.attaching"),
                attached: t("case.thread.attached", { count: 0 }).replace("0", "{count}"),
                errors: {
                  empty: t("case.thread.errors.empty"),
                  too_long: t("case.thread.errors.too_long"),
                  too_large: t("case.thread.errors.too_large"),
                  bad_type: t("case.thread.errors.bad_type"),
                  failed: t("case.thread.errors.failed"),
                  forbidden: t("case.thread.errors.failed"),
                  unauth: t("case.thread.errors.failed"),
                  not_found: t("case.thread.errors.failed"),
                },
              }}
            />
          ) : (
            <p className="mt-3 text-[12px] text-muted">{t("case.thread.noApplicant")}</p>
          )}
        </CaseSection>
```

- [ ] **Step 6: Добавить два оставшихся ключа**

В `admin.case.thread` файла `messages/en.json`:

```json
      "noApplicant": "This case has no registered applicant — there is nobody to write to.",
```

- [ ] **Step 7: Проверить типы и собрать**

Run: `npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -5`
Expected: пусто от tsc; все тесты PASS

- [ ] **Step 8: Коммит**

```bash
git add 'src/app/[locale]/admin/cases/[id]/page.tsx' messages/en.json
git commit -m "feat(admin): раздел переписки в деле"
```

---

### Task 11: Значки непрочитанного в очередях

**Files:**
- Modify: `src/lib/cases/queues.ts`
- Modify: `src/components/admin/queue-tile.tsx`
- Modify: `src/components/admin/case-row.tsx`
- Modify: `src/app/[locale]/admin/queues/page.tsx`
- Modify: `src/app/[locale]/admin/queues/[queue]/page.tsx`
- Test: `tests/case-queues.test.ts`

- [ ] **Step 1: Написать падающий тест**

Добавить в конец `tests/case-queues.test.ts`:

```ts
describe("buildTiles — непрочитанное", () => {
  const row = (subjectType: "COIN_CARD" | "POINT", id: string) => ({
    id,
    subjectType,
    status: "IN_REVIEW" as const,
    openedAt: new Date("2026-11-10T10:00:00Z"),
    dueAt: new Date("2026-11-20T10:00:00Z"),
    slaSeconds: 864000,
    clockStoppedAt: null,
  });

  it("складывает непрочитанное по делам очереди", () => {
    const tiles = buildTiles(
      [row("COIN_CARD", "a"), row("COIN_CARD", "b"), row("POINT", "c")],
      new Date("2026-11-17T10:00:00Z"),
      new Map([
        ["a", 2],
        ["c", 1],
      ]),
    );
    expect(tiles.find((t) => t.key === "coinCards")!.unread).toBe(2);
    expect(tiles.find((t) => t.key === "points")!.unread).toBe(1);
    expect(tiles.find((t) => t.key === "companies")!.unread).toBe(0);
  });

  it("без карты непрочитанного плитка просто молчит", () => {
    const tiles = buildTiles([row("COIN_CARD", "a")], new Date("2026-11-17T10:00:00Z"));
    expect(tiles.find((t) => t.key === "coinCards")!.unread).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать тест и убедиться, что он падает**

Run: `npx vitest run tests/case-queues.test.ts`
Expected: FAIL — `Property 'id' does not exist` / `unread` не определено

- [ ] **Step 3: Научить `buildTiles` непрочитанному**

В `src/lib/cases/queues.ts`:

```ts
export type CaseRow = {
  /** Нужен, чтобы сопоставить дело с числом непрочитанного. */
  id: string;
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
  /** Сообщений заявителей, которых не читала ни одна смена. */
  unread: number;
};
```

и в теле `buildTiles` третий необязательный параметр плюс подсчёт:

```ts
export function buildTiles(
  rows: CaseRow[],
  now: Date,
  unreadByCase?: Map<string, number>,
): QueueTile[] {
  return QUEUES.map((q) => {
    const mine = rows.filter((r) => q.subjectTypes.includes(r.subjectType) && isOpen(r.status));
    let oldest: Date | null = null;
    let worst: SlaState | null = null;
    let unread = 0;
    for (const r of mine) {
      if (!oldest || r.openedAt < oldest) oldest = r.openedAt;
      unread += unreadByCase?.get(r.id) ?? 0;
      const { state } = slaState({
        now,
        dueAt: r.dueAt,
        slaSeconds: r.slaSeconds,
        clockStoppedAt: r.clockStoppedAt,
      });
      if (!worst || SEVERITY[state] > SEVERITY[worst]) worst = state;
    }
    return { key: q.key, icon: q.icon, open: mine.length, oldestOpenedAt: oldest, worst, unread };
  });
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/case-queues.test.ts`
Expected: PASS

- [ ] **Step 5: Нарисовать значок на плитке**

В `src/components/admin/queue-tile.tsx` добавить проп и значок. Сигнатура:

```tsx
export function QueueTileCard({
  tile,
  label,
  href,
  ageLabel,
  slaLabel,
  emptyLabel,
  unreadLabel,
}: {
  tile: Tile;
  label: string;
  href: string;
  ageLabel: string | null;
  slaLabel: string | null;
  emptyLabel: string;
  unreadLabel: string | null;
}) {
```

и сразу внутри `<Link>`, перед знаком очереди:

```tsx
      {tile.unread > 0 && unreadLabel ? (
        <span
          title={unreadLabel}
          className="absolute right-3 top-3 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-foreground"
        >
          🔔 {tile.unread}
        </span>
      ) : null}
```

- [ ] **Step 6: Передать непрочитанное на экран плиток**

В `src/app/[locale]/admin/queues/page.tsx` добавить `id: true` в `select` запроса дел,
после запроса дел посчитать непрочитанное и передать подпись:

```tsx
  const unreadRows = await prisma.caseMessage.groupBy({
    by: ["caseId"],
    where: { caseId: { in: rows.map((r) => r.id) }, side: "APPLICANT", readByStaffAt: null },
    _count: { _all: true },
  });
  const unreadByCase = new Map(unreadRows.map((r) => [r.caseId, r._count._all]));

  const tiles = buildTiles(rows, now, unreadByCase);
```

и в `<QueueTileCard ... />` добавить:

```tsx
              unreadLabel={tile.unread > 0 ? t("queues.unread", { count: tile.unread }) : null}
```

- [ ] **Step 7: Значок в строке списка дел**

В `src/components/admin/case-row.tsx` добавить проп `unreadLabel: string | null` и
вывести его рядом со статусом:

```tsx
      {unreadLabel ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
          🔔 {unreadLabel}
        </span>
      ) : null}
```

- [ ] **Step 8: Посчитать непрочитанное в списке очереди**

В `src/app/[locale]/admin/queues/[queue]/page.tsx` после запроса `cases`:

```tsx
  const unreadRows = await prisma.caseMessage.groupBy({
    by: ["caseId"],
    where: { caseId: { in: cases.map((c) => c.id) }, side: "APPLICANT", readByStaffAt: null },
    _count: { _all: true },
  });
  const unreadByCase = new Map(unreadRows.map((r) => [r.caseId, r._count._all]));
```

и в `<CaseRowCard ... />`:

```tsx
                unreadLabel={
                  unreadByCase.get(c.id) ? t("queues.unread", { count: unreadByCase.get(c.id)! }) : null
                }
```

- [ ] **Step 9: Прогнать тесты и типы**

Run: `npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -5`
Expected: пусто от tsc; все тесты PASS

- [ ] **Step 10: Коммит**

```bash
git add src/lib/cases/queues.ts src/components/admin/queue-tile.tsx src/components/admin/case-row.tsx 'src/app/[locale]/admin/queues' tests/case-queues.test.ts
git commit -m "feat(admin): значок непрочитанного на плитке очереди и в списке дел"
```

---

### Task 12: Колокольчик в шапке админки

**Files:**
- Create: `src/components/admin/admin-bell.tsx`
- Create: `src/app/[locale]/admin/notifications/page.tsx`
- Modify: `src/components/admin/nav.tsx`

- [ ] **Step 1: Написать колокольчик**

```tsx
// src/components/admin/admin-bell.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";

/**
 * Колокольчик живёт в полосе закладок админки — там, где он виден на любом
 * экране. Раскрывающегося списка нет: нажатие ведёт на страницу уведомлений,
 * и это одинаково работает пальцем и мышью.
 */
export async function AdminBell({ locale }: { locale: string }) {
  const admin = await checkAdmin();
  if (!admin.ok) return null;
  const t = await getTranslations("admin.bell");
  const count = await prisma.adminNotification.count({
    where: { userId: admin.userId, readAt: null },
  });

  return (
    <Link
      href={`/${locale}/admin/notifications`}
      title={t("title")}
      className="ml-auto flex h-11 shrink-0 items-center gap-1.5 self-center rounded-full border border-hairline px-3 text-[13px] font-semibold hover:border-accent/60"
    >
      🔔
      {count > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-accent-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
```

- [ ] **Step 2: Поставить колокольчик в полосу закладок**

В `src/components/admin/nav.tsx` обернуть содержимое: добавить импорт
`import { AdminBell } from "./admin-bell";` и в разметке внутри `<div className="flex overflow-x-auto ...">`
после `{TABS.map(...)}` добавить:

```tsx
        <AdminBell locale={locale} />
```

- [ ] **Step 3: Написать страницу уведомлений**

```tsx
// src/app/[locale]/admin/notifications/page.tsx
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { AdminNav } from "@/components/admin/nav";
import { NotificationsReadMarker } from "@/components/admin/notifications-read-marker";
import { ADMIN_BUTTON_SECONDARY, ADMIN_COLUMN } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.bell");
  const admin = await checkAdmin();
  if (!admin.ok) return null; // до сюда не доходит: гейт стоит в admin/layout.tsx

  const rows = await prisma.adminNotification.findMany({
    where: { userId: admin.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = rows.filter((r) => !r.readAt).length;

  const time = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={ADMIN_COLUMN}>
      <AdminNav locale={locale} active="queues" />
      {unread > 0 ? <NotificationsReadMarker /> : null}
      <header className="mb-6 text-center">
        <h1 className="text-[26px] font-bold tracking-[-0.03em]">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("subtitle", { count: unread })}</p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-[20px] border border-hairline bg-card p-8 text-center text-muted">
          {t("empty")}
        </div>
      ) : (
        <ul className="flex flex-col gap-3 pb-10">
          {rows.map((n) => (
            <li
              key={n.id}
              className={`rounded-[18px] border bg-card p-4 ${
                n.readAt ? "border-hairline" : "border-accent/45"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted">
                <span className="font-semibold">{t(`kinds.${n.kind}`)}</span>
                <span>{time.format(n.createdAt)}</span>
              </div>
              <div className="text-[14px] font-semibold leading-tight">{n.title}</div>
              {n.body ? <p className="mt-1 text-[12px] text-muted">{n.body}</p> : null}
              {n.caseId ? (
                <Link href={`/${locale}/admin/cases/${n.caseId}`} className={`${ADMIN_BUTTON_SECONDARY} mt-3`}>
                  {t("open")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Написать гашение колокольчиков**

```tsx
// src/components/admin/notifications-read-marker.tsx
"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/actions/case-messages";

/** Список открыли — колокольчики погасли. Как и в нитке, из эффекта. */
export function NotificationsReadMarker() {
  useEffect(() => {
    void markNotificationsRead();
  }, []);
  return null;
}
```

- [ ] **Step 5: Проверить типы**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: пусто

- [ ] **Step 6: Коммит**

```bash
git add src/components/admin/admin-bell.tsx src/components/admin/notifications-read-marker.tsx src/components/admin/nav.tsx 'src/app/[locale]/admin/notifications'
git commit -m "feat(admin): колокольчик в шапке и страница уведомлений"
```

---

### Task 13: Переписка на стороне заявителя

**Files:**
- Create: `src/components/cabinet/cases-section.tsx`
- Create: `src/app/[locale]/cabinet/cases/[id]/page.tsx`
- Modify: `src/app/[locale]/cabinet/page.tsx`
- Modify: `src/app/[locale]/business/page.tsx`

- [ ] **Step 1: Написать раздел кабинета**

```tsx
// src/components/cabinet/cases-section.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { unreadCount } from "@/lib/cases/messages";

/**
 * «Ваши заявки» — вход в переписку со стороны заявителя. Раздел стоит и в
 * /cabinet, и в /business: аккаунт типа COMPANY в кабинет не попадает вовсе,
 * а дела у него есть.
 *
 * Права намеренно узкие: нитку видит тот, кто подал (`applicantUserId`).
 * Сотрудник компании-редактор переписку владельца не читает — расширять это
 * будем, когда появится явное требование.
 */
export async function CasesSection({ locale, userId }: { locale: string; userId: string }) {
  const t = await getTranslations("cabinet.cases");

  const cases = await prisma.complianceCase.findMany({
    where: { applicantUserId: userId },
    orderBy: { updatedAt: "desc" },
    take: 25,
    include: {
      messages: { select: { side: true, readByStaffAt: true, readByApplicantAt: true } },
    },
  });
  if (cases.length === 0) return null;

  return (
    <section id="cases" className="space-y-6">
      <h2 className="text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h2>
      <p className="text-muted">{t("subtitle")}</p>
      <ul className="flex flex-col gap-3">
        {cases.map((c) => {
          const unread = unreadCount(c.messages, "APPLICANT");
          return (
            <li key={c.id}>
              <Link
                href={`/${locale}/cabinet/cases/${c.id}`}
                className="flex min-h-12 items-center justify-between gap-3 rounded-[16px] border border-hairline bg-card p-4 hover:border-accent/60"
              >
                <span>
                  <b className="block text-[14px] font-semibold leading-tight">{c.title}</b>
                  <span className="text-[11.5px] text-muted">{t(`status.${c.status}`)}</span>
                </span>
                {unread > 0 ? (
                  <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold text-accent-foreground">
                    {t("unread", { count: unread })}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Написать страницу нитки заявителя**

```tsx
// src/app/[locale]/cabinet/cases/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { CaseThread } from "@/components/cases/case-thread";
import { CaseComposer } from "@/components/cases/case-composer";
import { CaseReadMarker } from "@/components/cases/case-read-marker";
import { parseAttachments } from "@/lib/cases/attachments";
import { unreadCount } from "@/lib/cases/messages";

export const dynamic = "force-dynamic";

export default async function CabinetCasePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const me = (session?.user as { id?: string } | undefined)?.id;
  if (!me) redirect(`/${locale}/login?next=/${locale}/cabinet/cases/${id}`);

  const c = await prisma.complianceCase.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { name: true, username: true } } },
      },
    },
  });
  // Чужое дело — notFound, а не «нет прав»: существование заявки не наше дело
  // рассказывать постороннему.
  if (!c || c.applicantUserId !== me) notFound();

  const t = await getTranslations("cabinet.cases");
  const tThread = await getTranslations("admin.case.thread");
  const unread = unreadCount(c.messages, "APPLICANT");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 md:py-16">
      {unread > 0 ? <CaseReadMarker caseId={c.id} /> : null}
      <header>
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">{t("title")}</div>
        <h1 className="mb-1 text-[26px] font-bold tracking-[-0.03em]">{c.title}</h1>
        <p className="text-muted">{t(`status.${c.status}`)}</p>
      </header>

      <CaseThread
        caseId={c.id}
        locale={locale}
        mySide="APPLICANT"
        messages={c.messages.map((m) => ({
          id: m.id,
          side: m.side,
          body: m.body,
          attachments: parseAttachments(m.attachments),
          createdAt: m.createdAt,
          authorName: m.author?.name ?? m.author?.username ?? null,
        }))}
        staffLabel={tThread("staff")}
        applicantLabel={tThread("applicant")}
        emptyLabel={tThread("empty")}
      />

      <CaseComposer
        caseId={c.id}
        side="APPLICANT"
        labels={{
          placeholder: t("placeholder"),
          send: t("send"),
          needsReply: "",
          templates: "",
          attach: tThread("attach"),
          attaching: tThread("attaching"),
          attached: tThread("attached", { count: 0 }).replace("0", "{count}"),
          errors: {
            empty: tThread("errors.empty"),
            too_long: tThread("errors.too_long"),
            too_large: tThread("errors.too_large"),
            bad_type: tThread("errors.bad_type"),
            failed: tThread("errors.failed"),
            forbidden: tThread("errors.failed"),
            unauth: tThread("errors.failed"),
            not_found: tThread("errors.failed"),
          },
        }}
      />
    </main>
  );
}
```

- [ ] **Step 3: Вставить раздел в кабинет**

В `src/app/[locale]/cabinet/page.tsx` добавить импорт
`import { CasesSection } from "@/components/cabinet/cases-section";`
и в разметке перед `<CompaniesSection ... />`:

```tsx
      <CasesSection locale={locale} userId={user.id} />
```

- [ ] **Step 4: Вставить раздел в кабинет предприятия**

В `src/app/[locale]/business/page.tsx` добавить тот же импорт и поставить
`<CasesSection locale={locale} userId={<id вошедшего>} />` в конец основной разметки
страницы (имя переменной с id взять из уже существующего кода страницы — там
читается сессия). Аккаунт типа COMPANY в `/cabinet` не попадает, а дела у него есть.

- [ ] **Step 5: Проверить типы и прогнать тесты**

Run: `npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -5`
Expected: пусто от tsc; все тесты PASS

- [ ] **Step 6: Коммит**

```bash
git add src/components/cabinet/cases-section.tsx 'src/app/[locale]/cabinet' 'src/app/[locale]/business/page.tsx'
git commit -m "feat(cabinet): переписка по заявке на стороне заявителя"
```

---

### Task 14: Прогон сроков в воркере

**Files:**
- Create: `src/lib/cases/due-sweep.ts`
- Modify: `worker/index.ts`
- Test: `tests/case-notifications.test.ts` (дополнить)

- [ ] **Step 1: Написать падающий тест на выборку повода**

Добавить в `tests/case-notifications.test.ts`:

```ts
import { alreadyRaised } from "@/lib/cases/notifications";

describe("alreadyRaised", () => {
  it("тот же повод по тому же делу второй раз не звонит", () => {
    const seen = new Set(["u1|DUE_SOON|c1"]);
    expect(alreadyRaised(seen, "u1", "DUE_SOON", "c1")).toBe(true);
  });

  it("другой повод или другое дело — звонит", () => {
    const seen = new Set(["u1|DUE_SOON|c1"]);
    expect(alreadyRaised(seen, "u1", "CASE_OVERDUE", "c1")).toBe(false);
    expect(alreadyRaised(seen, "u1", "DUE_SOON", "c2")).toBe(false);
    expect(alreadyRaised(seen, "u2", "DUE_SOON", "c1")).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npx vitest run tests/case-notifications.test.ts`
Expected: FAIL — `"alreadyRaised" is not exported`

- [ ] **Step 3: Добавить `alreadyRaised`**

В конец `src/lib/cases/notifications.ts`:

```ts
/**
 * Ключ «этот повод по этому делу уже звонил». Проверяется по всем звонкам, а не
 * только непрочитанным: прочитанный DUE_SOON не должен звонить каждый час снова.
 */
export function raisedKey(userId: string, kind: AdminNotificationKind, caseId: string): string {
  return `${userId}|${kind}|${caseId}`;
}

export function alreadyRaised(
  seen: Set<string>,
  userId: string,
  kind: AdminNotificationKind,
  caseId: string,
): boolean {
  return seen.has(raisedKey(userId, kind, caseId));
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/case-notifications.test.ts`
Expected: PASS

- [ ] **Step 5: Написать прогон**

```ts
// src/lib/cases/due-sweep.ts
import type { PrismaClient } from "@prisma/client";
import { raiseAndNotify } from "./admin-notify";
import { alreadyRaised, dueNotificationFor, raisedKey } from "./notifications";
import { OPEN_STATUSES } from "./types";

export type DueSweepStats = { checked: number; raised: number; skipped: number };

/**
 * Часовой прогон сроков. Он нужен потому, что часы срока — не событие: никто
 * не «нажимает» просрочку, её надо заметить самому.
 *
 * Дела без взявшего пропускаются (см. dueNotificationFor): безадресный звонок
 * будил бы всех админов по каждому делу.
 */
export async function runCaseDueSweep(
  db: Pick<PrismaClient, "complianceCase" | "caseMessage" | "adminNotification">,
  now: Date = new Date(),
): Promise<DueSweepStats> {
  const cases = await db.complianceCase.findMany({
    where: { status: { in: OPEN_STATUSES }, assigneeId: { not: null } },
    select: { id: true, title: true, status: true, assigneeId: true, dueAt: true, clockStoppedAt: true },
    take: 500,
  });
  if (cases.length === 0) return { checked: 0, raised: 0, skipped: 0 };

  const ids = cases.map((c) => c.id);

  // Последнее наше сообщение по делу — отсчёт молчания заявителя.
  const lastStaff = new Map<string, Date>();
  const msgs = await db.caseMessage.findMany({
    where: { caseId: { in: ids }, side: "STAFF" },
    select: { caseId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const m of msgs) lastStaff.set(m.caseId, m.createdAt);

  const raisedRows = await db.adminNotification.findMany({
    where: { caseId: { in: ids } },
    select: { userId: true, kind: true, caseId: true },
  });
  const seen = new Set(raisedRows.map((r) => raisedKey(r.userId, r.kind, r.caseId ?? "")));

  let raised = 0;
  let skipped = 0;
  for (const c of cases) {
    const kind = dueNotificationFor(
      {
        status: c.status,
        assigneeId: c.assigneeId,
        dueAt: c.dueAt,
        clockStoppedAt: c.clockStoppedAt,
        lastStaffMessageAt: lastStaff.get(c.id) ?? null,
      },
      now,
    );
    if (!kind || !c.assigneeId) continue;
    if (alreadyRaised(seen, c.assigneeId, kind, c.id)) {
      skipped += 1;
      continue;
    }
    await raiseAndNotify({ userId: c.assigneeId, kind, caseId: c.id, title: c.title });
    seen.add(raisedKey(c.assigneeId, kind, c.id));
    raised += 1;
  }

  return { checked: cases.length, raised, skipped };
}
```

- [ ] **Step 6: Включить прогон в воркер**

В `worker/index.ts` добавить импорт рядом с остальными `@/lib` импортами:

```ts
import { runCaseDueSweep } from "@/lib/cases/due-sweep";
```

Рядом с `runRevisionExpiry` (строка ~230) добавить обёртку:

```ts
async function runCaseDueJob() {
  const t0 = Date.now();
  try {
    const stats = await runCaseDueSweep(prisma);
    if (stats.raised > 0) {
      console.log(
        `[worker] case due sweep ok: ${stats.raised} raised, ${stats.skipped} already known, ${stats.checked} checked in ${Date.now() - t0}ms`,
      );
    }
  } catch (err) {
    console.error("[worker] case due sweep failed:", err);
  }
}
```

И в блок расписаний рядом с `cron.schedule("50 * * * *", ...)`:

```ts
  // Сроки дел — раз в час. Просрочка не событие: её надо заметить самому.
  cron.schedule("10 * * * *", () => void runCaseDueJob());
```

- [ ] **Step 7: Проверить прогон вживую (ничего не должно зазвенеть)**

Run: `npx tsx -e "import {prisma} from './src/lib/prisma'; import {runCaseDueSweep} from './src/lib/cases/due-sweep'; runCaseDueSweep(prisma).then(s=>console.log(s)).then(()=>process.exit(0))"`
Expected: объект вида `{ checked: 0, raised: 0, skipped: 0 }` — у дел посева нет взявшего, звонить некому

- [ ] **Step 8: Прогнать тесты и типы**

Run: `npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -5`
Expected: пусто от tsc; все тесты PASS

- [ ] **Step 9: Коммит**

```bash
git add src/lib/cases/due-sweep.ts src/lib/cases/notifications.ts tests/case-notifications.test.ts worker/index.ts
git commit -m "feat(cases): часовой прогон сроков — звонки за сутки, по просрочке и по молчанию"
```

---

### Task 15: Переводы, сборка, выкатка

**Files:**
- Modify: все `messages/*.json` (через скрипт)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Перевести новые ключи**

Правка `messages/en.json` без перевода выходит на сайт по-английски.

Run: `npm run i18n`
Expected: прогон по всем локалям из `SUPPORTED_LOCALES`, в конце без ошибок

- [ ] **Step 2: Проверить границу локалей**

Run: `npx vitest run tests/messages-parity.test.ts`
Expected: PASS

- [ ] **Step 3: Прогнать весь набор тестов**

Run: `npm test 2>&1 | tail -15`
Expected: все файлы PASS, ни одного failed

- [ ] **Step 4: Собрать**

Run: `npm run build 2>&1 | tail -20`
Expected: `✓ Compiled successfully`, в списке маршрутов видны
`/[locale]/admin/notifications`, `/[locale]/cabinet/cases/[id]`, `/api/case-attachment/...`

- [ ] **Step 5: Перезапустить веб и воркер**

`src/lib/cases/*` импортируется воркером, поэтому одного веба не хватит: на `tsx`
воркер прибивает исходники библиотек при старте.

```bash
pm2 restart trientes-web trientes-worker && pm2 save && pm2 status
```
Expected: оба процесса `online`

- [ ] **Step 6: Живая проверка снаружи**

```bash
curl -s -o /dev/null -w '%{http_code} queues\n' https://trientes.org/ru/admin/queues
curl -s -o /dev/null -w '%{http_code} attachment-unauth\n' https://trientes.org/api/case-attachment/zzz/0123456789abcdef01234567.pdf
curl -s -o /dev/null -w '%{http_code} attachment-badname\n' https://trientes.org/api/case-attachment/zzz/..%2F..%2Fetc%2Fpasswd
```
Expected: `307` или `200` у очередей (без сеанса — перенаправление на вход),
`401` у вложения без сеанса, `400` у негодного имени

- [ ] **Step 7: Живая проверка цепочки руками (в браузере)**

Пройти и записать результат:
1. Админом открыть любое дело из `/ru/admin/queues` → взять в работу → написать заявителю с флажком «нужен ответ» → статус стал «ждём заявителя», в журнале появились три записи (сообщение, смена статуса, часы встали), у карточки срока точка посерела.
2. Войти заявителем (или посмотреть `/ru/cabinet` его записью) → в разделе «Ваши заявки» видно дело со значком нового → открыть нитку → сообщение на месте.
3. Ответить заявителем, приложив pdf → у дела статус вернулся в «в работе», часы пошли, `dueAt` сдвинулся на простой.
4. Админом открыть `/ru/admin/queues` → на плитке очереди оранжевый значок с числом; в шапке колокольчик с единицей; открыть дело → значок погас, вложение открывается, а в приватном режиме без сеанса тот же адрес отдаёт 401.

- [ ] **Step 8: Описать слайс в `CLAUDE.md`**

В раздел «Phase 11 — Админка как управление делами (слайс AN)» добавить подраздел
про AO: живые адреса (`/{locale}/admin/notifications`, `/{locale}/cabinet/cases/[id]`),
решения из шапки этого плана (приватный корень вложений и почему; непрочитанное по
стороне; флажок «нужен ответ» и почему без него срок замерзает; звонок про молчание
заявителя на 14 дней; заготовки на языке заявителя; слова статуса для заявителя
другие), миграция `20261117190000_case_messaging`, прогон воркера `10 * * * *`,
новая переменная `CASE_ATTACHMENTS_ROOT` и каталог `/var/www/trientes-private/cases`
(его надо воссоздать при переносе на другую машину — как `trientes-uploads`),
и сдвинуть «Что дальше» на AP.

- [ ] **Step 9: Коммит и отправка**

```bash
git add messages CLAUDE.md
git commit -m "docs: слайс AO в CLAUDE.md, переводы переписки"
git push origin main
```
Expected: `main -> main`

---

## Самопроверка плана

**Покрытие спеки (раздел «Переписка (портал RFI)» и «Уведомления внутри админки»):**

| Требование спеки | Где сделано |
|---|---|
| Одна нитка на дело, слева заявитель, справа мы | Task 9 (`case-thread.tsx`), Task 10 |
| Вложения прямо в сообщении | Task 3, 7, 9 — с сознательным отходом: приватный корень (решение 1) |
| Сотрудник пишет из дела | Task 10 |
| Заявитель — из кабинета / `/business` | Task 13 |
| Заготовки в одно нажатие (4 штуки) | Task 2 (`TEMPLATE_KEYS`), Task 8, Task 9, Task 10 |
| Отправка переводит в `WAITING_APPLICANT` и останавливает часы | Task 2, Task 6 |
| Ответ возвращает в `IN_REVIEW` и запускает часы | Task 2, Task 6 |
| Заявителю уходит `notifyUser` | Task 5 (`notify-applicant.ts`) |
| Непрочитанные по стороне, значок на плитке очереди и на деле | Task 2, 10, 11 |
| `AdminNotification` + колокольчик с числом в шапке | Task 1, 5, 12 |
| Поводы: заявитель ответил, срок подходит | Task 6 (ответ), Task 14 (срок, просрочка, молчание) |
| Дубль в Telegram | Task 5 (`raiseAndNotify` → `notifyUser`) |
| Правила вида: действие — кнопка 48 px во всю ширину, колонка по центру | Task 9, 12, 13 — через `ADMIN_BUTTON`, `ADMIN_COLUMN` |

Поводы «назначили на тебя дело» и «попросили вторую подпись» в этом слайсе не
реализуются: назначение сейчас самообслуживание (сотрудник берёт дело сам, звонить
ему о собственном действии бессмысленно), а вторая подпись появляется только в AP
вместе с правилом четырёх глаз. Повод «пришла жалоба на точку» — слайс AQ.

**Плейсхолдеры:** в шагах нет «TBD», «аналогично задаче N» и шагов без кода. Исключение
одно и намеренное — Task 13 Step 4: имя переменной с id вошедшего берётся из
существующего кода `business/page.tsx`, потому что выдумывать его в плане хуже, чем
прочитать на месте.

**Согласованность типов:** `unreadCount(messages, side)` всюду зовётся с `ReadFlags[]`
(`side`, `readByStaffAt`, `readByApplicantAt`) — Task 10, 11, 13 передают ровно эти поля.
`buildTiles(rows, now, unreadByCase?)` — третий параметр необязательный, поэтому старые
вызовы в тесте `case-queues.test.ts` продолжают работать, но `CaseRow` получил `id`,
и потому Task 11 Step 1 переписывает строки теста с ним. `parseAttachments` возвращает
`Attachment[]`, его же ждёт `ThreadMessage.attachments`. `dueNotificationFor` возвращает
`AdminNotificationKind | null` — то же перечисление, что у `raiseAndNotify.kind`.
