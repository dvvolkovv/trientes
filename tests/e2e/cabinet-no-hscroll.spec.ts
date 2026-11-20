import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Телефон: ни один экран кабинета предприятия не должен быть шире окна.
 *
 * Просьба владельца дословно: «чтобы на мобильной версии он никуда не двигался ни
 * вправо, ни влево, только вверх-вниз». Проверяем это измерением, а не глазом —
 * `overflow-x: clip` на колонке лечит последствие, а тест ловит причину: таблицу,
 * длинное слово или сетку, которые вылезли за край.
 *
 * Тест заводит свою временную запись, предприятие и сеанс (экраны кабинета за
 * входом) и убирает их за собой. Без базы он честно падает, а не молча проходит.
 */

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Тесты запускаются без загрузчика .env — читаем его сами, как делают скрипты.
  // Путь от `process.cwd()`, а не от `import.meta.url`: последний заставляет
  // playwright собрать файл как модуль ES, и тогда клиент Prisma (CommonJS) падает.
  const env = readFileSync(join(process.cwd(), ".env"), "utf-8");
  const line = env.split("\n").find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl() } } });

const WIDTHS = [320, 390];

let userId = "";
let companyId = "";
let sessionToken = "";

test.beforeAll(async () => {
  const suffix = randomBytes(4).toString("hex");
  const user = await prisma.user.create({
    data: { username: `e2e_hscroll_${suffix}`, name: "E2E hscroll" },
  });
  userId = user.id;
  const company = await prisma.company.create({
    data: {
      ownerUserId: user.id,
      legalName: `E2E hscroll s.r.o. ${suffix}`,
      displayName: "E2E hscroll",
      status: "APPROVED",
      city: "Praha",
      country: "Czechia",
      countryCode: "CZ",
      street: "Dlouhá",
      houseNumber: "1",
      postalCode: "11000",
      website: "https://example.org",
      email: "e2e@example.org",
      phone: "+420 000 000 000",
      description: "Временное предприятие проверки ширины экрана.",
    },
  });
  companyId = company.id;
  await prisma.companyMember.create({ data: { companyId: company.id, userId: user.id, role: "OWNER" } });
  sessionToken = randomBytes(24).toString("hex");
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 3600_000) },
  });
});

test.afterAll(async () => {
  // Каскад уберёт предприятие, членство и сеанс вместе с записью.
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
});

test("экраны кабинета предприятия не ездят по горизонтали на 320 и 390 px", async ({ page, context, baseURL }) => {
  const base = `/ru/cabinet/companies/${companyId}`;
  const paths = [
    "/ru/cabinet",
    base,
    `${base}?edit=1`,
    `${base}/g/showcase`,
    `${base}/g/household`,
    `${base}/g/order`,
    `${base}/points`,
    `${base}/products`,
    `${base}/warehouses`,
    `${base}/supply`,
    `${base}/promos`,
    `${base}/loyalty`,
    `${base}/tasks`,
    `${base}/chat`,
    `${base}/team`,
    `${base}/journal`,
  ];

  // Имя cookie — с приставкой `__Secure-`: Auth.js выбирает её по `AUTH_URL`
  // (он https), а не по тому, куда стучится e2e. С простым `authjs.session-token`
  // все экраны отдавали 307 на вход, и тест проходил бы, ничего не измерив.
  // http://127.0.0.1 Chromium считает доверенным источником, поэтому приставка
  // принимается и на нём.
  const host = new URL(baseURL ?? "http://127.0.0.1:3000").hostname;
  await context.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: sessionToken,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  // Доказательство входа: без него проверка ширины мерила бы страницу входа.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toContainText("E2E hscroll");

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of paths) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const over = await page.evaluate(() => {
        const doc = document.documentElement;
        const slack = 1; // округление устройства — не прокрутка
        if (doc.scrollWidth <= doc.clientWidth + slack) return null;
        // Называем виновника: «страница шире окна» без него не починить.
        let worst: { tag: string; cls: string; right: number } | null = null;
        for (const el of Array.from(document.querySelectorAll("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > doc.clientWidth + slack && (!worst || r.right > worst.right)) {
            worst = {
              tag: el.tagName.toLowerCase(),
              cls: String((el as HTMLElement).className ?? "").slice(0, 120),
              right: Math.round(r.right),
            };
          }
        }
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, worst };
      });
      expect(over, `${path} @ ${width}px`).toBeNull();
    }
  }
});
