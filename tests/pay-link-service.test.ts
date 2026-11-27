import { describe, expect, it } from "vitest";
import { fetchPayLink, parseLinkPayload, PAY_LINK_API } from "@/lib/pay-link/service";

const ID = "pl_A1b2C3d4E5f";
const good = {
  accepting: true,
  merchant_id: "m_abc123",
  merchant: "Coffee House",
  title: "Оплата заказа ABCD2345",
  unit: "usd",
  amount: "20.00",
};

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("разбор ответа службы оплаты", () => {
  it("принимает годный ответ", () => {
    const r = parseLinkPayload(good);
    expect(r).toMatchObject({ accepting: true });
    expect(r && "info" in r && r.info.merchantId).toBe("m_abc123");
  });

  it("accepting должно быть именно true", () => {
    expect(parseLinkPayload({ ...good, accepting: "true" })).toBeNull();
    expect(parseLinkPayload({ ...good, accepting: 1 })).toBeNull();
  });

  it("accepting false — выключена, а не сбой", () => {
    expect(parseLinkPayload({ ...good, accepting: false })).toEqual({ accepting: false });
  });

  it("без номера магазина — не ответ", () => {
    const { merchant_id: _omit, ...rest } = good;
    expect(parseLinkPayload(rest)).toBeNull();
    expect(parseLinkPayload({ ...good, merchant_id: "abc123" })).toBeNull();
    expect(parseLinkPayload({ ...good, merchant_id: "m_abc-123" })).toBeNull();
  });

  it("единица ровно usd или coin", () => {
    expect(parseLinkPayload({ ...good, unit: "eur" })).toBeNull();
    expect(parseLinkPayload({ ...good, unit: "coin" })).toBeNull();
    const coin = parseLinkPayload({ ...good, unit: "coin", coin: { symbol: "TAL" } });
    expect(coin && "info" in coin && coin.info.coinSymbol).toBe("TAL");
  });

  it("сумма — строка или null", () => {
    const free = parseLinkPayload({ ...good, amount: null });
    expect(free && "info" in free && free.info.amount).toBeNull();
    expect(parseLinkPayload({ ...good, amount: 20 })).toBeNull();
  });

  it("название длиннее 200 знаков — не ответ", () => {
    expect(parseLinkPayload({ ...good, title: "x".repeat(201) })).toBeNull();
  });

  it("имя и название чистятся, но полное название остаётся для поиска кода", () => {
    const long = `${"a".repeat(150)} ABCD2345`;
    const r = parseLinkPayload({ ...good, merchant: "Coffee‮House", title: long });
    expect(r && "info" in r && r.info.merchant).toBe("CoffeeHouse");
    expect(r && "info" in r && r.info.title.length).toBe(80);
    expect(r && "info" in r && r.info.rawTitle).toBe(long);
  });

  it("не объект — не ответ", () => {
    expect(parseLinkPayload("ok")).toBeNull();
    expect(parseLinkPayload([good])).toBeNull();
    expect(parseLinkPayload(null)).toBeNull();
  });
});

describe("запрос к службе", () => {
  it("спрашивает постоянный хост и не идёт по редиректам", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const r = await fetchPayLink(ID, {
      fetchImpl: ((url: string, init: RequestInit) => {
        seen = { url, init };
        return Promise.resolve(reply(good));
      }) as unknown as typeof fetch,
    });
    expect(r.kind).toBe("ok");
    expect(seen!.url).toBe(`${PAY_LINK_API}/link/${ID}`);
    expect(seen!.init.redirect).toBe("manual");
  });

  it("404 — такой ссылки нет", async () => {
    const r = await fetchPayLink(ID, { fetchImpl: (() => Promise.resolve(reply({}, 404))) as unknown as typeof fetch });
    expect(r).toEqual({ kind: "missing" });
  });

  it("accepting false — выключена в кабинете", async () => {
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.resolve(reply({ accepting: false }))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "off" });
  });

  it("редирект — попробуйте позже, а не «нет ссылки»", async () => {
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.resolve(new Response(null, { status: 302 }))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("молчание службы — позже", async () => {
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("не тот JSON — позже, и ничего не сохраняем", async () => {
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.resolve(new Response("not json", { status: 200 }))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("ответ без номера магазина — позже: подключение магазинов ещё не открыто", async () => {
    const { merchant_id: _omit, ...rest } = good;
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.resolve(reply(rest))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("заявленная длина больше 64 КБ — не читаем вовсе", async () => {
    const r = await fetchPayLink(ID, {
      fetchImpl: (() =>
        Promise.resolve(reply(good, 200, { "content-length": String(64 * 1024 + 1) }))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("тело больше 64 КБ обрывается", async () => {
    const big = JSON.stringify({ ...good, merchant: "x".repeat(70 * 1024) });
    const r = await fetchPayLink(ID, {
      fetchImpl: (() => Promise.resolve(new Response(big, { status: 200 }))) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
  });

  it("негодный номер наружу не уходит", async () => {
    let called = false;
    const r = await fetchPayLink("pl_bad", {
      fetchImpl: (() => {
        called = true;
        return Promise.resolve(reply(good));
      }) as unknown as typeof fetch,
    });
    expect(r).toEqual({ kind: "later" });
    expect(called).toBe(false);
  });
});
