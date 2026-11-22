import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 280, height: 800 }, locale: "ru-RU" });
await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: process.argv[2], domain: "trientes.org", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
const p = await ctx.newPage();
await p.goto("https://trientes.org/ru/cabinet", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1200);
console.log(JSON.stringify(await p.evaluate(() => {
  const doc = document.documentElement;
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > doc.clientWidth + 1) {
      const chain = []; let n = el;
      while (n && n !== document.body) { chain.push(`${n.tagName.toLowerCase()}|${String(n.className||"").slice(0,60)}`); n = n.parentElement; }
      out.push({ right: Math.round(rect.right), text: (el.textContent||"").slice(0,30), chain: chain.slice(0,5) });
    }
  }
  return { sw: doc.scrollWidth, worst: out.sort((a,b)=>b.right-a.right).slice(0,2) };
}), null, 1));
await b.close();
