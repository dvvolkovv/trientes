import { chromium, devices } from "@playwright/test";
const TOKEN = process.argv[2];
const urls = [
  ["storefront", "https://trientes.org/ru/companies/cmwm2jtfr0009d7fcink72rv7"],
  ["subs", "https://trientes.org/ru/cabinet/subscriptions"],
];
const b = await chromium.launch();
for (const w of [240, 262, 280, 300, 320, 360, 393]) {
  const ctx = await b.newContext({ ...devices["iPhone 13 Pro"], viewport: { width: w, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: TOKEN, domain: "trientes.org", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  const p = await ctx.newPage();
  for (const [tag, url] of urls) {
    await p.goto(url, { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const d = document.documentElement;
      const over = [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > d.clientWidth + 1).slice(0, 4)
        .map(e => `${e.tagName}.${(e.className||"").toString().slice(0,60)}`);
      return { sw: d.scrollWidth, cw: d.clientWidth, over };
    });
    console.log(w, tag, r.sw, r.cw, r.sw > r.cw ? "OVERFLOW " + JSON.stringify(r.over) : "ok");
  }
  await ctx.close();
}
await b.close();
