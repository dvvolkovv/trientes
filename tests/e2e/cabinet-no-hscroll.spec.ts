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

/**
 * 280 px — не выдуманный узкий случай, а живой экран: iPhone 15 с текстовым
 * увеличением Safari («Aa») сужает эффективную ширину примерно до 262–280 px.
 * Ровно там владелец и увидел, как «одно на другое наезжает» (слайс BX).
 */
const WIDTHS = [280, 320, 390];

let userId = "";
let companyId = "";
let adId = "";
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
  // Студию мерили пустой — а значит не мерили вовсе: ни формы бумаг, ни
  // предпросмотра, ни полей места там нет, пока нет материала. Жалоба владельца
  // («во время правок поля ездят вправо-влево») пришла именно с правки.
  const ad = await prisma.companyAd.create({
    data: {
      companyId: company.id,
      kind: "PROMO",
      title: "Временный материал проверки ширины экрана",
      body: "Текст материала для проверки того, что поля не уезжают вбок.",
      language: "ru",
      mediaKind: "IMAGE",
      mediaUrl: `/uploads/ads/${company.id}/00000000000000000000000000000000.png`,
      // Два кадра (слайс CE): список кадров со стрелками «выше/ниже» и «убрать» —
      // самая широкая строка студии, и мерить её надо именно на узком экране.
      slides: [
        { kind: "IMAGE", url: `/uploads/ads/${company.id}/00000000000000000000000000000000.png` },
        { kind: "VIDEO", url: `/uploads/ads/${company.id}/11111111111111111111111111111111.mp4` },
      ],
      promoCode: "WIDTH-280",
      status: "DRAFT",
      placeName: "Место материала",
      placeAddress: "Dlouhá 12, Praha",
      placeLat: 50.0875,
      placeLon: 14.4213,
      action: "NONE",
    },
    select: { id: true },
  });
  adId = ad.id;
  await prisma.companyDocument.create({
    data: {
      companyId: company.id,
      adId: ad.id,
      kind: "other",
      kindCustom: "Разрешение",
      title: "Разрешение на размещение",
      linkUrl: "https://example.org/permit",
      publishedAt: new Date(),
    },
  });
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

test("экраны кабинета предприятия не ездят по горизонтали на 280, 320 и 390 px", async ({ page, context, baseURL }) => {
  // Два десятка адресов на три ширины — больше шестидесяти переходов: общий тридцатисекундный
  // срок набора для этого прогона мал, и падение по сроку выглядело бы как
  // переполнение, которого нет.
  test.setTimeout(240_000);
  const base = `/ru/cabinet/companies/${companyId}`;
  const paths = [
    "/ru/cabinet",
    // Публичная витрина предприятия: её открывают из подписок, и жалоба
    // владельца была именно про неё (слайс BX).
    `/ru/companies/${companyId}`,
    "/ru/cabinet/subscriptions",
    // Свои чеки покупателя (слайс CK).
    "/ru/cabinet/receipts",
    "/ru/cabinet/companies",
    "/ru/cabinet/companies/new",
    base,
    `${base}?edit=1`,
    `${base}/g/showcase`,
    `${base}/g/household`,
    `${base}/g/order`,
    `${base}/points`,
    `${base}/products`,
    `${base}/sales`,
    // Отчётность (слайс CL): сводка, выгрузка и ключи API — таблиц на экране больше
    // всего, и сюда же пришёл период с двумя полями даты.
    `${base}/reports`,
    `${base}/warehouses`,
    `${base}/supply`,
    `${base}/promos`,
    `${base}/ads`,
    // Та же студия в правке: форма места, бумаги и предпросмотр появляются только тут.
    `${base}/ads?ad=${adId}`,
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

  // Вторая половина той же жалобы, и причина у неё другая: Safari на iPhone
  // приближает страницу, когда фокус попадает в поле с кеглем меньше 16 px, и
  // после этого страница ездит боком. Мерим кегль, а не последствие: прокрутки
  // в Chromium при этом нет вовсе, и первая проверка такое пропускает.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`${base}/ads?ad=${adId}`, `${base}?edit=1`, `${base}/points`]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    const small = await page.evaluate(() => {
      const out: { tag: string; type: string; size: number }[] = [];
      for (const el of Array.from(document.querySelectorAll("input, select, textarea"))) {
        const e = el as HTMLInputElement;
        const type = (e.getAttribute("type") ?? "").toLowerCase();
        if (["checkbox", "radio", "range", "color", "hidden", "file"].includes(type)) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const size = parseFloat(getComputedStyle(e).fontSize);
        if (size < 16) out.push({ tag: e.tagName.toLowerCase(), type, size });
      }
      return out;
    });
    expect(small, `${path}: поля мельче 16px — Safari приблизит страницу при фокусе`).toEqual([]);
  }
});
