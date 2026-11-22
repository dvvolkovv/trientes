import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 280, height: 800 }, locale: "ru-RU" });
await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: process.argv[2], domain: "trientes.org", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
const p = await ctx.newPage();
await p.goto("https://trientes.org/ru/cabinet", { waitUntil: "networkidle" });
console.log(JSON.stringify(await p.evaluate(() => {
  const nav = document.querySelector("header nav");
  const cs = nav ? getComputedStyle(nav) : null;
  return { cls: nav?.className, display: cs?.display, width: nav?.getBoundingClientRect().width, mq1800: matchMedia("(min-width:1800px)").matches, innerW: window.innerWidth };
}), null, 1));
await b.close();
