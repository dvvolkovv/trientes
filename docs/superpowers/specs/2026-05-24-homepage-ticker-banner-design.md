# Бегущая строка над блоком новостей на главной

**Дата:** 2026-05-24
**Раздел:** новый компонент `<HomeTicker />` на `/{locale}` между HERO и NEWSFLOW

## Контекст

Цель — добавить узкую горизонтальную полосу-бегущую строку прямо над блоком
«Newsflow» на главной. В строке чередуются короткие маркетинговые фразы о
сервисе (белым «LED-точечным» шрифтом) и живые рыночные цифры — общая
капитализация, объём за 24 часа, доминация BTC, индекс Fear & Greed (оранжевым).
Между элементами — оранжевая точка-разделитель.

Запрошено голосом 2026-05-24. Дизайн согласован устно (см. голосовые
`otchet-ticker-vopros-2026-05-24.mp3`, `otchet-ticker-design-2026-05-24.mp3`).

## Принципы (согласовано голосом)

- Контент **только** двух типов в этом слайсе: (а) фразы из i18n,
  (б) уже кешированные в Redis рыночные цифры. Сырьё (золото, нефть, металлы) —
  отдельным слайсом позже; здесь его НЕ трогаем.
- Никаких новых внешних API и никакой работы в `trientes-worker` — используем
  существующие cache-keys `global:stats` и `fng:latest`.
- Шрифт «из точек» — через CSS-маску с `background-clip: text`, чтобы работало
  на всех 10 локалях, включая CJK. Готовый «pixel»-web-font не подходит
  (нет глифов под китайский/японский/корейский).
- Тёмная тема фиксирована (сайт всегда dark), цвета — белый `#ffffff` и
  бренд-оранжевый `#fe5c04`.
- Полоса всегда видна (если кеш пуст — показываем только фразы, без пустых
  цифр).

## Размещение

Файл: `src/app/[locale]/page.tsx`. Новая `<section>` вставляется между
существующим HERO (`</section>` на строке 61) и блоком `NEWSFLOW BANNER`
(строка 63). Полоса остаётся внутри того же `max-w-[1600px]`-контейнера, что и
остальное содержимое страницы, чтобы не ломать сетку.

## Компоненты

### `src/components/home-ticker.tsx` (client component)

Один файл, всё внутри. Принимает props:

```ts
type TickerItem =
  | { kind: "phrase"; text: string }
  | { kind: "stat"; label: string; value: string; href: string };

type HomeTickerProps = {
  items: TickerItem[];   // готовые к рендеру элементы (уже отформатированы)
  locale: string;        // для ссылок и aria
};
```

Рендерит:

```
<section aria-label="..." className="border-y border-white/5 bg-[#161616]">
  <div className="ticker-viewport overflow-hidden">
    <div className="ticker-track animate-marquee">
      {items × 2}   {/* дублируем для бесшовного цикла */}
    </div>
  </div>
</section>
```

Каждый item рендерится так:

- `phrase` → `<span className="ticker-dot-white">{text}</span>`
- `stat` → `<a href={href} className="ticker-dot-orange"><em>{label}:</em> {value}</a>`
- между элементами — `<span className="ticker-sep" aria-hidden>•</span>`

### Серверная подготовка данных (в `page.tsx`)

В существующей серверной функции, которая уже читает `stats` и `fearGreed`,
дополнительно собирается массив `tickerItems: TickerItem[]`:

1. **Phrases** — берутся из i18n через `t.raw("home.ticker.phrases")`
   (next-intl API для получения сырого массива). Если ключа нет — массив
   пустой, фразы не показываются.
2. **Stats** — если `stats` присутствует, добавляются 4 элемента:
   - mcap: `{label: t("home.ticker.labels.mcap"), value: formatCompactUsd(stats.totalMcap, currency, rates), href: "/{locale}/markets"}`
   - vol24h: аналогично
   - btc.d: `formatPercent(stats.btcDominance, 1)`
   - F&G: `${fearGreed.value} · ${t("home.ticker.fng." + fearGreed.classification)}`
3. **Interleaving** — порядок: phrase, stat, phrase, stat, …
   (чередуем; если фраз меньше, чем цифр — повторяем фразы по кругу).
   Не сортируем по чему-либо специальному.
4. **Если итоговый `tickerItems` пуст** (нет ни фраз, ни цифр) — `<HomeTicker />`
   не рендерится вовсе. На странице остаётся прежний gap между HERO и Newsflow.

Форматтеры — существующие в `src/lib/format.ts` (compact USD, percent).

## Визуальный стиль («буквы из точек»)

Добавляем три utility-класса в `src/app/globals.css`:

```css
.ticker-dot-white,
.ticker-dot-orange {
  font-family: var(--font-inter);
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
  margin: 0 1.5rem;
  color: rgba(254, 92, 4, 0.45);
  font-weight: 700;
}
```

Точный размер точек (0.6px / 2px tile) подбирается визуально при реализации —
цель: буквы читаемы и явно собраны из точек, как старое LED-табло. CJK-иероглифы
получат тот же эффект «из ничего» — точки заливают форму глифа.

## Анимация

```css
@keyframes ticker-marquee {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.animate-marquee {
  display: inline-flex;
  white-space: nowrap;
  animation: ticker-marquee 60s linear infinite;
  will-change: transform;
}
.ticker-viewport:hover .animate-marquee { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) {
  .animate-marquee { animation: none; transform: translateX(0); }
}
```

- `translateX(-50%)` работает корректно благодаря удвоенному набору items внутри
  трека.
- Пауза на hover — только десктоп (на touch hover не сработает, и это
  ожидаемо: пользователь сможет тапнуть по цифре, чтобы перейти).
- При `prefers-reduced-motion` — статичная полоса, скролл колесом/тачем работает
  благодаря `overflow-x` на viewport (см. ниже).

## Мобилка / overflow

Viewport получает `overflow-x: auto` на мобильном (`md:overflow-hidden`), чтобы
при отключённой анимации пользователь мог промотать руками. Скроллбар скрыт:

```css
.ticker-viewport { overflow: hidden; }
.ticker-viewport::-webkit-scrollbar { display: none; }
```

Высота полосы — `36px` (фиксированно), padding-y `8px`.

## i18n

Новый namespace `home.ticker` во всех 10 локалях
(`en, ru, de, es, fr, ja, ko, pt-BR, tr, zh-CN`):

```jsonc
"home": {
  "ticker": {
    "labels": {
      "mcap":         "Капитализация",
      "volume":       "Объём 24ч",
      "btcDominance": "BTC.D",
      "fearGreed":    "Fear & Greed"
    },
    "fng": {
      "Extreme Fear":  "крайний страх",
      "Fear":          "страх",
      "Neutral":       "нейтрально",
      "Greed":         "жадность",
      "Extreme Greed": "крайняя жадность"
    },
    "phrases": [
      "Реестр цифровой монеты",
      "Топ Layer-1",
      "8 фиатных валют",
      "Графики 7 дней",
      "Новости рынка в реальном времени",
      "Крипто-навигатор по миру",
      "Цены без задержек"
    ]
  }
}
```

Каждая локаль получает свой перевод фраз (а не транслит). `fng.*` — ключи
совпадают с тем, что отдаёт alternative.me; неизвестную классификацию падающим
fallback показываем «как есть».

## Доступность

- `<section aria-label="Service highlights and live market ticker">` (текст —
  i18n-ключ `home.ticker.ariaLabel`).
- Числовые ссылки получают `aria-label` вида «Total market cap, 2.3 trillion
  dollars», чтобы скринридеры не читали голую цифру без контекста.
- `prefers-reduced-motion` уже учтён.

## Что НЕ делаем в этом слайсе

- Сырьё (золото, нефть, металлы). Их нет в кеше для главной — нужно отдельно
  добавлять в `worker/index.ts` синхронизацию, расширять `KEYS.*` и формат
  ответа. Отдельный спек.
- Click-through аналитика (Plausible/Umami events).
- Админ-редактируемый список фраз. Сейчас фразы — в i18n; обновление = коммит.
- A/B-варианты порядка/скорости.

## Тестирование (ручное, перед `pm2 restart`)

1. `npm run build` — TypeScript должен пройти чисто.
2. Поднять локально (или после деплоя на проде), открыть `/ru`, `/en`, `/zh-CN`,
   `/ja` — проверить, что:
   - полоса видна между шапкой и Newsflow;
   - буквы реально выглядят «из точек», читаются;
   - цифры есть и совпадают с теми, что показаны в GlobalStatsHero выше;
   - наведение мышкой ставит на паузу;
   - клик по цифре ведёт на `/{locale}/markets`;
   - на мобильной ширине (≤640px) полоса не ломает layout.
3. Опустошить Redis-ключ `global:stats` (или временно) → проверить, что полоса
   всё равно рендерится, но без цифр.
4. Включить «уменьшение движения» в OS → проверить, что анимация отключена.

## Деплой

Web-only: `npm run build && pm2 restart trientes-web && pm2 save`.
Worker не трогаем — данные уже там лежат.
