import { describe, it, expect } from "vitest";
import { classifyTheme, dedupe, parseFeed, mergeAndRank, extractImage, type NewsItem } from "@/lib/news";
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
      { title: "A", url: "https://x.test/1", source: "X", publishedAt: 200, theme: "market", imageUrl: null },
      { title: "A dup", url: "https://x.test/1", source: "Y", publishedAt: 100, theme: "market", imageUrl: null },
      { title: "B", url: "https://x.test/2", source: "X", publishedAt: 150, theme: "tech", imageUrl: null },
    ];
    const out = dedupe(items);
    expect(out.map((i) => i.url)).toEqual(["https://x.test/1", "https://x.test/2"]);
  });
});

describe("extractImage", () => {
  it("prefers a media:thumbnail url", () => {
    expect(extractImage({ mediaThumbnail: [{ $: { url: "https://img.test/thumb.jpg" } }] })).toBe(
      "https://img.test/thumb.jpg",
    );
  });

  it("uses an image-hinted media:content", () => {
    expect(
      extractImage({ mediaContent: [{ $: { url: "https://img.test/m.jpg", medium: "image" } }] }),
    ).toBe("https://img.test/m.jpg");
  });

  it("ignores a non-image media:content such as video", () => {
    expect(
      extractImage({ mediaContent: [{ $: { url: "https://img.test/clip.mp4", medium: "video", type: "video/mp4" } }] }),
    ).toBeNull();
  });

  it("uses an image enclosure", () => {
    expect(extractImage({ enclosure: { url: "https://img.test/e.png", type: "image/png" } })).toBe(
      "https://img.test/e.png",
    );
  });

  it("ignores a non-image enclosure", () => {
    expect(extractImage({ enclosure: { url: "https://audio.test/show.mp3", type: "audio/mpeg" } })).toBeNull();
  });

  it("falls back to the first <img> in the body html", () => {
    expect(
      extractImage({ contentEncoded: '<p>lede</p><img src="https://img.test/body.webp" alt="x">' }),
    ).toBe("https://img.test/body.webp");
  });

  it("returns null when the feed carries no media", () => {
    expect(extractImage({ contentSnippet: "plain text only" })).toBeNull();
  });
});

describe("parseFeed", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Feed</title>
    <item><title>SEC sues exchange over compliance failures</title><link>https://news.test/a</link><pubDate>Wed, 20 May 2026 10:00:00 GMT</pubDate><media:content url="https://img.test/a.jpg" medium="image"/></item>
    <item><title>Missing link should be dropped</title><pubDate>Wed, 20 May 2026 09:00:00 GMT</pubDate></item>
    <item><title>Unsafe scheme should be dropped</title><link>javascript:alert(1)</link><pubDate>Wed, 20 May 2026 08:00:00 GMT</pubDate></item>
  </channel></rss>`;

  it("maps valid items, attaches media, and drops ones without a safe http(s) link", async () => {
    const items = await parseFeed(xml, "TestSource");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "SEC sues exchange over compliance failures",
      url: "https://news.test/a",
      source: "TestSource",
      theme: "regulation",
      imageUrl: "https://img.test/a.jpg",
    });
    expect(items[0].publishedAt).toBe(Math.floor(Date.parse("Wed, 20 May 2026 10:00:00 GMT") / 1000));
  });
});

describe("mergeAndRank", () => {
  it("flattens, sorts newest-first, dedupes by URL, and caps to limit", () => {
    const a: NewsItem[] = [{ title: "old", url: "https://t/1", source: "A", publishedAt: 100, theme: "market", imageUrl: null }];
    const b: NewsItem[] = [
      { title: "new", url: "https://t/2", source: "B", publishedAt: 300, theme: "tech", imageUrl: null },
      { title: "mid", url: "https://t/1", source: "B", publishedAt: 200, theme: "market", imageUrl: null }, // newer dup of /1
    ];
    const out = mergeAndRank([a, b], 2);
    expect(out.map((i) => i.title)).toEqual(["new", "mid"]);
    expect(out).toHaveLength(2);
  });
});

describe("syncNews", () => {
  it("caches fetched items in Redis under the news key with a TTL", async () => {
    const items: NewsItem[] = [
      { title: "x", url: "https://a/1", source: "S", publishedAt: 1, theme: "market", imageUrl: null },
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
