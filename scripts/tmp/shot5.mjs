import { chromium, devices } from "@playwright/test";
const TOKEN = process.argv[2];
const b = await chromium.launch();
for (const [w, fs, tag] of [[320, 16, "320"], [393, 22, "big"], [320, 22, "320big"]]) {
  const ctx = await b.newContext({ ...devices["iPhone 13 Pro"], viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "ru-RU" });
  await ctx.addCookies([{ name: "__Secure-authjs.session-token", value: TOKEN, domain: "trientes.org", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
  const p = await ctx.newPage();
  await p.addInitScript((size) => {
    document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = size + "px"; });
  }, fs);
  await p.goto("https://trientes.org/ru/companies/cmwm2jtfr0009d7fcink72rv7", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `/home/dv/trientes-artifacts/screens/arcon-${tag}.png`, fullPage: false });
  console.log(tag, await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  await ctx.close();
}
await b.close();
