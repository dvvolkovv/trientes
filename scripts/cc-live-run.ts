/**
 * Живой прогон слайса CC настоящим браузером: продавец отправляет материал,
 * модератор проверяет и утверждает, витрина показывает, правка опубликованного
 * ждёт решения. Данные готовит `cc-live-seed.ts`, убирает `cc-live-clean.ts`.
 */
import { chromium, type BrowserContext } from "@playwright/test";

const BASE = "http://127.0.0.1:3000";
const seed = JSON.parse(process.argv[2] ?? "{}");

async function ctxFor(browser: Awaited<ReturnType<typeof chromium.launch>>, token: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{
    name: "__Secure-authjs.session-token", value: token, domain: "127.0.0.1",
    path: "/", httpOnly: true, secure: true, sameSite: "Lax",
  }]);
  return ctx;
}

async function body(ctx: BrowserContext, url: string) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const text = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n");
  return { page, text };
}

const has = (text: string, s: string) => (text.includes(s) ? "да" : "НЕТ");

async function main() {
  const browser = await chromium.launch();
  const merchant = await ctxFor(browser, seed.ownerToken);
  const mod = await ctxFor(browser, seed.modToken);
  const mod2 = await ctxFor(browser, seed.mod2Token);
  const studio = `/ru/cabinet/companies/${seed.company}/ads`;

  // 1. Студия продавца: публикует модератор, кнопки «опубликовать» нет.
  {
    const { page, text } = await body(merchant, studio);
    console.log("1 студия:", text.split("\n").filter((l) => /модерат|Занято|Черновик|Отправить|Опубликовать/i.test(l)).join(" | "));
    console.log("   кнопки «Опубликовать» нет:", text.includes("Опубликовать") ? "НЕТ — она есть" : "да");
    await page.getByRole("button", { name: /Отправить на проверку|Отправить на модерацию/i }).first().click();
    await page.waitForTimeout(1500);
    const after = (await page.locator("body").innerText());
    console.log("2 после отправки:", after.split("\n").filter((l) => /модератор|Отозвать|Занято/i.test(l)).join(" | "));
    console.log("   правка закрыта (нет «Править»):", after.includes("Править") ? "НЕТ" : "да");
    await page.close();
  }

  // 3. Очередь модератора: видна только его очередь.
  {
    const { page, text } = await body(mod, "/ru/admin/queues");
    console.log("3 очереди модератора:", text.split("\n").filter((l) => l.trim() && !/Trientes|Выход|Панель/i.test(l)).slice(0, 8).join(" | "));
    await page.close();
  }

  // 4. Дело: материал виден баннером, лист проверок, «проверил».
  const caseUrl = await (async () => {
    const { page, text } = await body(mod, "/ru/admin/queues/ads");
    console.log("4 очередь рекламы:", text.split("\n").filter((l) => /Скидка|дел|срок/i.test(l)).slice(0, 4).join(" | "));
    const href = await page.locator('a[href*="/admin/cases/"]').first().getAttribute("href");
    await page.close();
    return href ?? "";
  })();
  console.log("   дело:", caseUrl);

  {
    const page = await mod.newPage();
    await page.goto(`${BASE}${caseUrl}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    // Разделы дела — складные: раскрываем все, иначе меряем закрытую вёрстку.
    const open = async () => {
      const n = await page.locator("details").count();
      for (let i = 0; i < n; i += 1) {
        await page.locator("details").nth(i).evaluate((el) => ((el as HTMLDetailsElement).open = true)).catch(() => {});
      }
      await page.waitForTimeout(300);
    };
    await open();
    let text = await page.locator("body").innerText();
    console.log("5 карточка дела:", {
      материал: has(text, "Материал"),
      лицо: has(text, "cclive s.r.o."),
      kyb: has(text, "APPROVED"),
      баннер: await page.locator('img[src*="/uploads/ads/"]').count(),
      срок: text.includes("Осталось") || text.includes("дн") ? "да" : "НЕТ",
    });
    await page.getByRole("button", { name: /Взять|Взять дело/i }).first().click().catch(() => {});
    await page.waitForTimeout(900);
    await open();
    // Три обязательных пункта — «Да» по каждому.
    const yes = page.getByRole("button", { name: /^OK$/ });
    const n = await yes.count();
    for (let i = 0; i < n; i += 1) {
      await yes.nth(i).click().catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(500);
    text = await page.locator("body").innerText();
    console.log("6 лист проверок: кнопок «Да»", n, "| статус:", text.split("\n").filter((l) => /Проверк|пункт/i.test(l)).slice(0, 2).join(" | "));
    await page.getByRole("button", { name: /Проверил|Отметить проверенным/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    text = await page.locator("body").innerText();
    console.log("7 после «проверил»:", text.split("\n").filter((l) => /проверил|подпис|утверд/i.test(l)).slice(0, 3).join(" | "));
    await page.close();
  }

  // 8. Второй модератор утверждает.
  {
    const page = await mod2.newPage();
    await page.goto(`${BASE}${caseUrl}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    for (let i = 0; i < await page.locator("details").count(); i += 1) {
      await page.locator("details").nth(i).evaluate((el) => ((el as HTMLDetailsElement).open = true)).catch(() => {});
    }
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Одобрить/i }).first().click();
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText();
    console.log("8 решение:", text.split("\n").filter((l) => /Решено|Одобрен|статус|Закрыт/i.test(l)).slice(0, 3).join(" | "));
    await page.close();
  }

  // 9. Витрина: материал в карусели.
  {
    const { page, text } = await body(merchant, `/ru/companies/${seed.company}`);
    // Поверх кадра не лежит ничего (правило BY): заголовок раскрывается под
    // баннером, поэтому ищем сам кадр, а не слова.
    const frames = await page.locator('img[src*="/uploads/ads/"], video[src*="/uploads/ads/"]').count();
    console.log("9 витрина: кадров материала:", frames, "| заголовок в раскрытой части:", has(text, "Скидка на кофе"));
    await page.close();
  }

  // 10. Правка опубликованного ложится слепком.
  {
    const page = await merchant.newPage();
    await page.goto(`${BASE}${studio}?ad=${seed.ad}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    let text = await page.locator("body").innerText();
    console.log("10 форма правки опубликованного:", text.split("\n").filter((l) => /модератор|карусел|проверк/i.test(l)).slice(0, 3).join(" | "));
    await page.locator("#ad-title").fill("Скидка на чай всю неделю");
    await page.getByRole("button", { name: /Сохранить/i }).first().click();
    await page.waitForTimeout(2000);
    text = await page.locator("body").innerText();
    console.log("11 после правки:", text.split("\n").filter((l) => /модератор|одобренн|Правк|измен/i.test(l)).slice(0, 3).join(" | "));
    await page.close();
  }
  {
    const { page, text } = await body(merchant, `/ru/companies/${seed.company}`);
    const live = await page.locator('img[src*="/uploads/ads/"]').count();
    console.log("12 витрина во время правки: кадров", live, "| старый заголовок:", has(text, "Скидка на кофе"), "| новый:", has(text, "Скидка на чай"));
    await page.close();
  }

  // 13. Модератор видит «было → стало» и отвергает правку.
  {
    const page = await mod2.newPage();
    await page.goto(`${BASE}${caseUrl}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    for (let i = 0; i < await page.locator("details").count(); i += 1) {
      await page.locator("details").nth(i).evaluate((el) => ((el as HTMLDetailsElement).open = true)).catch(() => {});
    }
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Взять/i }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    for (let i = 0; i < await page.locator("details").count(); i += 1) {
      await page.locator("details").nth(i).evaluate((el) => ((el as HTMLDetailsElement).open = true)).catch(() => {});
    }
    await page.waitForTimeout(300);
    const text = await page.locator("body").innerText();
    console.log("13 дело после правки:", text.split("\n").filter((l) => /было|→|Скидка на чай|изменен/i.test(l)).slice(0, 5).join(" | "));
    // Текстовых полей на странице два — нитка переписки и причина решения;
    // целимся в причину по её подсказке.
    await page.getByPlaceholder(/Причина/i).first().fill("Заголовок обещает чай, а кадр с кофе — поправьте кадр.");
    await page.getByRole("button", { name: /Отклонить/i }).first().click();
    await page.waitForTimeout(2500);
    await page.waitForTimeout(1500);
    const after = await page.locator("body").innerText();
    console.log("14 после отказа:", after.split("\n").filter((l) => /Отклон|ошиб|не удал|Решено|закрыт/i.test(l)).slice(0, 3).join(" | "));
    await page.close();
  }
  {
    const { page, text } = await body(merchant, studio);
    console.log("15 продавец видит причину:", text.split("\n").filter((l) => /не принят|поправьте|карусел/i.test(l)).slice(0, 3).join(" | "));
    await page.close();
  }
  {
    const { page, text } = await body(merchant, `/ru/companies/${seed.company}`);
    console.log("16 витрина после отказа: старый заголовок:", has(text, "Скидка на кофе"));
    await page.close();
  }

  await browser.close();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
