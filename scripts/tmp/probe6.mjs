import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 393, height: 800 } });
const p = await ctx.newPage();
await p.goto("https://trientes.org/ru", { waitUntil: "load" });
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
  const styles = document.querySelectorAll("style").length;
  const d = document.createElement("div"); d.className = "hidden"; document.body.appendChild(d);
  const disp = getComputedStyle(d).display; d.remove();
  const nav = document.querySelector("header nav");
  return { links, styles, sheets: document.styleSheets.length, probeDisplay: disp, navDisplay: nav ? getComputedStyle(nav).display : null, bodyBg: getComputedStyle(document.body).backgroundColor };
}), null, 1));
await b.close();
