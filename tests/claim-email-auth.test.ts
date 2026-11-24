import { describe, it, expect } from "vitest";
import { provedDomains, fromAddress, fromDomain } from "@/lib/claims/email-auth";

/**
 * Доказательство домена во входящем письме. Главная проверка слайса CI:
 * `From` подделать стоит ноль, поэтому доказательством служит только подпись
 * домена, проверенная НАШИМ почтовым сервером.
 */

const OUR = "mail.selyanska.eu";

describe("provedDomains", () => {
  it("принимает dkim=pass нашего сервера", () => {
    const h = [
      `Authentication-Results: ${OUR}; dkim=pass header.d=acala.network header.s=mail; spf=pass smtp.mailfrom=acala.network; dmarc=pass`,
    ];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "acala.network", proof: "DKIM" },
    ]);
  });

  it("не верит заголовку чужого сервера: его пишет кто угодно по пути", () => {
    const h = [
      `Authentication-Results: relay.evil.example; dkim=pass header.d=acala.network`,
    ];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([]);
  });

  it("берёт только верхний наш заголовок: при приёме он добавляется сверху", () => {
    const h = [
      `Authentication-Results: ${OUR}; dkim=none; spf=none; dmarc=none`,
      `Authentication-Results: ${OUR}; dkim=pass header.d=acala.network`,
    ];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([]);
  });

  it("dkim=fail и dkim=none доказательством не являются", () => {
    for (const verdict of ["fail", "none", "temperror", "permerror", "neutral"]) {
      const h = [`Authentication-Results: ${OUR}; dkim=${verdict} header.d=acala.network`];
      expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([]);
    }
  });

  it("dmarc=pass со spf=pass доказывает домен From: это и есть согласование", () => {
    const h = [
      `Authentication-Results: ${OUR}; dkim=none; spf=pass smtp.mailfrom=acala.network; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acala.network`,
    ];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "acala.network", proof: "DMARC_SPF" },
    ]);
  });

  it("dmarc=pass без spf=pass не доказывает: согласование могло прийти через DKIM чужого домена", () => {
    const h = [
      `Authentication-Results: ${OUR}; dkim=pass header.d=mailer.example; spf=fail; dmarc=pass header.from=acala.network`,
    ];
    // Доказан домен подписи, а не домен From.
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "mailer.example", proof: "DKIM" },
    ]);
  });

  it("подпись чужого домена остаётся подписью чужого домена", () => {
    const h = [`Authentication-Results: ${OUR}; dkim=pass header.d=sendgrid.net`];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "sendgrid.net", proof: "DKIM" },
    ]);
  });

  it("несколько подписей — несколько доказанных доменов, без повторов", () => {
    const h = [
      `Authentication-Results: ${OUR}; dkim=pass header.d=acala.network; dkim=pass header.d=ACALA.network; dkim=pass header.d=mailgun.org`,
    ];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "acala.network", proof: "DKIM" },
      { domain: "mailgun.org", proof: "DKIM" },
    ]);
  });

  it("имя сервера сравнивается без регистра и с точкой на конце", () => {
    const h = [`Authentication-Results: MAIL.Selyanska.EU.; dkim=pass header.d=acala.network`];
    expect(provedDomains(h, OUR, "ops@acala.network")).toHaveLength(1);
  });

  it("нет заголовка вовсе — ничего не доказано", () => {
    expect(provedDomains([], OUR, "ops@acala.network")).toEqual([]);
  });

  it("домен подписи в кавычках и с www не ломает разбор", () => {
    const h = [`Authentication-Results: ${OUR}; dkim=pass header.d="www.acala.network"`];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([
      { domain: "acala.network", proof: "DKIM" },
    ]);
  });

  it("мусор вместо домена подписи отбрасывается", () => {
    const h = [`Authentication-Results: ${OUR}; dkim=pass header.d=localhost`];
    expect(provedDomains(h, OUR, "ops@acala.network")).toEqual([]);
  });
});

describe("fromAddress / fromDomain", () => {
  it("достаёт адрес из формы с именем", () => {
    expect(fromAddress('"Acala Ops" <Ops@Acala.Network>')).toBe("ops@acala.network");
  });

  it("достаёт адрес из голой формы", () => {
    expect(fromAddress("ops@acala.network")).toBe("ops@acala.network");
  });

  it("отвергает то, что адресом не является", () => {
    expect(fromAddress("Acala Ops")).toBeNull();
    expect(fromAddress("")).toBeNull();
    expect(fromAddress("ops@localhost")).toBeNull();
  });

  it("домен адреса — без www и в нижнем регистре", () => {
    expect(fromDomain("ops@WWW.Acala.Network")).toBe("acala.network");
    expect(fromDomain("нет")).toBeNull();
  });
});
