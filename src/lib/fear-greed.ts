// Crypto Fear & Greed Index from alternative.me (free, no API key required).
// A 0–100 daily sentiment gauge: 0 = Extreme Fear, 100 = Extreme Greed. The worker
// refreshes it into Redis on a schedule; the home-page hero reads the cache and shows
// it beside the BTC/ETH dominance rows. Pure parsing (parseFearGreed) is unit tested;
// fetchFearGreed does the network IO. Independent of CoinGecko — no quota impact.

export type FearGreed = {
  value: number; // 0–100
  classification: string; // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
  updatedAt: number; // unix seconds — when the index was last computed
};

export function parseFearGreed(raw: unknown): FearGreed {
  const root = raw as { data?: Array<Record<string, unknown>> };
  const d = root.data?.[0];
  if (!d) throw new Error("fear-greed: missing data[0]");
  const value = Number(d.value);
  if (!Number.isFinite(value)) throw new Error("fear-greed: non-numeric value");
  const ts = Number(d.timestamp);
  return {
    value: Math.round(value),
    classification: String(d.value_classification ?? "").trim(),
    updatedAt: Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000),
  };
}

const FNG_URL = "https://api.alternative.me/fng/?limit=1";

export async function fetchFearGreed(timeoutMs = 6000): Promise<FearGreed> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FNG_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`fear-greed -> HTTP ${res.status}`);
    return parseFearGreed(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
