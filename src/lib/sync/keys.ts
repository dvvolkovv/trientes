export const KEYS = {
  topList: "snapshot:list:top100",
  coin: (id: string) => `snapshot:coin:${id}`,
  globalStats: "global:stats",
} as const;

export const TTL = {
  snapshot: 90,      // seconds — must outlast the 60s sync interval
  globalStats: 300,  // 5 min
} as const;
