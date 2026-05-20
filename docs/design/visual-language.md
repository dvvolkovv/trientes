# Trientes Visual Language

> Production brand language for trientes.org. Sibling-aligned with [trientes.com](https://trientes.com) (mobile wallet).

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| `bg` | `#161616` | Page background |
| `bg-tint` | `#16151A` | Hover surfaces, secondary fill |
| `card` | `#1E1D24` | Card backgrounds, table chrome |
| `card-alt` | `#312F3A` | Hover on cards, secondary buttons |
| `hairline` | `#2A2932` | All separators and table dividers |
| `foreground` | `#FFFFFF` | Primary text |
| `muted` | `#A09BAA` | Secondary text, eyebrows, captions |
| `muted-strong` | `#C6C1CF` | Body copy (descriptions) |
| `accent` | `#F7931A` | Reserved: primary CTAs, brand mark only |
| `accent-foreground` | `#0A0A0A` | Text on accent surfaces |
| `up` | `#30B658` | Positive price/percent + live indicator |
| `down` | `#E55C5C` | Negative price/percent |
| `info` | `#304DB6` | AUTO_L1 source badge |

## Typography

- **Display:** Inter 900 (`font-black`) at `text-[42px]` mobile → `text-[112px]` desktop. Tracking `-0.045em`. Used for hero only.
- **Section:** Inter 700 (`font-bold`) at `text-[32-40px]`. Tracking `-0.03em`.
- **Body:** Inter 400. `text-[15px-18px]`. Subtitles `font-light text-muted`.
- **Eyebrow:** `text-[11px] uppercase tracking-[0.18-0.3em]` (`text-muted` or `text-up`). Always followed by larger heading.
- **Numeric:** JetBrains Mono via `.num` class. Always tabular figures (`tnum`). Apply to every price, percent, market-cap, volume, rank.

## Hero pattern

- Orange-on-card eyebrow (`text-up` actually — live indicator green): `● Live · Layer-1 Ledger · refreshed every 10 min`
- Two-line headline; second line includes an italic-orange accent word
- Subtitle in `text-muted font-light`, max-w-[640px]
- Right column: 4-row global stats with hairline dividers, `.num text-[22px]`

## Tables

- Wrapper: `bg-card border border-hairline rounded-[20px] overflow-hidden`
- Header row: `text-[11px] uppercase tracking-[0.18em] text-muted px-5 py-4 border-b border-hairline`
- Body rows: `px-5 py-5 border-b border-hairline hover:bg-bg-tint transition-colors`
- Mobile (<md): switch to cards via `hidden md:block` / `md:hidden`

## Buttons

- **Primary CTA:** `bg-accent text-accent-foreground glow-accent rounded-md px-4 py-2.5 text-sm font-semibold uppercase tracking-wider`. Reserved for sign-in, approve, add-coin, submit forms.
- **Secondary:** `bg-card-alt text-foreground border border-hairline rounded-md px-4 py-2 text-sm font-medium`
- **Ghost:** `text-muted hover:text-foreground rounded-md px-3 py-1.5 text-sm`
- **Inverse (selected tab / active filter):** `bg-foreground text-bg`. Use for timeframe tabs, active filter pills.

## Sparkline

- Brand-orange line + gradient fill (0.24 → 0 opacity)
- Default desktop: `120 × 36`. Mobile card: `80 × 24`.
- Direction (up/down) is conveyed by the adjacent percent column, NOT by line color.

## Live updates

- `data-live-price={coinId}` attribute on every price element
- Client component `<LivePrices>` subscribes to `/api/stream/prices` SSE
- On tick: text updates + flash animation (green up / red down) for 700ms

## Spacing scale

- Mobile padding: `px-4`
- Desktop padding: `px-12 xl:px-20`
- Vertical hero: `py-12 md:py-28`
- Section: `py-12`
- Card interiors: `p-6 md:p-8` (large), `p-4` (compact mobile card)

## Don't

- Don't use accent (orange) for non-CTA states. It's the single brand colour reserved for action.
- Don't introduce additional display fonts. Inter does all the heavy lifting via weight + tracking.
- Don't break tabular numerics. Always `.num` on every cell with a number.
- Don't show fake live timestamps — use static "refreshed every X min" copy instead.

## Reference: trientes.com

Sibling product (mobile multi-currency wallet) from the same group. The dark palette + Inter + Bitcoin-orange accent + rounded-[20px] cards all originate there. Stay consistent across both products.
