export const LIVE = {
  price: (coinId: string) => `live:price:${coinId}`,
  // Pub/sub channel: workers PUBLISH, SSE route SUBSCRIBES.
  channel: "live:price:channel",
} as const;

export const LIVE_TTL = {
  price: 60, // 60s — a stale tick is OK; the next ticker comes within seconds
} as const;
