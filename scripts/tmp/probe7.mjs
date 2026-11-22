import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 280, height: 800 }, locale: "ru-RU" });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:3200/ru", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => {
  const row = document.querySelector("header > div");
  return {
    rowW: row.getBoundingClientRect().width,
    kids: [...row.children].map(c => ({
      tag: c.tagName.toLowerCase(), cls: String(c.className).slice(0, 70),
      w: Math.round(c.getBoundingClientRect().width), right: Math.round(c.getBoundingClientRect().right),
      disp: getComputedStyle(c).display,
    })),
  };
}), null, 1));
await b.close();
