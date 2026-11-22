import { chromium } from "@playwright/test";
const b = await chromium.launch();
for (const w of [280, 393, 500]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, locale: "ru-RU" });
  const p = await ctx.newPage();
  await p.goto("https://trientes.org/ru", { waitUntil: "networkidle" });
  console.log(w, JSON.stringify(await p.evaluate(() => {
    const nav = document.querySelector("header nav");
    const has = [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText === ".hidden"); } catch { return false; } });
    return { display: nav ? getComputedStyle(nav).display : null, width: nav?.getBoundingClientRect().width, hiddenRule: has, sw: document.documentElement.scrollWidth };
  })));
  await ctx.close();
}
await b.close();
