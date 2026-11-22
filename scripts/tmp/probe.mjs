import { chromium } from "@playwright/test";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 280, height: 800 }, locale: "ru-RU" });
const p = await ctx.newPage();
await p.goto("https://trientes.org/ru", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const doc = document.documentElement;
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > doc.clientWidth + 1) {
      const chain = [];
      let n = el;
      while (n && n !== document.body) { chain.push(`${n.tagName.toLowerCase()}.${String(n.className||"").slice(0,50)}`); n = n.parentElement; }
      out.push({ right: Math.round(rect.right), chain: chain.slice(0, 4) });
    }
  }
  return { sw: doc.scrollWidth, cw: doc.clientWidth, worst: out.sort((a,b)=>b.right-a.right).slice(0,3) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
