import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Brand palette (shared with trientes.com)
const C = {
  bg: "#161616",
  bgTint: "#16151A",
  card: "#1E1D24",
  cardAlt: "#312F3A",
  text: "#FFFFFF",
  muted: "#A09BAA",
  hairline: "#2A2932",
  orange: "#F7931A",
  green: "#30B658",
  blue: "#304DB6",
  red: "#E55C5C",
} as const;

// Mock data — top 5 L1s with realistic numbers
const COINS = [
  {
    rank: 1,
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    price: 76684.12,
    h1: 0.21,
    h24: -0.47,
    d7: -4.71,
    mcap: 1.53e12,
    vol: 29.24e9,
    spark: [
      80012, 79850, 80120, 81045, 81330, 80920, 80540, 80312, 79980, 79770, 80050, 80620, 80710, 80450, 80082, 79788, 79330, 79110, 78940, 78650, 78220, 77900, 77510, 77110, 76920, 76800, 76760, 76684,
    ],
    up: false,
  },
  {
    rank: 2,
    id: "ethereum",
    name: "Ethereum",
    symbol: "ETH",
    price: 2108.55,
    h1: -0.12,
    h24: -1.19,
    d7: -8.32,
    mcap: 254.47e9,
    vol: 11.16e9,
    spark: [
      2298, 2287, 2295, 2310, 2305, 2285, 2261, 2240, 2225, 2210, 2202, 2198, 2210, 2218, 2202, 2185, 2165, 2150, 2138, 2125, 2118, 2108, 2102, 2095, 2088, 2095, 2105, 2108,
    ],
    up: false,
  },
  {
    rank: 4,
    id: "binancecoin",
    name: "BNB",
    symbol: "BNB",
    price: 590.34,
    h1: 0.05,
    h24: 0.82,
    d7: 2.14,
    mcap: 85.62e9,
    vol: 1.42e9,
    spark: [
      578, 581, 583, 580, 579, 582, 585, 587, 584, 583, 586, 588, 590, 588, 585, 584, 583, 586, 588, 589, 587, 588, 590, 591, 590, 589, 590, 590.34,
    ],
    up: true,
  },
  {
    rank: 5,
    id: "ripple",
    name: "XRP",
    symbol: "XRP",
    price: 2.498,
    h1: 1.32,
    h24: 3.45,
    d7: 12.04,
    mcap: 142.31e9,
    vol: 3.88e9,
    spark: [
      2.23, 2.25, 2.28, 2.32, 2.35, 2.37, 2.34, 2.36, 2.39, 2.42, 2.41, 2.43, 2.45, 2.44, 2.46, 2.47, 2.45, 2.46, 2.48, 2.49, 2.51, 2.50, 2.49, 2.48, 2.49, 2.50, 2.50, 2.498,
    ],
    up: true,
  },
  {
    rank: 7,
    id: "solana",
    name: "Solana",
    symbol: "SOL",
    price: 142.88,
    h1: -0.18,
    h24: 1.74,
    d7: -3.21,
    mcap: 68.45e9,
    vol: 2.91e9,
    spark: [
      147, 146, 145, 144, 143, 142, 141, 140, 139, 138, 140, 141, 142, 143, 144, 143, 142, 141, 140, 141, 142, 143, 142, 141, 142, 143, 143, 142.88,
    ],
    up: true,
  },
];

const fmtCompact = (n: number) => {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(2)}`;
};

const fmtPrice = (n: number) => {
  if (n >= 1)
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  return `$${n.toFixed(4)}`;
};

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function Sparkline({
  points,
  up,
  width = 96,
  height = 28,
}: {
  points: number[];
  up: boolean;
  width?: number;
  height?: number;
}) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const d = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const stroke = up ? C.green : C.red;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DesignPreview() {
  return (
    <div
      className={`${inter.className} fixed inset-0 z-50 overflow-y-auto`}
      style={{ background: C.bg, color: C.text }}
    >
      <style>{`
        :root { --mono: ${mono.style.fontFamily}; }
        .num { font-family: var(--mono); font-feature-settings: "tnum" 1, "zero" 1; }
        .hair { background: ${C.hairline}; }
        .glow-orange { box-shadow: 0 0 0 1px rgba(247,147,26,0.25), 0 8px 40px -8px rgba(247,147,26,0.25); }
        .row-hover:hover { background: ${C.bgTint}; }
        @keyframes flash {
          0% { background-color: rgba(48,182,88,0.20); }
          100% { background-color: transparent; }
        }
        .flashing { animation: flash 800ms ease-out; }
      `}</style>

      {/* ─── NAVBAR ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 backdrop-blur-md"
        style={{
          background: "rgba(22,22,22,0.85)",
          borderBottom: `1px solid ${C.hairline}`,
        }}
      >
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 h-16 flex items-center gap-8">
          {/* Wordmark */}
          <div className="flex items-baseline gap-2">
            <span className="text-[20px] font-bold tracking-[-0.02em]">trientes</span>
            <span
              className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm"
              style={{ color: C.orange, border: `1px solid ${C.orange}40` }}
            >
              .org
            </span>
          </div>

          <nav className="flex items-center gap-6 text-sm" style={{ color: C.muted }}>
            <a href="#" className="hover:text-white transition-colors">Coins</a>
            <a href="#" className="hover:text-white transition-colors">Exchanges</a>
            <a href="#" className="hover:text-white transition-colors">Watchlist</a>
            <a href="#" className="hover:text-white transition-colors">Request</a>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider"
              style={{ background: C.card, color: C.muted, border: `1px solid ${C.hairline}` }}
            >
              USD
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider"
              style={{ background: C.card, color: C.muted, border: `1px solid ${C.hairline}` }}
            >
              EN
            </button>
            <button
              className="text-xs px-3 py-1.5 rounded-md font-medium uppercase tracking-wider"
              style={{ background: C.card, color: C.muted, border: `1px solid ${C.hairline}` }}
            >
              ☾
            </button>
            <button
              className="ml-2 text-xs px-4 py-1.5 rounded-md font-semibold uppercase tracking-wider transition-colors hover:brightness-110"
              style={{ background: C.orange, color: "#0A0A0A" }}
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* ─── HERO ────────────────────────────────────────────────── */}
      <section className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-16 md:py-28">
        <div className="grid grid-cols-12 gap-8 items-end">
          <div className="col-span-12 lg:col-span-8">
            <div
              className="num text-[11px] uppercase tracking-[0.3em] mb-6"
              style={{ color: C.orange }}
            >
              ● Live · Layer-1 Ledger · {new Date().toUTCString().slice(0, 22)}Z
            </div>
            <h1
              className="text-[60px] md:text-[88px] lg:text-[112px] leading-[0.92] tracking-[-0.04em] font-black"
              style={{ letterSpacing: "-0.045em" }}
            >
              The ledger
              <br />
              of digital{" "}
              <span style={{ color: C.orange, fontStyle: "italic", fontWeight: 800 }}>coinage</span>.
            </h1>
            <p
              className="mt-8 max-w-[640px] text-[18px] md:text-[20px] leading-[1.5] font-light"
              style={{ color: C.muted }}
            >
              Track the top Layer-1 cryptocurrencies, with live prices, sparklines,
              and 8-currency conversion. Single source of truth, refreshed continuously.
            </p>
          </div>

          {/* Global Stats — typographic broadside */}
          <div className="col-span-12 lg:col-span-4">
            <div className="space-y-5">
              {[
                { label: "Total market cap", value: "$2.64T", delta: "+0.42%", up: true },
                { label: "24h volume", value: "$128.4B", delta: "−2.18%", up: false },
                { label: "BTC dominance", value: "58.3%", delta: null, up: true },
                { label: "ETH dominance", value: "9.7%", delta: null, up: true },
              ].map((s) => (
                <div
                  key={s.label}
                  className="flex items-baseline justify-between border-b pb-3"
                  style={{ borderColor: C.hairline }}
                >
                  <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: C.muted }}>
                    {s.label}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <div className="num text-[22px] font-medium">{s.value}</div>
                    {s.delta && (
                      <div
                        className="num text-[12px] font-medium"
                        style={{ color: s.up ? C.green : C.red }}
                      >
                        {s.delta}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── COIN TABLE ──────────────────────────────────────────── */}
      <section className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <div className="num text-[11px] uppercase tracking-[0.3em] mb-2" style={{ color: C.muted }}>
              Section · I
            </div>
            <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em]">Top Layer-1.</h2>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <input
              type="text"
              placeholder="Search by name or symbol…"
              className="px-3 py-2 rounded-md text-sm w-[280px] outline-none focus:ring-1 transition"
              style={{
                background: C.card,
                color: C.text,
                border: `1px solid ${C.hairline}`,
              }}
            />
          </div>
        </div>

        <div
          className="overflow-hidden"
          style={{ background: C.card, borderRadius: "20px", border: `1px solid ${C.hairline}` }}
        >
          <table className="w-full">
            <thead>
              <tr
                className="text-[11px] uppercase tracking-[0.18em]"
                style={{ color: C.muted, borderBottom: `1px solid ${C.hairline}` }}
              >
                <th className="text-left font-medium px-5 py-4 w-12">#</th>
                <th className="text-left font-medium px-5 py-4">Name</th>
                <th className="text-right font-medium px-5 py-4">Price</th>
                <th className="text-right font-medium px-5 py-4">1h</th>
                <th className="text-right font-medium px-5 py-4">24h</th>
                <th className="text-right font-medium px-5 py-4">7d</th>
                <th className="text-right font-medium px-5 py-4">Market cap</th>
                <th className="text-right font-medium px-5 py-4">Volume</th>
                <th className="text-left font-medium px-5 py-4 w-32">7d chart</th>
                <th className="px-5 py-4 w-12" />
              </tr>
            </thead>
            <tbody>
              {COINS.map((c, idx) => (
                <tr
                  key={c.id}
                  className="row-hover transition-colors"
                  style={{
                    borderBottom: idx < COINS.length - 1 ? `1px solid ${C.hairline}` : "none",
                  }}
                >
                  <td className="num px-5 py-5 text-[13px]" style={{ color: C.muted }}>
                    {c.rank}
                  </td>
                  <td className="px-5 py-5">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{
                          background: c.symbol === "BTC" ? C.orange : C.cardAlt,
                          color: c.symbol === "BTC" ? "#0A0A0A" : C.text,
                        }}
                      >
                        {c.symbol[0]}
                      </div>
                      <span className="font-medium text-[15px]">{c.name}</span>
                      <span className="num text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>
                        {c.symbol}
                      </span>
                    </div>
                  </td>
                  <td className="num text-right text-[15px] px-5 py-5 font-medium">
                    {fmtPrice(c.price)}
                  </td>
                  <td className="num text-right text-[13px] px-5 py-5" style={{ color: c.h1 >= 0 ? C.green : C.red }}>
                    {fmtPct(c.h1)}
                  </td>
                  <td className="num text-right text-[13px] px-5 py-5" style={{ color: c.h24 >= 0 ? C.green : C.red }}>
                    {fmtPct(c.h24)}
                  </td>
                  <td className="num text-right text-[13px] px-5 py-5" style={{ color: c.d7 >= 0 ? C.green : C.red }}>
                    {fmtPct(c.d7)}
                  </td>
                  <td className="num text-right text-[13px] px-5 py-5" style={{ color: C.muted }}>
                    {fmtCompact(c.mcap)}
                  </td>
                  <td className="num text-right text-[13px] px-5 py-5" style={{ color: C.muted }}>
                    {fmtCompact(c.vol)}
                  </td>
                  <td className="px-5 py-5">
                    <Sparkline points={c.spark} up={c.up} />
                  </td>
                  <td className="px-5 py-5 text-center">
                    <button
                      className="opacity-60 hover:opacity-100 transition-opacity"
                      style={{ color: c.symbol === "BTC" ? C.orange : C.muted }}
                      aria-label="Watch"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill={c.symbol === "BTC" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── COIN DETAIL PREVIEW ─────────────────────────────────── */}
      <section className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
        <div className="num text-[11px] uppercase tracking-[0.3em] mb-2" style={{ color: C.muted }}>
          Section · II
        </div>
        <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em] mb-8">
          Detail page header.
        </h2>

        <div
          className="rounded-[20px] p-8 md:p-12"
          style={{ background: C.card, border: `1px solid ${C.hairline}` }}
        >
          <div className="flex items-start gap-6 mb-10">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-[24px] font-bold flex-shrink-0"
              style={{ background: C.orange, color: "#0A0A0A" }}
            >
              B
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h1 className="text-[40px] md:text-[56px] font-bold tracking-[-0.035em] leading-[1]">
                  Bitcoin
                </h1>
                <span className="num text-[16px] uppercase tracking-[0.15em]" style={{ color: C.muted }}>
                  BTC
                </span>
                <span
                  className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm"
                  style={{ background: C.orange + "20", color: C.orange }}
                >
                  ★ Rank 1
                </span>
              </div>
              <div className="mt-2 num text-[11px] uppercase tracking-[0.2em]" style={{ color: C.muted }}>
                Layer-1 · Native asset
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="num text-[44px] md:text-[60px] font-medium tracking-[-0.03em] leading-[1]">
                $76,684.12
              </div>
              <div className="mt-2 flex items-center justify-end gap-3 num text-[14px]">
                <span style={{ color: C.red }}>−0.47%</span>
                <span style={{ color: C.muted }}>24h</span>
              </div>
            </div>
          </div>

          {/* Timeframe tabs */}
          <div className="flex items-center gap-1 mb-6">
            {(["1D", "7D", "1M", "1Y", "All"] as const).map((tf, i) => (
              <button
                key={tf}
                className="num text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium transition-all"
                style={{
                  background: i === 1 ? C.orange : "transparent",
                  color: i === 1 ? "#0A0A0A" : C.muted,
                  border: i === 1 ? "none" : `1px solid ${C.hairline}`,
                }}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Mock chart area */}
          <div
            className="h-[260px] rounded-md relative overflow-hidden"
            style={{ background: C.bgTint, border: `1px solid ${C.hairline}` }}
          >
            <svg width="100%" height="100%" viewBox="0 0 800 260" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.red} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={C.red} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M 0 70 L 30 60 L 60 75 L 90 50 L 120 55 L 150 80 L 180 95 L 210 70 L 240 100 L 270 120 L 300 110 L 330 130 L 360 115 L 390 140 L 420 135 L 450 155 L 480 145 L 510 170 L 540 165 L 570 185 L 600 175 L 630 195 L 660 200 L 690 210 L 720 220 L 750 215 L 780 230 L 800 235 L 800 260 L 0 260 Z"
                fill="url(#chartGrad)"
              />
              <path
                d="M 0 70 L 30 60 L 60 75 L 90 50 L 120 55 L 150 80 L 180 95 L 210 70 L 240 100 L 270 120 L 300 110 L 330 130 L 360 115 L 390 140 L 420 135 L 450 155 L 480 145 L 510 170 L 540 165 L 570 185 L 600 175 L 630 195 L 660 200 L 690 210 L 720 220 L 750 215 L 780 230 L 800 235"
                fill="none"
                stroke={C.red}
                strokeWidth="1.5"
              />
            </svg>
          </div>
        </div>
      </section>

      {/* ─── BUTTONS & MICRO-COMPONENTS ──────────────────────────── */}
      <section className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
        <div className="num text-[11px] uppercase tracking-[0.3em] mb-2" style={{ color: C.muted }}>
          Section · III
        </div>
        <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em] mb-8">
          Buttons &amp; bits.
        </h2>

        <div className="grid grid-cols-12 gap-6">
          <div
            className="col-span-12 md:col-span-6 lg:col-span-4 rounded-[20px] p-6"
            style={{ background: C.card, border: `1px solid ${C.hairline}` }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: C.muted }}>
              Buttons
            </div>
            <div className="flex flex-col gap-3">
              <button
                className="text-sm px-4 py-2.5 rounded-md font-semibold uppercase tracking-wider glow-orange transition-all hover:brightness-110"
                style={{ background: C.orange, color: "#0A0A0A" }}
              >
                Continue with Google
              </button>
              <button
                className="text-sm px-4 py-2.5 rounded-md font-medium transition-colors"
                style={{ background: C.cardAlt, color: C.text, border: `1px solid ${C.hairline}` }}
              >
                Continue with GitHub
              </button>
              <button
                className="text-sm px-4 py-2.5 rounded-md font-medium transition-colors"
                style={{ color: C.muted, border: `1px solid ${C.hairline}` }}
              >
                Cancel
              </button>
            </div>
          </div>

          <div
            className="col-span-12 md:col-span-6 lg:col-span-4 rounded-[20px] p-6"
            style={{ background: C.card, border: `1px solid ${C.hairline}` }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: C.muted }}>
              Badges
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                style={{ background: C.orange + "20", color: C.orange }}
              >
                ★ Rank 1
              </span>
              <span
                className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                style={{ background: C.green + "20", color: C.green }}
              >
                Approved
              </span>
              <span
                className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                style={{ background: "#F7931A20", color: C.orange }}
              >
                Pending
              </span>
              <span
                className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                style={{ background: C.red + "20", color: C.red }}
              >
                Rejected
              </span>
              <span
                className="num text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-sm font-medium"
                style={{ background: C.blue + "20", color: "#7E94E5" }}
              >
                Layer-1
              </span>
            </div>
          </div>

          <div
            className="col-span-12 md:col-span-12 lg:col-span-4 rounded-[20px] p-6"
            style={{ background: C.card, border: `1px solid ${C.hairline}` }}
          >
            <div className="text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: C.muted }}>
              Live tick (animated)
            </div>
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: C.green }} />
                <span className="text-sm" style={{ color: C.muted }}>
                  Bitcoin
                </span>
              </div>
              <div className="num text-[18px] font-medium flashing">$76,684.12</div>
            </div>
            <p className="mt-3 text-[12px] leading-[1.5]" style={{ color: C.muted }}>
              SSE → Binance WebSocket. Green flash on tick. Mono numeric figures.
            </p>
          </div>
        </div>
      </section>

      {/* ─── STYLE GUIDE: PALETTE + TYPE ─────────────────────────── */}
      <section className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
        <div className="num text-[11px] uppercase tracking-[0.3em] mb-2" style={{ color: C.muted }}>
          Section · IV
        </div>
        <h2 className="text-[32px] md:text-[40px] font-bold tracking-[-0.03em] mb-8">
          Style guide.
        </h2>

        <div className="grid grid-cols-12 gap-8 mb-12">
          {/* Palette */}
          <div className="col-span-12 lg:col-span-7">
            <div className="text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: C.muted }}>
              Palette
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { name: "BG", hex: C.bg },
                { name: "BG tint", hex: C.bgTint },
                { name: "Card", hex: C.card },
                { name: "Card alt", hex: C.cardAlt },
                { name: "Hairline", hex: C.hairline },
                { name: "Muted", hex: C.muted },
                { name: "Orange", hex: C.orange, accent: true },
                { name: "Green", hex: C.green },
                { name: "Red", hex: C.red },
                { name: "Blue", hex: C.blue },
              ].map((c) => (
                <div
                  key={c.name}
                  className="rounded-[12px] overflow-hidden"
                  style={{ border: `1px solid ${C.hairline}` }}
                >
                  <div className="h-20" style={{ background: c.hex }} />
                  <div className="px-3 py-2.5" style={{ background: C.card }}>
                    <div className="text-[11px] font-medium uppercase tracking-[0.12em]">{c.name}</div>
                    <div className="num text-[10px]" style={{ color: C.muted }}>
                      {c.hex.toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Type scale */}
          <div className="col-span-12 lg:col-span-5">
            <div className="text-[11px] uppercase tracking-[0.18em] mb-4" style={{ color: C.muted }}>
              Type scale
            </div>
            <div className="space-y-5">
              <div className="border-b pb-4" style={{ borderColor: C.hairline }}>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: C.muted }}>
                  Display · Inter 900 · −4% tracking
                </div>
                <div className="text-[44px] font-black leading-[0.95] tracking-[-0.04em]">
                  digital coinage
                </div>
              </div>
              <div className="border-b pb-4" style={{ borderColor: C.hairline }}>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: C.muted }}>
                  Section · Inter 700 · −3% tracking
                </div>
                <div className="text-[28px] font-bold tracking-[-0.025em]">Top Layer-1.</div>
              </div>
              <div className="border-b pb-4" style={{ borderColor: C.hairline }}>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: C.muted }}>
                  Body · Inter 400
                </div>
                <div className="text-[16px] leading-[1.55]" style={{ color: C.muted }}>
                  Single source of truth, refreshed continuously.
                </div>
              </div>
              <div className="border-b pb-4" style={{ borderColor: C.hairline }}>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: C.muted }}>
                  Eyebrow · 11px UPPER 30% tracking
                </div>
                <div className="num text-[11px] uppercase tracking-[0.3em]" style={{ color: C.orange }}>
                  ● Live · Layer-1 Ledger
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] mb-1" style={{ color: C.muted }}>
                  Numeric · JetBrains Mono · tabular figures
                </div>
                <div className="num text-[24px] font-medium">$76,684.12 · −0.47%</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer
        className="mt-20"
        style={{ background: C.bgTint, borderTop: `1px solid ${C.hairline}` }}
      >
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-12 md:col-span-5">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-[18px] font-bold tracking-[-0.02em]">trientes</span>
                <span
                  className="num text-[10px] font-medium uppercase tracking-[0.25em] px-1.5 py-0.5 rounded-sm"
                  style={{ color: C.orange, border: `1px solid ${C.orange}40` }}
                >
                  .org
                </span>
              </div>
              <p className="text-[14px] leading-[1.6] max-w-[420px]" style={{ color: C.muted }}>
                The ledger of digital coinage. A sibling of{" "}
                <Link href="https://trientes.com" className="underline">
                  trientes.com
                </Link>
                , focused on tracking top Layer-1 cryptocurrencies.
              </p>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="text-[10px] uppercase tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                Markets
              </div>
              <ul className="space-y-2 text-[14px]">
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Coins</a></li>
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Exchanges</a></li>
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Watchlist</a></li>
              </ul>
            </div>
            <div className="col-span-6 md:col-span-2">
              <div className="text-[10px] uppercase tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                Account
              </div>
              <ul className="space-y-2 text-[14px]">
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Sign in</a></li>
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Settings</a></li>
                <li><a href="#" className="hover:text-white" style={{ color: C.muted }}>Request a coin</a></li>
              </ul>
            </div>
            <div className="col-span-12 md:col-span-3">
              <div className="text-[10px] uppercase tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                Data
              </div>
              <p className="text-[12px] leading-[1.6]" style={{ color: C.muted }}>
                Prices via CoinGecko + Binance WS. Refreshed every 10 min, live ticks for top 20 via SSE.
              </p>
            </div>
          </div>
          <div
            className="mt-12 pt-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 num text-[11px] uppercase tracking-[0.18em]"
            style={{ color: C.muted, borderTop: `1px solid ${C.hairline}` }}
          >
            <div>© 2026 Trientes</div>
            <div>v0.1.0 · MMXXVI</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
