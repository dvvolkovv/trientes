import { describe, it, expect } from "vitest";
import { classifyTheme, dedupe, parseFeed, mergeAndRank, type NewsItem } from "@/lib/news";
import { syncNews } from "@/lib/sync/orchestrator";

describe("classifyTheme", () => {
  it("tags the four themes the banner cares about, else general", () => {
    expect(classifyTheme("SEC files lawsuit against crypto exchange over compliance")).toBe("regulation");
    expect(classifyTheme("New layer-1 blockchain launches mainnet with novel consensus")).toBe("blockchain");
    expect(classifyTheme("Developers ship zero-knowledge scaling upgrade for wallets")).toBe("tech");
    expect(classifyTheme("Bitcoin price rallies as ETF inflows surge")).toBe("market");
    expect(classifyTheme("Crypto conference announced for next spring")).toBe("general");
  });
});

describe("dedupe", () => {
  it("drops items sharing a URL, keeping the first occurrence", () => {
    const items: NewsItem[] = [
      { title: "A", url: "https://x.test/1", source: "X", publishedAt: 200, theme: "market" },
      { title: "A dup", url: "https://x.test/1", source: "Y", publishedAt: 100, theme: "market" },
      { title: "B", url: "https://x.test/2", source: "X", publishedAt: 150, theme: "tech" },
    ];
    const out = dedupe(items);
    expect(out.map((i) => i.url)).toEqual(["https://x.test/1", "https://x.test/2"]);
  });
});

describe("parseFeed", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
    <item><title>SEC sues exchange over compliance failures</title><link>https://news.test/a</link><pubDate>Wed, 20 May 2026 10:00:00 GMT</pubDate></item>
    <item><title>Missing link should be dropped</title><pubDate>Wed, 20 May 2026 09:00:00 GMT</pubDate></item>
    <item><title>Unsafe scheme should be dropped</title><link>javascript:alert(1)</link><pubDate>Wed, 20 May 2026 08:00:00 GMT</pubDate></item>
  </channel></rss>`;

  it("maps valid items and drops ones without a safe http(s) link", async () => {
    const items = await parseFeed(xml, "TestSource");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "SEC sues exchange over compliance failures",
      url: "https://news.test/a",
      source: "TestSource",
      theme: "regulation",
    });
    expect(items[0].publishedAt).toBe(Math.floor(Date.parse("Wed, 20 May 2026 10:00:00 GMT") / 1000));
  });
});

describe("mergeAndRank", () => {
  it("flattens, sorts newest-first, dedupes by URL, and caps to limit", () => {
    const a: NewsItem[] = [{ title: "old", url: "https://t/1", source: "A", publishedAt: 100, theme: "market" }];
    const b: NewsItem[] = [
      { title: "new", url: "https://t/2", source: "B", publishedAt: 300, theme: "tech" },
      { title: "mid", url: "https://t/1", source: "B", publishedAt: 200, theme: "market" }, // newer dup of /1
    ];
    const out = mergeAndRank([a, b], 2);
    expect(out.map((i) => i.title)).toEqual(["new", "mid"]);
    expect(out).toHaveLength(2);
  });
});

describe("syncNews", () => {
  it("caches fetched items in Redis under the news key with a TTL", async () => {
    const items: NewsItem[] = [
      { title: "x", url: "https://a/1", source: "S", publishedAt: 1, theme: "market" },
    ];
    const calls: Array<[string, string, "EX", number]> = [];
    const redis = {
      set: async (k: string, v: string, mode: "EX", ttl: number) => {
        calls.push([k, v, mode, ttl]);
        return "OK";
      },
    };
    const res = await syncNews({ fetchNews: async () => items, redis });
    expect(res.count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("news:latest");
    expect(JSON.parse(calls[0][1])).toEqual(items);
    expect(calls[0][2]).toBe("EX");
    expect(calls[0][3]).toBeGreaterThan(0);
  });
});
