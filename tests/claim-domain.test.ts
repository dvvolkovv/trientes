import { describe, it, expect } from "vitest";
import {
  containsToken,
  fetchTxtRecords,
  fetchWellKnown,
  parseTxtAnswer,
  TXT_PREFIX,
  websiteDomain,
  WELL_KNOWN_PATH,
  type DomainFetch,
} from "../src/lib/claim-domain";

const TOKEN = "trientes-ab12cd34";

describe("websiteDomain", () => {
  it("вытаскивает домен из сайта карточки", () => {
    expect(websiteDomain({ website: "https://www.Example.com/path?x=1" })).toBe("example.com");
    expect(websiteDomain({ website: "example.org" })).toBe("example.org");
    expect(websiteDomain({ website: " https://sub.example.co.uk " })).toBe("sub.example.co.uk");
  });

  it("отказывается от того, что доменом не является", () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain({})).toBeNull();
    expect(websiteDomain({ website: "" })).toBeNull();
    expect(websiteDomain({ website: "localhost" })).toBeNull();
    expect(websiteDomain({ website: "не ссылка" })).toBeNull();
    expect(websiteDomain({ website: 42 })).toBeNull();
  });
});

describe("parseTxtAnswer", () => {
  it("снимает кавычки и склеивает длинную запись", () => {
    const body = {
      Answer: [
        { type: 16, data: `"${TXT_PREFIX}${TOKEN}"` },
        { type: 16, data: '"часть1" "часть2"' },
        { type: 5, data: "cname.example.com" },
        { type: 16, data: 12345 },
      ],
    };
    expect(parseTxtAnswer(body)).toEqual([`${TXT_PREFIX}${TOKEN}`, "часть1часть2"]);
  });

  it("пустой или битый ответ", () => {
    expect(parseTxtAnswer(null)).toEqual([]);
    expect(parseTxtAnswer({})).toEqual([]);
    expect(parseTxtAnswer({ Answer: "nope" })).toEqual([]);
  });
});

function jsonFetch(handler: (url: string) => unknown): DomainFetch {
  return async (url: string) => {
    const body = handler(url);
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

describe("fetchTxtRecords", () => {
  it("возвращает записи основного резолвера", async () => {
    const r = await fetchTxtRecords("example.com", {
      fetchImpl: jsonFetch(() => ({ Answer: [{ type: 16, data: `"${TXT_PREFIX}${TOKEN}"` }] })),
    });
    expect(r.records).toEqual([`${TXT_PREFIX}${TOKEN}`]);
  });

  it("идёт к резервному резолверу, если основной упал", async () => {
    const seen: string[] = [];
    const r = await fetchTxtRecords("example.com", {
      fetchImpl: jsonFetch((url) => {
        seen.push(url);
        if (url.includes("cloudflare")) return new Error("down");
        return { Answer: [{ type: 16, data: `"${TXT_PREFIX}${TOKEN}"` }] };
      }),
    });
    expect(seen.length).toBe(2);
    expect(r.records).toEqual([`${TXT_PREFIX}${TOKEN}`]);
  });

  it("домен без нужной записи", async () => {
    const r = await fetchTxtRecords("example.com", {
      fetchImpl: jsonFetch(() => ({ Status: 0, Answer: [] })),
    });
    expect(r).toEqual({ records: null, error: "dns_no_record" });
  });

  it("оба резолвера недоступны", async () => {
    const r = await fetchTxtRecords("example.com", {
      fetchImpl: jsonFetch(() => new Error("timeout")),
    });
    expect(r).toEqual({ records: null, error: "dns_unreachable" });
  });

  it("резолвер ответил не-200", async () => {
    const r = await fetchTxtRecords("example.com", {
      fetchImpl: async () => ({
        ok: false, status: 500,
        json: async () => ({}), text: async () => "",
      }),
    });
    expect(r).toEqual({ records: null, error: "dns_unreachable" });
  });
});

describe("fetchWellKnown", () => {
  const ok = (text: string): DomainFetch => async (url) => {
    expect(url).toBe(`https://example.com${WELL_KNOWN_PATH}`);
    return { ok: true, status: 200, json: async () => ({}), text: async () => text };
  };

  it("читает тело файла", async () => {
    const r = await fetchWellKnown("example.com", { fetchImpl: ok(`${TOKEN}\n`) });
    expect(r.body?.trim()).toBe(TOKEN);
  });

  it("обрезает тело килобайтом", async () => {
    const r = await fetchWellKnown("example.com", { fetchImpl: ok("x".repeat(5000)) });
    expect(r.body?.length).toBe(1024);
  });

  it("404 и 403 — файла нет", async () => {
    for (const status of [404, 403]) {
      const r = await fetchWellKnown("example.com", {
        fetchImpl: async () => ({ ok: false, status, json: async () => ({}), text: async () => "" }),
      });
      expect(r).toEqual({ body: null, error: "well_known_missing" });
    }
  });

  it("500 и обрыв — сайт недоступен", async () => {
    const five = await fetchWellKnown("example.com", {
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => "" }),
    });
    expect(five).toEqual({ body: null, error: "well_known_unreachable" });

    const dead = await fetchWellKnown("example.com", {
      fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    });
    expect(dead).toEqual({ body: null, error: "well_known_unreachable" });
  });
});

describe("containsToken", () => {
  it("находит токен в любом регистре и среди пробелов", () => {
    expect(containsToken(`  ${TOKEN.toUpperCase()}\n`, TOKEN)).toBe(true);
    expect(containsToken(`${TXT_PREFIX}${TOKEN}`, TOKEN)).toBe(true);
    expect(containsToken("trientes-ffffffff", TOKEN)).toBe(false);
  });
});
