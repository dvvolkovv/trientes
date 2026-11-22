import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 280, height: 800 }, locale: "ru-RU" });
await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: process.argv[2], domain: "127.0.0.1", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:3200/ru/cabinet", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(() => {
  const doc = document.documentElement;
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > doc.clientWidth + 1) {
      const chain = []; let n = el;
      while (n && n !== document.body) { chain.push(`${n.tagName.toLowerCase()}|${String(n.className||"").slice(0,55)}`); n = n.parentElement; }
      out.push({ right: Math.round(r.right), text: (el.textContent||"").trim().slice(0,25), chain: chain.slice(0,4) });
    }
  }
  return { sw: doc.scrollWidth, title: document.title.slice(0,40), worst: out.sort((a,b)=>b.right-a.right).slice(0,2) };
}), null, 1));
await b.close();
