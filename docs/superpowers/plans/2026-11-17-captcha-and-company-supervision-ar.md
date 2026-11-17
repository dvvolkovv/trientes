# Капча «Соберите знак» + надзор над предприятием (AR) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть три анонимные двери сайта подписанной одноразовой капчей со
знаком Trientes и дать админке экран надзора над залистованным предприятием
(предупреждение, приостановка, периодический пересмотр), попутно закрыв дыру
«статус компании не смотрит никто».

**Architecture:** капча — чистая геометрия (`src/lib/captcha.ts`) + подпись и
одноразовость в Redis (`src/lib/captcha-store.ts`) + клиентский компонент на
маске CSS; три маршрута зовут один `requireCaptcha(req, body)`. Надзор — те же
компоненты и те же доводы, что у надзора над точкой в AQ: поле `suspendedAt` у
`Company`, события в неизменяемом журнале дела, адресный колокольчик, суточный
прогон в воркере. Видимость компании — один фрагмент условия на все выборки.

**Tech Stack:** Next.js (App Router, server actions), Prisma/PostgreSQL, ioredis,
next-intl, vitest, PM2 (`trientes-web` + `trientes-worker`).

---

## Файлы

**Капча**

- Create `src/lib/captcha.ts` — чистое: поле, допуск, разбор и сборка токена, решение.
- Create `src/lib/captcha-store.ts` — HMAC-подпись, Redis-одноразовость, выдача/проверка.
- Create `src/app/api/captcha/route.ts` — `GET`: вошедшему `{needed:false}`, анониму задача.
- Create `src/components/captcha/mark-captcha.tsx` — клиентский компонент.
- Create `public/captcha-mark.png` — обрезанный по глифу знак (из `public/logo.png`).
- Modify `src/components/register-form.tsx`, `src/components/forgot-password-form.tsx`,
  `src/components/coin-detail/poi-report-dialog.tsx` — вставка капчи.
- Modify `src/app/api/auth/password/register/route.ts`,
  `src/app/api/auth/password/forgot/route.ts`,
  `src/app/api/point-report/route.ts` — проверка.
- Create `tests/captcha.test.ts`.

**Надзор**

- Modify `prisma/schema.prisma` + Create `prisma/migrations/20261118100000_company_supervision/migration.sql`.
- Create `src/lib/company-visibility.ts` — фрагменты условий + `companyReviewDue`/`nextReviewAt`.
- Create `src/lib/cases/company-review-sweep.ts` — суточный прогон.
- Create `src/app/actions/company-supervision.ts` — предупредить / приостановить / вернуть / пересмотр пройден.
- Create `src/app/[locale]/admin/companies/[id]/page.tsx` — экран.
- Create `src/components/admin/company-supervision.tsx` — кнопки с причиной.
- Modify `src/lib/company-points.ts`, `src/app/[locale]/services/page.tsx`,
  `src/app/[locale]/companies/page.tsx`, `src/app/[locale]/companies/[id]/page.tsx`,
  `src/lib/coin-card-public.ts` (+ прочие публичные выборки карточек) — видимость.
- Modify `src/lib/cases/decide.ts` — `nextReviewAt` при одобрении компании.
- Modify `src/lib/cases/journal.ts`, `src/lib/cases/admin-notify.ts` — новые виды.
- Modify `worker/index.ts` — `35 5 * * *`.
- Create `tests/company-visibility.test.ts`, `tests/company-review.test.ts`.

**Языки**

- Modify `messages/en.json` (+ `npm run i18n`).

---

## Task 1: Знак для капчи

**Files:**
- Create: `public/captcha-mark.png`
- Create: `scripts/make-captcha-mark.ts`

- [ ] **Step 1: Написать скрипт обрезки**

`public/logo.png` — белый глиф на полупрозрачном круге 152×152. Для капчи нужен
только глиф: круг в маске дал бы прямоугольное пятно вместо знака.

```ts
// scripts/make-captcha-mark.ts
// Знак для капчи = глиф из public/logo.png без круглой подложки.
// Маска CSS читает альфу, поэтому полупрозрачный круг пришлось бы вырезать
// порогом: всё, что ниже 200, — фон.
import sharp from "sharp";

const THRESHOLD = 200;

async function main() {
  const src = sharp("public/logo.png");
  const { width, height } = await src.metadata();
  if (!width || !height) throw new Error("no size");
  const { data } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height * 4);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    const keep = a >= THRESHOLD;
    out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255;
    out[i * 4 + 3] = keep ? 255 : 0;
    if (keep) {
      const x = i % width, y = Math.floor(i / width);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("empty glyph");
  await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toFile("public/captcha-mark.png");
  console.log("captcha-mark", maxX - minX + 1, "x", maxY - minY + 1);
}

void main();
```

- [ ] **Step 2: Прогнать и посмотреть глазами**

Run: `npx tsx scripts/make-captcha-mark.ts`
Expected: `captcha-mark <w> x <h>` с отношением сторон около 1,4 : 1.

- [ ] **Step 3: Commit**

```bash
git add scripts/make-captcha-mark.ts public/captcha-mark.png
git commit -m "feat(captcha): знак Trientes как маска для капчи"
```

---

## Task 2: Чистая часть капчи

**Files:**
- Create: `src/lib/captcha.ts`
- Test: `tests/captcha.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
// tests/captcha.test.ts
import { describe, expect, it } from "vitest";
import {
  CAPTCHA_STAGE,
  CAPTCHA_TOLERANCE,
  MIN_SOLVE_MS,
  MAX_AGE_MS,
  isSolved,
  newGeometry,
  checkTiming,
} from "@/lib/captcha";

describe("captcha geometry", () => {
  it("точка сборки каждый раз новая и внутри поля", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const g = newGeometry();
      seen.add(`${Math.round(g.home.x)}:${Math.round(g.home.y)}`);
      expect(g.home.x).toBeGreaterThanOrEqual(0);
      expect(g.home.y).toBeGreaterThanOrEqual(0);
      expect(g.home.x + g.mark.w).toBeLessThanOrEqual(CAPTCHA_STAGE.w);
      expect(g.home.y + g.mark.h).toBeLessThanOrEqual(CAPTCHA_STAGE.h);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it("вынутая часть начинается далеко от места", () => {
    for (let i = 0; i < 50; i++) {
      const g = newGeometry();
      const d = Math.hypot(g.start.x - g.home.x, g.start.y - g.home.y);
      expect(d).toBeGreaterThan(CAPTCHA_TOLERANCE * 3);
    }
  });

  it("решение принимается в пределах допуска", () => {
    const home = { x: 100, y: 50 };
    expect(isSolved(home, { x: 100, y: 50 })).toBe(true);
    expect(isSolved(home, { x: 100 + CAPTCHA_TOLERANCE - 1, y: 50 })).toBe(true);
    expect(isSolved(home, { x: 100 + CAPTCHA_TOLERANCE + 2, y: 50 })).toBe(false);
    expect(isSolved(home, { x: 100, y: 50 + CAPTCHA_TOLERANCE + 2 })).toBe(false);
  });

  it("мгновенный ответ не принимается, просроченный тоже", () => {
    const issued = 1_000_000;
    expect(checkTiming(issued, issued + MIN_SOLVE_MS - 1)).toBe("captcha_too_fast");
    expect(checkTiming(issued, issued + MIN_SOLVE_MS + 1)).toBe(null);
    expect(checkTiming(issued, issued + MAX_AGE_MS + 1)).toBe("captcha_expired");
    // Часы клиента и сервера не совпадают: будущее тоже просрочка, а не минус.
    expect(checkTiming(issued, issued - 5_000)).toBe("captcha_expired");
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run tests/captcha.test.ts`
Expected: FAIL — `Cannot find module '@/lib/captcha'`.

- [ ] **Step 3: Написать модуль**

```ts
// src/lib/captcha.ts
/**
 * Капча «Соберите знак»: чистая геометрия, без Redis и без подписи.
 *
 * Поле — условные единицы (320×190), клиент масштабирует их под свою ширину.
 * Единицы, а не пиксели: на телефоне и на компьютере задача должна быть одна и
 * та же, иначе допуск в пикселях означал бы разную строгость.
 */

export const CAPTCHA_STAGE = { w: 320, h: 190 } as const;
/** Размер знака на поле. Отношение сторон — у public/captcha-mark.png. */
export const CAPTCHA_MARK = { w: 132, h: 94.6 } as const;
/** Допуск попадания. */
export const CAPTCHA_TOLERANCE = 13;
/** Быстрее этого человек не успевает прочитать задачу и дотянуть часть. */
export const MIN_SOLVE_MS = 800;
/** Задача живёт пять минут. */
export const MAX_AGE_MS = 5 * 60 * 1000;

export type Point = { x: number; y: number };

export type Geometry = {
  stage: { w: number; h: number };
  mark: { w: number; h: number };
  /** Куда должна встать вынутая часть. */
  home: Point;
  /** Где она лежит в начале. */
  start: Point;
  /** Где проходит разрез (доли высоты знака). */
  cut: { top: number; bottom: number };
};

/** Разрез по швам знака: рога с крышей, средняя галочка, нижняя дуга. */
const CUT = { top: 0.45, bottom: 0.28 } as const;

export function newGeometry(random: () => number = Math.random): Geometry {
  const maxX = CAPTCHA_STAGE.w - CAPTCHA_MARK.w;
  const maxY = CAPTCHA_STAGE.h - CAPTCHA_MARK.h;
  // Точка сборки гуляет по полю: записанный ответ не переиспользовать.
  const home = {
    x: Math.round(maxX * (0.2 + random() * 0.6)),
    y: Math.round(maxY * (0.2 + random() * 0.6)),
  };
  const side = random() < 0.5 ? -1 : 1;
  const dx = side * (CAPTCHA_TOLERANCE * 5 + random() * 30);
  const dy = (random() - 0.5) * CAPTCHA_TOLERANCE * 4;
  const start = {
    x: Math.round(Math.min(Math.max(home.x + dx, 0), maxX)),
    y: Math.round(Math.min(Math.max(home.y + dy, 0), maxY)),
  };
  // Если край поля подтянул часть обратно к месту, отодвигаем её в другую сторону.
  if (Math.hypot(start.x - home.x, start.y - home.y) <= CAPTCHA_TOLERANCE * 3) {
    start.x = Math.round(home.x - dx < 0 || home.x - dx > maxX ? (home.x > maxX / 2 ? 0 : maxX) : home.x - dx);
  }
  return { stage: { ...CAPTCHA_STAGE }, mark: { ...CAPTCHA_MARK }, home, start, cut: { ...CUT } };
}

export function isSolved(home: Point, at: Point): boolean {
  return (
    Math.abs(home.x - at.x) <= CAPTCHA_TOLERANCE && Math.abs(home.y - at.y) <= CAPTCHA_TOLERANCE
  );
}

/** Возвращает код отказа или null. */
export function checkTiming(issuedAtMs: number, nowMs: number): string | null {
  const age = nowMs - issuedAtMs;
  if (age < 0 || age > MAX_AGE_MS) return "captcha_expired";
  if (age < MIN_SOLVE_MS) return "captcha_too_fast";
  return null;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/captcha.test.ts`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add src/lib/captcha.ts tests/captcha.test.ts
git commit -m "feat(captcha): геометрия задачи и правила приёма"
```

---

## Task 3: Подпись и одноразовость

**Files:**
- Create: `src/lib/captcha-store.ts`
- Modify: `tests/captcha.test.ts`

- [ ] **Step 1: Дописать падающий тест**

Добавить в `tests/captcha.test.ts`:

```ts
import { packToken, parseToken, signToken } from "@/lib/captcha-store";

describe("captcha token", () => {
  const secret = "test-secret";
  const base = { nonce: "abcdef", issuedAt: 1_700_000_000_000, ipHash: "ip1", home: { x: 42, y: 17 } };

  it("своя подпись читается обратно", () => {
    const token = packToken(base, secret);
    const parsed = parseToken(token, secret);
    expect(parsed).toEqual(base);
  });

  it("подделанная точка сборки не читается", () => {
    const token = packToken(base, secret);
    const [nonce, issued, ip, , y, sig] = token.split(".");
    const forged = [nonce, issued, ip, "0", y, sig].join(".");
    expect(parseToken(forged, secret)).toBe(null);
  });

  it("чужой ключ не читается", () => {
    expect(parseToken(packToken(base, secret), "other-secret")).toBe(null);
  });

  it("мусор не роняет разбор", () => {
    expect(parseToken("", secret)).toBe(null);
    expect(parseToken("a.b.c", secret)).toBe(null);
  });

  it("подпись устойчива к длине полей", () => {
    // Склейка через точку без разделителя дала бы одну подпись двум разным
    // задачам: ("ab","c") и ("a","bc").
    const a = signToken({ ...base, nonce: "ab", ipHash: "c" }, secret);
    const b = signToken({ ...base, nonce: "a", ipHash: "bc" }, secret);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run tests/captcha.test.ts`
Expected: FAIL — `Cannot find module '@/lib/captcha-store'`.

- [ ] **Step 3: Написать модуль**

```ts
// src/lib/captcha-store.ts
/**
 * Подпись задачи и её одноразовость.
 *
 * Задача не секрет: точка сборки нарисована на экране, значит известна и
 * роботу, читающему DOM. Подпись защищает не от решения, а от выдумывания
 * задачи и от повтора: выдана сервером, тому же адресу, не старше пяти минут,
 * предъявлена один раз.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";
import { MAX_AGE_MS, newGeometry, type Geometry, type Point } from "@/lib/captcha";

export type TokenPayload = {
  nonce: string;
  issuedAt: number;
  ipHash: string;
  home: Point;
};

function secretKey(): string {
  return (
    process.env.CAPTCHA_SECRET ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    "trientes-captcha-dev"
  );
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`captcha:${ip}`).digest("hex").slice(0, 16);
}

export function signToken(p: TokenPayload, secret: string): string {
  // Длины полей в подписи: иначе склейка ("ab","c") и ("a","bc") дала бы одну
  // и ту же строку под подписью.
  const body = [p.nonce, String(p.issuedAt), p.ipHash, String(p.home.x), String(p.home.y)]
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function packToken(p: TokenPayload, secret: string = secretKey()): string {
  return [p.nonce, p.issuedAt, p.ipHash, p.home.x, p.home.y, signToken(p, secret)].join(".");
}

export function parseToken(token: string, secret: string = secretKey()): TokenPayload | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 6) return null;
  const [nonce, issuedRaw, ipHash, xRaw, yRaw, sig] = parts;
  const issuedAt = Number(issuedRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const payload: TokenPayload = { nonce, issuedAt, ipHash, home: { x, y } };
  const expected = signToken(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

const KEY = (nonce: string) => `captcha:${nonce}`;

/** Выдать задачу: геометрия + подписанный токен + строка в Redis. */
export async function issueChallenge(ip: string): Promise<Geometry & { token: string }> {
  const g = newGeometry();
  const payload: TokenPayload = {
    nonce: randomBytes(9).toString("base64url"),
    issuedAt: Date.now(),
    ipHash: hashIp(ip),
    home: g.home,
  };
  try {
    await redis.set(KEY(payload.nonce), "1", "PX", MAX_AGE_MS);
  } catch (err) {
    // Redis лёг — задача остаётся подписанной и срочной, но перестаёт быть
    // одноразовой. Запереть дверь было бы хуже: никто не зарегистрируется.
    console.warn("[captcha] store unavailable on issue", err);
  }
  return { ...g, token: packToken(payload) };
}

/** Погасить задачу. `true` — она была цела и теперь погашена. */
export async function consume(nonce: string): Promise<boolean> {
  try {
    const removed = await redis.del(KEY(nonce));
    return removed === 1;
  } catch (err) {
    console.warn("[captcha] store unavailable on consume", err);
    return true; // см. довод выше
  }
}

/** Выдача дешёвая, но не бесплатная: 60 задач с адреса за 10 минут. */
export async function tooManyIssues(ip: string): Promise<boolean> {
  const key = `captcha:issues:${hashIp(ip)}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.pexpire(key, 10 * 60 * 1000);
    return n > 60;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/captcha.test.ts`
Expected: PASS (9 тестов).

- [ ] **Step 5: Commit**

```bash
git add src/lib/captcha-store.ts tests/captcha.test.ts
git commit -m "feat(captcha): подписанная одноразовая задача"
```

---

## Task 4: Маршрут выдачи и общая проверка

**Files:**
- Create: `src/app/api/captcha/route.ts`
- Create: `src/lib/captcha-guard.ts`

- [ ] **Step 1: Маршрут выдачи**

```ts
// src/app/api/captcha/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { issueChallenge, tooManyIssues } from "@/lib/captcha-store";

export const dynamic = "force-dynamic";

/**
 * Вошедшему капча не показывается никогда, и клиент о сеансе ничего не знает:
 * проще спросить здесь, чем прокидывать свойство через полстраницы навигатора.
 */
export async function GET(req: Request) {
  const session = await auth();
  if ((session?.user as { id?: string } | undefined)?.id) {
    return NextResponse.json({ needed: false });
  }
  const ip = clientIp(req);
  if (await tooManyIssues(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const challenge = await issueChallenge(ip);
  return NextResponse.json({ needed: true, ...challenge });
}
```

- [ ] **Step 2: Общая проверка для маршрутов**

```ts
// src/lib/captcha-guard.ts
import { auth } from "@/auth";
import { clientIp } from "@/lib/client-ip";
import { checkTiming, isSolved } from "@/lib/captcha";
import { consume, hashIp, parseToken } from "@/lib/captcha-store";

export type CaptchaVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Одна проверка на три анонимные двери. Вошедший проходит мимо: он уже прошёл
 * дверь, и лишняя загадка на каждое действие — налог на честного человека.
 */
export async function requireCaptcha(req: Request, raw: unknown): Promise<CaptchaVerdict> {
  const session = await auth();
  if ((session?.user as { id?: string } | undefined)?.id) return { ok: true };

  const body = (raw ?? {}) as { token?: unknown; x?: unknown; y?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const x = Number(body.x);
  const y = Number(body.y);
  if (!token || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, reason: "captcha_required" };
  }

  const payload = parseToken(token);
  if (!payload) return { ok: false, reason: "captcha_invalid" };
  if (payload.ipHash !== hashIp(clientIp(req))) return { ok: false, reason: "captcha_invalid" };

  const timing = checkTiming(payload.issuedAt, Date.now());
  if (timing) return { ok: false, reason: timing };

  if (!isSolved(payload.home, { x, y })) return { ok: false, reason: "captcha_invalid" };
  if (!(await consume(payload.nonce))) return { ok: false, reason: "captcha_invalid" };
  return { ok: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/captcha/route.ts src/lib/captcha-guard.ts
git commit -m "feat(captcha): маршрут выдачи и общая проверка"
```

---

## Task 5: Компонент капчи

**Files:**
- Create: `src/components/captcha/mark-captcha.tsx`

- [ ] **Step 1: Написать компонент**

Поведение — из утверждённого макета `trientes-artifacts/mockups/captcha.html`:
призрак знака, две части белым, третья оранжевым тянется пальцем; подсветка
цели; Tab → стрелки → Enter; ↻ — другая задача.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CAPTCHA_STAGE, isSolved, type Geometry, type Point } from "@/lib/captcha";

export type CaptchaSolution = { token: string; x: number; y: number };

type Labels = {
  title: string; hint: string; idle: string; ok: string; bad: string;
  keyboard: string; reload: string;
};

/**
 * Знак режется по своим же швам: `clip-path` по долям высоты. Один растр
 * (`/captcha-mark.png`) в маске CSS — цвет частей задаёт фон, а не три файла.
 */
export function MarkCaptcha({
  onSolved,
  labels,
}: {
  onSolved: (s: CaptchaSolution | null) => void;
  labels: Labels;
}) {
  const [g, setG] = useState<(Geometry & { token: string }) | null>(null);
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 });
  const [solved, setSolved] = useState(false);
  const [bad, setBad] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);

  const load = useCallback(async () => {
    setSolved(false);
    setBad(false);
    onSolved(null);
    try {
      const res = await fetch("/api/captcha", { cache: "no-store" });
      const data = (await res.json()) as { needed?: boolean } & Geometry & { token: string };
      if (!data.needed) {
        setNeeded(false);
        // Вошедшему капчи нет — форма должна отправляться как прежде.
        onSolved({ token: "", x: 0, y: 0 });
        return;
      }
      setNeeded(true);
      setG(data);
      setPos(data.start);
    } catch {
      setNeeded(true);
    }
  }, [onSolved]);

  useEffect(() => {
    void load();
  }, [load]);

  if (needed === false) return null;

  const scale = (el: HTMLDivElement | null) => (el ? el.clientWidth / CAPTCHA_STAGE.w : 1);

  function move(client: Point) {
    if (!g || solved) return;
    const k = scale(stageRef.current);
    const drag = dragRef.current;
    if (!drag) return;
    const next = { x: (client.x - drag.ox) / k, y: (client.y - drag.oy) / k };
    setPos(next);
    if (isSolved(g.home, next)) {
      setPos(g.home);
      setSolved(true);
      setBad(false);
      onSolved({ token: g.token, x: g.home.x, y: g.home.y });
    }
  }

  const markStyle = (clip: string, color: string, p: Point): React.CSSProperties => ({
    position: "absolute",
    width: `${(g!.mark.w / CAPTCHA_STAGE.w) * 100}%`,
    height: `${(g!.mark.h / CAPTCHA_STAGE.h) * 100}%`,
    left: `${(p.x / CAPTCHA_STAGE.w) * 100}%`,
    top: `${(p.y / CAPTCHA_STAGE.h) * 100}%`,
    clipPath: clip,
    background: color,
    WebkitMaskImage: "url(/captcha-mark.png)",
    maskImage: "url(/captcha-mark.png)",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  });

  return (
    <div className="rounded-[18px] border border-hairline bg-card p-4">
      <h3 className="text-[14px] font-semibold">{labels.title}</h3>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{labels.hint}</p>

      <div
        ref={stageRef}
        className={`relative mt-3 overflow-hidden rounded-[16px] border bg-bg-tint/40 ${
          solved ? "border-accent/50" : "border-hairline"
        }`}
        style={{ aspectRatio: `${CAPTCHA_STAGE.w} / ${CAPTCHA_STAGE.h}`, touchAction: "none" }}
        onPointerMove={(e) => move({ x: e.clientX, y: e.clientY })}
        onPointerUp={() => {
          if (dragRef.current && g && !solved) setBad(true);
          dragRef.current = null;
        }}
      >
        {g ? (
          <>
            <div style={{ ...markStyle("none", "rgba(141,135,160,.34)", g.home) }} />
            <div style={markStyle(`inset(0 0 ${(1 - g.cut.top) * 100}% 0)`, "#fff", g.home)} />
            <div style={markStyle(`inset(${(1 - g.cut.bottom) * 100}% 0 0 0)`, "#fff", g.home)} />
            <div
              role="button"
              tabIndex={0}
              aria-label={labels.title}
              className="cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-accent"
              style={markStyle(
                `inset(${g.cut.top * 100}% 0 ${g.cut.bottom * 100}% 0)`,
                solved ? "var(--accent)" : "var(--accent)",
                pos,
              )}
              onPointerDown={(e) => {
                if (solved) return;
                const k = scale(stageRef.current);
                dragRef.current = { ox: e.clientX - pos.x * k, oy: e.clientY - pos.y * k };
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              }}
              onKeyDown={(e) => {
                if (solved || !g) return;
                const step = e.shiftKey ? 12 : 4;
                const map: Record<string, [number, number]> = {
                  ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                  ArrowUp: [0, -step], ArrowDown: [0, step],
                };
                const d = map[e.key];
                if (d) {
                  e.preventDefault();
                  const next = { x: pos.x + d[0], y: pos.y + d[1] };
                  setPos(next);
                  if (isSolved(g.home, next)) {
                    setPos(g.home);
                    setSolved(true);
                    setBad(false);
                    onSolved({ token: g.token, x: g.home.x, y: g.home.y });
                  }
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (!isSolved(g.home, pos)) setBad(true);
                }
              }}
            />
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={`flex-1 text-[12px] ${solved ? "font-semibold text-up" : bad ? "font-semibold text-down" : "text-muted"}`}
        >
          {solved ? labels.ok : bad ? labels.bad : labels.idle}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          aria-label={labels.reload}
          className="h-9 min-w-9 rounded-full bg-card-alt px-3 text-[15px] text-muted-strong"
        >
          ↻
        </button>
      </div>
      <p className="mt-2 text-[10.5px] leading-snug text-muted">{labels.keyboard}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/captcha/mark-captcha.tsx
git commit -m "feat(captcha): лист сборки знака"
```

---

## Task 6: Капча на трёх дверях

**Files:**
- Modify: `src/app/api/auth/password/register/route.ts`
- Modify: `src/app/api/auth/password/forgot/route.ts`
- Modify: `src/app/api/point-report/route.ts`
- Modify: `src/components/register-form.tsx`
- Modify: `src/components/forgot-password-form.tsx`
- Modify: `src/components/coin-detail/poi-report-dialog.tsx`

- [ ] **Step 1: Регистрация — сервер**

В `register/route.ts` сразу после разбора тела (до `validateUsername`):

```ts
  const captcha = await requireCaptcha(req, body.captcha);
  if (!captcha.ok) return NextResponse.json({ error: captcha.reason }, { status: 400 });
```

Импорт: `import { requireCaptcha } from "@/lib/captcha-guard";`
Тип тела расширить полем `captcha?: unknown`.

Проверка идёт **после** разбора JSON, но **до** записи в `LoginAttempt`: иначе
непройденная капча тикала бы ограничитель честного человека.

- [ ] **Step 2: Сброс пароля — сервер**

В `forgot/route.ts` после `parseResetIdentifier` и до `checkResetRateLimit`:

```ts
  const captcha = await requireCaptcha(req, (body as { captcha?: unknown }).captcha);
  if (!captcha.ok) return NextResponse.json({ error: captcha.reason }, { status: 400 });
```

- [ ] **Step 3: Жалоба на точку — сервер**

В `point-report/route.ts` после разбора тела и `auth()`:

```ts
  const captcha = await requireCaptcha(req, body.captcha);
  if (!captcha.ok) return NextResponse.json({ error: captcha.reason }, { status: 400 });
```

- [ ] **Step 4: Формы**

В каждой из трёх форм:

```tsx
const [captcha, setCaptcha] = useState<CaptchaSolution | null>(null);
...
<MarkCaptcha onSolved={setCaptcha} labels={{ ... из t("captcha.*") ... }} />
```

Кнопка отправки получает `disabled={pending || !captcha}`, а тело запроса —
`captcha`. В `poi-report-dialog.tsx` строки берутся тем же `t`, что и остальные
строки листа (`report.*` рядом с `captcha.*` в namespace карточки точки).

**Важно:** `onSolved` передаётся как `setCaptcha` (стабильная ссылка) — замыкание,
созданное в теле компонента, перезапускало бы `useEffect` на каждый рендер и
задача запрашивалась бы бесконечно.

- [ ] **Step 5: Проверить глазами**

Run: `npm run build && pm2 restart trientes-web`
Открыть `/ru/register` — задача видна, кнопка погашена, знак складывается,
регистрация проходит. Открыть ту же страницу, собрать знак, отправить дважды
(кнопкой «назад») — второй раз `captcha_invalid`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(captcha): проверка на регистрации, сбросе пароля и жалобе"
```

---

## Task 7: Строки капчи

**Files:**
- Modify: `messages/en.json`

- [ ] **Step 1: Ключи**

```json
"captcha": {
  "title": "Assemble the mark",
  "hint": "Drag the orange piece into place — the mark must come together.",
  "idle": "A piece is out of place",
  "ok": "The mark is whole",
  "bad": "Not quite — try again",
  "keyboard": "Keyboard: Tab → arrow keys → Enter.",
  "reload": "Another challenge",
  "errors": {
    "captcha_required": "Please assemble the mark first.",
    "captcha_invalid": "The check did not pass. Try another challenge.",
    "captcha_expired": "The challenge expired. Take a new one.",
    "captcha_too_fast": "That was too fast. Try again."
  }
}
```

Те же четыре кода ошибок добавить в `register.errors.*`, `reset.errors.*` и
`coin.poi.report.errors.*` — ровно теми же словами (форма показывает ошибку из
своего namespace).

- [ ] **Step 2: Перевести**

Run: `npm run i18n`
Expected: прогон идемпотентный, трогает только новые ключи.

Run: `npx vitest run tests/messages-parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add messages/
git commit -m "feat(i18n): строки капчи"
```

---

## Task 8: Данные надзора

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261118100000_company_supervision/migration.sql`

- [ ] **Step 1: Схема**

В `model Company` после блока KYB:

```prisma
  // Надзор: предприятие снято с витрины до выяснения. Статус APPROVED при этом
  // не трогаем — это мера надзора, а не отмена решения модератора.
  suspendedAt    DateTime?
  suspendReason  String?
  suspendedById  String?
```

В `model ComplianceCase` после `firstResponseAt`:

```prisma
  /// Срок следующего пересмотра залистованного предприятия. Выводится из риска
  /// (12 месяцев, при высоком 6), своей колонки под интервал нет.
  nextReviewAt DateTime?
```

В `enum CaseEventKind` добавить `COMPANY_WARNED`, `COMPANY_SUSPENDED`,
`COMPANY_RESTORED`, `REVIEW_PASSED`.
В `enum AdminNotificationKind` добавить `REVIEW_DUE`.
В `model Company` добавить `@@index([suspendedAt])`.

- [ ] **Step 2: Миграция руками**

Чекаут — прод; `migrate dev` умеет предлагать сброс базы, поэтому SQL пишем сами:

```sql
-- prisma/migrations/20261118100000_company_supervision/migration.sql
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_WARNED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_SUSPENDED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'COMPANY_RESTORED';
ALTER TYPE "CaseEventKind" ADD VALUE IF NOT EXISTS 'REVIEW_PASSED';
ALTER TYPE "AdminNotificationKind" ADD VALUE IF NOT EXISTS 'REVIEW_DUE';

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendReason" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "suspendedById" TEXT;
CREATE INDEX IF NOT EXISTS "Company_suspendedAt_idx" ON "Company"("suspendedAt");

ALTER TABLE "ComplianceCase" ADD COLUMN IF NOT EXISTS "nextReviewAt" TIMESTAMP(3);
```

- [ ] **Step 3: Применить**

Run: `npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration applied`.

Примечание: `ALTER TYPE ... ADD VALUE` в PostgreSQL не выполняется внутри
транзакции вместе с использованием нового значения — здесь это безопасно,
потому что новые значения в этой же миграции не используются.

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(db): поля надзора над предприятием и срок пересмотра"
```

---

## Task 9: Видимость компании — один фрагмент

**Files:**
- Create: `src/lib/company-visibility.ts`
- Test: `tests/company-visibility.test.ts`

- [ ] **Step 1: Падающий тест**

```ts
// tests/company-visibility.test.ts
import { describe, expect, it } from "vitest";
import {
  PUBLIC_COMPANY,
  LIVE_CARD_COMPANY,
  nextReviewAt,
  reviewDueSoon,
  REVIEW_NOTICE_DAYS,
} from "@/lib/company-visibility";

describe("видимость компании", () => {
  it("публичная компания — одобренная, не удалённая, не снятая", () => {
    expect(PUBLIC_COMPANY).toEqual({ status: "APPROVED", deletedAt: null, suspendedAt: null });
  });

  it("карточка без компании остаётся видна", () => {
    expect(LIVE_CARD_COMPANY).toEqual({
      OR: [{ companyId: null }, { company: { deletedAt: null, suspendedAt: null } }],
    });
  });
});

describe("пересмотр", () => {
  const base = new Date("2026-11-17T00:00:00Z");

  it("обычный риск — через 12 месяцев, высокий — через 6", () => {
    expect(nextReviewAt(base, "MEDIUM").toISOString()).toBe("2027-11-17T00:00:00.000Z");
    expect(nextReviewAt(base, "HIGH").toISOString()).toBe("2027-05-17T00:00:00.000Z");
  });

  it("звонит за 30 дней, не раньше", () => {
    const due = new Date("2026-12-10T00:00:00Z");
    expect(reviewDueSoon(due, base)).toBe(true);
    expect(reviewDueSoon(new Date("2027-01-10T00:00:00Z"), base)).toBe(false);
    // Просроченный пересмотр — тем более повод.
    expect(reviewDueSoon(new Date("2026-10-01T00:00:00Z"), base)).toBe(true);
    expect(reviewDueSoon(null, base)).toBe(false);
    expect(REVIEW_NOTICE_DAYS).toBe(30);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run tests/company-visibility.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать модуль**

```ts
// src/lib/company-visibility.ts
/**
 * Что считается видимым предприятием — в одном месте, а не пятью копиями по
 * выборкам. Своя копия правила в проекте уже однажды отставала (список локалей),
 * и правило видимости — ровно такой же случай.
 */
import type { CaseRisk } from "@prisma/client";

/** Фрагмент `where` для связи `company`. */
export const PUBLIC_COMPANY = { status: "APPROVED", deletedAt: null, suspendedAt: null } as const;

/**
 * Карточка монеты: у посеянных нами компании нет вовсе, и прятать их не за что.
 * Поэтому условие пропускает `companyId = null` явно.
 */
export const LIVE_CARD_COMPANY = {
  OR: [{ companyId: null }, { company: { deletedAt: null, suspendedAt: null } }],
} as const;

export const REVIEW_NOTICE_DAYS = 30;

/** Срок следующего пересмотра: 12 месяцев, при высоком риске 6. */
export function nextReviewAt(from: Date, risk: CaseRisk): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + (risk === "HIGH" ? 6 : 12));
  return d;
}

export function reviewDueSoon(due: Date | null, now: Date): boolean {
  if (!due) return false;
  return due.getTime() - now.getTime() <= REVIEW_NOTICE_DAYS * 86400_000;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/company-visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/company-visibility.ts tests/company-visibility.test.ts
git commit -m "feat(company): одно правило видимости предприятия"
```

---

## Task 10: Закрыть дыру в публичных выборках

**Files:**
- Modify: `src/lib/company-points.ts` (две выборки)
- Modify: `src/app/[locale]/services/page.tsx`
- Modify: `src/app/[locale]/companies/page.tsx`
- Modify: `src/app/[locale]/companies/[id]/page.tsx`
- Modify: публичные выборки карточек монет

- [ ] **Step 1: Точки (фид и поиск)**

В `fetchApprovedPointsInBbox` и `searchApprovedPointsByName` заменить
`company: { status: "APPROVED", deletedAt: null }` на `company: PUBLIC_COMPANY`.

- [ ] **Step 2: Услуги и страницы компаний**

В `services/page.tsx` — то же самое, сохранив поведение фильтра по стране
(он пересобирает объект `where.company`, и `suspendedAt: null` обязан уцелеть):

```ts
  if (/^[A-Z]{2}$/.test(cc)) where.company = { ...PUBLIC_COMPANY, countryCode: cc };
```

В `/companies` (список) и `/companies/[id]` — снятая компания отдаёт `notFound()`.

- [ ] **Step 3: Карточки монет**

Найти публичные выборки:

Run: `grep -rn "coinCard.find" src/lib src/app | grep -v admin`

В каждой публичной (страница карточки, каталог, витрина, поиск) добавить
`...LIVE_CARD_COMPANY` в `where`. Админские выборки не трогать: сотрудник
обязан видеть снятую компанию и её карточки.

- [ ] **Step 4: Проверить глазами**

Run:
```bash
npx tsx -e "
import {prisma} from './src/lib/prisma';
(async()=>{
  const c = await prisma.company.findFirst({ where: { status: 'APPROVED' } });
  console.log(c?.id, c?.displayName);
  await prisma.\$disconnect();
})()"
```
Затем проставить `suspendedAt` этой компании, открыть `/ru/services` и фид
`/api/crypto-map/poi?bbox=...` — её точек и услуг быть не должно; снять
`suspendedAt` обратно.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(company): снятое предприятие уходит с карты, из услуг и каталога"
```

---

## Task 11: Действия надзора

**Files:**
- Create: `src/app/actions/company-supervision.ts`
- Modify: `src/lib/cases/journal.ts` (ключи новых событий)
- Modify: `src/lib/cases/admin-notify.ts` (строка `REVIEW_DUE`)

- [ ] **Step 1: Ключи журнала и строка звонка**

В `KEYS` добавить `COMPANY_WARNED: "companyWarned"`, `COMPANY_SUSPENDED:
"companySuspended"`, `COMPANY_RESTORED: "companyRestored"`, `REVIEW_PASSED:
"reviewPassed"`. В `TELEGRAM_LINE` — `REVIEW_DUE: "🗓 Periodic review due"`.

- [ ] **Step 2: Экшены**

```ts
// src/app/actions/company-supervision.ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { appendCaseEvent } from "@/lib/cases/journal";
import { ensureCase } from "@/lib/cases/ensure";
import { notifyApplicantOfMessage } from "@/lib/cases/notify-applicant";
import { pausePatch } from "@/lib/cases/sla";
import { nextReviewAt } from "@/lib/company-visibility";

export type SupervisionResult = { ok: true } | { ok: false; reason: string };

const MIN_REASON = 3;

/** Дело предприятия: оно уже есть у поданной заявки, но у старых может не быть. */
async function caseOf(companyId: string, title: string, ownerUserId: string) {
  const existing = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "COMPANY", subjectId: companyId } },
  });
  if (existing) return existing;
  const id = await ensureCase({
    subjectType: "COMPANY",
    subjectId: companyId,
    title,
    applicantUserId: ownerUserId,
  });
  return id ? prisma.complianceCase.findUnique({ where: { id } }) : null;
}

/**
 * Предупреждение — сообщение в нитку плюс событие журнала. Отдельной таблицы
 * нет: журнал неизменяем и уже есть, а колонка-счётчик потребовала бы держать
 * её в согласии с ним руками.
 */
export async function warnCompany(input: {
  companyId: string;
  body: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const body = input.body.trim();
  if (body.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  const c = await caseOf(company.id, company.displayName, company.ownerUserId);
  if (!c) return { ok: false, reason: "failed" };

  await prisma.caseMessage.create({
    data: { caseId: c.id, authorId: admin.userId, side: "STAFF", body: body.slice(0, 4000) },
  });
  // Предупреждение требует ответа — часы срока встают, как у любого нашего
  // письма с флажком «нужен ответ».
  await prisma.complianceCase.update({
    where: { id: c.id },
    data: { status: "WAITING_APPLICANT", ...pausePatch(new Date()) },
  });
  await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "COMPANY_WARNED" });
  await logAdminAction({
    actorId: admin.userId, action: "WARN_COMPANY",
    targetType: "Company", targetId: company.id, details: { body: body.slice(0, 500) },
  });
  await notifyApplicantOfMessage({
    applicantUserId: company.ownerUserId, caseId: c.id,
    caseTitle: company.displayName, preview: body.slice(0, 300),
  }).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Снять предприятие с витрины. Причина обязательна и уходит владельцу словами. */
export async function suspendCompany(input: {
  companyId: string;
  reason: string;
}): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const reason = input.reason.trim();
  if (reason.length < MIN_REASON) return { ok: false, reason: "reason_too_short" };

  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };

  await prisma.company.update({
    where: { id: company.id },
    data: { suspendedAt: new Date(), suspendReason: reason.slice(0, 500), suspendedById: admin.userId },
  });
  const c = await caseOf(company.id, company.displayName, company.ownerUserId);
  if (c) {
    await prisma.caseMessage.create({
      data: { caseId: c.id, authorId: admin.userId, side: "STAFF", body: reason.slice(0, 4000) },
    });
    await appendCaseEvent({
      caseId: c.id, actorId: admin.userId, kind: "COMPANY_SUSPENDED",
      payload: { reason: reason.slice(0, 200) },
    });
    await notifyApplicantOfMessage({
      applicantUserId: company.ownerUserId, caseId: c.id,
      caseTitle: company.displayName, preview: reason.slice(0, 300),
    }).catch(() => {});
  }
  await logAdminAction({
    actorId: admin.userId, action: "SUSPEND_COMPANY",
    targetType: "Company", targetId: company.id, details: { reason: reason.slice(0, 500) },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Вернуть предприятие на витрину — одно действие, без прохода через очередь. */
export async function restoreCompany(input: { companyId: string }): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };

  await prisma.company.update({
    where: { id: company.id },
    data: { suspendedAt: null, suspendReason: null, suspendedById: null },
  });
  const c = await prisma.complianceCase.findUnique({
    where: { subjectType_subjectId: { subjectType: "COMPANY", subjectId: company.id } },
  });
  if (c) await appendCaseEvent({ caseId: c.id, actorId: admin.userId, kind: "COMPANY_RESTORED" });
  await logAdminAction({
    actorId: admin.userId, action: "UNSUSPEND_COMPANY",
    targetType: "Company", targetId: company.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Пересмотр пройден: событие в журнал и следующая дата. */
export async function passReview(input: { companyId: string }): Promise<SupervisionResult> {
  const admin = await checkAdmin();
  if (!admin.ok) return { ok: false, reason: admin.reason };
  const company = await prisma.company.findUnique({ where: { id: input.companyId } });
  if (!company) return { ok: false, reason: "not_found" };
  const c = await caseOf(company.id, company.displayName, company.ownerUserId);
  if (!c) return { ok: false, reason: "failed" };

  const now = new Date();
  const due = nextReviewAt(now, c.risk);
  await prisma.complianceCase.update({ where: { id: c.id }, data: { nextReviewAt: due } });
  await appendCaseEvent({
    caseId: c.id, actorId: admin.userId, kind: "REVIEW_PASSED",
    payload: { next: due.toISOString().slice(0, 10) },
  });
  // Прочитанный звонок о пересмотре больше не нужен.
  await prisma.adminNotification.deleteMany({ where: { caseId: c.id, kind: "REVIEW_DUE" } });
  revalidatePath("/", "layout");
  return { ok: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/company-supervision.ts src/lib/cases/journal.ts src/lib/cases/admin-notify.ts
git commit -m "feat(admin): предупреждение, приостановка и пересмотр предприятия"
```

---

## Task 12: Срок пересмотра при одобрении

**Files:**
- Modify: `src/app/actions/case-review.ts` (место, где дело становится APPROVED)

- [ ] **Step 1: Найти место**

Run: `grep -n "decision" src/app/actions/case-review.ts | head -30`

- [ ] **Step 2: Поставить дату**

В ветке одобрения, где делу пишется `decision: "APPROVED"`, для
`subjectType === "COMPANY"` добавить в тот же `data`:

```ts
      ...(c.subjectType === "COMPANY" ? { nextReviewAt: nextReviewAt(now, c.risk) } : {}),
```

Импорт: `import { nextReviewAt } from "@/lib/company-visibility";`

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/case-review.ts
git commit -m "feat(cases): одобренное предприятие получает срок пересмотра"
```

---

## Task 13: Суточный прогон пересмотра

**Files:**
- Create: `src/lib/cases/company-review-sweep.ts`
- Test: `tests/company-review.test.ts`
- Modify: `worker/index.ts`

- [ ] **Step 1: Падающий тест чистой части**

```ts
// tests/company-review.test.ts
import { describe, expect, it } from "vitest";
import { planReview, reviewAddressee } from "@/lib/cases/company-review-sweep";

const now = new Date("2026-11-17T00:00:00Z");

describe("план пересмотра", () => {
  it("пустая дата наверстывается молча от даты одобрения", () => {
    const step = planReview(
      { nextReviewAt: null, risk: "MEDIUM", companyReviewedAt: new Date("2026-01-10T00:00:00Z") },
      now,
    );
    expect(step.setNextReviewAt?.toISOString()).toBe("2027-01-10T00:00:00.000Z");
    expect(step.ring).toBe(false);
  });

  it("наверстанная дата уже прошла — звоним сразу", () => {
    const step = planReview(
      { nextReviewAt: null, risk: "MEDIUM", companyReviewedAt: new Date("2025-01-10T00:00:00Z") },
      now,
    );
    expect(step.ring).toBe(true);
  });

  it("за 30 дней звоним, за 60 — нет", () => {
    expect(planReview({ nextReviewAt: new Date("2026-12-05T00:00:00Z"), risk: "MEDIUM", companyReviewedAt: null }, now).ring).toBe(true);
    expect(planReview({ nextReviewAt: new Date("2027-02-05T00:00:00Z"), risk: "MEDIUM", companyReviewedAt: null }, now).ring).toBe(false);
  });

  it("звонок адресный: проверявший, иначе взявший, иначе утвердивший", () => {
    expect(reviewAddressee({ reviewedById: "a", assigneeId: "b", approvedById: "c" })).toBe("a");
    expect(reviewAddressee({ reviewedById: null, assigneeId: "b", approvedById: "c" })).toBe("b");
    expect(reviewAddressee({ reviewedById: null, assigneeId: null, approvedById: "c" })).toBe("c");
    expect(reviewAddressee({ reviewedById: null, assigneeId: null, approvedById: null })).toBe(null);
  });
});
```

- [ ] **Step 2: Прогнать, убедиться, что падает**

Run: `npx vitest run tests/company-review.test.ts`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Написать прогон**

```ts
// src/lib/cases/company-review-sweep.ts
import type { CaseRisk } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextReviewAt, reviewDueSoon } from "@/lib/company-visibility";
import { raiseAndNotify } from "./admin-notify";

export type ReviewStats = { checked: number; backfilled: number; rang: number; noAddressee: number };

export type ReviewStep = { setNextReviewAt: Date | null; ring: boolean };

/**
 * Чистая часть. Пустую дату наверстываем молча — это не событие, а
 * наверстывание: у предприятий, одобренных до этого слайса, её взяться
 * неоткуда.
 */
export function planReview(
  row: { nextReviewAt: Date | null; risk: CaseRisk; companyReviewedAt: Date | null },
  now: Date,
): ReviewStep {
  if (!row.nextReviewAt) {
    if (!row.companyReviewedAt) return { setNextReviewAt: null, ring: false };
    const due = nextReviewAt(row.companyReviewedAt, row.risk);
    return { setNextReviewAt: due, ring: reviewDueSoon(due, now) };
  }
  return { setNextReviewAt: null, ring: reviewDueSoon(row.nextReviewAt, now) };
}

/**
 * Звонок адресный. Некому звонить — молчим: безадресный звонок будит всех
 * админов, и его перестают читать (тот же довод, что в AQ).
 */
export function reviewAddressee(c: {
  reviewedById: string | null;
  assigneeId: string | null;
  approvedById: string | null;
}): string | null {
  return c.reviewedById ?? c.assigneeId ?? c.approvedById ?? null;
}

export async function runCompanyReviewSweep(now: Date = new Date()): Promise<ReviewStats> {
  const stats: ReviewStats = { checked: 0, backfilled: 0, rang: 0, noAddressee: 0 };
  const cases = await prisma.complianceCase.findMany({
    where: { subjectType: "COMPANY" },
    select: {
      id: true, title: true, risk: true, nextReviewAt: true,
      subjectId: true, reviewedById: true, assigneeId: true, approvedById: true,
    },
    take: 500,
  });

  for (const c of cases) {
    const company = await prisma.company.findUnique({
      where: { id: c.subjectId },
      select: { status: true, deletedAt: true, reviewedAt: true },
    });
    // Пересматривают залистованное. Отклонённому и удалённому пересмотр не нужен.
    if (!company || company.status !== "APPROVED" || company.deletedAt) continue;
    stats.checked += 1;

    const step = planReview(
      { nextReviewAt: c.nextReviewAt, risk: c.risk, companyReviewedAt: company.reviewedAt },
      now,
    );
    if (step.setNextReviewAt) {
      await prisma.complianceCase.update({
        where: { id: c.id },
        data: { nextReviewAt: step.setNextReviewAt },
      });
      stats.backfilled += 1;
    }
    if (!step.ring) continue;

    const to = reviewAddressee(c);
    if (!to) {
      console.warn("[company-review] no addressee", { caseId: c.id });
      stats.noAddressee += 1;
      continue;
    }
    await raiseAndNotify({ userId: to, kind: "REVIEW_DUE", caseId: c.id, title: c.title });
    stats.rang += 1;
  }
  return stats;
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npx vitest run tests/company-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Воркер**

В `worker/index.ts` рядом с `runPointReportJob`:

```ts
  // Пересмотр предприятий — сразу после лестницы жалоб: шаги считаются днями.
  cron.schedule("35 5 * * *", () => void runCompanyReviewJob());
```

и обёртка рядом с прочими job-функциями:

```ts
async function runCompanyReviewJob() {
  try {
    const stats = await runCompanyReviewSweep();
    console.log("[company-review]", stats);
  } catch (err) {
    console.error("[company-review] failed", err);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/cases/company-review-sweep.ts tests/company-review.test.ts worker/index.ts
git commit -m "feat(worker): суточный прогон пересмотра предприятий"
```

---

## Task 14: Экран надзора

**Files:**
- Create: `src/app/[locale]/admin/companies/[id]/page.tsx`
- Create: `src/components/admin/company-supervision.tsx`

- [ ] **Step 1: Клиентский компонент действий**

Кнопки `ADMIN_BUTTON*` высотой 48 px во всю ширину (`src/lib/admin-ui.ts`),
текстовое поле причины, показ кода ошибки словами. Три действия: предупредить,
приостановить (причина обязательна), вернуть; плюс «пересмотр пройден».

- [ ] **Step 2: Страница**

Разделы `CaseSection` с нумерацией `nextNo()`, как в деле:

1. три числа (точек на карте, жалоб за 90 дней, предупреждений);
2. надзор (кто одобрил и когда, KYB, срок пересмотра, «пересмотр пройден»);
3. связь (написать / предупредить);
4. объекты (точки со значками «проверяется»/«снята», карточки монет);
5. листинг (приостановить / вернуть).

Ссылка на экран — из дела компании (раздел «Анкета») и из `/admin/business`.

- [ ] **Step 3: Проверить глазами**

Run: `npm run build && pm2 restart trientes-web`
Открыть `/ru/admin/companies/<id>` на телефоне: колонка по центру, кнопки
во всю ширину, числа читаются.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(admin): экран надзора над предприятием"
```

---

## Task 15: Владелец видит снятие

**Files:**
- Modify: `src/app/[locale]/cabinet/companies/[id]/page.tsx`

- [ ] **Step 1: Плашка**

Если `company.suspendedAt` — вверху страницы красная плашка с причиной
(`company.suspendReason`) и строкой «ответьте в нитке дела». Без этого
владелец видит исчезнувшие точки и не знает почему.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(cabinet): владелец видит причину снятия предприятия"
```

---

## Task 16: Строки надзора

**Files:**
- Modify: `messages/en.json`

- [ ] **Step 1: Ключи**

`admin.company.*` (title, numbers.points/reports/warnings, supervision.*,
contact.*, objects.*, listing.*, errors.*), `admin.case.journal.companyWarned /
companySuspended / companyRestored / reviewPassed`, `admin.notifications.kind.REVIEW_DUE`,
`cabinet.company.suspended.*`, `notify.companyWarned.*`.

- [ ] **Step 2: Перевести и проверить**

Run: `npm run i18n && npx vitest run tests/messages-parity.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add messages/
git commit -m "feat(i18n): строки надзора над предприятием"
```

---

## Task 17: Сборка, прогон, выкладка

- [ ] **Step 1: Весь набор тестов**

Run: `npx vitest run`
Expected: PASS, без упавших.

- [ ] **Step 2: Линт и сборка**

Run: `npm run lint && npm run build`
Expected: без ошибок.

- [ ] **Step 3: Живой прогон надзора**

На настоящей компании: предупредить → сообщение в нитке и событие в журнале;
приостановить с причиной → точки уходят из фида, услуги пропадают, владелец
получает сообщение; вернуть → всё возвращается. Прогон пересмотра руками:

```bash
npx tsx -e "
import { runCompanyReviewSweep } from './src/lib/cases/company-review-sweep';
(async()=>{ console.log(await runCompanyReviewSweep()); process.exit(0); })()"
```

- [ ] **Step 4: Перезапуск**

`src/lib` изменился и воркер его импортирует — перезапускаем оба:

```bash
pm2 restart trientes-web trientes-worker && pm2 save
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Запись в CLAUDE.md**

Раздел «Слайс AR — надзор над предприятием и капча» с решениями, которые стоит
помнить: три двери и почему не вход; честная оценка силы капчи; Redis лёг —
дверь не запираем; приостановка не трогает `APPROVED`; дело пересмотра не
заводим (у дела `@@unique` на объект); предупреждение живёт в журнале, а не в
своей таблице; звонок адресный.

```bash
git add CLAUDE.md && git commit -m "docs: слайс AR в CLAUDE.md" && git push origin main
```
