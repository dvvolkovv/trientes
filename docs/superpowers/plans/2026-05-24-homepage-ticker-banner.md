# Homepage Ticker Banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin scrolling ticker between the homepage hero and the newsflow block. It alternates short marketing phrases (white, LED-dot styling) with live market numbers (orange) — total market cap, 24h volume, BTC dominance, Fear & Greed.

**Architecture:** One new client component `<HomeTicker />` rendering a CSS-only marquee. Items are built server-side in `page.tsx` from data already in Redis (`global:stats`, `fng:latest`) — **no worker changes**. Dot-letter effect via `background-clip: text` + radial-gradient mask in `globals.css`. Phrases come from a new `home.ticker.phrases` i18n key; numeric labels and F&G classifications reuse the existing `listing.*` translations already present in all 10 locales.

**Tech Stack:** Next.js 16 (Server Components + Client Components), Tailwind v4 (`@theme inline`), next-intl, existing Redis snapshot readers, existing format helpers in `src/lib/format.ts` and `src/lib/currency.ts`.

**Spec:** `docs/superpowers/specs/2026-05-24-homepage-ticker-banner-design.md`

---

## File Structure

**Create:**
- `src/components/home-ticker.tsx` — client component, ~80 lines: marquee viewport + items map.

**Modify:**
- `src/app/globals.css` — append `.ticker-dot-white`, `.ticker-dot-orange`, `.ticker-sep`, `.ticker-track`, `.ticker-viewport`, `@keyframes ticker-marquee`, and the `prefers-reduced-motion` override.
- `src/app/[locale]/page.tsx` — import `HomeTicker`, build `tickerItems` from `stats`/`fearGreed`/`th.raw("ticker.phrases")`, render `<HomeTicker items={...} locale={locale} />` between the HERO `</section>` (line 61) and the NEWSFLOW `{news.length > 0 && ...}` block.
- `messages/{en,ru,de,es,fr,ja,ko,pt-BR,tr,zh-CN}.json` — append `home.ticker.{ariaLabel, phrases[]}` to each. **Do NOT** duplicate labels/F&G keys — reuse `listing.globalMarketCap`, `listing.globalVolume`, `listing.btcDominance`, `listing.fearGreed`, `listing.fng.*` which already exist.

---

## Task 1: CSS — dot effect, marquee animation, reduced-motion override

**Files:**
- Modify: `src/app/globals.css` (append to end)

- [ ] **Step 1: Append the ticker styles to globals.css**

Append this block at the end of `src/app/globals.css`:

```css
/* ---- Homepage ticker (LED-dot scrolling strip above newsflow) ---- */
.ticker-viewport {
  overflow: hidden;
  position: relative;
  height: 36px;
}
.ticker-track {
  display: inline-flex;
  align-items: center;
  height: 100%;
  white-space: nowrap;
  animation: ticker-marquee 60s linear infinite;
  will-change: transform;
}
.ticker-viewport:hover .ticker-track {
  animation-play-state: paused;
}
@keyframes ticker-marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.ticker-dot-white,
.ticker-dot-orange {
  font-family: var(--font-inter), system-ui, sans-serif;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background-size: 2px 2px;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
.ticker-dot-white {
  background-image: radial-gradient(circle, #ffffff 0.6px, transparent 1px);
}
.ticker-dot-orange {
  background-image: radial-gradient(circle, #fe5c04 0.6px, transparent 1px);
}
.ticker-sep {
  margin: 0 1.25rem;
  color: rgba(254, 92, 4, 0.45);
  font-weight: 700;
  font-size: 13px;
}
.ticker-stat-label {
  opacity: 0.7;
  margin-right: 0.4em;
  font-style: normal;
}
@media (prefers-reduced-motion: reduce) {
  .ticker-track {
    animation: none;
    transform: translateX(0);
  }
  .ticker-viewport {
    overflow-x: auto;
  }
  .ticker-viewport::-webkit-scrollbar { display: none; }
}
```

- [ ] **Step 2: Verify build still compiles**

Run: `npm run build`
Expected: build succeeds (the new CSS adds no JS — only style rules; Tailwind v4 passes plain CSS through).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(home): CSS for LED-dot ticker marquee + reduced-motion override"
```

---

## Task 2: Create the `<HomeTicker />` client component

**Files:**
- Create: `src/components/home-ticker.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/home-ticker.tsx` with this exact content:

```tsx
"use client";

import Link from "next/link";

export type TickerItem =
  | { kind: "phrase"; text: string }
  | { kind: "stat"; label: string; value: string; href: string; ariaLabel?: string };

type HomeTickerProps = {
  items: TickerItem[];
  ariaLabel: string;
};

export function HomeTicker({ items, ariaLabel }: HomeTickerProps) {
  if (items.length === 0) return null;

  // Duplicate the items so translateX(-50%) yields a seamless loop.
  const doubled = [...items, ...items];

  return (
    <section
      aria-label={ariaLabel}
      className="border-y border-hairline bg-bg"
    >
      <div className="ticker-viewport">
        <div className="ticker-track">
          {doubled.map((item, i) => (
            <span key={i} className="inline-flex items-center">
              {item.kind === "phrase" ? (
                <span className="ticker-dot-white">{item.text}</span>
              ) : (
                <Link
                  href={item.href}
                  className="ticker-dot-orange hover:opacity-80 transition-opacity"
                  aria-label={item.ariaLabel ?? `${item.label} ${item.value}`}
                >
                  <em className="ticker-stat-label">{item.label}</em>
                  {item.value}
                </Link>
              )}
              <span className="ticker-sep" aria-hidden>
                •
              </span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `src/components/home-ticker.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/home-ticker.tsx
git commit -m "feat(home): HomeTicker client component (marquee + items renderer)"
```

---

## Task 3: Wire `<HomeTicker />` into the homepage

**Files:**
- Modify: `src/app/[locale]/page.tsx`

- [ ] **Step 1: Add imports at the top of `src/app/[locale]/page.tsx`**

After the existing `import { LivePrices } ...` line (line 6), add:

```tsx
import { HomeTicker, type TickerItem } from "@/components/home-ticker";
import { formatCompactInCurrency } from "@/lib/currency";
```

(Tip: `formatCompactInCurrency` is the same helper `GlobalStatsHero` already uses, so the ticker numbers will match the hero numbers byte-for-byte.)

- [ ] **Step 2: Inside the component, build `tickerItems` after the existing `await Promise.all(...)` block**

Right after the closing `]);` of `Promise.all` (currently line 31), add the following block. It uses the already-loaded `th` translator, plus a fresh `tl` translator alias from the existing `listing` namespace so we can reuse already-translated labels:

```tsx
  const tlist = await getTranslations("listing");

  // ----- Build ticker items: interleave phrases (white) and live stats (orange).
  const phrasesRaw = th.raw("ticker.phrases");
  const phrases: string[] = Array.isArray(phrasesRaw)
    ? (phrasesRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const statItems: TickerItem[] = [];
  if (stats && rates) {
    statItems.push({
      kind: "stat",
      label: tlist("globalMarketCap"),
      value: formatCompactInCurrency(stats.totalMarketCapUsd, currency, rates),
      href: `/${locale}/markets`,
    });
    statItems.push({
      kind: "stat",
      label: tlist("globalVolume"),
      value: formatCompactInCurrency(stats.total24hVolumeUsd, currency, rates),
      href: `/${locale}/markets`,
    });
    statItems.push({
      kind: "stat",
      label: tlist("btcDominance"),
      value: `${stats.btcDominancePct.toFixed(1)}%`,
      href: `/${locale}/markets`,
    });
  }
  if (fearGreed) {
    const fngKey =
      {
        "extreme fear": "fng.extremeFear",
        fear: "fng.fear",
        neutral: "fng.neutral",
        greed: "fng.greed",
        "extreme greed": "fng.extremeGreed",
      }[fearGreed.classification.toLowerCase()] ?? null;
    const fngLabel = fngKey ? tlist(fngKey) : fearGreed.classification;
    statItems.push({
      kind: "stat",
      label: tlist("fearGreed"),
      value: `${fearGreed.value} · ${fngLabel}`,
      href: `/${locale}/markets`,
    });
  }

  // Interleave: phrase, stat, phrase, stat, ... — phrases cycle if shorter.
  const tickerItems: TickerItem[] = [];
  const maxLen = Math.max(phrases.length, statItems.length);
  for (let i = 0; i < maxLen; i++) {
    if (phrases.length > 0) {
      tickerItems.push({ kind: "phrase", text: phrases[i % phrases.length] });
    }
    if (statItems[i]) tickerItems.push(statItems[i]);
  }
```

- [ ] **Step 3: Insert the `<HomeTicker />` between HERO and NEWSFLOW**

Currently line 61 closes the HERO `</section>` and line 63 starts the NEWSFLOW block. Insert this between them (before `{/* NEWSFLOW BANNER */}`):

```tsx
        {/* TICKER BANNER */}
        <HomeTicker items={tickerItems} ariaLabel={th("ticker.ariaLabel")} />
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed cleanly.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/page.tsx
git commit -m "feat(home): render HomeTicker between hero and newsflow"
```

---

## Task 4: i18n — Russian (`messages/ru.json`)

**Files:**
- Modify: `messages/ru.json` — append `ticker` subtree inside the existing `"home"` object.

- [ ] **Step 1: Locate the `home` namespace in `messages/ru.json`**

Open `messages/ru.json` and find the `"home": { ... }` block. Inside it, alongside the existing keys (`heroLine1`, `heroLine2Before`, `heroLine2Accent`, `heroLine2After`, `heroEyebrow`, `heroSubtitle`, …), add a new `ticker` sub-object.

- [ ] **Step 2: Add the `ticker` block**

Inside `"home"`, add:

```json
"ticker": {
  "ariaLabel": "Подсветка сервиса и живой рыночный тикер",
  "phrases": [
    "Реестр цифровой монеты",
    "Топ Layer-1",
    "8 фиатных валют",
    "Графики за 7 дней",
    "Новости рынка в реальном времени",
    "Крипто-навигатор по миру",
    "Цены без задержек"
  ]
}
```

Place it as the last key inside `"home"` (mind the comma on the preceding key).

- [ ] **Step 3: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/ru.json','utf8'))"`
Expected: command exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add messages/ru.json
git commit -m "i18n(home): ticker phrases + aria label (ru)"
```

---

## Task 5: i18n — English (`messages/en.json`)

**Files:**
- Modify: `messages/en.json`

- [ ] **Step 1: Add the same `ticker` block under `home` in `messages/en.json`**

```json
"ticker": {
  "ariaLabel": "Service highlights and live market ticker",
  "phrases": [
    "Digital coin registry",
    "Top Layer-1",
    "8 fiat currencies",
    "7-day charts",
    "Live market news",
    "Worldwide crypto navigator",
    "Prices with no delay"
  ]
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('messages/en.json','utf8'))"`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json
git commit -m "i18n(home): ticker phrases + aria label (en)"
```

---

## Task 6: i18n — remaining 8 locales

**Files:**
- Modify: `messages/de.json`, `messages/es.json`, `messages/fr.json`, `messages/ja.json`, `messages/ko.json`, `messages/pt-BR.json`, `messages/tr.json`, `messages/zh-CN.json`

For each file below, add the same `ticker` sub-object inside `"home"`. Phrases are translated per locale. The `ariaLabel` is the locale-equivalent of "Service highlights and live market ticker".

- [ ] **Step 1: `messages/de.json`**

```json
"ticker": {
  "ariaLabel": "Service-Highlights und Live-Markt-Ticker",
  "phrases": [
    "Register der Digitalmünze",
    "Top Layer-1",
    "8 Fiat-Währungen",
    "7-Tage-Charts",
    "Live-Marktnachrichten",
    "Weltweiter Krypto-Navigator",
    "Preise ohne Verzögerung"
  ]
}
```

- [ ] **Step 2: `messages/es.json`**

```json
"ticker": {
  "ariaLabel": "Destacados del servicio y ticker de mercado en vivo",
  "phrases": [
    "Registro de la moneda digital",
    "Top Layer-1",
    "8 monedas fiat",
    "Gráficos a 7 días",
    "Noticias del mercado en vivo",
    "Navegador cripto mundial",
    "Precios sin retraso"
  ]
}
```

- [ ] **Step 3: `messages/fr.json`**

```json
"ticker": {
  "ariaLabel": "Points forts du service et téléscripteur de marché en direct",
  "phrases": [
    "Registre de la pièce numérique",
    "Top Layer-1",
    "8 devises fiat",
    "Graphiques sur 7 jours",
    "Actualités de marché en direct",
    "Navigateur crypto mondial",
    "Prix sans délai"
  ]
}
```

- [ ] **Step 4: `messages/ja.json`**

```json
"ticker": {
  "ariaLabel": "サービスのハイライトとライブ市場ティッカー",
  "phrases": [
    "デジタル通貨のレジスター",
    "トップ Layer-1",
    "8 つの法定通貨",
    "7 日チャート",
    "ライブ市場ニュース",
    "世界のクリプトナビゲーター",
    "遅延のない価格"
  ]
}
```

- [ ] **Step 5: `messages/ko.json`**

```json
"ticker": {
  "ariaLabel": "서비스 하이라이트 및 실시간 시장 티커",
  "phrases": [
    "디지털 코인 레지스터",
    "Top Layer-1",
    "8 개 법정 화폐",
    "7 일 차트",
    "실시간 시장 뉴스",
    "전 세계 크립토 내비게이터",
    "지연 없는 가격"
  ]
}
```

- [ ] **Step 6: `messages/pt-BR.json`**

```json
"ticker": {
  "ariaLabel": "Destaques do serviço e ticker de mercado ao vivo",
  "phrases": [
    "Registro da moeda digital",
    "Top Layer-1",
    "8 moedas fiat",
    "Gráficos de 7 dias",
    "Notícias de mercado ao vivo",
    "Navegador cripto mundial",
    "Preços sem atraso"
  ]
}
```

- [ ] **Step 7: `messages/tr.json`**

```json
"ticker": {
  "ariaLabel": "Servis öne çıkanları ve canlı piyasa şeridi",
  "phrases": [
    "Dijital paranın sicili",
    "En iyi Layer-1",
    "8 itibari para birimi",
    "7 günlük grafikler",
    "Canlı piyasa haberleri",
    "Dünya çapında kripto navigatörü",
    "Gecikmesiz fiyatlar"
  ]
}
```

- [ ] **Step 8: `messages/zh-CN.json`**

```json
"ticker": {
  "ariaLabel": "服务亮点和实时市场行情",
  "phrases": [
    "数字货币登记册",
    "顶级 Layer-1",
    "8 种法币",
    "7 天图表",
    "实时市场新闻",
    "全球加密导航器",
    "价格无延迟"
  ]
}
```

- [ ] **Step 9: Validate all 8 JSON files parse**

Run:
```bash
for f in de es fr ja ko pt-BR tr zh-CN; do
  node -e "JSON.parse(require('fs').readFileSync('messages/${f}.json','utf8'))" || echo "BROKEN: $f"
done
```
Expected: no `BROKEN:` lines printed.

- [ ] **Step 10: Commit**

```bash
git add messages/de.json messages/es.json messages/fr.json messages/ja.json \
        messages/ko.json messages/pt-BR.json messages/tr.json messages/zh-CN.json
git commit -m "i18n(home): ticker phrases + aria label (de, es, fr, ja, ko, pt-BR, tr, zh-CN)"
```

---

## Task 7: Build, deploy, manual verification

**Files:** none

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds. If TypeScript or ESLint complain, fix and re-run before deploying — never deploy a failing build.

- [ ] **Step 2: Restart the web process**

Run: `pm2 restart trientes-web && pm2 save`
Expected: process restarts cleanly. Worker is NOT restarted (no `src/lib` consumer touched).

- [ ] **Step 3: Manual smoke test — Russian locale**

Open https://trientes.org/ru in a browser.

Verify:
- A horizontal strip is visible **between** the hero "Реестр цифровой монеты" headline + global stats block, and the "Newsflow" headline.
- Strip scrolls right-to-left smoothly (~60s per full loop).
- Letters look composed of dots (LED-style).
- White phrases include "РЕЕСТР ЦИФРОВОЙ МОНЕТЫ", "ТОП LAYER-1", etc.
- Orange items show "Общая капитализация: $X.XXT", "Объём за 24ч: $X.XXB", "Доминация BTC: NN.N%", "Страх и жадность: NN · Страх/Жадность/etc.".
- Numbers match the values shown in the GlobalStatsHero above.
- Hovering the strip pauses the animation.
- Clicking any orange item navigates to `/ru/markets`.

- [ ] **Step 4: Manual smoke test — English + at least one CJK locale**

Open https://trientes.org/en and https://trientes.org/zh-CN.

Verify the strip renders, the phrases are in the right language, and CJK glyphs are visible as dot-patterns (might appear denser due to higher stroke count — acceptable as long as they are readable).

- [ ] **Step 5: Reduced-motion check**

In the browser devtools: Rendering panel → "Emulate CSS media feature prefers-reduced-motion: reduce". Reload.
Expected: strip is static, can be scrolled horizontally with mouse/trackpad without auto-animation.

- [ ] **Step 6: Mobile width check**

DevTools → toggle device toolbar → set width to 375px. Reload.
Expected: strip remains a single line at full width, does not overflow vertically, does not break the page layout.

- [ ] **Step 7: Push to origin**

Run: `git push origin main`
Expected: push succeeds. (This server has the deploy key.)

- [ ] **Step 8: Take a screenshot of the live banner**

Save a screenshot to `trientes-ticker-deployed.png` in the repo root (this matches the project's convention of dropping deployment proof images in the working tree). One screenshot of the ticker area on `/ru` is enough.

---

## Out-of-Scope (explicit non-tasks)

- Commodities (gold/oil/metals) in the ticker — separate slice.
- Click-through analytics — not wired here.
- Admin UI for editing phrases — phrases stay in i18n.
- Unit tests for `HomeTicker` — pure presentation; covered by manual smoke test + the project's prevailing pattern (no UI unit tests in earlier slices either).
