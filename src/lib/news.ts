// Crypto news aggregation from public RSS feeds (no API key required).
// The worker refreshes these into Redis on a schedule; the home-page banner reads
// the cache. Pure helpers (classifyTheme/dedupe/parseFeed/mergeAndRank) are unit
// tested; fetchNews does the network IO and tolerates individual feed failures.

import Parser from "rss-parser";

export type NewsTheme = "market" | "blockchain" | "regulation" | "tech" | "general";

export type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: number; // unix seconds
  theme: NewsTheme;
  imageUrl: string | null; // article thumbnail, null when the feed carries none
};

// Verified to return valid RSS without an API key (with a browser UA + redirects).
export const FEEDS: { url: string; source: string }[] = [
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://decrypt.co/feed", source: "Decrypt" },
  { url: "https://thedefiant.io/api/feed", source: "The Defiant" },
];

// Checked most-specific first. A headline matching several buckets takes the
// earliest one here (regulation > blockchain > tech > market).
const THEME_KEYWORDS: { theme: NewsTheme; words: string[] }[] = [
  {
    theme: "regulation",
    words: ["sec ", "regulat", "lawsuit", "court", " ban ", "sanction", "compliance", "cftc", "mica", "sues", "lawmaker", "congress", "senate", "treasury", " tax", "settlement", "license"],
  },
  {
    theme: "blockchain",
    words: ["blockchain", "layer-1", "layer 1", "layer-2", "layer 2", "mainnet", "testnet", "protocol", "consensus", "validator", "rollup", "fork", "interoperab", "node "],
  },
  {
    theme: "tech",
    words: ["zero-knowledge", "zk-", "zk ", "smart contract", "upgrade", "scaling", "developer", "sdk", "wallet", "infrastructure", "bridge", "open-source"],
  },
  {
    theme: "market",
    words: ["price", "rally", "rallies", "surge", "plunge", "drop", "etf", "market", "bull", "bear", "trading", "all-time high", "ath", "inflow", "outflow", "billion", "million", "sell-off"],
  },
];

export function classifyTheme(text: string): NewsTheme {
  const t = ` ${text.toLowerCase()} `;
  for (const { theme, words } of THEME_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return theme;
  }
  return "general";
}

export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

// Newest-first, then dedupe (so a duplicated URL keeps its freshest copy), capped.
export function mergeAndRank(lists: NewsItem[][], limit = 20): NewsItem[] {
  const flat = lists.flat().sort((a, b) => b.publishedAt - a.publishedAt);
  return dedupe(flat).slice(0, limit);
}

function isHttpUrl(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

// Most feeds expose a thumbnail via media:* or enclosure; keep the raw nodes so
// extractImage can pick the best one. enclosure is a built-in rss-parser field.
const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["content:encoded", "contentEncoded"],
    ],
  },
});

const IMG_EXT = /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i;

// Pull a usable image URL from a media:* node (single or array). xml2js puts
// attributes under `$`; some shapes inline them. When requireImageHint is set,
// only accept nodes that look like images (medium/type/extension).
function mediaUrl(node: unknown, requireImageHint: boolean): string | null {
  const arr = Array.isArray(node) ? node : node == null ? [] : [node];
  for (const raw of arr) {
    const m = raw as { $?: Record<string, unknown>; url?: unknown };
    const attrs = (m.$ ?? m) as Record<string, unknown>;
    const url = attrs.url;
    if (typeof url !== "string" || !isHttpUrl(url)) continue;
    if (!requireImageHint) return url;
    const medium = attrs.medium;
    const type = typeof attrs.type === "string" ? attrs.type : "";
    if (medium === "image" || type.startsWith("image/") || IMG_EXT.test(url)) return url;
  }
  return null;
}

// Best-effort article thumbnail. Priority: media:thumbnail, image media:content,
// image enclosure, then the first <img> in the body. null when none qualify.
export function extractImage(item: Record<string, unknown>): string | null {
  const thumb = mediaUrl(item.mediaThumbnail, false);
  if (thumb) return thumb;

  const media = mediaUrl(item.mediaContent, true);
  if (media) return media;

  const enc = item.enclosure as { url?: unknown; type?: unknown } | undefined;
  if (enc && typeof enc.url === "string" && isHttpUrl(enc.url)) {
    const t = typeof enc.type === "string" ? enc.type : "";
    if (t.startsWith("image/") || IMG_EXT.test(enc.url)) return enc.url;
  }

  const html = [item.contentEncoded, item.content].find((v) => typeof v === "string") as
    | string
    | undefined;
  if (html) {
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && isHttpUrl(m[1])) return m[1];
  }
  return null;
}

export async function parseFeed(xml: string, source: string): Promise<NewsItem[]> {
  const feed = await parser.parseString(xml);
  const out: NewsItem[] = [];
  for (const it of feed.items ?? []) {
    const title = (it.title ?? "").trim();
    const url = it.link ?? "";
    if (!title || !isHttpUrl(url)) continue;
    const ms = Date.parse(it.isoDate ?? it.pubDate ?? "");
    const publishedAt = Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
    out.push({
      title,
      url,
      source,
      publishedAt,
      theme: classifyTheme(`${title} ${it.contentSnippet ?? ""}`),
      imageUrl: extractImage(it as unknown as Record<string, unknown>),
    });
  }
  return out;
}

const UA = "Mozilla/5.0 (compatible; TrientesNewsBot/1.0; +https://trientes.org)";

async function fetchFeedXml(url: string, timeoutMs = 6000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Fetch all feeds in parallel; a failing feed is logged and skipped, not fatal.
export async function fetchNews(limit = 20): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await fetchFeedXml(f.url), f.source)),
  );
  const lists: NewsItem[][] = [];
  for (const r of results) {
    if (r.status === "fulfilled") lists.push(r.value);
    else console.error("[news] feed failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  }
  return mergeAndRank(lists, limit);
}
