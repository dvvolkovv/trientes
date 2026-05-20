// CoinGecko id → Binance symbol (always paired with USDT). Top 20 L1s.
// Coins not listed on Binance (e.g. some wrapped/exotic ones) are omitted —
// the SSE just falls back to the 10-min snapshot price for them.
export const CG_TO_BINANCE: Record<string, string> = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT",
  cardano: "ADAUSDT",
  "avalanche-2": "AVAXUSDT",
  polkadot: "DOTUSDT",
  tron: "TRXUSDT",
  chainlink: "LINKUSDT",
  cosmos: "ATOMUSDT",
  "polygon-ecosystem-token": "POLUSDT",
  "near": "NEARUSDT",
  litecoin: "LTCUSDT",
  "internet-computer": "ICPUSDT",
  algorand: "ALGOUSDT",
  filecoin: "FILUSDT",
  "hedera-hashgraph": "HBARUSDT",
  vechain: "VETUSDT",
  stellar: "XLMUSDT",
};

// Reverse lookup for the WS message handler.
export const BINANCE_TO_CG: Record<string, string> = Object.fromEntries(
  Object.entries(CG_TO_BINANCE).map(([cg, bn]) => [bn, cg]),
);

export function parseMiniTicker(raw: unknown): { binancePair: string; price: number } | null {
  const r = raw as Record<string, unknown>;
  if (r.e !== "24hrMiniTicker") return null;
  const s = typeof r.s === "string" ? r.s : null;
  const c = typeof r.c === "string" ? Number(r.c) : NaN;
  if (!s || !Number.isFinite(c)) return null;
  return { binancePair: s, price: c };
}
