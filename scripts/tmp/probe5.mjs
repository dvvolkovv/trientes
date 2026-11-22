import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 800 } });
const p = await ctx.newPage();
await p.goto("https://trientes.org/ru", { waitUntil: "networkidle" });
console.log(JSON.stringify(await p.evaluate(() => {
  const d = document.createElement("div"); d.className = "hidden"; document.body.appendChild(d);
  const disp = getComputedStyle(d).display;
  d.remove();
  const sheets = [...document.styleSheets].map(s => { try { return { href: s.href, rules: s.cssRules.length }; } catch (e) { return { href: s.href, err: String(e).slice(0,40) }; } });
  return { probeDisplay: disp, sheets };
}), null, 1));
await b.close();
