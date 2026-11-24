import { describe, it, expect } from "vitest";
import { subjectDomain, domainMatches, siteDomain } from "@/lib/claims/domain-subject";

/**
 * Домен объекта берём МЫ, а не заявитель: он уже записан у нас — в карточке
 * или в каталожной записи монеты. Доказательство на домене, который назвал сам
 * заявитель, доказательством не является.
 */

describe("siteDomain", () => {
  it("хост без www и в нижнем регистре", () => {
    expect(siteDomain("https://Acala.Network/")).toBe("acala.network");
    expect(siteDomain("https://www.revolut.com")).toBe("revolut.com");
    expect(siteDomain("acala.network")).toBe("acala.network");
  });

  it("путь и запрос отбрасываются", () => {
    expect(siteDomain("https://app.hyperliquid.xyz/trade?x=1")).toBe("app.hyperliquid.xyz");
  });

  it("не адрес — ничего", () => {
    expect(siteDomain("")).toBeNull();
    expect(siteDomain("   ")).toBeNull();
    expect(siteDomain("https://localhost:3000")).toBeNull();
    expect(siteDomain("не адрес")).toBeNull();
  });
});

describe("subjectDomain", () => {
  it("у карточки монеты сайт из самой карточки сильнее каталожного", () => {
    expect(
      subjectDomain({
        kind: "COIN_CARD",
        links: { website: "https://taler.uno" },
        coinWebsiteUrl: "https://coingecko.example/taler",
      }),
    ).toBe("taler.uno");
  });

  it("у посеянной карточки домен берётся из каталожной записи монеты", () => {
    expect(
      subjectDomain({ kind: "COIN_CARD", links: null, coinWebsiteUrl: "https://acala.network/" }),
    ).toBe("acala.network");
  });

  it("негодный сайт карточки не мешает каталожному", () => {
    expect(
      subjectDomain({
        kind: "COIN_CARD",
        links: { website: "нет" },
        coinWebsiteUrl: "https://akash.network",
      }),
    ).toBe("akash.network");
  });

  it("домена нет вовсе — null, и двери на объекте не будет", () => {
    expect(subjectDomain({ kind: "COIN_CARD", links: null, coinWebsiteUrl: null })).toBeNull();
  });

  it("у финтех-записи домен из её сайта", () => {
    expect(subjectDomain({ kind: "FINTECH", website: "https://wirexapp.com" })).toBe(
      "wirexapp.com",
    );
  });
});

describe("domainMatches", () => {
  it("равенство — обычный случай", () => {
    expect(domainMatches("acala.network", "acala.network")).toBe("EXACT");
  });

  it("домен письма — родитель домена объекта: владелец зоны доказывает больше", () => {
    expect(domainMatches("hyperliquid.xyz", "app.hyperliquid.xyz")).toBe("PARENT");
  });

  it("домен письма — поддомен домена объекта: принимаем, но помечаем", () => {
    expect(domainMatches("mail.acala.network", "acala.network")).toBe("SUBDOMAIN");
  });

  it("чужой домен не подходит", () => {
    expect(domainMatches("evil.example", "acala.network")).toBeNull();
    expect(domainMatches("acala.network.evil.example", "acala.network")).toBeNull();
    // Похожее окончание — не поддомен: граница считается по метке.
    expect(domainMatches("notacala.network", "acala.network")).toBeNull();
  });

  it("публичный суффикс совпадением не считается", () => {
    // Иначе письмо с любого британского домена подошло бы ко всем .co.uk.
    expect(domainMatches("co.uk", "shop.co.uk")).toBeNull();
    expect(domainMatches("com.br", "loja.com.br")).toBeNull();
    expect(domainMatches("com", "acala.com")).toBeNull();
  });

  it("сам публичный суффикс как домен объекта тоже не годится", () => {
    expect(domainMatches("shop.co.uk", "co.uk")).toBeNull();
  });

  it("пустые значения ничего не доказывают", () => {
    expect(domainMatches("", "acala.network")).toBeNull();
    expect(domainMatches("acala.network", "")).toBeNull();
  });
});
